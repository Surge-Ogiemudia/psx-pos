import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const pharmacyIdStr = session.user.pharmacyId;
    if (!pharmacyIdStr) {
      return NextResponse.json({ error: "No pharmacy ID in session" }, { status: 400 });
    }

    const pharmacyId = new mongoose.Types.ObjectId(pharmacyIdStr);
    const query = request.nextUrl.searchParams.get("query") || "";

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ products: [] });
    }

    const products = await Product.find({
      pharmacyId,
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
