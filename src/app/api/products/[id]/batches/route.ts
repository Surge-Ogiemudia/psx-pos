import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { compareBatchesFifo } from "@/lib/unitHierarchy";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/products/[id]/batches">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const batches = (await ProductBatch.find({ ...scope, productId: id }).lean()).sort(compareBatchesFifo);

    return NextResponse.json({ batches });
  } catch (error) {
    return handleApiError(error);
  }
}
