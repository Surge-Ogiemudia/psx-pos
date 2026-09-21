import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import DeletionLog from "@/models/DeletionLog";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";

interface MergeDuplicatesPayload {
  branchId?: string;
  keptProductId: string;
  mergedProductIds: string[];
  finalQuantity: number;
}

// Collapses a group of duplicate Product documents (the same physical item photographed on
// multiple shelves during the stock-take) into ONE. Every step below operates on arrays
// ($in / updateMany / deleteMany) rather than merging one pair at a time, so an N-way group
// (e.g. the 3-copy "MONAFEN Pain Relieving Gel" case) runs through the exact same transaction
// as a simple 2-way merge — mergedProductIds is just a longer array, nothing else changes.
export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = (await request.json()) as MergeDuplicatesPayload;
    const { keptProductId, mergedProductIds, finalQuantity } = body;
    const scope = getBranchScope(session, body.branchId);

    if (!keptProductId || !Array.isArray(mergedProductIds) || mergedProductIds.length === 0) {
      return NextResponse.json(
        { error: "keptProductId and at least one mergedProductIds entry are required" },
        { status: 400 }
      );
    }
    if (mergedProductIds.includes(keptProductId)) {
      return NextResponse.json(
        { error: "keptProductId cannot also appear in mergedProductIds" },
        { status: 400 }
      );
    }
    const parsedQty = Number(finalQuantity);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      return NextResponse.json({ error: "finalQuantity must be a non-negative number" }, { status: 400 });
    }

    // Scoped find (not findById) so a product belonging to a different pharmacy/branch can
    // never be merged in, even if its id was somehow passed from the client.
    const allIds = [keptProductId, ...mergedProductIds];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const products = await Product.find({ _id: { $in: allIds }, ...scope }).lean<any[]>();
    if (products.length !== allIds.length) {
      return NextResponse.json(
        { error: "One or more products were not found in this pharmacy/branch" },
        { status: 404 }
      );
    }
    const keptProduct = products.find((p) => String(p._id) === keptProductId)!;
    const mergedAwayProducts = products.filter((p) => String(p._id) !== keptProductId);

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        // Reassign every merged-away product's batch/expiry history onto the kept product so
        // it isn't lost — a single updateMany covers any number of merged-away ids at once.
        await ProductBatch.updateMany(
          { productId: { $in: mergedProductIds } },
          { $set: { productId: keptProductId } },
          { session: dbSession }
        );

        await Product.findByIdAndUpdate(
          keptProductId,
          { $set: { quantityInStock: parsedQty } },
          { session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "duplicate_merge",
          summary: `Merged ${mergedAwayProducts.length + 1} duplicate listings of ${formatProductLabel(
            keptProduct
          )} into one (${parsedQty} in stock); removed: ${mergedAwayProducts
            .map((p) => formatProductLabel(p))
            .join(", ")}`,
          refCollection: "Product",
          refId: keptProductId,
        });

        // Every POS terminal caches the catalog locally (IndexedDB) and only knows to force
        // a full resync — rather than a normal incremental delta — when it sees a
        // DeletionLog entry newer than its last sync. Deleting these products without one
        // left merged-away duplicates as permanent "ghosts" in that local cache: POS kept
        // showing the old count/copies forever, no refresh would ever clear them, because
        // nothing ever told it something was deleted.
        await DeletionLog.create(
          [
            {
              pharmacyId: scope.pharmacyId,
              branchId: scope.branchId,
              type: mergedAwayProducts.length > 1 ? "batch" : "single",
              deletedByUserId: session.user.id,
              deletedByName: session.user.name ?? "Unknown",
              itemCount: mergedAwayProducts.length,
              summary: `Merged ${mergedAwayProducts.length + 1} duplicate listings of ${formatProductLabel(
                keptProduct
              )} into one — removed: ${mergedAwayProducts.map((p) => formatProductLabel(p)).join(", ")}`,
              productSnapshot: mergedAwayProducts.length === 1 ? mergedAwayProducts[0] : null,
            },
          ],
          { session: dbSession }
        );

        // Delete every merged-away Product document — their batches were already
        // reassigned above, so nothing is lost, only the duplicate catalog entries.
        await Product.deleteMany({ _id: { $in: mergedProductIds } }, { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, keptProductId, removedProductIds: mergedProductIds });
  } catch (error) {
    return handleApiError(error);
  }
}
