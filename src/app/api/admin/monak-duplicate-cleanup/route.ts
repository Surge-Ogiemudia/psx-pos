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
const BATCH_SIZE = 1500; // bulkWrite, not per-item transactions — see note below

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

    // Re-fetch fresh (not the values from the top-of-request snapshot) so a sale that landed
    // in the last few seconds is still correctly reflected in the orphan's quantity.
    const orphanIds = pairs.map((p) => p.orphan._id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freshOrphans = await Product.find({ _id: { $in: orphanIds } }).lean<any[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freshOrphanById = new Map<string, any>(freshOrphans.map((o) => [String(o._id), o]));

    // One bulkWrite per collection covering the whole batch, instead of one full ACID
    // transaction per pair — per-item transactions were the actual bottleneck (each one is
    // several sequential round-trips + a multi-document commit), timing out the function at
    // even 150 items. This trades cross-collection atomicity-per-pair for throughput; it's a
    // safe trade here because the whole job is already idempotent (rebuilds the pair list
    // fresh every call) — a partial failure just means that pair gets picked up again next call,
    // never double-processed or corrupted.
    const productOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
    const batchOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deletionLogDocs: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skipped: any[] = [];

    for (const { orphan, kept } of pairs) {
      const freshOrphan = freshOrphanById.get(String(orphan._id));
      if (!freshOrphan) {
        skipped.push({ item: kept.itemName, orphanId: String(orphan._id), reason: "orphan already gone" });
        continue;
      }
      const S_k = soldById.get(String(kept._id)) || 0;
      const finalQty = Math.max(0, freshOrphan.quantityInStock - S_k);

      productOps.push({
        updateOne: { filter: { _id: kept._id }, update: { $set: { quantityInStock: finalQty } } },
      });
      productOps.push({ deleteOne: { filter: { _id: orphan._id } } });
      batchOps.push({
        updateMany: { filter: { productId: orphan._id }, update: { $set: { productId: kept._id } } },
      });
      deletionLogDocs.push({
        pharmacyId,
        branchId: kept.branchId,
        type: "single",
        deletedByUserId: systemUserId,
        deletedByName: SYSTEM_NAME,
        itemCount: 1,
        summary: `Duplicate reconciliation: removed accidental double-publish duplicate of "${kept.itemName}" (${freshOrphan.quantityInStock} units) after reconciling against sales; kept product corrected to ${finalQty} units`,
        productSnapshot: freshOrphan,
      });
    }

    if (deletionLogDocs.length > 0) await DeletionLog.insertMany(deletionLogDocs, { ordered: false });
    if (batchOps.length > 0) await ProductBatch.bulkWrite(batchOps, { ordered: false });
    if (productOps.length > 0) await Product.bulkWrite(productOps, { ordered: false });

    const succeeded = deletionLogDocs.length;

    return NextResponse.json({
      success: true,
      processed: succeeded,
      skipped: skipped.length,
      skippedDetail: skipped.slice(0, 20),
      remaining: totalRemainingBeforeThisCall - succeeded,
      done: totalRemainingBeforeThisCall - succeeded <= 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
