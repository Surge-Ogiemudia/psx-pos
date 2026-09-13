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

    await dbConnect();

    const query: any = { pharmacyId: session.user.pharmacyId };
    if (branchId) query.branchId = branchId;

    // Get all drafts sorted by newest first
    const drafts = await AiDraftProduct.find(query).sort({ createdAt: -1 }).lean();

    return NextResponse.json({ success: true, drafts });
  } catch (error: any) {
    console.error("Failed to fetch AI Drafts:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch drafts" }, { status: 500 });
  }
}
