import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DeletionLog from "@/models/DeletionLog";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const log = await DeletionLog.findOne({ _id: id, ...scope }).lean();
    if (!log || !log.csvContent) {
      return NextResponse.json({ error: "No file available for this log entry" }, { status: 404 });
    }

    return new NextResponse(log.csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${log.csvFileName || "deleted-items.csv"}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
