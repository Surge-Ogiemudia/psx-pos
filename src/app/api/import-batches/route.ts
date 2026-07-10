import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ImportBatch from "@/models/ImportBatch";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const batches = await ImportBatch.find(scope).sort({ createdAt: -1 }).limit(100).lean();
    const batchIds = batches.map((b) => b._id);
    const remainingCounts = await Product.aggregate([
      { $match: { importBatchId: { $in: batchIds } } },
      { $group: { _id: "$importBatchId", count: { $sum: 1 } } },
    ]);
    const remainingById = new Map(remainingCounts.map((r) => [r._id.toString(), r.count]));

    return NextResponse.json({
      batches: batches.map((b) => ({
        ...b,
        remainingCount: remainingById.get(b._id.toString()) ?? 0,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
