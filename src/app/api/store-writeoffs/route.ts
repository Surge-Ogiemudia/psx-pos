import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { compareBatchesFifo, computeBaseUnitsPerLevel, planDraw, pluralize } from "@/lib/unitHierarchy";
import { handleApiError } from "@/lib/apiError";

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Only an admin or store manager can write off stock" }, { status: 403 });
    }
    await dbConnect();

    const body = await request.json();
    const storeProductId = typeof body.storeProductId === "string" ? body.storeProductId : "";
    const form = typeof body.form === "string" ? body.form.trim() : "";
    const quantity = Number(body.quantity);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!storeProductId) return NextResponse.json({ error: "storeProductId is required" }, { status: 400 });
    if (!form) return NextResponse.json({ error: "form is required" }, { status: 400 });
    if (!Number.isFinite(quantity) || quantity < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);

    const storeProduct = await StoreProduct.findOne({ _id: storeProductId, ...scope }).lean();
    if (!storeProduct) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const batchesRaw = await StoreBatch.find({ ...scope, storeProductId, remainingBaseUnitQuantity: { $gt: 0 } }).lean();
    if (batchesRaw.length === 0) {
      return NextResponse.json({ error: "No stock available to write off" }, { status: 400 });
    }
    const batches = [...batchesRaw].sort(compareBatchesFifo);
    const referenceHierarchy = batches[0].unitHierarchy;
    const piecesPerForm = computeBaseUnitsPerLevel(referenceHierarchy)[form];
    if (piecesPerForm === undefined) {
      return NextResponse.json({ error: `"${form}" is not a valid unit for ${storeProduct.name}` }, { status: 400 });
    }
    const neededBaseUnits = piecesPerForm * quantity;

    const plan = planDraw(
      batches.map((b) => ({ id: b._id.toString(), remainingBaseUnitQuantity: b.remainingBaseUnitQuantity })),
      neededBaseUnits
    );
    if (!plan) {
      const totalAvailable = batches.reduce((sum, b) => sum + b.remainingBaseUnitQuantity, 0);
      const baseUnitName = referenceHierarchy[referenceHierarchy.length - 1].unitName;
      return NextResponse.json(
        { error: `Only ${totalAvailable} ${pluralize(baseUnitName, totalAvailable)} available to write off` },
        { status: 400 }
      );
    }

    const store = await Store.findById(scope.storeId).lean();

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        for (const draw of plan) {
          const updated = await StoreBatch.findOneAndUpdate(
            { _id: draw.id, remainingBaseUnitQuantity: { $gte: draw.baseUnitsDrawn } },
            { $inc: { remainingBaseUnitQuantity: -draw.baseUnitsDrawn } },
            { session: dbSession }
          );
          if (!updated) throw new Error("Batch stock changed — please try again");
        }

        await StoreProduct.findOneAndUpdate(
          { _id: storeProductId },
          { $inc: { quantityInStock: -neededBaseUnits } },
          { session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "store",
          storeId: scope.storeId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "write_off",
          summary: `${session.user.name} wrote off ${quantity} ${pluralize(form, quantity)} of ${storeProduct.name}${
            store ? ` at ${store.storeName}` : ""
          }${reason ? ` (${reason})` : ""}`,
          metadata: { form, quantity, neededBaseUnits, reason },
          refCollection: "StoreProduct",
          refId: storeProduct._id,
        });
      });

      return NextResponse.json({ ok: true }, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
