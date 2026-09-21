import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { isDuplicateText } from "@/lib/duplicateDetection";

// Mobile Triage's duplicates step: given the live product an operator is currently on,
// find OTHER live products (same branch) that look like the same physical item. Product
// vs product, not draft vs draft — every queue draft already has its own live product, so
// there's no separate "still pending" duplicate case anymore, just this one.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;

    const current = await Product.findOne({ _id: id, pharmacyId }).lean();
    if (!current) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchProducts = await Product.find({
      pharmacyId,
      branchId: (current as any).branchId,
      _id: { $ne: id },
    }).lean();

    const candidates = branchProducts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => isDuplicateText((current as any).itemName, p.itemName))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({
        _id: p._id,
        itemName: p.itemName,
        brand: p.brand,
        size: p.size,
        imageUrl: p.imageUrl || null,
        quantityInStock: p.quantityInStock,
      }));

    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    return handleApiError(error);
  }
}
