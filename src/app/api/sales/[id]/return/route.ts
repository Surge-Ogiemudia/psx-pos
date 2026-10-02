import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";
import { requireApiSession, getBranchScope, ApiAuthError } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";

// "Return Sale" — cleanly undoes a sale rung up TODAY: restocks everything it drew from (full
// batch credit, not a partial one like Refund — nothing can have been refunded from it yet, see
// the guard below), soft-voids the sale record (kept for the activity log, not deleted, and
// excluded from totals/listings from here on), and hands the original line items back so the
// cashier can reload them into the cart and resell. Unlike Refund, this never rewrites a day
// that may already be closed/reconciled — restricted to the SAME calendar day on purpose.
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

function lagosDateKey(d: Date): string {
  const lagos = new Date(d.getTime() + LAGOS_OFFSET_MS);
  return `${lagos.getUTCFullYear()}-${lagos.getUTCMonth()}-${lagos.getUTCDate()}`;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const role = session.user.role;
    if (role !== "admin" && !(role === "store_keeper" && session.user.branchId)) {
      throw new ApiAuthError(403, "Not available");
    }
    await dbConnect();

    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) throw new ApiAuthError(400, "Invalid sale id");
    const body = await request.json().catch(() => ({}));
    const scope = getBranchScope(session, body.branchId);
    const scopeQ = { pharmacyId: new mongoose.Types.ObjectId(scope.pharmacyId), branchId: new mongoose.Types.ObjectId(scope.branchId) };

    const dbSession = await mongoose.startSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: any[] = [];
    try {
      await dbSession.withTransaction(async () => {
        const sale = await Sale.findOne({ _id: id, ...scopeQ }).session(dbSession).lean();
        if (!sale) throw new ApiAuthError(404, "Sale not found");
        if (sale.voided) throw new ApiAuthError(409, "This sale has already been returned");
        if (lagosDateKey(sale.timestamp) !== lagosDateKey(new Date())) {
          throw new ApiAuthError(400, "Only a sale from today can be returned this way — use Refund for an earlier sale");
        }
        const hasRefund = await Refund.exists({ saleId: sale._id }).session(dbSession);
        if (hasRefund) {
          throw new ApiAuthError(409, "This sale already has a refund against it — use Refund for any remaining items instead");
        }

        for (const line of sale.items) {
          if (line.isCustom || !line.productId) continue;
          await Product.findOneAndUpdate(
            { _id: line.productId, ...scopeQ },
            { $inc: { quantityInStock: line.quantity } },
            { session: dbSession }
          );
          for (const draw of line.batchDraws || []) {
            await ProductBatch.findOneAndUpdate(
              { _id: draw.batchId, ...scopeQ },
              { $inc: { remainingQuantity: draw.quantity } },
              { session: dbSession }
            );
          }
        }

        await Sale.updateOne(
          { _id: sale._id },
          {
            $set: {
              voided: true,
              voidedAt: new Date(),
              voidedByUserId: session.user.id,
              voidedByName: session.user.name ?? "Unknown",
            },
          },
          { session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "sale_return",
          summary: `Returned sale #${sale.receiptNumber} (₦${sale.totalAmount.toFixed(2)}) — stock restored, reloaded into cart for resale`,
          metadata: { saleId: String(sale._id), totalAmount: sale.totalAmount },
          refCollection: "Sale",
          refId: sale._id,
        });

        items = sale.items.map((line) => ({
          productId: line.productId ? String(line.productId) : null,
          isCustom: line.isCustom,
          itemName: line.itemName,
          brand: line.brand,
          size: line.size,
          category: line.category,
          quantity: line.quantity,
          form: line.form,
          formQuantity: line.formQuantity,
          unitPrice: line.unitPrice,
          originalUnitPrice: line.originalUnitPrice,
          discountPercent: line.discountPercent,
        }));
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, items });
  } catch (error) {
    return handleApiError(error);
  }
}
