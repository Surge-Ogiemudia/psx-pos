import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
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
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireStoreApiSession();
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
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;
    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    
    const product = await StoreProduct.findOne({ _id: id, ...scope }).lean();
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (product.quantityInStock > 0) {
      return NextResponse.json({ error: "Cannot delete product with stock" }, { status: 400 });
    }
    
    // Also delete any zero-quantity batches associated with it
    await StoreBatch.deleteMany({ storeProductId: id, ...scope });
    await StoreProduct.deleteOne({ _id: id, ...scope });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
