import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { buildDrawPlan, type Channel } from "@/lib/storeDraw";
import { handleApiError } from "@/lib/apiError";

const CHANNELS: Channel[] = ["sister_store", "branch", "distributor", "wholesaler", "retailer"];

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/store-products/[id]/draw-preview">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const params = request.nextUrl.searchParams;
    const scope = getStoreScope(session, params.get("storeId"));
    const form = params.get("form") ?? "";
    const quantity = Number(params.get("quantity"));
    const channel = params.get("channel") as Channel;

    if (!form) return NextResponse.json({ error: "form is required" }, { status: 400 });
    if (!Number.isFinite(quantity) || quantity < 1) {
      return NextResponse.json({ error: "quantity must be at least 1" }, { status: 400 });
    }
    if (!CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const plan = await buildDrawPlan({
      pharmacyId: scope.pharmacyId,
      storeId: scope.storeId,
      storeProductId: id,
      form,
      quantity,
      channel,
    });

    return NextResponse.json({
      referenceHierarchy: plan.referenceHierarchy,
      totalBaseUnitQuantity: plan.totalBaseUnitQuantity,
      totalValue: plan.totalValue,
      batchesInvolved: plan.items.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
