import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const query: Record<string, unknown> = { ...scope };
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const storeProducts = await StoreProduct.find(query).sort({ name: 1 }).lean();

    // Stock is always tracked internally in base units (so batches with different packaging
    // never break the math) — but staff think in whatever form they received the product as,
    // not the smallest unit. Attach each product's most recently received hierarchy so the UI
    // can display "X cartons" instead of a meaningless count of the base unit.
    const batches = await StoreBatch.find({ ...scope, storeProductId: { $in: storeProducts.map((p) => p._id) } })
      .sort({ receivedAt: -1 })
      .select("storeProductId unitHierarchy")
      .lean();
    const hierarchyByProductId = new Map<string, (typeof batches)[number]["unitHierarchy"]>();
    for (const batch of batches) {
      const key = batch.storeProductId.toString();
      if (!hierarchyByProductId.has(key)) hierarchyByProductId.set(key, batch.unitHierarchy);
    }

    const withHierarchy = storeProducts.map((p) => ({
      ...p,
      displayUnitHierarchy: hierarchyByProductId.get(p._id.toString()) ?? null,
    }));

    return NextResponse.json({ storeProducts: withHierarchy });
  } catch (error) {
    return handleApiError(error);
  }
}
