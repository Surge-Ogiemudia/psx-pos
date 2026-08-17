import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/db";
import Product from "@/models/Product";
import { resolveScope } from "@/lib/scope";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const scope = await resolveScope(req, session);

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query") || "";

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
