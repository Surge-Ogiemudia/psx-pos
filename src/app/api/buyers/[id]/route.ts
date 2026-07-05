import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import StoreSale from "@/models/StoreSale";
import { requireStoreApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/buyers/[id]">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const buyer = await Buyer.findOne({ _id: id, pharmacyId: session.user.pharmacyId }).lean();
    if (!buyer) return NextResponse.json({ error: "Buyer not found" }, { status: 404 });

    const sales = await StoreSale.find({ pharmacyId: session.user.pharmacyId, buyerId: id })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    return NextResponse.json({ buyer, sales });
  } catch (error) {
    return handleApiError(error);
  }
}
