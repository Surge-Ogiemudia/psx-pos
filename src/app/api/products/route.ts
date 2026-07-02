import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const query: Record<string, unknown> = {
      pharmacyId: session.user.pharmacyId,
      branchId: session.user.branchId,
    };
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const products = await Product.find(query).sort({ name: 1 }).lean();
    return NextResponse.json({ products });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      name,
      category,
      quantityInStock,
      retailPrice,
      wholesalePrice,
      distributorPrice,
      batchNumber,
      expiryDate,
    } = body;

    if (!name || !category || retailPrice == null || wholesalePrice == null || distributorPrice == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!["medicine", "non-medicine"].includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const product = await Product.create({
      pharmacyId: session.user.pharmacyId,
      branchId: session.user.branchId,
      name,
      category,
      quantityInStock: Number(quantityInStock) || 0,
      retailPrice: Number(retailPrice),
      wholesalePrice: Number(wholesalePrice),
      distributorPrice: Number(distributorPrice),
      batchNumber: batchNumber || "",
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
