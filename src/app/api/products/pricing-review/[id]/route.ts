import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { computeReviewFlags } from "@/lib/reviewFlags";
import {
  verifyPricingAccess,
  APCARE_PHARMACY_ID,
  APCARE_BRANCH_ID,
} from "@/lib/authPricing";
import mongoose from "mongoose";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const isAuthorized = await verifyPricingAccess(req);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid draft ID" }, { status: 400 });
    }

    const body = await req.json();
    const retailPrice = Number(body.retailPrice);

    if (isNaN(retailPrice) || retailPrice <= 0) {
      return NextResponse.json(
        { error: "A valid positive retailPrice is required" },
        { status: 400 }
      );
    }

    await dbConnect();

    const pharmacyId = new mongoose.Types.ObjectId(APCARE_PHARMACY_ID);
    const branchId = new mongoose.Types.ObjectId(APCARE_BRANCH_ID);

    // Strictly find draft within APCare Pharmacy and Branch
    const draft = await AiDraftProduct.findOne({
      _id: new mongoose.Types.ObjectId(id),
      pharmacyId,
      branchId,
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // 1. Update retail price and mark confirmed
    draft.retailPrice = retailPrice;
    draft.priceConfirmed = true;

    // Optional corrections from the wizard
    if (typeof body.extractedItemName === "string" && body.extractedItemName.trim()) {
      draft.extractedItemName = body.extractedItemName.trim();
    }
    if (typeof body.extractedBrand === "string") {
      draft.extractedBrand = body.extractedBrand.trim();
    }
    if (typeof body.extractedSize === "string") {
      draft.extractedSize = body.extractedSize.trim();
    }
    if (typeof body.category === "string" && ["medicine", "non-medicine", "supermarket"].includes(body.category)) {
      draft.category = body.category;
    }

    // 2. Dynamically re-evaluate needsReviewReason using central validator
    draft.needsReviewReason = computeReviewFlags(draft);

    await draft.save();

    // 3. If draft was already linked to a live catalog Product, sync the product retailPrice too
    if (draft.productId) {
      try {
        await Product.updateOne(
          { _id: draft.productId, pharmacyId, branchId },
          { $set: { retailPrice } }
        );
      } catch (prodErr) {
        console.warn("Could not sync price to Product:", prodErr);
      }
    }

    return NextResponse.json({
      success: true,
      draft,
    });
  } catch (error: any) {
    console.error("Failed to update draft price:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update draft price" },
      { status: 500 }
    );
  }
}
