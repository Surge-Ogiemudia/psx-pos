import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { compareBatchesFifo, planBestEffortDraw } from "@/lib/unitHierarchy";
import { formatProductLabel } from "@/lib/types";
import { parseNumeric } from "@/lib/numberInput";
import { handleApiError } from "@/lib/apiError";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const newQuantity = parseNumeric(body.newQuantity);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      return NextResponse.json({ error: "New quantity must be a non-negative number" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required for a stock adjustment" }, { status: 400 });
    }

    const scope = getBranchScope(session, body.branchId);
    const product = await Product.findOne({ _id: id, ...scope });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const delta = newQuantity - product.quantityInStock;
    if (delta === 0) {
      return NextResponse.json({ error: "That's already the current stock count — nothing to adjust" }, { status: 400 });
    }

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        if (delta > 0) {
          // Found more than recorded — a new batch of unknown origin, expiry not yet known.
          await ProductBatch.create(
            [
              {
                ...scope,
                productId: product._id,
                quantity: delta,
                remainingQuantity: delta,
                batchNumber: "",
                expiryDate: null,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );
        } else {
          // Came up short — draw the difference down from real batches FIFO (soonest expiry
          // first), same as a sale would, on a best-effort basis so legacy/untracked stock
          // never blocks the correction the admin is explicitly making.
          const shortfall = -delta;
          const rawBatches = await ProductBatch.find(
            { productId: product._id, ...scope, remainingQuantity: { $gt: 0 } },
            null,
            { session: dbSession }
          ).lean();
          const drawPlan = planBestEffortDraw(
            rawBatches.sort(compareBatchesFifo).map((b) => ({ id: b._id.toString(), remainingBaseUnitQuantity: b.remainingQuantity })),
            shortfall
          );
          for (const draw of drawPlan) {
            await ProductBatch.findOneAndUpdate(
              { _id: draw.id, ...scope, remainingQuantity: { $gte: draw.baseUnitsDrawn } },
              { $inc: { remainingQuantity: -draw.baseUnitsDrawn } },
              { session: dbSession }
            );
          }
        }

        await Product.findOneAndUpdate({ _id: product._id }, { $set: { quantityInStock: newQuantity } }, { session: dbSession });

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "stock_adjustment",
          summary: `${session.user.name} adjusted ${formatProductLabel(product)} from ${product.quantityInStock} to ${newQuantity} (${reason})`,
          metadata: { previousQuantity: product.quantityInStock, newQuantity, delta, reason },
          refCollection: "Product",
          refId: product._id,
        });
      });
    } finally {
      await dbSession.endSession();
    }

    const updated = await Product.findOne({ _id: id, ...scope }).lean();
    return NextResponse.json({ product: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
