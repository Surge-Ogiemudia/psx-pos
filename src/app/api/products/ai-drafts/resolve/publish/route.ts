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

    // draftIds can be explicitly provided, OR if publishAllClean is true, we publish all eligible extracted drafts
    const { draftIds, publishAllClean, branchId } = body;

    let query: any = {
      pharmacyId: session.user.pharmacyId,
      status: "extracted",
    };

    if (branchId) query.branchId = branchId;

    if (Array.isArray(draftIds) && draftIds.length > 0) {
      query._id = { $in: draftIds };
    } else if (publishAllClean) {
      query.$or = [
        { needsReviewReason: { $size: 0 } },
        { needsReviewReason: { $exists: false } }
      ];
    } else {
      return NextResponse.json({ error: "draftIds or publishAllClean required" }, { status: 400 });
    }

    const drafts = await AiDraftProduct.find(query);

    let publishedCount = 0;
    const errors: any[] = [];

    for (const draft of drafts) {
      try {
        const itemName = (draft.extractedItemName || "").trim();
        const retailPrice = Number(draft.retailPrice || 0);

        if (!itemName || itemName.toLowerCase().includes("unnamed") || retailPrice <= 0) {
          errors.push({ id: draft._id, reason: "Missing valid name or price" });
          continue;
        }

        const newProduct = await Product.create({
          pharmacyId: draft.pharmacyId,
          branchId: draft.branchId,
          itemName,
          brand: (draft.extractedBrand || "Unknown Brand").trim(),
          size: (draft.extractedSize || "Standard").trim(),
          category: draft.category || "medicine",
          imageUrl: draft.frontImageUrl,
          quantityInStock: draft.quantityInStock || 0,
          retailPrice,
          wholesalePrice: 0,
          distributorPrice: 0,
          costPrice: 0,
          alertQuantity: Math.max(1, Math.floor((draft.quantityInStock || 0) * 0.2)),
          unitHierarchy: [{ unitName: "Piece", unitsPerParent: 1 }],
          barcode: (draft.extractedBarcode || "").trim(),
          expiryDate: draft.extractedExpiryDate,
        });

        draft.status = "completed";
        draft.productId = newProduct._id;
        draft.errorMsg = null;
        await draft.save();

        publishedCount++;
      } catch (err: any) {
        errors.push({ id: draft._id, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      publishedCount,
      totalAttempted: drafts.length,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error: any) {
    console.error("Failed to publish drafts:", error);
    return NextResponse.json({ error: error.message || "Failed to publish drafts" }, { status: 500 });
  }
}
