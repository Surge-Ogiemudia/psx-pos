import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import { requireStoreApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const type = request.nextUrl.searchParams.get("type");
    const search = request.nextUrl.searchParams.get("search")?.trim();

    const query: Record<string, unknown> = { pharmacyId: session.user.pharmacyId };
    if (type) query.buyerType = type;
    if (search) query.nameKey = { $regex: search.toLowerCase(), $options: "i" };

    const buyers = await Buyer.find(query).sort({ name: 1 }).limit(50).lean();
    return NextResponse.json({ buyers });
  } catch (error) {
    return handleApiError(error);
  }
}
