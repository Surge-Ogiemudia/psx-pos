import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";
import User from "@/models/User";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

const PAYMENT_METHODS = ["cash", "card", "mobile_money"] as const;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required for reports" }, { status: 403 });
    }
    await dbConnect();

    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    const now = new Date();
    const from = fromParam ? startOfDay(new Date(fromParam)) : startOfDay(now);
    const to = toParam ? endOfDay(new Date(toParam)) : endOfDay(now);

    const requestedBranchId = request.nextUrl.searchParams.get("branchId");
    const match: Record<string, unknown> = {
      pharmacyId: new mongoose.Types.ObjectId(session.user.pharmacyId),
      timestamp: { $gte: from, $lte: to },
    };
    if (requestedBranchId) match.branchId = new mongoose.Types.ObjectId(requestedBranchId);

    const isStaff = false;
    const saleMatch = match;
    const refundMatch = match;

    const results = await Sale.aggregate([
      { $match: saleMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          totalAmount: { $sum: "$totalAmount" },
          totalCost: { $sum: { $ifNull: ["$totalCost", 0] } },
          saleCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const summary = results.reduce(
      (acc, r) => {
        acc.totalAmount += r.totalAmount;
        acc.totalCost += r.totalCost || 0;
        acc.saleCount += r.saleCount;
        return acc;
      },
      { totalAmount: 0, totalCost: 0, saleCount: 0 }
    );

    const refundResults = await Refund.aggregate([
      { $match: refundMatch },
      { $group: { _id: null, refundAmount: { $sum: "$totalAmount" }, refundCost: { $sum: { $ifNull: ["$totalCost", 0] } }, refundCount: { $sum: 1 } } },
    ]);
    const refundAmount = refundResults[0]?.refundAmount ?? 0;
    const refundCost = refundResults[0]?.refundCost ?? 0;
    const refundCount = refundResults[0]?.refundCount ?? 0;

    // Sales broken down by payment method. Legacy docs (pre-split-payments) have no `payments`
    // array — synthesize one from the old paymentMethod/totalAmount so this works correctly
    // whether or not the migration script has been run yet.
    const paymentTotals = await Sale.aggregate([
      { $match: saleMatch },
      {
        $addFields: {
          _payments: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$payments", []] } }, 0] },
              "$payments",
              [{ method: { $ifNull: ["$paymentMethod", "cash"] }, amount: "$totalAmount" }],
            ],
          },
        },
      },
      { $unwind: "$_payments" },
      { $group: { _id: "$_payments.method", amount: { $sum: "$_payments.amount" } } },
    ]);

    const changeByMethod = await Sale.aggregate([
      { $match: { ...saleMatch, changeGiven: { $gt: 0 } } },
      { $group: { _id: { $ifNull: ["$changeMethod", "cash"] }, amount: { $sum: "$changeGiven" } } },
    ]);

    const feeResult = await Sale.aggregate([
      { $match: saleMatch },
      { $group: { _id: null, feeIncome: { $sum: { $ifNull: ["$changeFee", 0] } } } },
    ]);
    const feeIncome = feeResult[0]?.feeIncome ?? 0;

    const refundByMethod = await Refund.aggregate([
      { $match: refundMatch },
      { $group: { _id: { $ifNull: ["$method", "cash"] }, amount: { $sum: "$totalAmount" } } },
    ]);

    const byMethod = PAYMENT_METHODS.map((method) => {
      const salesIn = paymentTotals.find((p) => p._id === method)?.amount ?? 0;
      const refundsOut = refundByMethod.find((r) => r._id === method)?.amount ?? 0;
      const changeOut = changeByMethod.find((c) => c._id === method)?.amount ?? 0;
      return { method, salesIn, refundsOut, changeOut, netCash: salesIn - refundsOut - changeOut };
    });

    // Per-staff breakdown is admin-only — staff already see only their own numbers above.
    let byStaff: { userId: string; userName: string; totalAmount: number; saleCount: number }[] = [];
    if (!isStaff) {
      const byStaffRaw = await Sale.aggregate([
        { $match: saleMatch },
        { $group: { _id: "$userId", totalAmount: { $sum: "$totalAmount" }, totalCost: { $sum: { $ifNull: ["$totalCost", 0] } }, saleCount: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
      ]);
      const staffDocs = await User.find({ _id: { $in: byStaffRaw.map((s) => s._id) } })
        .select("name")
        .lean();
      const staffNameById = new Map(staffDocs.map((u) => [u._id.toString(), u.name]));
      byStaff = byStaffRaw.map((s) => ({
        userId: s._id.toString(),
        userName: staffNameById.get(s._id.toString()) ?? "Unknown",
        totalAmount: s.totalAmount,
        totalCost: s.totalCost,
        grossProfit: s.totalAmount - s.totalCost,
        saleCount: s.saleCount,
      }));
    }

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        ...summary,
        refundAmount,
        refundCost,
        refundCount,
        netAmount: summary.totalAmount - refundAmount,
        netCost: summary.totalCost - refundCost,
        grossProfit: (summary.totalAmount - refundAmount) - (summary.totalCost - refundCost),
      },
      byDay: results.map((r) => ({ date: r._id, totalAmount: r.totalAmount, totalCost: r.totalCost || 0, grossProfit: r.totalAmount - (r.totalCost || 0), saleCount: r.saleCount })),
      byMethod,
      feeIncome,
      byStaff,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
