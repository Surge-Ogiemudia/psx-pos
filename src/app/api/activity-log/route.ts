import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ActivityLog from "@/models/ActivityLog";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const storeId = request.nextUrl.searchParams.get("storeId");
    const scope = getStoreScope(session, storeId);

    const entries = await ActivityLog.find({
      pharmacyId: scope.pharmacyId,
      scope: "store",
      storeId: scope.storeId,
    })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({ entries });
  } catch (error) {
    return handleApiError(error);
  }
}
