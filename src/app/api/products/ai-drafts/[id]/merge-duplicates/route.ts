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

interface MergeDuplicatesPayload {
  // Operator-confirmed subset of the candidates the siblings/ GET returned — the operator
  // may have deselected any that turned out to be genuinely different items. Never trust
  // the fuzzy match alone to decide this; it only ever proposes candidates.
  siblingDraftIds: string[];
  // Operator-confirmed final stock count for the kept product — defaults client-side to
  // the sum of the kept + every selected sibling's current live quantity, but is editable
  // (same UX as Panel 4's "Final Quantity In Stock" field), so it's trusted as-given here.
  finalQuantity: number;
  itemName: string;
  brand: string;
  size: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string | null;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice?: number;
  frontImageUrl: string;
  backImageUrl?: string | null;
}

async function releaseClaim(draftId: string, pharmacyId: string) {
  // Mirrors the rollback pattern already used by confirm/route.ts and merge/route.ts —
  // release a claimed draft back to "pending" so it returns to the Panel 1 queue instead
  // of being stuck in "confirming" forever after a failed write.
  await AiDraftProduct.findOneAndUpdate(
    { _id: draftId, pharmacyId, status: "confirming" },
    { $set: { status: "pending" } }
  ).catch(() => {});
}

// Panel 1->2: collapses the currently-open draft AND one or more sibling drafts (queue
// duplicates of it — see siblings/route.ts) into a single live Product, in one atomic
// transaction, no matter how many siblings are involved (N-way, not just pairs — mirrors
// how products/duplicates/merge/route.ts already handles an arbitrary-length
// mergedProductIds array).
//
// This route ONLY runs once an operator has explicitly confirmed the merge (picked which
// siblings are genuinely the same item, reviewed/edited the final quantity, and clicked
// the confirm button in Monak Triage) — nothing here is triggered automatically by the
// fuzzy match itself.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;
    const body = (await request.json()) as MergeDuplicatesPayload;
    const {
      siblingDraftIds,
      finalQuantity,
      itemName,
      brand,
      size,
      category,
      expiryDate,
      retailPrice,
      wholesalePrice,
      distributorPrice = 0,
      frontImageUrl,
    } = body;

    if (!itemName?.trim()) {
      return NextResponse.json({ error: "itemName is required" }, { status: 400 });
    }
    if (!Array.isArray(siblingDraftIds) || siblingDraftIds.length === 0) {
      return NextResponse.json(
        { error: "At least one sibling draft id is required — use the normal Save flow if there are no duplicates" },
        { status: 400 }
      );
    }
    if (siblingDraftIds.includes(id)) {
      return NextResponse.json({ error: "siblingDraftIds cannot include the currently-open draft" }, { status: 400 });
    }
    const parsedQty = Number(finalQuantity);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      return NextResponse.json({ error: "finalQuantity must be a non-negative number" }, { status: 400 });
    }

    // --------------- Claim every draft involved, one at a time, before touching anything
    // else. Same atomic status-transition guard as confirm/route.ts and merge/route.ts —
    // {status: {$nin: ["completed","confirming"]}} -> "confirming" — so a different
    // operator can never grab a sibling mid-merge. If any claim fails partway through,
    // everything already claimed is released back to "pending" and the whole request
    // fails, rather than silently merging a partial/different set than what the operator
    // actually confirmed on screen.
    const claimedIds: string[] = [];

    const keptClaim = await AiDraftProduct.findOneAndUpdate(
      { _id: id, pharmacyId, status: { $nin: ["completed", "confirming"] } },
      { $set: { status: "confirming" } },
      { new: true }
    ).lean();
    if (!keptClaim) {
      const existing = await AiDraftProduct.findOne({ _id: id, pharmacyId }).lean();
      if (!existing) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      return NextResponse.json({ error: "This item is already being processed by another operator." }, { status: 409 });
    }
    claimedIds.push(id);

    let claimFailure: NextResponse | null = null;
    for (const siblingId of siblingDraftIds) {
      const claimed = await AiDraftProduct.findOneAndUpdate(
        { _id: siblingId, pharmacyId, status: { $nin: ["completed", "confirming"] } },
        { $set: { status: "confirming" } },
        { new: true }
      ).lean();
      if (!claimed) {
        const existing = await AiDraftProduct.findOne({ _id: siblingId, pharmacyId }).lean();
        claimFailure = NextResponse.json(
          {
            error: existing
              ? "One of the selected duplicates is already being processed by another operator — please re-open this item and try again."
              : "One of the selected duplicates could not be found — please re-open this item and try again.",
          },
          { status: existing ? 409 : 404 }
        );
        break;
      }
      claimedIds.push(siblingId);
    }

    if (claimFailure) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return claimFailure;
    }

    // --------------- Load the kept draft + product, and every sibling's product ---------------
    const keptDraft = keptClaim;
    const keptProduct = keptDraft.productId
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await Product.findOne({ _id: keptDraft.productId, pharmacyId }).lean<any>()
      : null;
    if (!keptProduct) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return NextResponse.json({ error: "The currently-open item has no live product to merge into" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siblingDrafts = await AiDraftProduct.find({ _id: { $in: siblingDraftIds }, pharmacyId }).lean<any[]>();
    if (siblingDrafts.length !== siblingDraftIds.length) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return NextResponse.json({ error: "One or more selected duplicates were not found" }, { status: 404 });
    }
    const siblingProductIds = siblingDrafts
      .map((d) => d.productId)
      .filter((pid): pid is mongoose.Types.ObjectId => Boolean(pid));
    if (siblingProductIds.length !== siblingDrafts.length) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return NextResponse.json({ error: "One or more selected duplicates have no live product to merge" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siblingProducts = await Product.find({ _id: { $in: siblingProductIds }, pharmacyId }).lean<any[]>();
    if (siblingProducts.length !== siblingProductIds.length) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return NextResponse.json(
        { error: "One or more selected duplicates' products were not found in this pharmacy/branch" },
        { status: 404 }
      );
    }
    // Scope guard: every sibling product must belong to the same branch as the kept
    // product — the fuzzy match is already branch-scoped upstream in siblings/route.ts,
    // this just double-checks nothing crossed a branch boundary before we delete anything.
    const mismatchedBranch = siblingProducts.find((p) => String(p.branchId) !== String(keptProduct.branchId));
    if (mismatchedBranch) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      return NextResponse.json({ error: "Selected duplicates span more than one branch" }, { status: 400 });
    }

    const branchId = keptProduct.branchId.toString();
    const parsedExpiry = parseExpiryDate(expiryDate);

    // Same review-flag computation as confirm/route.ts, from the raw operator input.
    const needsReviewReason: string[] = [];
    if (!brand?.trim()) needsReviewReason.push("missing_brand");
    if (!size?.trim()) needsReviewReason.push("missing_size");
    if (!parsedExpiry) needsReviewReason.push("missing_expiry");
    if (!retailPrice || Number(retailPrice) <= 0) needsReviewReason.push("missing_price");

    const dbSession = await mongoose.startSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updatedProduct: any = null;

    try {
      await dbSession.withTransaction(async () => {
        // Whatever the operator actually confirmed in Panel 2/3 for the survivor is what's
        // saved — this feature eliminates duplicate RECORDS, it doesn't skip the normal
        // review of the kept item's data. Quantity is the operator-confirmed final count,
        // not a blind $inc, mirroring products/duplicates/merge/route.ts.
        updatedProduct = await Product.findByIdAndUpdate(
          keptProduct._id,
          {
            $set: {
              itemName: itemName.trim(),
              brand: brand?.trim() || "Unknown",
              size: size?.trim() || "Standard",
              category,
              imageUrl: frontImageUrl || keptProduct.imageUrl,
              quantityInStock: parsedQty,
              retailPrice: Number(retailPrice) || 0,
              wholesalePrice: Number(wholesalePrice) || 0,
              distributorPrice: Number(distributorPrice) || 0,
              expiryDate: parsedExpiry,
              needsReviewReason,
            },
          },
          { new: true, session: dbSession }
        );

        // Reassign every merged-away product's batch/expiry history onto the kept product,
        // same N-way updateMany pattern as products/duplicates/merge/route.ts.
        await ProductBatch.updateMany(
          { productId: { $in: siblingProductIds } },
          { $set: { productId: keptProduct._id } },
          { session: dbSession }
        );

        // POS caches the catalog locally per terminal and only knows to force a full resync
        // (instead of a normal incremental delta) when it sees a DeletionLog entry newer
        // than its last sync — without one here, these merged-away duplicates would stay as
        // permanent "ghosts" in every terminal's local cache, exactly the bug we just fixed
        // elsewhere tonight.
        await DeletionLog.create(
          [
            {
              pharmacyId,
              branchId,
              type: siblingProducts.length > 1 ? "batch" : "single",
              deletedByUserId: session.user.id,
              deletedByName: session.user.name ?? "Unknown",
              itemCount: siblingProducts.length,
              summary: `Monak Triage: Merged ${siblingProducts.length + 1} duplicate queue listings of ${formatProductLabel(
                updatedProduct
              )} into one (${parsedQty} in stock); removed: ${siblingProducts
                .map((p) => formatProductLabel(p))
                .join(", ")}`,
              productSnapshot: siblingProducts.length === 1 ? siblingProducts[0] : null,
            },
          ],
          { session: dbSession }
        );

        await Product.deleteMany({ _id: { $in: siblingProductIds } }, { session: dbSession });

        // Mark EVERY involved draft — the currently-open one and every sibling folded in —
        // as completed, all pointing at the same kept product. This is the part not covered
        // by any existing route: without it, the sibling drafts would stay "extracted" and
        // keep reappearing in Panel 1 even though their products no longer exist.
        await AiDraftProduct.findByIdAndUpdate(
          id,
          { $set: { status: "completed", productId: keptProduct._id } },
          { session: dbSession }
        );
        await AiDraftProduct.updateMany(
          { _id: { $in: siblingDraftIds } },
          { $set: { status: "completed", productId: keptProduct._id } },
          { session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId,
          scope: "branch",
          branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "duplicate_merge",
          summary: `Monak Triage: Merged ${siblingProducts.length + 1} duplicate queue listings into ${formatProductLabel(
            updatedProduct
          )} (${parsedQty} in stock); removed: ${siblingProducts.map((p) => formatProductLabel(p)).join(", ")}`,
          refCollection: "Product",
          refId: keptProduct._id,
        });
      });
    } catch (transactionError) {
      await Promise.all(claimedIds.map((cid) => releaseClaim(cid, pharmacyId)));
      throw transactionError;
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({
      success: true,
      product: updatedProduct,
      keptDraftId: id,
      mergedDraftIds: siblingDraftIds,
      removedProductIds: siblingProductIds.map((pid) => String(pid)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
