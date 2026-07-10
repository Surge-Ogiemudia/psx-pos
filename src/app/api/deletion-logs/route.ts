import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DeletionLog from "@/models/DeletionLog";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const logs = await DeletionLog.find(scope)
      .select("-csvContent")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return NextResponse.json({
      logs: logs.map((l) => ({ ...l, hasCsv: !!l.csvFileName })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
