import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { findSimilarProducts } from "@/lib/productSimilarity";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const params = request.nextUrl.searchParams;
    const itemName = params.get("itemName")?.trim() ?? "";
    const brand = params.get("brand")?.trim() ?? "";
    const size = params.get("size")?.trim() ?? "";
    const excludeId = params.get("excludeId");
    if (!itemName) {
      return NextResponse.json({ matches: [] });
    }

    const scope = getBranchScope(session, params.get("branchId"));
    const existing = await Product.find(scope)
      .select("itemName brand size quantityInStock retailPrice wholesalePrice distributorPrice batchNumber expiryDate unitHierarchy")
      .lean();

    const pool = excludeId ? existing.filter((p) => String(p._id) !== excludeId) : existing;
    const matches = findSimilarProducts({ itemName, brand, size }, pool);

    return NextResponse.json({ matches });
  } catch (error) {
    return handleApiError(error);
  }
}
