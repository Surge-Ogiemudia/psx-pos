import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/store-products/[id]">
) {
  try {
    const session = await requireStoreApiSession();
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Only an admin or store manager can delete a store product" }, { status: 403 });
    }
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    const result = await StoreProduct.deleteOne({ _id: id, ...scope });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Store product not found" }, { status: 404 });
    }

    // Batches only make sense attached to their product — clean them up too rather than
    // leaving them orphaned once the product they belong to is gone.
    await StoreBatch.deleteMany({ ...scope, storeProductId: id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
