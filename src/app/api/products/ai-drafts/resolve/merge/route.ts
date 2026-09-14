import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const body = await req.json();

    const { draftIds, productData } = body;
    if (!Array.isArray(draftIds) || draftIds.length === 0) {
      return NextResponse.json({ error: "draftIds must be a non-empty array" }, { status: 400 });
    }

    if (!productData?.itemName || !productData?.retailPrice) {
      return NextResponse.json({ error: "Item name and valid retail price are required" }, { status: 400 });
    }

    // Fetch the drafts to verify ownership
    const drafts = await AiDraftProduct.find({
      _id: { $in: draftIds },
      pharmacyId: session.user.pharmacyId
    });

    if (drafts.length === 0) {
      return NextResponse.json({ error: "No matching drafts found" }, { status: 404 });
    }

    const firstDraft = drafts[0];
    const totalQty = productData.quantityInStock !== undefined 
      ? Number(productData.quantityInStock)
      : drafts.reduce((sum, d) => sum + (d.quantityInStock || 0), 0);

    // Create the unified Product
    const newProduct = await Product.create({
      pharmacyId: session.user.pharmacyId,
      branchId: firstDraft.branchId,
      itemName: productData.itemName.trim(),
      brand: (productData.brand || firstDraft.extractedBrand || "Unknown Brand").trim(),
      size: (productData.size || firstDraft.extractedSize || "Standard").trim(),
      category: productData.category || firstDraft.category || "medicine",
      imageUrl: productData.imageUrl || firstDraft.frontImageUrl,
      quantityInStock: totalQty,
      retailPrice: Number(productData.retailPrice),
      wholesalePrice: 0,
      distributorPrice: 0,
      costPrice: 0,
      alertQuantity: Math.max(1, Math.floor(totalQty * 0.2)),
      unitHierarchy: [{ unitName: "Piece", unitsPerParent: 1 }],
      barcode: (productData.barcode || firstDraft.extractedBarcode || "").trim(),
      expiryDate: productData.expiryDate ? new Date(productData.expiryDate) : firstDraft.extractedExpiryDate,
    });

    // Mark all merged drafts as completed
    await AiDraftProduct.updateMany(
      { _id: { $in: drafts.map(d => d._id) } },
      { 
        $set: { 
          status: "completed", 
          productId: newProduct._id,
          errorMsg: null 
        } 
      }
    );

    return NextResponse.json({ 
      success: true, 
      product: newProduct, 
      mergedDraftsCount: drafts.length 
    });

  } catch (error: any) {
    console.error("Failed to merge drafts:", error);
    return NextResponse.json({ error: error.message || "Failed to merge drafts" }, { status: 500 });
  }
}
