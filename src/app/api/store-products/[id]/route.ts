import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import { requireStoreApiSession, getStoreScope, ApiAuthError } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
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
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      throw new ApiAuthError(403, "Only an admin or store manager can delete a store item");
    }
    await dbConnect();
    const { id } = await ctx.params;
    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));

    const product = await StoreProduct.findOne({ _id: id, ...scope }).lean();
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const label = formatProductLabel(product);
    const batches = await StoreBatch.find({ storeProductId: id, ...scope }).select("_id").lean();
    const batchIds = batches.map((b) => b._id);

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await DispenseSetting.deleteMany({ storeBatchId: { $in: batchIds }, ...scope }, { session: dbSession });
        await StoreBatch.deleteMany({ storeProductId: id, ...scope }, { session: dbSession });
        await StoreProduct.deleteOne({ _id: id, ...scope }, { session: dbSession });

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "store",
          storeId: scope.storeId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "delete",
          summary: `${session.user.name} deleted ${label}${product.quantityInStock > 0 ? ` (had ${product.quantityInStock} ${product.baseUnitName} in stock)` : ""}`,
          metadata: { quantityInStock: product.quantityInStock, batchesRemoved: batchIds.length },
        });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
