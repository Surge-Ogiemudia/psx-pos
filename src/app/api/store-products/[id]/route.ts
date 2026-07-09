import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/store-products/[id]">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;
    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));

    const product = await StoreProduct.findOne({ _id: id, ...scope }).lean();
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    return NextResponse.json({ product });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/store-products/[id]">
) {
  try {
    const session = await requireStoreApiSession();
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Only an admin or store manager can edit a store product" }, { status: 403 });
    }
    await dbConnect();
    const { id } = await ctx.params;
    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));

    const body = await request.json();
    const itemName = typeof body.itemName === "string" ? body.itemName.trim() : "";
    const brand = typeof body.brand === "string" ? body.brand.trim() : "";
    const size = typeof body.size === "string" ? body.size.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";

    if (!itemName) return NextResponse.json({ error: "Item name is required" }, { status: 400 });
    if (!brand) return NextResponse.json({ error: "Brand is required" }, { status: 400 });
    if (!size) return NextResponse.json({ error: "Size is required" }, { status: 400 });

    const product = await StoreProduct.findOneAndUpdate(
      { _id: id, ...scope },
      { $set: { itemName, brand, size, category } },
      { new: true }
    ).lean();

    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    return NextResponse.json({ product });
  } catch (error) {
    return handleApiError(error);
  }
}

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
