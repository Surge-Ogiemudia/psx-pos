import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Sale, { type SaleDoc } from "@/models/Sale";
import User from "@/models/User";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

function normalizeSale(sale: Record<string, unknown> & Partial<SaleDoc>) {
  if (Array.isArray(sale.payments) && sale.payments.length > 0) return sale;
  const legacyMethod = (sale as { paymentMethod?: string }).paymentMethod || "cash";
  return {
    ...sale,
    payments: [{ method: legacyMethod, amount: sale.totalAmount }],
    amountTendered: sale.totalAmount,
    changeGiven: 0,
    changeMethod: "cash",
    changeFee: 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    
    // Only fetch sales marked as pending print. They must be less than 1 hour old to prevent infinite backlog loops.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const sales = await Sale.find({ 
      ...scope, 
      printStatus: "pending",
      timestamp: { $gte: oneHourAgo } 
    }).sort({ timestamp: 1 }).limit(10).lean();

    const staffDocs = await User.find({ _id: { $in: sales.map((s) => s.userId) } })
      .select("name")
      .lean();
    const staffNameById = new Map(staffDocs.map((u) => [u._id.toString(), u.name]));

    return NextResponse.json({
      sales: sales.map((s) => ({
        ...normalizeSale(s),
        userName: staffNameById.get(String(s.userId)) ?? "Unknown",
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
