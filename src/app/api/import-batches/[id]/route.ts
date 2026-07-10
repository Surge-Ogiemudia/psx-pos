import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import ImportBatch from "@/models/ImportBatch";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/import-batches/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const batch = await ImportBatch.findOne({ _id: id, ...scope }).lean();
    if (!batch) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }

    const dbSession = await mongoose.startSession();
    let deletedCount = 0;
    try {
      await dbSession.withTransaction(async () => {
        const result = await Product.deleteMany({ importBatchId: id, ...scope }, { session: dbSession });
        deletedCount = result.deletedCount ?? 0;
        await ImportBatch.deleteOne({ _id: id, ...scope }, { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ deletedCount });
  } catch (error) {
    return handleApiError(error);
  }
}
