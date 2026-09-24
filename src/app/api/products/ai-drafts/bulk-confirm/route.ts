import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { parseExpiryDate } from "@/lib/parseExpiryDate";
import { isMonakTriageLocked, triageLockedResponse } from "@/lib/monakTriageLock";

// Emergency pre-open safety valve: push every already AI-read snap straight into the
// live catalog in one shot, price simply flagged missing rather than blocking (checkout
// itself refuses to sell anything still at ₦0 — see the guard in src/app/api/sales/route.ts).
// Done as bulk Mongo operations (insertMany/bulkWrite), never a per-item loop — that's what
// keeps this safe well past any serverless timeout even at four-figure item counts. No
// multi-collection transaction wrapping the bulk writes on purpose: an interrupted
// transaction across a huge insertMany is a worse failure mode (silent full rollback,
// no partial progress) than the small window here where a product could in principle be
// created without every AiDraftProduct row linked yet — every step is idempotent and
// re-queryable, so a partial run is just re-run, not corrupted data.
//
// Deliberately does NOT mark drafts "completed" — it links each one to its new live
// product via productId but leaves status as "extracted", so every item stays visible in
// Panel 1/2/3 for an operator to finish triaging (real price, corrected name/brand,
// duplicate check) even though it's already sellable. The `productId: null` filter below
// is what makes this idempotent — re-running it only picks up items that haven't been
// published yet, never double-publishes something already live.
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    if (isMonakTriageLocked(session.user.pharmacyId)) return triageLockedResponse();
    await dbConnect();

    const body = await request.json().catch(() => ({}));
    const { pharmacyId, branchId } = getBranchScope(session, body.branchId);

    const drafts = await AiDraftProduct.find({
      pharmacyId,
      branchId,
      status: "extracted",
      productId: null,
      extractedItemName: { $exists: true, $ne: null },
    }).lean();

    if (drafts.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const productDocs = drafts.map((draft) => {
      const brand = draft.extractedBrand?.trim() || "Unknown";
      const size = draft.extractedSize?.trim() || "Standard";
      const parsedExpiry = parseExpiryDate(
        draft.extractedExpiryDate ? new Date(draft.extractedExpiryDate).toISOString() : null
      ); // extractedExpiryDate is stored as a Date already; still routed through the shared
      // guard so any corrupted value (e.g. a stray Excel-serial-as-year date) gets caught here too.
      const retailPrice = Number(draft.retailPrice) || 0;

      const needsReviewReason: string[] = [];
      if (!draft.extractedBrand?.trim()) needsReviewReason.push("missing_brand");
      if (!draft.extractedSize?.trim()) needsReviewReason.push("missing_size");
      if (!parsedExpiry) needsReviewReason.push("missing_expiry");
      if (!retailPrice || retailPrice <= 0) needsReviewReason.push("missing_price");

      return {
        _id: new mongoose.Types.ObjectId(),
        draftId: draft._id,
        doc: {
          pharmacyId,
          branchId,
          itemName: draft.extractedItemName!.trim(),
          brand,
          size,
          category: draft.category || "supermarket",
          imageUrl: draft.frontImageUrl || null,
          quantityInStock: draft.quantityInStock,
          alertQuantity: Math.max(1, Math.floor(draft.quantityInStock * 0.2)),
          retailPrice,
          wholesalePrice: 0,
          distributorPrice: 0,
          costPrice: 0,
          expiryDate: parsedExpiry,
          barcode: draft.extractedBarcode || "",
          needsReviewReason,
        },
      };
    });

    await Product.insertMany(
      productDocs.map((p) => ({ _id: p._id, ...p.doc })),
      { ordered: false }
    );

    const batchDocs = productDocs
      .filter((p) => p.doc.quantityInStock > 0)
      .map((p) => ({
        pharmacyId,
        branchId,
        productId: p._id,
        quantity: p.doc.quantityInStock,
        remainingQuantity: p.doc.quantityInStock,
        batchNumber: "",
        expiryDate: p.doc.expiryDate,
        receivedByUserId: session.user.id,
        receivedAt: new Date(),
      }));
    if (batchDocs.length > 0) {
      await ProductBatch.insertMany(batchDocs, { ordered: false });
    }

    await AiDraftProduct.bulkWrite(
      productDocs.map((p) => ({
        updateOne: {
          filter: { _id: p.draftId },
          update: { $set: { productId: p._id } },
        },
      }))
    );

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await logActivity(dbSession, {
          pharmacyId,
          scope: "branch",
          branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "product_create",
          summary: `Published ${productDocs.length} AI-read items to the live catalog (emergency pre-open sweep) — still open in the triage queue for review`,
          refCollection: "Product",
          refId: null,
        });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, count: productDocs.length });
  } catch (error) {
    return handleApiError(error);
  }
}
