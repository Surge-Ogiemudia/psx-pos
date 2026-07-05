import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { handleApiError } from "@/lib/apiError";

const CHANNELS = ["sister_store", "branch", "distributor", "wholesaler", "retailer"] as const;
const CHANNEL_LABEL: Record<string, string> = {
  sister_store: "sister store",
  branch: "retail branch",
  distributor: "distributor",
  wholesaler: "wholesaler",
  retailer: "retailer",
};

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/store-batches/[id]/dispense-settings">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const batch = await StoreBatch.findOne({ _id: id, pharmacyId: session.user.pharmacyId }).lean();
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    getStoreScope(session, batch.storeId.toString());

    const settings = await DispenseSetting.find({
      pharmacyId: session.user.pharmacyId,
      storeBatchId: id,
    }).lean();

    return NextResponse.json({ batch, settings });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/store-batches/[id]/dispense-settings">
) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const batch = await StoreBatch.findOne({ _id: id, pharmacyId: session.user.pharmacyId });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    getStoreScope(session, batch.storeId.toString());

    const body = await request.json();
    const channel = body.channel;
    const priceForm = typeof body.priceForm === "string" ? body.priceForm.trim() : "";
    const priceAmount = Number(body.priceAmount);

    if (!CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }
    if (!batch.unitHierarchy.some((l) => l.unitName === priceForm)) {
      return NextResponse.json(
        { error: `"${priceForm}" must be one of this batch's unit levels` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(priceAmount) || priceAmount < 0) {
      return NextResponse.json({ error: "Price amount must be a non-negative number" }, { status: 400 });
    }

    const dbSession = await mongoose.startSession();
    try {
      let setting;
      await dbSession.withTransaction(async () => {
        setting = await DispenseSetting.findOneAndUpdate(
          { pharmacyId: session.user.pharmacyId, storeBatchId: id, channel },
          {
            $set: {
              priceForm,
              priceAmount,
              setByUserId: session.user.id,
              storeId: batch.storeId,
              storeProductId: batch.storeProductId,
            },
          },
          { new: true, upsert: true, session: dbSession, setDefaultsOnInsert: true }
        );

        await logActivity(dbSession, {
          pharmacyId: session.user.pharmacyId,
          scope: "store",
          storeId: batch.storeId.toString(),
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "dispense_setting",
          summary: `${session.user.name} set the ${CHANNEL_LABEL[channel]} price for ${batch.productName} to ₦${priceAmount.toFixed(2)} per ${priceForm}`,
          metadata: { channel, priceForm, priceAmount },
          refCollection: "DispenseSetting",
          refId: setting!._id,
        });
      });

      return NextResponse.json({ setting });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
