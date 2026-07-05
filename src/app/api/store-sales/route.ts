import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import Buyer from "@/models/Buyer";
import StoreSale from "@/models/StoreSale";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { pluralize } from "@/lib/unitHierarchy";
import { buildDrawPlan } from "@/lib/storeDraw";
import { handleApiError } from "@/lib/apiError";

const BUYER_TYPES = ["distributor", "wholesaler", "retailer"] as const;
const PAYMENT_METHODS = ["cash", "card", "mobile_money"] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const storeId = request.nextUrl.searchParams.get("storeId");
    const buyerId = request.nextUrl.searchParams.get("buyerId");
    const query: Record<string, unknown> = { pharmacyId: session.user.pharmacyId };

    if (buyerId) {
      query.buyerId = buyerId;
    } else {
      const scope = getStoreScope(session, storeId);
      query.storeId = scope.storeId;
    }

    const sales = await StoreSale.find(query).sort({ timestamp: -1 }).limit(200).lean();
    return NextResponse.json({ sales });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      storeProductId,
      form,
      quantity,
      buyerType,
      buyerName,
      paymentMethod,
    }: {
      storeProductId?: string;
      form?: string;
      quantity?: number;
      buyerType?: string;
      buyerName?: string;
      paymentMethod?: string;
    } = body;

    if (!buyerType || !BUYER_TYPES.includes(buyerType as (typeof BUYER_TYPES)[number])) {
      return NextResponse.json({ error: "Invalid buyer type" }, { status: 400 });
    }
    const validBuyerType: (typeof BUYER_TYPES)[number] = buyerType as (typeof BUYER_TYPES)[number];
    const trimmedName = typeof buyerName === "string" ? buyerName.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Buyer name is required" }, { status: 400 });
    }
    if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod as (typeof PAYMENT_METHODS)[number])) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }
    const validPaymentMethod: (typeof PAYMENT_METHODS)[number] = paymentMethod as (typeof PAYMENT_METHODS)[number];
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }
    if (!storeProductId || !form) {
      return NextResponse.json({ error: "storeProductId and form are required" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    const sourceStore = await Store.findById(scope.storeId).lean();

    const dbSession = await mongoose.startSession();
    try {
      let response: { totalAmount: number; totalBaseUnitQuantity: number; batchesInvolved: number } | null = null;

      await dbSession.withTransaction(async () => {
        const plan = await buildDrawPlan({
          pharmacyId: scope.pharmacyId,
          storeId: scope.storeId,
          storeProductId,
          form,
          quantity: qty,
          channel: validBuyerType,
          dbSession,
        });

        const nameKey = trimmedName.toLowerCase();
        const buyer = await Buyer.findOneAndUpdate(
          { pharmacyId: scope.pharmacyId, buyerType: validBuyerType, nameKey },
          {
            $inc: { totalPurchaseAmount: plan.totalValue },
            $set: { lastPurchaseAt: new Date() },
            $setOnInsert: { name: trimmedName, nameKey, buyerType: validBuyerType, phoneNumber: "" },
          },
          { new: true, upsert: true, session: dbSession, setDefaultsOnInsert: true }
        );
        const isNewBuyer = buyer.createdAt.getTime() === buyer.updatedAt.getTime();

        const saleIds: mongoose.Types.ObjectId[] = [];

        for (const item of plan.items) {
          const updatedBatch = await StoreBatch.findOneAndUpdate(
            { _id: item.batch._id, remainingBaseUnitQuantity: { $gte: item.baseUnitsDrawn } },
            { $inc: { remainingBaseUnitQuantity: -item.baseUnitsDrawn } },
            { new: true, session: dbSession }
          );
          if (!updatedBatch) throw new Error("Batch stock changed — please try again");

          const baseUnitName = item.batch.unitHierarchy[item.batch.unitHierarchy.length - 1].unitName;

          const saleCreated = await StoreSale.create(
            [
              {
                pharmacyId: scope.pharmacyId,
                storeId: scope.storeId,
                buyerId: buyer._id,
                buyerType: validBuyerType,
                storeProductId,
                storeBatchId: item.batch._id,
                productName: item.batch.productName,
                unitHierarchySnapshot: item.batch.unitHierarchy,
                soldForm: baseUnitName,
                soldQuantity: item.baseUnitsDrawn,
                baseUnitQuantity: item.baseUnitsDrawn,
                unitPriceAtSoldForm: item.unitPriceAtBaseUnit,
                totalAmount: item.lineTotal,
                paymentMethod: validPaymentMethod,
                soldByUserId: session.user.id,
                timestamp: new Date(),
              },
            ],
            { session: dbSession }
          );
          saleIds.push(saleCreated[0]._id);
        }

        await StoreProduct.findOneAndUpdate(
          { _id: storeProductId },
          { $inc: { quantityInStock: -plan.totalBaseUnitQuantity } },
          { session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "store",
          storeId: scope.storeId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "sell",
          summary: `${sourceStore?.storeName ?? "The store"} sold ${qty} ${pluralize(form, qty)} of ${plan.items[0].batch.productName} to ${trimmedName} (${buyerType}) for ₦${plan.totalValue.toFixed(2)}${plan.items.length > 1 ? ` (spanning ${plan.items.length} batches)` : ""}${isNewBuyer ? " — new buyer registered" : ""}`,
          metadata: {
            buyerType,
            buyerName: trimmedName,
            form,
            quantity: qty,
            baseUnitQuantity: plan.totalBaseUnitQuantity,
            totalAmount: plan.totalValue,
            paymentMethod,
            saleIds,
          },
          refCollection: "StoreSale",
          refId: saleIds[0],
        });

        response = {
          totalAmount: plan.totalValue,
          totalBaseUnitQuantity: plan.totalBaseUnitQuantity,
          batchesInvolved: plan.items.length,
        };
      });

      return NextResponse.json(response, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
