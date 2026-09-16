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

    if (!productData?.itemName || !String(productData.itemName).trim()) {
      return NextResponse.json({ error: "Item name is required" }, { status: 400 });
    }

    const price = productData.retailPrice !== undefined && productData.retailPrice !== null
      ? Math.max(0, Number(productData.retailPrice) || 0)
      : (draft.retailPrice || 0);

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

    // Update draft as an individually separated item
    draft.extractedItemName = String(productData.itemName).trim();
    draft.extractedBrand = String(productData.brand || draft.extractedBrand || "Unknown Brand").trim();
    draft.extractedSize = String(productData.size || draft.extractedSize || "Standard").trim();
    draft.category = productData.category || draft.category || "medicine";
    draft.quantityInStock = qty;
    draft.retailPrice = price;
    draft.extractedBarcode = String(productData.barcode !== undefined ? productData.barcode : (draft.extractedBarcode || "")).trim();
    if (productData.expiryDate) {
      draft.extractedExpiryDate = new Date(productData.expiryDate);
    }
    draft.isSplitUnique = true;
    draft.status = "extracted";

    // Recompute review flags: zero_price will send it straight to "Needs Attention" for MD review
    const reasons: string[] = [];
    if (!draft.retailPrice || draft.retailPrice <= 0) reasons.push("zero_price");
    if (!draft.extractedItemName || draft.extractedItemName.toLowerCase().includes("unnamed") || draft.extractedItemName.length < 3) {
      reasons.push("missing_name");
    }
    if (draft.retailPrice && draft.retailPrice > 50000) reasons.push("high_price_check");
    if (draft.quantityInStock && draft.quantityInStock > 100) reasons.push("high_qty_check");
    draft.needsReviewReason = reasons;

    await draft.save();

    return NextResponse.json({
      success: true,
      draft,
      routedTo: reasons.length > 0 ? "needsAttention" : "ready",
    });
  } catch (error: any) {
    console.error("Failed to approve single draft:", error);
    return NextResponse.json({ error: error.message || "Failed to approve draft" }, { status: 500 });
  }
}
