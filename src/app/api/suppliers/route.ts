import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Supplier from "@/models/Supplier";
import { requireStoreApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const query: Record<string, unknown> = { pharmacyId: session.user.pharmacyId };
    if (search) query.nameKey = { $regex: search.toLowerCase(), $options: "i" };

    const suppliers = await Supplier.find(query).sort({ name: 1 }).limit(50).lean();
    return NextResponse.json({ suppliers });
  } catch (error) {
    return handleApiError(error);
  }
}
