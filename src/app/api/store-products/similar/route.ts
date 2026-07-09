import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { findSimilarProducts } from "@/lib/productSimilarity";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const params = request.nextUrl.searchParams;
    const itemName = params.get("itemName")?.trim() ?? "";
    const brand = params.get("brand")?.trim() ?? "";
    const size = params.get("size")?.trim() ?? "";
    if (!itemName) {
      return NextResponse.json({ matches: [] });
    }

    const scope = getStoreScope(session, params.get("storeId"));
    const existing = await StoreProduct.find(scope)
      .select("itemName brand size quantityInStock baseUnitName category")
      .lean();

    const matches = findSimilarProducts({ itemName, brand, size }, existing).filter((m) => !m.exact);

    return NextResponse.json({ matches });
  } catch (error) {
    return handleApiError(error);
  }
}
