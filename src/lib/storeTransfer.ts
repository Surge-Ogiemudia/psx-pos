import mongoose from "mongoose";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import StoreTransfer from "@/models/StoreTransfer";
import Store from "@/models/Store";
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
 * The dispatch half of a push — shared by the single-item push route and the bulk-push route so
 * both stay in exactly one place. Draws down the source batch(es) and creates "in_transit"
 * StoreTransfer records, but does NOT touch the destination: stock only lands there once the
 * destination actively confirms receipt (see receiveTransfers below). Must be called inside an
 * already-open transaction (dbSession).
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
          status: "in_transit",
          initiatedByUserId: actorUserId,
          timestamp: new Date(),
        },
      ],
      { session: dbSession }
    );
    transferIds.push(transferCreated[0]._id);
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
    summary: `${sourceStoreName} pushed ${quantity} ${pluralize(form, quantity)} of ${plan.items[0].batch.productName} to ${destinationName}${plan.items.length > 1 ? ` (spanning ${plan.items.length} batches)` : ""} — awaiting receipt`,
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

export interface ReceiveTransfersParams {
  pharmacyId: string;
  destinationType: "store" | "branch";
  toStoreId?: string;
  toBranchId?: string;
  transferIds: string[];
  actorUserId: string;
  actorName: string;
  dbSession: mongoose.ClientSession;
}

export interface ReceiveResult {
  received: number;
  totalBaseUnitQuantity: number;
  totalValue: number;
}

/**
 * The receive half of a push. Only ever operates on transfers matching the caller's own
 * authorized destination (filtered into the query below, not just trusted from the request) —
 * so a session can never receive a transfer addressed to a different store/branch by passing
 * an arbitrary transferId. Must be called inside an already-open transaction (dbSession).
 */
