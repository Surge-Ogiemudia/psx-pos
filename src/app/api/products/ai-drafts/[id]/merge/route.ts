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

interface MergePayload {
  productId: string;
  quantity: number;
  expiryDate?: string | null;
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
    await dbConnect();

    const { id } = await params;
    const { productId, quantity, expiryDate } = (await request.json()) as MergePayload;

    if (!productId || !quantity || Number(quantity) < 1) {
      return NextResponse.json(
        { error: "productId and a positive quantity are required" },
        { status: 400 }
      );
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

    const dbSession = await mongoose.startSession();

    try {
      await dbSession.withTransaction(async () => {
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
          { $inc: { quantityInStock: parsedQty } },
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
