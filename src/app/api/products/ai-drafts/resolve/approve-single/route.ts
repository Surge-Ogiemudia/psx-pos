import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const body = await req.json();
    const { draftId, productData } = body;

    if (!draftId) {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    if (!productData?.itemName || productData?.retailPrice === undefined || productData?.retailPrice === null) {
      return NextResponse.json({ error: "Item name and valid retail price are required" }, { status: 400 });
    }

    const price = Number(productData.retailPrice);
    if (isNaN(price) || price <= 0) {
      return NextResponse.json({ error: "Retail price must be a positive number" }, { status: 400 });
    }

    // Fetch the draft to verify ownership and branch
    const draft = await AiDraftProduct.findOne({
      _id: draftId,
      pharmacyId: session.user.pharmacyId,
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found or unauthorized" }, { status: 404 });
    }

    const qty = productData.quantityInStock !== undefined 
      ? Math.max(0, Number(productData.quantityInStock))
      : (draft.quantityInStock || 0);

    // Create the individual Product
    const newProduct = await Product.create({
      pharmacyId: session.user.pharmacyId,
      branchId: draft.branchId,
      itemName: String(productData.itemName).trim(),
      brand: String(productData.brand || draft.extractedBrand || "Unknown Brand").trim(),
      size: String(productData.size || draft.extractedSize || "Standard").trim(),
      category: productData.category || draft.category || "medicine",
      imageUrl: productData.imageUrl || draft.frontImageUrl,
      quantityInStock: qty,
      retailPrice: price,
      wholesalePrice: 0,
      distributorPrice: 0,
      costPrice: 0,
      alertQuantity: Math.max(1, Math.floor(qty * 0.2)),
      unitHierarchy: [{ unitName: "Piece", unitsPerParent: 1 }],
      barcode: String(productData.barcode !== undefined ? productData.barcode : (draft.extractedBarcode || "")).trim(),
      expiryDate: productData.expiryDate ? new Date(productData.expiryDate) : draft.extractedExpiryDate,
    });

    // Update the AiDraftProduct status to completed
    draft.status = "completed";
    draft.productId = newProduct._id;
    draft.errorMsg = null;
    await draft.save();

    return NextResponse.json({
      success: true,
      product: newProduct,
    });
  } catch (error: any) {
    console.error("Failed to approve single draft:", error);
    return NextResponse.json({ error: error.message || "Failed to approve draft" }, { status: 500 });
  }
}
