import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import {
  verifyPricingAccess,
  APCARE_PHARMACY_ID,
  APCARE_BRANCH_ID,
} from "@/lib/authPricing";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const isAuthorized = await verifyPricingAccess(req);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    await dbConnect();

    const pharmacyId = new mongoose.Types.ObjectId(APCARE_PHARMACY_ID);
    const branchId = new mongoose.Types.ObjectId(APCARE_BRANCH_ID);

    // Fetch drafts for APCare Pharmacy that lack a price (retailPrice is null, 0, or <= 0)
    const query: any = {
      pharmacyId,
      branchId,
      $or: [
        { retailPrice: null },
        { retailPrice: 0 },
        { retailPrice: { $lte: 0 } },
        { retailPrice: { $exists: false } },
      ],
    };

    // Sort by createdAt ascending to progress chronologically through drafts
    const drafts = await AiDraftProduct.find(query)
      .sort({ createdAt: 1 })
      .lean();

    // Also get overall statistics for context
    const totalDrafts = await AiDraftProduct.countDocuments({ pharmacyId, branchId });
    const pricedCount = totalDrafts - drafts.length;

    return NextResponse.json({
      success: true,
      count: drafts.length,
      totalDrafts,
      pricedCount,
      drafts,
    });
  } catch (error: any) {
    console.error("Failed to fetch unpriced drafts:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch drafts" },
      { status: 500 }
    );
  }
}
