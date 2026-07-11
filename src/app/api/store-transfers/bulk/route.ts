import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import Branch from "@/models/Branch";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import StoreTransfer from "@/models/StoreTransfer";
import DispenseSetting from "@/models/DispenseSetting";
import ActivityLog from "@/models/ActivityLog";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { compareBatchesFifo, computeBaseUnitsPerLevel, convertToBaseUnits, planDraw, pluralize } from "@/lib/unitHierarchy";
import { parseNumeric } from "@/lib/numberInput";
import { handleApiError } from "@/lib/apiError";

// A bulk push does a handful of batched reads/writes covering every item, instead of one full
// transaction per item — with thousands of items, per-item round trips are slow enough to blow
// past the platform's request timeout. Give this route extra room regardless.
export const maxDuration = 300;

interface BulkPushItem {
  storeProductId?: string;
  form?: string;
  quantity?: number;
}

type Channel = "sister_store" | "branch";
const CHANNEL_LABEL: Record<Channel, string> = { sister_store: "sister-store", branch: "branch" };

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      destinationType,
      toStoreId,
      toBranchId,
    }: {
      destinationType?: "store" | "branch";
      toStoreId?: string;
      toBranchId?: string;
    } = body;
    const items: BulkPushItem[] = Array.isArray(body.items) ? body.items : [];

    if (destinationType !== "store" && destinationType !== "branch") {
      return NextResponse.json({ error: "Invalid destination type" }, { status: 400 });
    }
    if (destinationType === "store" && !toStoreId) {
      return NextResponse.json({ error: "Destination store is required" }, { status: 400 });
    }
    if (destinationType === "branch" && !toBranchId) {
      return NextResponse.json({ error: "Destination branch is required" }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Select at least one item to push" }, { status: 400 });
    }
    if (items.length > 2000) {
      return NextResponse.json({ error: "Limit is 2000 items per bulk push" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    if (destinationType === "store" && toStoreId === scope.storeId) {
      return NextResponse.json({ error: "Cannot push to the same store" }, { status: 400 });
    }

    const sourceStore = await Store.findById(scope.storeId).lean();
    const destinationName =
      destinationType === "store"
        ? (await Store.findById(toStoreId).lean())?.storeName
        : (await Branch.findById(toBranchId).lean())?.branchName;
    if (!destinationName) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    // --- Pre-fetch everything needed in a handful of queries, not one per item ---
    const requestedIds = items.map((i) => i.storeProductId).filter((v): v is string => !!v);
    const sourceProducts = await StoreProduct.find({ _id: { $in: requestedIds }, ...scope }).lean();
    const sourceProductById = new Map(sourceProducts.map((p) => [p._id.toString(), p]));

    const allBatches = await StoreBatch.find({
      ...scope,
      storeProductId: { $in: requestedIds },
      remainingBaseUnitQuantity: { $gt: 0 },
    }).lean();
    const batchesByProduct = new Map<string, typeof allBatches>();
    for (const b of allBatches) {
      const key = b.storeProductId.toString();
      if (!batchesByProduct.has(key)) batchesByProduct.set(key, []);
      batchesByProduct.get(key)!.push(b);
    }
    for (const arr of batchesByProduct.values()) arr.sort(compareBatchesFifo);

    const channel: Channel = destinationType === "store" ? "sister_store" : "branch";
    const settings = await DispenseSetting.find({
      ...scope,
      storeBatchId: { $in: allBatches.map((b) => b._id) },
      channel,
    }).lean();
    const settingByBatchId = new Map(settings.map((s) => [s.storeBatchId.toString(), s]));

    // --- Compute a draw/price plan per item, purely in memory — no writes yet ---
    type Batch = (typeof allBatches)[number];
    interface Draw {
      batch: Batch;
      baseUnitsDrawn: number;
      unitPriceAtBaseUnit: number;
      lineTotal: number;
    }
    interface ItemPlan {
      storeProductId: string;
      sourceProduct: (typeof sourceProducts)[number];
      draws: Draw[];
      totalBaseUnitQuantity: number;
      totalValue: number;
    }
    const plans: ItemPlan[] = [];
    const results: { storeProductId: string; error?: string; totalValue?: number; batchesInvolved?: number }[] = [];

    for (const item of items) {
      const storeProductId = item.storeProductId || "";
      const form = item.form || "";
      const qty = parseNumeric(item.quantity);

      if (!storeProductId || !form) {
        results.push({ storeProductId, error: "Missing product or form" });
        continue;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        results.push({ storeProductId, error: "Quantity must be at least 1" });
        continue;
      }
      const sourceProduct = sourceProductById.get(storeProductId);
      if (!sourceProduct) {
        results.push({ storeProductId, error: "Source product not found" });
        continue;
      }
      const batches = batchesByProduct.get(storeProductId) ?? [];
      if (batches.length === 0) {
        results.push({ storeProductId, error: "No stock available for this product" });
        continue;
      }

      let neededBaseUnits: number;
      try {
        neededBaseUnits = convertToBaseUnits(batches[0].unitHierarchy, form, qty);
      } catch (err) {
        results.push({ storeProductId, error: err instanceof Error ? err.message : "Invalid form" });
        continue;
      }

      const allocation = planDraw(
        batches.map((b) => ({ id: b._id.toString(), remainingBaseUnitQuantity: b.remainingBaseUnitQuantity })),
        neededBaseUnits
      );
      if (!allocation) {
        const totalAvailable = batches.reduce((sum, b) => sum + b.remainingBaseUnitQuantity, 0);
        const baseUnitName = batches[0].unitHierarchy[batches[0].unitHierarchy.length - 1].unitName;
        results.push({
          storeProductId,
          error: `Only ${totalAvailable} ${pluralize(baseUnitName, totalAvailable)} available across all batches`,
        });
        continue;
      }

      let hasError = false;
      const draws: Draw[] = [];
      let totalValue = 0;
      for (const draw of allocation) {
        const batch = batches.find((b) => b._id.toString() === draw.id)!;
        const setting = settingByBatchId.get(batch._id.toString());
        if (!setting) {
          const receivedDate = new Date(batch.receivedAt).toLocaleDateString();
          results.push({
            storeProductId,
            error: `No ${CHANNEL_LABEL[channel]} price set for the batch of ${batch.productName} received ${receivedDate} — set a price for it first`,
          });
          hasError = true;
          break;
        }
        const perLevel = computeBaseUnitsPerLevel(batch.unitHierarchy);
        const settingPiecesPerForm = perLevel[setting.priceForm];
        if (settingPiecesPerForm === undefined) {
          results.push({ storeProductId, error: "Dispense setting uses an unknown unit" });
          hasError = true;
          break;
        }
        const unitPriceAtBaseUnit = setting.priceAmount / settingPiecesPerForm;
        const lineTotal = unitPriceAtBaseUnit * draw.baseUnitsDrawn;
        totalValue += lineTotal;
        draws.push({ batch, baseUnitsDrawn: draw.baseUnitsDrawn, unitPriceAtBaseUnit, lineTotal });
      }
      if (hasError) continue;

      plans.push({ storeProductId, sourceProduct, draws, totalBaseUnitQuantity: neededBaseUnits, totalValue });
    }

    if (plans.length === 0) {
      return NextResponse.json({ pushed: 0, results }, { status: 400 });
    }

    // --- Issue a handful of bulk writes covering every successful item ---
    // Only the source side changes here: batches drawn down and the source product's stock
    // decremented. The destination gets nothing yet — that only happens once it confirms
    // receipt (see /api/store-transfers/receive), same real-world gap the single-item push
    // models via executeTransfer/receiveTransfers in src/lib/storeTransfer.ts.
    const now = new Date();

    const batchDecrementOps = plans.flatMap((p) =>
      p.draws.map((d) => ({
        updateOne: {
          filter: { _id: d.batch._id, remainingBaseUnitQuantity: { $gte: d.baseUnitsDrawn } },
          update: { $inc: { remainingBaseUnitQuantity: -d.baseUnitsDrawn } },
        },
      }))
    );
    if (batchDecrementOps.length > 0) await StoreBatch.bulkWrite(batchDecrementOps);

    const transferDocs = plans.flatMap((p) =>
      p.draws.map((d) => {
        const baseUnitName = d.batch.unitHierarchy[d.batch.unitHierarchy.length - 1].unitName;
        return {
          pharmacyId: scope.pharmacyId,
          fromStoreId: scope.storeId,
          destinationType,
          toStoreId: destinationType === "store" ? toStoreId : null,
          toBranchId: destinationType === "branch" ? toBranchId : null,
          storeProductId: p.storeProductId,
          storeBatchId: d.batch._id,
          productName: d.batch.productName,
          unitHierarchySnapshot: d.batch.unitHierarchy,
          pushedForm: baseUnitName,
          pushedQuantity: d.baseUnitsDrawn,
          baseUnitQuantity: d.baseUnitsDrawn,
          unitPriceAtPushForm: d.unitPriceAtBaseUnit,
          totalValue: d.lineTotal,
          status: "in_transit",
          initiatedByUserId: session.user.id,
          timestamp: now,
        };
      })
    );
    if (transferDocs.length > 0) await StoreTransfer.insertMany(transferDocs);

    await StoreProduct.bulkWrite(
      plans.map((p) => ({
        updateOne: {
          filter: { _id: p.storeProductId },
          update: { $inc: { quantityInStock: -p.totalBaseUnitQuantity } },
        },
      }))
    );

    await ActivityLog.create({
      pharmacyId: scope.pharmacyId,
      scope: "store",
      storeId: scope.storeId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? "Unknown",
      action: "push",
      summary: `${sourceStore?.storeName ?? "The store"} bulk-pushed ${plans.length} item${plans.length === 1 ? "" : "s"} to ${destinationName} — awaiting receipt`,
      metadata: { destinationType, toStoreId, toBranchId, itemCount: plans.length },
      timestamp: now,
    });

    plans.forEach((p) => {
      results.push({ storeProductId: p.storeProductId, totalValue: p.totalValue, batchesInvolved: p.draws.length });
    });

    return NextResponse.json({ pushed: plans.length, results }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
