import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import { requireApiSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const body = await req.json();

    const { branchId, frontImageUrl, backImageUrl, quantityInStock, retailPrice, category } = body;
    if (!branchId || !frontImageUrl) {
      return NextResponse.json({ error: "branchId and frontImageUrl are required" }, { status: 400 });
    }

    const draft = await AiDraftProduct.create({
      pharmacyId: session.user.pharmacyId,
      branchId,
      frontImageUrl,
      backImageUrl,
      quantityInStock: quantityInStock || 0,
      retailPrice: retailPrice || null,
      category: ["medicine", "non-medicine", "supermarket"].includes(category) ? category : "medicine",
      status: "pending"
    });

    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    console.error("Failed to create AI Draft:", error);
    return NextResponse.json({ error: error.message || "Failed to create draft" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    // Optional — omitted entirely keeps the old unlimited-fetch behavior (desktop still
    // relies on seeing the true full queue for its lane counts). Mobile passes this to
    // avoid re-transferring thousands of drafts (image URLs included) on every 5s poll.
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 0)) : null;

    await dbConnect();

    // Excludes "completed" — Panel 1 never displays those (Panel 4's own /processed
    // endpoint covers them), so shipping them here on every 5s poll is pure waste.
    const query: any = { pharmacyId: session.user.pharmacyId, status: { $ne: "completed" } };
    if (branchId) query.branchId = branchId;

    // Trimmed to exactly what the Live Queue UI reads — drops branchId/pharmacyId,
    // internal confirm-flow flags, and other fields that were being shipped over the
    // wire on every poll but never used client-side.
    let cursor = AiDraftProduct.find(query)
      .select(
        "frontImageUrl backImageUrl quantityInStock retailPrice category status createdAt extractedItemName extractedBrand extractedSize extractedExpiryDate productId"
      )
      .sort({ createdAt: -1 });
    if (limit) cursor = cursor.limit(limit);
    const drafts = await cursor.lean();

    // Only computed when a limit was actually requested — an extra count() on every
    // unlimited desktop poll would be pure overhead for a number nothing there reads.
    const total = limit ? await AiDraftProduct.countDocuments(query) : drafts.length;

    return NextResponse.json({ success: true, drafts, total });
  } catch (error: any) {
    console.error("Failed to fetch AI Drafts:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch drafts" }, { status: 500 });
  }
}
