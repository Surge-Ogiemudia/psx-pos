import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
import { parseExpiryDate } from "@/lib/parseExpiryDate";
import { isMonakTriageLocked, triageLockedResponse } from "@/lib/monakTriageLock";

interface ConfirmPayload {
  itemName: string;
  brand: string;
  size: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string | null;
  quantity: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice?: number;
  frontImageUrl: string;
  backImageUrl?: string | null;
}

// Manual triage confirmation for an AiDraftProduct (e.g. Monak Triage), as opposed to
// the Gemini-driven auto-extract in ai-drafts/[id]/process.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    if (isMonakTriageLocked(session.user.pharmacyId)) return triageLockedResponse();
    await dbConnect();

    const { id } = await params;
    const body = (await request.json()) as ConfirmPayload;
    const {
      itemName,
      brand,
      size,
      category,
      expiryDate,
      quantity,
      retailPrice,
      wholesalePrice,
      distributorPrice = 0,
      frontImageUrl,
    } = body;

    if (!itemName?.trim()) {
      return NextResponse.json(
        { error: "itemName is required" },
        { status: 400 }
      );
    }

    const { pharmacyId } = session.user;

    // Atomic claim: with multiple operators triaging in parallel, this is the guard
    // against two of them confirming the same snap at once. Whoever's update actually
    // flips pending/extracted/error -> "confirming" wins; the other gets null back.
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

    const branchId = draft.branchId.toString();
    const alertQuantity = Math.max(1, Math.floor(Number(quantity) * 0.2));
    const parsedExpiry = parseExpiryDate(expiryDate);
    const parsedQty = Number(quantity);

    // Computed from the RAW client input, before any storage fallback is applied below,
    // so the flag accurately reflects what the operator actually left blank rather than
    // the placeholder value that ends up stored.
    const needsReviewReason: string[] = [];
    if (!brand?.trim()) needsReviewReason.push("missing_brand");
    if (!size?.trim()) needsReviewReason.push("missing_size");
    if (!parsedExpiry) needsReviewReason.push("missing_expiry");
    if (!retailPrice || Number(retailPrice) <= 0) needsReviewReason.push("missing_price");

    const dbSession = await mongoose.startSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let product: any = null;

    try {
      await dbSession.withTransaction(async () => {
        // This draft may already have a live Product — the pre-open bulk-publish flow
        // creates the catalog entry immediately (so it's sellable right away) but leaves
        // the draft's status as "extracted" instead of "completed", specifically so it
        // stays visible here for an operator to finish triaging later. In that case this
        // confirm is an EDIT of the already-live product, not a second creation.
        // quantityInStock/ProductBatch are deliberately left untouched here — by the time
        // an operator gets to it, the product may already have live sales against it, so
        // this path only ever touches identity/pricing fields, never stock.
        const existingProduct = draft.productId
          ? await Product.findOne({ _id: draft.productId, pharmacyId }, null, { session: dbSession })
          : null;

        if (existingProduct) {
          product = await Product.findByIdAndUpdate(
            existingProduct._id,
            {
              $set: {
                itemName: itemName.trim(),
                brand: brand?.trim() || "Unknown",
                size: size?.trim() || "Standard",
                category,
                imageUrl: frontImageUrl || existingProduct.imageUrl,
                retailPrice: Number(retailPrice) || 0,
                wholesalePrice: Number(wholesalePrice) || 0,
                distributorPrice: Number(distributorPrice) || 0,
                expiryDate: parsedExpiry,
                needsReviewReason,
              },
            },
            { new: true, session: dbSession }
          );

          await AiDraftProduct.findByIdAndUpdate(
            id,
            { status: "completed", productId: product!._id },
            { session: dbSession }
          );
          return;
        }

        const created = await Product.create(
          [
            {
              pharmacyId,
              branchId,
              itemName: itemName.trim(),
              // Product.brand has a strict minlength:1 validator, so an empty/missing brand
              // can't be stored as "" — fall back to a placeholder, same idea as size's
              // "Standard" below. The missing_brand flag (computed above, pre-fallback) is
              // what actually records that it wasn't known.
              brand: brand?.trim() || "Unknown",
              size: size?.trim() || "Standard",
              category,
              imageUrl: frontImageUrl || null,
              quantityInStock: parsedQty,
              alertQuantity,
              retailPrice: Number(retailPrice) || 0,
              wholesalePrice: Number(wholesalePrice) || 0,
              distributorPrice: Number(distributorPrice) || 0,
              costPrice: 0,
              expiryDate: parsedExpiry,
              barcode: "",
              unitHierarchy: [],
              needsReviewReason,
            },
          ],
          { session: dbSession }
        );
        product = created[0];

        if (parsedQty > 0) {
          await ProductBatch.create(
            [
              {
                pharmacyId,
                branchId,
                productId: product._id,
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
        }

        await logActivity(dbSession, {
          pharmacyId,
          scope: "branch",
          branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "product_create",
          summary: `Fast Mobile Entry (Triage): Added ${formatProductLabel(product!)} to the catalog`,
          refCollection: "Product",
          refId: product!._id,
        });

        await AiDraftProduct.findByIdAndUpdate(
          id,
          { status: "completed", productId: product!._id },
          { session: dbSession }
        );
      });
    } catch (transactionError) {
      // Release the claim so the item goes back to the queue instead of being stuck
      // in "confirming" forever because one operator's save failed partway through.
      await AiDraftProduct.findOneAndUpdate(
        { _id: id, pharmacyId, status: "confirming" },
        { $set: { status: "pending" } }
      ).catch(() => {});
      throw transactionError;
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, product });
  } catch (error) {
    return handleApiError(error);
  }
}
