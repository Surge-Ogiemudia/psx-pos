import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

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
    if (session.user.role === "admin") {
      // Admin is pharmacy-wide: a specific branch narrows the report, omitting it aggregates everything.
      if (requestedBranchId) match.branchId = new mongoose.Types.ObjectId(requestedBranchId);
    } else if (session.user.branchId) {
      match.branchId = new mongoose.Types.ObjectId(session.user.branchId);
    } else {
      return NextResponse.json({ error: "No branch access" }, { status: 403 });
    }

    const results = await Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          totalAmount: { $sum: "$totalAmount" },
          saleCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const summary = results.reduce(
      (acc, r) => {
        acc.totalAmount += r.totalAmount;
        acc.saleCount += r.saleCount;
        return acc;
      },
      { totalAmount: 0, saleCount: 0 }
    );

    const refundResults = await Refund.aggregate([
      { $match: match },
      { $group: { _id: null, refundAmount: { $sum: "$totalAmount" }, refundCount: { $sum: 1 } } },
    ]);
    const refundAmount = refundResults[0]?.refundAmount ?? 0;
    const refundCount = refundResults[0]?.refundCount ?? 0;

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        ...summary,
        refundAmount,
        refundCount,
        netAmount: summary.totalAmount - refundAmount,
      },
      byDay: results.map((r) => ({ date: r._id, totalAmount: r.totalAmount, saleCount: r.saleCount })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
