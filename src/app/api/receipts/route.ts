import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
import User from "@/models/User";
import { requireApiSession, getBranchScope, ApiAuthError } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Receipt look-up for reprinting. Deliberately narrow: only the last few days, and only what is
// printed on a receipt: no cost, profit or refund figures. Store keepers use this instead of
// the Reports page.
const DAYS_BACK = 3;
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

function windowStart(): Date {
  const lagosNow = new Date(Date.now() + LAGOS_OFFSET_MS);
  const lagosMidnight = Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate());
  return new Date(lagosMidnight - DAYS_BACK * 24 * 60 * 60 * 1000 - LAGOS_OFFSET_MS);
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    const role = session.user.role;
    if (role !== "admin" && !(role === "store_keeper" && session.user.branchId)) {
      throw new ApiAuthError(403, "Not available");
    }
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const sales = await Sale.find({ ...scope, timestamp: { $gte: windowStart() } })
      .sort({ timestamp: -1 })
      .limit(300)
      .lean();

    const staffDocs = await User.find({ _id: { $in: sales.map((s) => s.userId) } })
      .select("name")
      .lean();
    const staffName = new Map(staffDocs.map((u) => [u._id.toString(), u.name]));

    return NextResponse.json({
      daysBack: DAYS_BACK,
      receipts: sales.map((s) => {
        const legacy = (s as { paymentMethod?: string }).paymentMethod || "cash";
        const payments =
          Array.isArray(s.payments) && s.payments.length > 0
            ? s.payments.map((p) => ({ method: p.method, amount: p.amount }))
            : [{ method: legacy, amount: s.totalAmount }];
        return {
          _id: String(s._id),
          receiptNumber: s.receiptNumber,
          customerName: s.customerName,
          userName: staffName.get(String(s.userId)) ?? "Unknown",
          timestamp: s.timestamp,
          totalAmount: s.totalAmount,
          amountTendered: s.amountTendered ?? s.totalAmount,
          changeGiven: s.changeGiven ?? 0,
          payments,
          items: s.items.map((i) => ({
            productName: i.productName,
            quantity: (i as { formQuantity?: number }).formQuantity ?? i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
            originalUnitPrice: (i as { originalUnitPrice?: number | null }).originalUnitPrice ?? null,
            discountPercent: (i as { discountPercent?: number }).discountPercent ?? 0,
          })),
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
