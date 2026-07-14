import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Supplier from "@/models/Supplier";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const supplier = await Supplier.findOne({ _id: id, pharmacyId: session.user.pharmacyId }).lean();
    if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

    const batches = await StoreBatch.find({ pharmacyId: session.user.pharmacyId, supplierId: id })
      .sort({ receivedAt: -1 })
      .limit(100)
      .lean();

    return NextResponse.json({ supplier, batches });
  } catch (error) {
    return handleApiError(error);
  }
}
