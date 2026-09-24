import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope, ApiAuthError } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import { refreshGroups } from "@/lib/triageV2/groups";

export async function POST(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    // Admin only regardless of TRIAGE_V2_OPEN_TO_ALL_OPERATORS.
    if (session.user.role !== "admin") throw new ApiAuthError(403, "Admin access required");
    await dbConnect();
    let body: { branchId?: string } = {};
    try {
      body = await request.json();
    } catch {
      /* empty body is fine */
    }
    const scope = getBranchScope(session, body.branchId ?? request.nextUrl.searchParams.get("branchId"));
    const counts = await refreshGroups(scope.pharmacyId, scope.branchId);
    return NextResponse.json({ success: true, ...counts });
  } catch (error) {
    return handleApiError(error);
  }
}
