import type mongoose from "mongoose";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import {
  compareBatchesFifo,
  computeBaseUnitsPerLevel,
  convertToBaseUnits,
  planDraw,
  pluralize,
  type UnitLevel,
} from "@/lib/unitHierarchy";

export type Channel = "sister_store" | "branch" | "distributor" | "wholesaler" | "retailer";

const CHANNEL_LABEL: Record<Channel, string> = {
  sister_store: "sister-store",
  branch: "branch",
  distributor: "distributor",
  wholesaler: "wholesaler",
  retailer: "retailer",
};

export interface DrawPlanItem {
  batch: {
    _id: mongoose.Types.ObjectId;
    unitHierarchy: UnitLevel[];
    receivedAt: Date;
    expiryDate?: Date | null;
    batchNumber?: string;
    productName: string;
  };
  baseUnitsDrawn: number;
  unitPriceAtBaseUnit: number;
  lineTotal: number;
}

export interface DrawPlan {
  referenceHierarchy: UnitLevel[];
  items: DrawPlanItem[];
  totalBaseUnitQuantity: number;
  totalValue: number;
}

/**
 * Reads-only: finds every batch with remaining stock for this product, sorts them
 * FIFO, and greedily allocates the requested form+quantity across as many as
 * needed — spanning batches instead of erroring out when one batch alone isn't
 * enough. Each batch keeps its own price for the channel, so the total is a real
 * sum across possibly-different per-batch prices, not one price applied broadly.
 * Throws a descriptive Error (never returns partial/invalid plans) if there isn't
 * enough stock overall, or if any batch the plan needs to draw from has no price
 * set for the requested channel yet.
 */
export async function buildDrawPlan(params: {
  pharmacyId: string;
  storeId: string;
  storeProductId: string;
  form: string;
  quantity: number;
  channel: Channel;
  dbSession?: mongoose.ClientSession;
}): Promise<DrawPlan> {
  const options = params.dbSession ? { session: params.dbSession } : undefined;

  const rawBatches = await StoreBatch.find(
    {
      pharmacyId: params.pharmacyId,
      storeId: params.storeId,
      storeProductId: params.storeProductId,
      remainingBaseUnitQuantity: { $gt: 0 },
    },
    null,
    options
  ).lean();

  if (rawBatches.length === 0) {
    throw new Error("No stock available for this product");
  }

  const sorted = rawBatches.sort(compareBatchesFifo);
  const referenceHierarchy = sorted[0].unitHierarchy;
  const neededBaseUnits = convertToBaseUnits(referenceHierarchy, params.form, params.quantity);

  const allocation = planDraw(
    sorted.map((b) => ({ id: b._id.toString(), remainingBaseUnitQuantity: b.remainingBaseUnitQuantity })),
    neededBaseUnits
  );

  if (!allocation) {
    const totalAvailable = sorted.reduce((sum, b) => sum + b.remainingBaseUnitQuantity, 0);
    const baseUnitName = referenceHierarchy[referenceHierarchy.length - 1].unitName;
    throw new Error(`Only ${totalAvailable} ${pluralize(baseUnitName, totalAvailable)} available across all batches`);
  }

  const items: DrawPlanItem[] = [];
  let totalValue = 0;

  for (const draw of allocation) {
    const batch = sorted.find((b) => b._id.toString() === draw.id)!;
    const setting = await DispenseSetting.findOne(
      { pharmacyId: params.pharmacyId, storeBatchId: batch._id, channel: params.channel },
      null,
      options
    );
    if (!setting) {
      const receivedDate = new Date(batch.receivedAt).toLocaleDateString();
      throw new Error(
        `No ${CHANNEL_LABEL[params.channel]} price set for the batch of ${batch.productName} received ${receivedDate} — set a price for it first`
      );
    }
    const perLevel = computeBaseUnitsPerLevel(batch.unitHierarchy);
    const settingPiecesPerForm = perLevel[setting.priceForm];
    if (settingPiecesPerForm === undefined) {
      throw new Error("Dispense setting uses an unknown unit");
    }
    const unitPriceAtBaseUnit = setting.priceAmount / settingPiecesPerForm;
    const lineTotal = unitPriceAtBaseUnit * draw.baseUnitsDrawn;
    totalValue += lineTotal;
    items.push({ batch, baseUnitsDrawn: draw.baseUnitsDrawn, unitPriceAtBaseUnit, lineTotal });
  }

  return { referenceHierarchy, items, totalBaseUnitQuantity: neededBaseUnits, totalValue };
}
