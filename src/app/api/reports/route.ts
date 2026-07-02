import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
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

    const results = await Sale.aggregate([
      {
        $match: {
          pharmacyId: new mongoose.Types.ObjectId(session.user.pharmacyId),
          branchId: new mongoose.Types.ObjectId(session.user.branchId),
          timestamp: { $gte: from, $lte: to },
        },
      },
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

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      summary,
      byDay: results.map((r) => ({ date: r._id, totalAmount: r.totalAmount, saleCount: r.saleCount })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