export async function receiveTransfers(params: ReceiveTransfersParams): Promise<ReceiveResult> {
  const { pharmacyId, destinationType, toStoreId, toBranchId, transferIds, actorUserId, actorName, dbSession } =
    params;

  const destQuery: Record<string, unknown> = {
    _id: { $in: transferIds },
    pharmacyId,
    status: "in_transit",
    destinationType,
  };
  if (destinationType === "store") destQuery.toStoreId = toStoreId;
  else destQuery.toBranchId = toBranchId;

  const transfers = await StoreTransfer.find(destQuery, null, { session: dbSession });
  if (transfers.length === 0) throw new Error("No pending transfers to receive");

  // Cache find-or-create'd destination products by source storeProductId within this call, so
  // receiving several batches of the same product doesn't create duplicate destination rows.
  const destProductCache = new Map<string, { _id: mongoose.Types.ObjectId }>();
  let totalBaseUnitQuantity = 0;
  let totalValue = 0;
  let sourceStoreName = "";

  for (const transfer of transfers) {
    const sourceProduct = await StoreProduct.findOne(
      { _id: transfer.storeProductId, pharmacyId },
      null,
      { session: dbSession }
    );
    if (!sourceProduct) throw new Error("Source product no longer exists");

    if (!sourceStoreName) {
      const sourceStore = await Store.findById(transfer.fromStoreId).lean();
      sourceStoreName = sourceStore?.storeName ?? "the source store";
    }

    // storeBatchId still points at the source batch document (only its remaining quantity was
    // decremented at push time, the document itself persists), so batchNumber/expiryDate can be
    // read from it now instead of needing to have been snapshotted onto the transfer earlier.
    const sourceBatch = await StoreBatch.findById(transfer.storeBatchId, null, { session: dbSession });

    const cacheKey = transfer.storeProductId.toString();
    let destProduct = destProductCache.get(cacheKey);

    if (destinationType === "store") {
      if (!destProduct) {
        let found = await StoreProduct.findOne(
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
        if (!found) {
          const created = await StoreProduct.create(
            [
              {
                pharmacyId,
                storeId: toStoreId,
                itemName: sourceProduct.itemName,
                brand: sourceProduct.brand,
                size: sourceProduct.size,
                category: sourceProduct.category,
                baseUnitName:
                  transfer.unitHierarchySnapshot[transfer.unitHierarchySnapshot.length - 1].unitName,
                quantityInStock: 0,
              },
            ],
            { session: dbSession }
          );
          found = created[0];
        }
        destProduct = found;
        destProductCache.set(cacheKey, destProduct);
      }

      await StoreBatch.create(
        [
          {
            pharmacyId,
            storeId: toStoreId,
            storeProductId: destProduct._id,
            productName: transfer.productName,
            unitHierarchy: transfer.unitHierarchySnapshot,
            receivedForm: transfer.pushedForm,
            receivedQuantity: transfer.pushedQuantity,
            baseUnitQuantity: transfer.baseUnitQuantity,
            remainingBaseUnitQuantity: transfer.baseUnitQuantity,
            purchaseAmount: transfer.totalValue,
            purchaseUnitCost: transfer.unitPriceAtPushForm,
            batchNumber: sourceBatch?.batchNumber ?? "",
            expiryDate: sourceBatch?.expiryDate ?? null,
            sourceTransferId: transfer._id,
            receivedByUserId: actorUserId,
            receivedAt: new Date(),
          },
        ],
        { session: dbSession }
      );

      await StoreProduct.findOneAndUpdate(
        { _id: destProduct._id },
        { $inc: { quantityInStock: transfer.baseUnitQuantity } },
        { session: dbSession }
      );
    } else {
      if (!destProduct) {
        let found = await Product.findOne(
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
        if (!found) {
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
                unitHierarchy: transfer.unitHierarchySnapshot,
                retailPrice: transfer.unitPriceAtPushForm,
                wholesalePrice: transfer.unitPriceAtPushForm,
                distributorPrice: transfer.unitPriceAtPushForm,
                batchNumber: sourceBatch?.batchNumber ?? "",
                expiryDate: sourceBatch?.expiryDate ?? null,
              },
            ],
            { session: dbSession }
          );
          found = created[0];
        }
        destProduct = found;
        destProductCache.set(cacheKey, destProduct);
      }

      await ProductBatch.create(
        [
          {
            pharmacyId,
            branchId: toBranchId,
            productId: destProduct._id,
            quantity: transfer.baseUnitQuantity,
            remainingQuantity: transfer.baseUnitQuantity,
            batchNumber: sourceBatch?.batchNumber ?? "",
            expiryDate: sourceBatch?.expiryDate ?? null,
            sourceTransferId: transfer._id,
            receivedByUserId: actorUserId,
            receivedAt: new Date(),
          },
        ],
        { session: dbSession }
      );

      await Product.findOneAndUpdate(
        { _id: destProduct._id },
        { $inc: { quantityInStock: transfer.baseUnitQuantity } },
        { session: dbSession }
      );
    }

    await StoreTransfer.findOneAndUpdate(
      { _id: transfer._id },
      { status: "received", receivedByUserId: actorUserId, receivedAt: new Date() },
      { session: dbSession }
    );

    totalBaseUnitQuantity += transfer.baseUnitQuantity;
    totalValue += transfer.totalValue;
  }

  await logActivity(dbSession, {
    pharmacyId,
    scope: destinationType === "store" ? "store" : "branch",
    storeId: destinationType === "store" ? (toStoreId ?? undefined) : undefined,
    branchId: destinationType === "branch" ? (toBranchId ?? undefined) : undefined,
    actorUserId,
    actorName,
    action: "receive",
    summary: `Received ${transfers.length} transfer${transfers.length === 1 ? "" : "s"} from ${sourceStoreName} (₦${totalValue.toFixed(2)})`,
    metadata: { transferIds: transfers.map((t) => t._id), totalBaseUnitQuantity, totalValue },
    refCollection: "StoreTransfer",
    refId: transfers[0]._id,
  });

  return { received: transfers.length, totalBaseUnitQuantity, totalValue };
}
