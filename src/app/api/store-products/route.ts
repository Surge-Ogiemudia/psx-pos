import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
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
    return NextResponse.json({ storeProducts });
  } catch (error) {
    return handleApiError(error);
  }
}
