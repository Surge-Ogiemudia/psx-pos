import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireApiSession, getBranchScope } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const scope = getBranchScope(session);
    const query = request.nextUrl.searchParams.get("query") || "";

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ products: [] });
    }

    const products = await Product.find({
      pharmacyId: scope.pharmacyId,
      $or: [
        { itemName: { $regex: query, $options: "i" } },
        { brand: { $regex: query, $options: "i" } },
      ],
    })
      .limit(20)
      .lean();

    return NextResponse.json({ products });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to search catalog products" }, { status: 500 });
  }
}
