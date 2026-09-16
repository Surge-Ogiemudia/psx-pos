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

    if (!productData?.itemName || !productData.itemName.trim()) {
      return NextResponse.json({ error: "Item name is required" }, { status: 400 });
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

    const price = productData.retailPrice !== undefined && productData.retailPrice !== null
      ? Math.max(0, Number(productData.retailPrice) || 0)
      : (firstDraft.retailPrice || 0);

    // Update the unified primary draft
    firstDraft.extractedItemName = productData.itemName.trim();
    firstDraft.extractedBrand = (productData.brand || firstDraft.extractedBrand || "Unknown Brand").trim();
    firstDraft.extractedSize = (productData.size || firstDraft.extractedSize || "Standard").trim();
    firstDraft.category = productData.category || firstDraft.category || "medicine";
    firstDraft.quantityInStock = totalQty;
    firstDraft.retailPrice = price;
    firstDraft.extractedBarcode = (productData.barcode !== undefined ? productData.barcode : (firstDraft.extractedBarcode || "")).trim();
    if (productData.expiryDate) {
      firstDraft.extractedExpiryDate = new Date(productData.expiryDate);
    }
    firstDraft.isSplitUnique = true;
    firstDraft.status = "extracted";

    // Recompute review flags: zero_price will direct it straight to "Needs Attention" for MD review
    const reasons: string[] = [];
    if (!firstDraft.retailPrice || firstDraft.retailPrice <= 0) reasons.push("zero_price");
    if (!firstDraft.extractedItemName || firstDraft.extractedItemName.toLowerCase().includes("unnamed") || firstDraft.extractedItemName.length < 3) {
      reasons.push("missing_name");
    }
    if (firstDraft.retailPrice && firstDraft.retailPrice > 50000) reasons.push("high_price_check");
    if (firstDraft.quantityInStock && firstDraft.quantityInStock > 100) reasons.push("high_qty_check");
    firstDraft.needsReviewReason = reasons;

    await firstDraft.save();

    // Mark sibling duplicate drafts as completed so they are retired from the review queue
    const siblingDraftIds = drafts.slice(1).map(d => d._id);
    if (siblingDraftIds.length > 0) {
      await AiDraftProduct.updateMany(
        { _id: { $in: siblingDraftIds } },
        { 
          $set: { 
            status: "completed", 
            errorMsg: `Merged into draft ${firstDraft._id}`,
            needsReviewReason: []
          } 
        }
      );
    }

    return NextResponse.json({ 
      success: true, 
      draft: firstDraft, 
      mergedDraftsCount: drafts.length,
      routedTo: reasons.length > 0 ? "needsAttention" : "ready"
    });

  } catch (error: any) {
    console.error("Failed to merge drafts:", error);
    return NextResponse.json({ error: error.message || "Failed to merge drafts" }, { status: 500 });
  }
}
