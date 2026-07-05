import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { compareBatchesFifo } from "@/lib/unitHierarchy";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/store-products/[id]/batches">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    const batches = (await StoreBatch.find({ ...scope, storeProductId: id }).lean()).sort(compareBatchesFifo);

    return NextResponse.json({ batches });
  } catch (error) {
    return handleApiError(error);
  }
}
