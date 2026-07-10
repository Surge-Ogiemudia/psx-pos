import mongoose from "mongoose";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import StoreTransfer from "@/models/StoreTransfer";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { logActivity } from "@/lib/activityLog";
import { pluralize } from "@/lib/unitHierarchy";
import { buildDrawPlan } from "@/lib/storeDraw";

export interface ExecuteTransferParams {
  pharmacyId: string;
  storeId: string;
  storeProductId: string;
  form: string;
  quantity: number;
  destinationType: "store" | "branch";
  toStoreId?: string;
  toBranchId?: string;
  sourceStoreName: string;
  destinationName: string;
  actorUserId: string;
  actorName: string;
  dbSession: mongoose.ClientSession;
}

export interface TransferResult {
  totalBaseUnitQuantity: number;
  totalValue: number;
  batchesInvolved: number;
}

/**
 * The full push transaction body for one store product to one destination — shared by the
 * single-item push route and the bulk-push route so both draw/transfer/dispense logic stays in
 * exactly one place. Must be called inside an already-open transaction (dbSession).
 */
export async function executeTransfer(params: ExecuteTransferParams): Promise<TransferResult> {
  const {
    pharmacyId,
    storeId,
    storeProductId,
    form,
    quantity,
    destinationType,
    toStoreId,
    toBranchId,
    sourceStoreName,
    destinationName,
    actorUserId,
    actorName,
    dbSession,
  } = params;
  const scope = { pharmacyId, storeId };
  const channel = destinationType === "store" ? "sister_store" : "branch";

  const plan = await buildDrawPlan({
    pharmacyId,
    storeId,
    storeProductId,
    form,
    quantity,
    channel,
    dbSession,
  });

  // Destination products (whether a sister store or a branch) are matched/created by the
  // source item's itemName/brand/size, not by re-parsing the batch's composed productName
  // snapshot string.
  const sourceProduct = await StoreProduct.findOne({ _id: storeProductId, ...scope }, null, { session: dbSession });
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
        pharmacyId,
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
            pharmacyId,
            branchId: toBranchId,
            itemName: sourceProduct.itemName,
            brand: sourceProduct.brand,
            size: sourceProduct.size,
            category: sourceProduct.category,
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
          pharmacyId,
          fromStoreId: storeId,
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
          initiatedByUserId: actorUserId,
          timestamp: new Date(),
        },
      ],
      { session: dbSession }
    );
    transferIds.push(transferCreated[0]._id);

    if (destinationType === "store") {
      let destProduct = await StoreProduct.findOne(
        {
          pharmacyId,
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
              pharmacyId,
              storeId: toStoreId,
              itemName: sourceProduct.itemName,
              brand: sourceProduct.brand,
              size: sourceProduct.size,
              category: sourceProduct.category,
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
            pharmacyId,
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
            receivedByUserId: actorUserId,
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
            pharmacyId,
            branchId: toBranchId,
            productId: branchDestProduct._id,
            quantity: item.baseUnitsDrawn,
            remainingQuantity: item.baseUnitsDrawn,
            batchNumber: item.batch.batchNumber,
            expiryDate: item.batch.expiryDate,
            sourceTransferId: transferCreated[0]._id,
            receivedByUserId: actorUserId,
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
    pharmacyId,
    scope: "store",
    storeId,
    actorUserId,
    actorName,
    action: "push",
    summary: `${sourceStoreName} pushed ${quantity} ${pluralize(form, quantity)} of ${plan.items[0].batch.productName} to ${destinationName}${plan.items.length > 1 ? ` (spanning ${plan.items.length} batches)` : ""}`,
    metadata: {
      destinationType,
      toStoreId,
      toBranchId,
      form,
      quantity,
      baseUnitQuantity: plan.totalBaseUnitQuantity,
      totalValue: plan.totalValue,
      transferIds,
    },
    refCollection: "StoreTransfer",
    refId: transferIds[0],
  });

  return {
    totalBaseUnitQuantity: plan.totalBaseUnitQuantity,
    totalValue: plan.totalValue,
    batchesInvolved: plan.items.length,
  };
}
