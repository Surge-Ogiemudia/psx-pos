import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import { requireApiSession } from "@/lib/session";

import { computeReviewFlags } from "@/lib/reviewFlags";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    await dbConnect();
    const body = await req.json();

    const draft = await AiDraftProduct.findOne({
      _id: resolvedParams.id,
      pharmacyId: session.user.pharmacyId,
    });

    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    if (body.extractedItemName !== undefined) draft.extractedItemName = body.extractedItemName.trim();
    if (body.extractedBrand !== undefined) draft.extractedBrand = body.extractedBrand.trim();
    if (body.extractedSize !== undefined) draft.extractedSize = body.extractedSize.trim();
    if (body.extractedBarcode !== undefined) draft.extractedBarcode = body.extractedBarcode.trim();
    if (body.retailPrice !== undefined) draft.retailPrice = Number(body.retailPrice);
    if (body.quantityInStock !== undefined) draft.quantityInStock = Number(body.quantityInStock);
    if (body.category !== undefined) draft.category = body.category;
    if (body.extractedExpiryDate !== undefined) {
      draft.extractedExpiryDate = body.extractedExpiryDate ? new Date(body.extractedExpiryDate) : null;
    }
    if (body.categoryConfirmed !== undefined) {
      draft.categoryConfirmed = Boolean(body.categoryConfirmed);
    }

    // Dynamically re-evaluate needsReviewReason using central validator
    draft.needsReviewReason = computeReviewFlags(draft);

    await draft.save();

    return NextResponse.json({ success: true, draft });

  } catch (error: any) {
    console.error("Failed to update draft:", error);
    return NextResponse.json({ error: error.message || "Failed to update draft" }, { status: 500 });
  }
}
