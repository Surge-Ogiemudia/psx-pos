import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import DeletionLog from "@/models/DeletionLog";
import Sale from "@/models/Sale";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// One-time cleanup for the accidental double-publish of Monak's emergency pre-open sweep
// (bulk-publish-live.js ran twice, 36 seconds apart, creating two separate live Products
// for every AI-read draft instead of one). Locked to Monak specifically — this is not a
// general-purpose tool, it targets one known, already-diagnosed incident.
const MONAK_PHARMACY_ID = "6a5f61da9e1719c3b02842ae";
const MONAK_SYSTEM_USER_ID = "6a5f61da9e1719c3b02842ae"; // Monak's own generic owner account
const SYSTEM_NAME = "System (duplicate reconciliation cleanup)";
const SINCE_DATE = new Date("2026-09-20T00:00:00.000Z");
const BATCH_SIZE = 400; // stays comfortably inside the 300s function budget per call

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    if (session.user.pharmacyId !== MONAK_PHARMACY_ID) {
      return NextResponse.json({ error: "This cleanup is scoped to Monak Pharmacy only" }, { status: 403 });
    }

    await dbConnect();

    const pharmacyId = new mongoose.Types.ObjectId(MONAK_PHARMACY_ID);
    const systemUserId = new mongoose.Types.ObjectId(MONAK_SYSTEM_USER_ID);

    // Rebuild the pair list fresh every call — orphans already merged in a prior call
    // simply won't exist anymore, so this naturally resumes wherever the last call left off.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allDrafts = await AiDraftProduct.find({ pharmacyId }).lean<any[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allProducts = await Product.find({ pharmacyId }).lean<any[]>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftByPhoto = new Map<string, any>();
    for (const d of allDrafts) {
      if (!d.frontImageUrl || draftByPhoto.has(d.frontImageUrl)) continue;
      draftByPhoto.set(d.frontImageUrl, d);
    }
    const linkedProductIds = new Set(allDrafts.filter((d) => d.productId).map((d) => String(d.productId)));
    const orphanedProducts = allProducts.filter((p) => !linkedProductIds.has(String(p._id)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productById = new Map<string, any>(allProducts.map((p) => [String(p._id), p]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPairs: { orphan: any; kept: any }[] = [];
    for (const orphan of orphanedProducts) {
      const draft = orphan.imageUrl ? draftByPhoto.get(orphan.imageUrl) : null;
      if (!draft || !draft.productId) continue;
      const kept = productById.get(String(draft.productId));
      if (!kept) continue;
      allPairs.push({ orphan, kept });
    }

    const totalRemainingBeforeThisCall = allPairs.length;
    const pairs = allPairs.slice(0, BATCH_SIZE);

    if (pairs.length === 0) {
      return NextResponse.json({ success: true, processed: 0, failed: 0, remaining: 0, done: true });
    }

    const keptIds = pairs.map((p) => p.kept._id);
    const salesAgg = await Sale.aggregate([
      { $match: { pharmacyId, timestamp: { $gte: SINCE_DATE }, "items.productId": { $in: keptIds } } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $in: keptIds } } },
      { $group: { _id: "$items.productId", totalSold: { $sum: "$items.quantity" } } },
    ]);
    const soldById = new Map(salesAgg.map((r) => [String(r._id), r.totalSold as number]));

    let succeeded = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failures: any[] = [];

    for (const { orphan, kept } of pairs) {
      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => {
          const freshOrphan = await Product.findById(orphan._id).session(dbSession).lean();
          const freshKept = await Product.findById(kept._id).session(dbSession).lean();
          if (!freshOrphan) throw new Error("orphan already gone");
          if (!freshKept) throw new Error("kept product missing");

          const S_k = soldById.get(String(kept._id)) || 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const finalQty = Math.max(0, (freshOrphan as any).quantityInStock - S_k);

          await Product.findByIdAndUpdate(
            kept._id,
            { $set: { quantityInStock: finalQty } },
            { session: dbSession }
          );

          await ProductBatch.updateMany(
            { productId: orphan._id },
            { $set: { productId: kept._id } },
            { session: dbSession }
          );

          await DeletionLog.create(
            [
              {
                pharmacyId,
                branchId: kept.branchId,
                type: "single",
                deletedByUserId: systemUserId,
                deletedByName: SYSTEM_NAME,
                itemCount: 1,
                summary: `Duplicate reconciliation: removed accidental double-publish duplicate of "${kept.itemName}" (${
                  (freshOrphan as { quantityInStock: number }).quantityInStock
                } units) after reconciling against sales; kept product corrected to ${finalQty} units`,
                productSnapshot: freshOrphan,
              },
            ],
            { session: dbSession }
          );

          await Product.findByIdAndDelete(orphan._id, { session: dbSession });
        });
        succeeded++;
      } catch (err) {
        failures.push({
          item: kept.itemName,
          keptId: String(kept._id),
          orphanId: String(orphan._id),
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await dbSession.endSession();
      }
    }

    return NextResponse.json({
      success: true,
      processed: succeeded,
      failed: failures.length,
      failures: failures.slice(0, 20),
      remaining: totalRemainingBeforeThisCall - succeeded,
      done: totalRemainingBeforeThisCall - succeeded <= 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
