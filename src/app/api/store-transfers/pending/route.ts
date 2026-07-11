import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreTransfer from "@/models/StoreTransfer";
import { requireApiSession, getStoreScope, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const storeIdParam = request.nextUrl.searchParams.get("storeId");
    const branchIdParam = request.nextUrl.searchParams.get("branchId");
    if (!storeIdParam && !branchIdParam) {
      return NextResponse.json({ error: "storeId or branchId is required" }, { status: 400 });
    }

    let query: Record<string, unknown>;
    if (storeIdParam) {
      const scope = getStoreScope(session, storeIdParam);
      query = { pharmacyId: scope.pharmacyId, status: "in_transit", toStoreId: scope.storeId };
    } else {
      const scope = getBranchScope(session, branchIdParam);
      query = { pharmacyId: scope.pharmacyId, status: "in_transit", toBranchId: scope.branchId };
    }

    const transfers = await StoreTransfer.find(query).sort({ timestamp: -1 }).limit(200).lean();
    return NextResponse.json({ transfers });
  } catch (error) {
    return handleApiError(error);
  }
}
