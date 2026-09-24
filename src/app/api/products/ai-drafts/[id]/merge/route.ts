import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import DeletionLog from "@/models/DeletionLog";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
import { parseExpiryDate } from "@/lib/parseExpiryDate";
import { isMonakTriageLocked, triageLockedResponse } from "@/lib/monakTriageLock";

interface MergePayload {
  productId: string;
  quantity: number;
  expiryDate?: string | null;
  // Operator-confirmed from the merge screen — previously this route never touched price
  // at all, silently keeping whatever the existing product already had (correct or stale)
  // with no chance for the operator to even see, let alone correct, it.
  retailPrice?: number;
  wholesalePrice?: number;
}

// Merge a triaged snap into an EXISTING product instead of creating a duplicate — used
// when the same physical item turns up on a second shelf and gets re-photographed.
// Adds a new ProductBatch + bumps quantityInStock rather than creating a second Product.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    if (isMonakTriageLocked(session.user.pharmacyId)) return triageLockedResponse();
    await dbConnect();

    const { id } = await params;
    const { productId, quantity, expiryDate, retailPrice, wholesalePrice } = (await request.json()) as MergePayload;

    if (!productId || !quantity || Number(quantity) < 1) {
      return NextResponse.json(
        { error: "productId and a positive quantity are required" },
        { status: 400 }
      );
    }
    if (retailPrice !== undefined && (!Number.isFinite(retailPrice) || retailPrice < 0)) {
      return NextResponse.json({ error: "retailPrice must be a non-negative number" }, { status: 400 });
    }
    if (wholesalePrice !== undefined && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) {
      return NextResponse.json({ error: "wholesalePrice must be a non-negative number" }, { status: 400 });
    }

    const { pharmacyId } = session.user;

    // Same atomic claim as the normal confirm path — protects against one operator
    // merging this draft while another is simultaneously confirming it as new.
    const draft = await AiDraftProduct.findOneAndUpdate(
      { _id: id, pharmacyId, status: { $nin: ["completed", "confirming"] } },
      { $set: { status: "confirming" } },
      { new: true }
    ).lean();

    if (!draft) {
      const existing = await AiDraftProduct.findOne({ _id: id, pharmacyId }).lean();
      if (!existing) {
        return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "This item is already being processed by another operator." },
        { status: 409 }
      );
    }

    const existingProduct = await Product.findOne({ _id: productId, pharmacyId }).lean();
    if (!existingProduct) {
      await AiDraftProduct.findOneAndUpdate(
        { _id: id, pharmacyId, status: "confirming" },
        { $set: { status: "pending" } }
      );
      return NextResponse.json({ error: "Target product not found" }, { status: 404 });
    }

    const branchId = existingProduct.branchId.toString();
    const parsedExpiry = parseExpiryDate(expiryDate);
    const parsedQty = Number(quantity);
    // Only set fields the operator actually confirmed — omitted entirely (not just 0)
    // leaves the existing product's price untouched, same as this route's prior behavior.
    const priceSet: Record<string, number> = {};
    if (retailPrice !== undefined) priceSet.retailPrice = retailPrice;
    if (wholesalePrice !== undefined) priceSet.wholesalePrice = wholesalePrice;

    // This draft may already have its OWN live product (the pre-open bulk-publish flow
    // creates one immediately, then leaves the draft visible for an operator to finish
    // triaging). If the operator now merges it into a DIFFERENT existing product, the
    // already-published one can't just be left behind — that's exactly the duplicate
    // leak this whole merge feature exists to prevent. Retire it into the target instead
    // of adding a fresh batch: reassign its batch history, fold in its actual CURRENT
    // quantityInStock (not the operator-typed `quantity`, since live sales may already
    // have moved it since publish), then delete it.
    const alreadyPublishedProduct =
      draft.productId && String(draft.productId) !== String(existingProduct._id)
        ? await Product.findOne({ _id: draft.productId, pharmacyId }).lean()
        : null;

    const dbSession = await mongoose.startSession();

    try {
      await dbSession.withTransaction(async () => {
        if (alreadyPublishedProduct) {
          await ProductBatch.updateMany(
            { productId: alreadyPublishedProduct._id },
            { $set: { productId: existingProduct._id } },
            { session: dbSession }
          );

          await Product.findByIdAndUpdate(
            existingProduct._id,
            { $inc: { quantityInStock: alreadyPublishedProduct.quantityInStock }, $set: priceSet },
            { session: dbSession }
          );

          // POS caches the catalog locally per terminal and only knows to force a full
          // resync (instead of a normal incremental delta) when it sees a DeletionLog
          // entry newer than its last sync — without one here, this retired duplicate
          // would stay as a permanent "ghost" in every terminal's local cache forever,
          // no refresh able to clear it since nothing ever recorded the deletion.
          await DeletionLog.create(
            [
              {
                pharmacyId,
                branchId,
                type: "single",
                deletedByUserId: session.user.id,
                deletedByName: session.user.name ?? "Unknown",
                itemCount: 1,
                summary: `Fast Mobile Entry (Triage): Retired duplicate ${formatProductLabel(alreadyPublishedProduct)} after merging it into ${formatProductLabel(existingProduct)}`,
                productSnapshot: alreadyPublishedProduct,
              },
            ],
            { session: dbSession }
          );

          await Product.findByIdAndDelete(alreadyPublishedProduct._id, { session: dbSession });

          await logActivity(dbSession, {
            pharmacyId,
            scope: "branch",
            branchId,
            actorUserId: session.user.id,
            actorName: session.user.name ?? "Unknown",
            action: "duplicate_merge",
            summary: `Fast Mobile Entry (Triage): Merged already-published duplicate ${formatProductLabel(alreadyPublishedProduct)} (${alreadyPublishedProduct.quantityInStock} units) into ${formatProductLabel(existingProduct)}`,
            refCollection: "Product",
            refId: existingProduct._id,
          });
        } else {
          await ProductBatch.create(
            [
              {
                pharmacyId,
                branchId,
                productId: existingProduct._id,
                quantity: parsedQty,
                remainingQuantity: parsedQty,
                batchNumber: "",
                expiryDate: parsedExpiry,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );

          await Product.findByIdAndUpdate(
            existingProduct._id,
            { $inc: { quantityInStock: parsedQty }, $set: priceSet },
            { session: dbSession }
          );

          await logActivity(dbSession, {
            pharmacyId,
            scope: "branch",
            branchId,
            actorUserId: session.user.id,
            actorName: session.user.name ?? "Unknown",
            action: "receive",
            summary: `Fast Mobile Entry (Triage): Added ${parsedQty} more units of ${formatProductLabel(existingProduct)} found on another shelf`,
            refCollection: "Product",
            refId: existingProduct._id,
          });
        }

        await AiDraftProduct.findByIdAndUpdate(
          id,
          { status: "completed", productId: existingProduct._id },
          { session: dbSession }
        );
      });
    } catch (transactionError) {
      await AiDraftProduct.findOneAndUpdate(
        { _id: id, pharmacyId, status: "confirming" },
        { $set: { status: "pending" } }
      ).catch(() => {});
      throw transactionError;
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, productId: existingProduct._id, addedQuantity: parsedQty });
  } catch (error) {
    return handleApiError(error);
  }
}
