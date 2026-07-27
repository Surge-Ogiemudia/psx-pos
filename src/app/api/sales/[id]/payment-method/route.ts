import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { parseNumeric } from "@/lib/numberInput";

const PAYMENT_METHODS = ["cash", "card", "mobile_money"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Transfer",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    const scope = await getBranchScope(session);
    const { id } = await params;

    const body = await req.json();
    const rawPayments = body.payments;

    if (!Array.isArray(rawPayments) || rawPayments.length === 0) {
      return NextResponse.json({ error: "At least one payment method is required." }, { status: 400 });
    }

    const newPayments: { method: PaymentMethod; amount: number }[] = [];
    let newAmountTendered = 0;

    for (const p of rawPayments) {
      const method = String(p.method || "").trim() as PaymentMethod;
      const amount = parseNumeric(p.amount);

      if (!PAYMENT_METHODS.includes(method)) {
        return NextResponse.json({ error: `Invalid payment method: ${p.method}` }, { status: 400 });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "Payment amount must be greater than 0." }, { status: 400 });
      }
      newPayments.push({ method, amount });
      newAmountTendered += amount;
    }

    await dbConnect();

    const sale = await Sale.findOne({ _id: id, pharmacyId: scope.pharmacyId });
    if (!sale) {
      return NextResponse.json({ error: "Sale transaction not found." }, { status: 404 });
    }

    if (scope.branchId && sale.branchId.toString() !== scope.branchId) {
      return NextResponse.json({ error: "Access denied to sale from another branch." }, { status: 403 });
    }

    const oldSummary = sale.payments
      .map((p) => `${PAYMENT_METHOD_LABEL[p.method as PaymentMethod] || p.method} ₦${p.amount.toFixed(2)}`)
      .join(", ");

    (sale.payments as unknown) = newPayments;
    sale.amountTendered = newAmountTendered;
    sale.changeGiven = Math.max(0, newAmountTendered - sale.totalAmount);
    
    // If payments were changed to non-cash, ensure change fee logic is clean
    if (!newPayments.some((p) => p.method === "cash")) {
      sale.changeFee = 0;
    }

    await sale.save();

    const newSummary = newPayments
      .map((p) => `${PAYMENT_METHOD_LABEL[p.method]} ₦${p.amount.toFixed(2)}`)
      .join(", ");

    const mongooseSession = await mongoose.startSession();
    try {
      await mongooseSession.withTransaction(async () => {
        await logActivity(mongooseSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId || sale.branchId.toString(),
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "sell",
          summary: `Updated payment method for Sale #${sale._id.toString().slice(-8)} from [${oldSummary}] to [${newSummary}]`,
          metadata: { saleId: sale._id, oldPayments: oldSummary, newPayments: newSummary },
          refCollection: "Sale",
          refId: sale._id,
        });
      });
    } finally {
      await mongooseSession.endSession();
    }

    return NextResponse.json({ success: true, sale });
  } catch (err) {
    return handleApiError(err);
  }
}
