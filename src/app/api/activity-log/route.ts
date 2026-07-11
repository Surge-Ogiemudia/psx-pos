import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ActivityLog from "@/models/ActivityLog";
import { requireApiSession, getStoreScope, getBranchScope, ApiAuthError } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    // store_manager/store_keeper only ever have store access; staff only ever have branch
    // access. Admin has both, so it explicitly picks via ?scope= (defaulting to branch).
    const role = session.user.role;
    const requestedScope = request.nextUrl.searchParams.get("scope");
    if ((role === "store_manager" || role === "store_keeper") && requestedScope === "branch") {
      throw new ApiAuthError(403, "No branch access");
    }
    if (role === "staff" && requestedScope === "store") {
      throw new ApiAuthError(403, "No store access");
    }
    const scope: "branch" | "store" =
      role === "store_manager" || role === "store_keeper"
        ? "store"
        : role === "staff"
          ? "branch"
          : requestedScope === "store"
            ? "store"
            : "branch";

    const query: Record<string, unknown> = { scope };
    if (scope === "store") {
      const storeScope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
      query.pharmacyId = storeScope.pharmacyId;
      query.storeId = storeScope.storeId;
    } else {
      const branchScope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
      query.pharmacyId = branchScope.pharmacyId;
      query.branchId = branchScope.branchId;
    }
    // Staff only ever see their own actions, matching how Reports scopes staff to their own sales.
    if (role === "staff") {
      query.actorUserId = session.user.id;
    }

    const entries = await ActivityLog.find(query).sort({ timestamp: -1 }).limit(200).lean();

    return NextResponse.json({ entries });
  } catch (error) {
    return handleApiError(error);
  }
}
