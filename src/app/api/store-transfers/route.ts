import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import Branch from "@/models/Branch";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import StoreTransfer from "@/models/StoreTransfer";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { pluralize } from "@/lib/unitHierarchy";
import { buildDrawPlan } from "@/lib/storeDraw";
import { handleApiError } from "@/lib/apiError";
import { parseNumeric } from "@/lib/numberInput";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const storeId = request.nextUrl.searchParams.get("storeId");
    const scope = getStoreScope(session, storeId);

    const transfers = await StoreTransfer.find({ pharmacyId: scope.pharmacyId, fromStoreId: scope.storeId })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({ transfers });
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
      destinationType,
      toStoreId,
      toBranchId,
    }: {
      storeProductId?: string;
      form?: string;
      quantity?: number;
      destinationType?: "store" | "branch";
      toStoreId?: string;
      toBranchId?: string;
    } = body;

    if (destinationType !== "store" && destinationType !== "branch") {
      return NextResponse.json({ error: "Invalid destination type" }, { status: 400 });
    }
    if (destinationType === "store" && !toStoreId) {
      return NextResponse.json({ error: "Destination store is required" }, { status: 400 });
    }
    if (destinationType === "branch" && !toBranchId) {
      return NextResponse.json({ error: "Destination branch is required" }, { status: 400 });
    }
    const qty = parseNumeric(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }
    if (!storeProductId || !form) {
      return NextResponse.json({ error: "storeProductId and form are required" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    if (destinationType === "store" && toStoreId === scope.storeId) {
      return NextResponse.json({ error: "Cannot push to the same store" }, { status: 400 });
    }

    const channel = destinationType === "store" ? "sister_store" : "branch";
    const sourceStore = await Store.findById(scope.storeId).lean();
    const destinationName =
      destinationType === "store"
        ? (await Store.findById(toStoreId).lean())?.storeName
        : (await Branch.findById(toBranchId).lean())?.branchName;
    if (!destinationName) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    const dbSession = await mongoose.startSession();
    try {
      let response: { totalBaseUnitQuantity: number; totalValue: number; batchesInvolved: number } | null = null;

      await dbSession.withTransaction(async () => {
        const plan = await buildDrawPlan({
          pharmacyId: scope.pharmacyId,
          storeId: scope.storeId,
          storeProductId,
          form,
          quantity: qty,
          channel,
          dbSession,
        });

        // Destination products (whether a sister store or a branch) are matched/created by the
        // source item's itemName/brand/size, not by re-parsing the batch's composed productName
        // snapshot string.
        const sourceProduct = await StoreProduct.findOne(
          { _id: storeProductId, ...scope },
          null,
          { session: dbSession }
        );
        if (!sourceProduct) throw new Error("Source product not found");

        // For a branch destination, find-or-create the branch's Product row up front (using the
        // first batch's price/unitHierarchy as the representative snapshot) so each store batch
        // pushed can get its own ProductBatch record against it inside the loop below.
        let branchDestProduct: Awaited<ReturnType<typeof Product.findOne>> | null = null;
        if (destinationType === "branch") {
          const weightedPricePerBaseUnit = plan.totalValue / plan.totalBaseUnitQuantity;
          const firstBatch = plan.items[0].batch;
          branchDestProduct = await Product.findOne(
            {
              pharmacyId: scope.pharmacyId,
              branchId: toBranchId,
              itemName: sourceProduct.itemName,
              brand: sourceProduct.brand,
              size: sourceProduct.size,
            },
            null,
            { session: dbSession }
          );
          if (!branchDestProduct) {
            const created = await Product.create(
              [
                {
                  pharmacyId: scope.pharmacyId,
                  branchId: toBranchId,
                  itemName: sourceProduct.itemName,
                  brand: sourceProduct.brand,
                  size: sourceProduct.size,
                  category: "medicine",
                  quantityInStock: 0,
                  unitHierarchy: firstBatch.unitHierarchy,
                  retailPrice: weightedPricePerBaseUnit,
                  wholesalePrice: weightedPricePerBaseUnit,
                  distributorPrice: weightedPricePerBaseUnit,
                  batchNumber: firstBatch.batchNumber,
                  expiryDate: firstBatch.expiryDate,
                },
              ],
              { session: dbSession }
            );
            branchDestProduct = created[0];
          } else {
            await Product.findOneAndUpdate(
              { _id: branchDestProduct._id },
              { $set: { retailPrice: weightedPricePerBaseUnit, unitHierarchy: firstBatch.unitHierarchy } },
              { session: dbSession }
            );
          }
        }

        const transferIds: mongoose.Types.ObjectId[] = [];

        for (const item of plan.items) {
          const updatedBatch = await StoreBatch.findOneAndUpdate(
            { _id: item.batch._id, remainingBaseUnitQuantity: { $gte: item.baseUnitsDrawn } },
            { $inc: { remainingBaseUnitQuantity: -item.baseUnitsDrawn } },
            { new: true, session: dbSession }
          );
          if (!updatedBatch) throw new Error("Batch stock changed — please try again");

          const baseUnitName = item.batch.unitHierarchy[item.batch.unitHierarchy.length - 1].unitName;

          const transferCreated = await StoreTransfer.create(
            [
              {
                pharmacyId: scope.pharmacyId,
                fromStoreId: scope.storeId,
                destinationType,
                toStoreId: destinationType === "store" ? toStoreId : null,
                toBranchId: destinationType === "branch" ? toBranchId : null,
                storeProductId,
                storeBatchId: item.batch._id,
                productName: item.batch.productName,
                unitHierarchySnapshot: item.batch.unitHierarchy,
                pushedForm: baseUnitName,
                pushedQuantity: item.baseUnitsDrawn,
                baseUnitQuantity: item.baseUnitsDrawn,
                unitPriceAtPushForm: item.unitPriceAtBaseUnit,
                totalValue: item.lineTotal,
                initiatedByUserId: session.user.id,
                timestamp: new Date(),
              },
            ],
            { session: dbSession }
          );
          transferIds.push(transferCreated[0]._id);

          if (destinationType === "store") {
            let destProduct = await StoreProduct.findOne(
              {
                pharmacyId: scope.pharmacyId,
                storeId: toStoreId,
                itemName: sourceProduct.itemName,
                brand: sourceProduct.brand,
                size: sourceProduct.size,
              },
              null,
              { session: dbSession }
            );
            if (!destProduct) {
              const created = await StoreProduct.create(
                [
                  {
                    pharmacyId: scope.pharmacyId,
                    storeId: toStoreId,
                    itemName: sourceProduct.itemName,
                    brand: sourceProduct.brand,
                    size: sourceProduct.size,
                    category: "medicine",
                    baseUnitName,
                    quantityInStock: 0,
                  },
                ],
                { session: dbSession }
              );
              destProduct = created[0];
            }

            await StoreBatch.create(
              [
                {
                  pharmacyId: scope.pharmacyId,
                  storeId: toStoreId,
                  storeProductId: destProduct._id,
                  productName: item.batch.productName,
                  unitHierarchy: item.batch.unitHierarchy,
                  receivedForm: baseUnitName,
                  receivedQuantity: item.baseUnitsDrawn,
                  baseUnitQuantity: item.baseUnitsDrawn,
                  remainingBaseUnitQuantity: item.baseUnitsDrawn,
                  purchaseAmount: item.lineTotal,
                  purchaseUnitCost: item.unitPriceAtBaseUnit,
                  batchNumber: item.batch.batchNumber,
                  expiryDate: item.batch.expiryDate,
                  sourceTransferId: transferCreated[0]._id,
                  receivedByUserId: session.user.id,
                  receivedAt: new Date(),
                },
              ],
              { session: dbSession }
            );

            await StoreProduct.findOneAndUpdate(
              { _id: destProduct._id },
              { $inc: { quantityInStock: item.baseUnitsDrawn } },
              { session: dbSession }
            );
          }

          if (destinationType === "branch" && branchDestProduct) {
            await ProductBatch.create(
              [
                {
                  pharmacyId: scope.pharmacyId,
                  branchId: toBranchId,
                  productId: branchDestProduct._id,
                  quantity: item.baseUnitsDrawn,
                  remainingQuantity: item.baseUnitsDrawn,
                  batchNumber: item.batch.batchNumber,
                  expiryDate: item.batch.expiryDate,
                  sourceTransferId: transferCreated[0]._id,
                  receivedByUserId: session.user.id,
                  receivedAt: new Date(),
                },
              ],
              { session: dbSession }
            );

            await Product.findOneAndUpdate(
              { _id: branchDestProduct._id },
              { $inc: { quantityInStock: item.baseUnitsDrawn } },
              { session: dbSession }
            );
          }
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
          action: "push",
          summary: `${sourceStore?.storeName ?? "The store"} pushed ${qty} ${pluralize(form, qty)} of ${plan.items[0].batch.productName} to ${destinationName}${plan.items.length > 1 ? ` (spanning ${plan.items.length} batches)` : ""}`,
          metadata: {
            destinationType,
            toStoreId,
            toBranchId,
            form,
            quantity: qty,
            baseUnitQuantity: plan.totalBaseUnitQuantity,
            totalValue: plan.totalValue,
            transferIds,
          },
          refCollection: "StoreTransfer",
          refId: transferIds[0],
        });

        response = {
          totalBaseUnitQuantity: plan.totalBaseUnitQuantity,
          totalValue: plan.totalValue,
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
