import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { convertToBaseUnits, parseHierarchyString, pluralize, type UnitLevel } from "@/lib/unitHierarchy";
import { normalizeText } from "@/lib/productSimilarity";
import { parseExpiryDateLoose } from "@/lib/dateInput";
import { parseNumeric } from "@/lib/numberInput";
import { formatProductLabel, type ProductCategory } from "@/lib/types";
import { handleApiError } from "@/lib/apiError";

interface IntakeRow {
  itemName?: string;
  brand?: string;
  size?: string;
  category?: string;
  unitHierarchy?: string;
  receivedForm?: string;
  receivedQuantity?: string | number;
  purchaseAmount?: string | number;
  supplierName?: string;
  batchNumber?: string;
  expiryDate?: string;
  priceForm?: string;
  sisterStorePrice?: string | number;
  branchPrice?: string | number;
  distributorPrice?: string | number;
  wholesalerPrice?: string | number;
  retailerPrice?: string | number;
}

type Channel = "sister_store" | "branch" | "distributor" | "wholesaler" | "retailer";

const CHANNELS: Channel[] = ["sister_store", "branch", "distributor", "wholesaler", "retailer"];
const CHANNEL_FIELD: Record<Channel, keyof IntakeRow> = {
  sister_store: "sisterStorePrice",
  branch: "branchPrice",
  distributor: "distributorPrice",
  wholesaler: "wholesalerPrice",
  retailer: "retailerPrice",
};
const CHANNEL_LABEL: Record<Channel, string> = {
  sister_store: "sister-store",
  branch: "branch",
  distributor: "distributor",
  wholesaler: "wholesaler",
  retailer: "retailer",
};

const CATEGORIES: ProductCategory[] = ["medicine", "non-medicine", "supermarket"];

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

interface ParsedRow {
  rowNumber: number;
  itemName: string;
  brand: string;
  size: string;
  category: ProductCategory;
  hierarchy: UnitLevel[];
  receivedForm: string;
  receivedQuantity: number;
  purchaseAmount: number;
  supplierName: string;
  batchNumber: string;
  expiryDate: Date | null;
  baseUnitQuantity: number;
  purchaseUnitCost: number;
  baseUnitName: string;
  productLabel: string;
  isNewItem: boolean;
  prices: { channel: Channel; priceForm: string; priceAmount: number }[];
}

async function analyzeRows(rows: IntakeRow[], scope: { pharmacyId: string; storeId: string }) {
  const errors: { row: number; error: string }[] = [];
  const toReceive: ParsedRow[] = [];

  const existingProducts = await StoreProduct.find(scope).select("itemName brand size").lean();
  const existingKeys = new Set(
    existingProducts.map((p) => `${normalizeText(p.itemName)}|${normalizeText(p.brand)}|${normalizeText(p.size)}`)
  );
  const seenInFile = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const itemName = typeof row.itemName === "string" ? row.itemName.trim() : "";
    const brand = typeof row.brand === "string" ? row.brand.trim() : "";
    const size = typeof row.size === "string" ? row.size.trim() : "";
    const label = itemName ? `"${itemName}"` : "this row";

    if (!itemName) {
      errors.push({ row: rowNumber, error: "Missing item name — every row needs one" });
      return;
    }
    if (!brand) {
      errors.push({ row: rowNumber, error: `${label}: missing brand` });
      return;
    }
    if (!size) {
      errors.push({ row: rowNumber, error: `${label}: missing size (use "Standard" if none)` });
      return;
    }
    const categoryInput = isMissing(row.category) ? "supermarket" : row.category;
    if (!CATEGORIES.includes(categoryInput as ProductCategory)) {
      errors.push({
        row: rowNumber,
        error: `${label}: category must be "medicine", "non-medicine", or "supermarket", got "${row.category}"`,
      });
      return;
    }
    const category = categoryInput as ProductCategory;
    const hierarchy = parseHierarchyString(row.unitHierarchy);
    if (!hierarchy || hierarchy.length === 0) {
      errors.push({ row: rowNumber, error: `${label}: unitHierarchy is required, e.g. "carton:1>box:4>piece:10"` });
      return;
    }
    if (hierarchy.some((l) => !l.unitName)) {
      errors.push({ row: rowNumber, error: `${label}: every unit level in unitHierarchy needs a name` });
      return;
    }
    const receivedForm = typeof row.receivedForm === "string" ? row.receivedForm.trim() : "";
    if (!hierarchy.some((l) => l.unitName === receivedForm)) {
      errors.push({ row: rowNumber, error: `${label}: receivedForm "${receivedForm}" must be one of the unitHierarchy levels` });
      return;
    }
    const receivedQuantity = parseNumeric(row.receivedQuantity);
    if (!Number.isFinite(receivedQuantity) || receivedQuantity < 1) {
      errors.push({ row: rowNumber, error: `${label}: received quantity must be at least 1` });
      return;
    }
    const purchaseAmount = parseNumeric(row.purchaseAmount);
    if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) {
      errors.push({ row: rowNumber, error: `${label}: purchase amount must be a non-negative number` });
      return;
    }
    let expiryDate: Date | null = null;
    if (row.expiryDate) {
      const parsed = parseExpiryDateLoose(row.expiryDate);
      if (!parsed) {
        errors.push({
          row: rowNumber,
          error: `${label}: couldn't understand expiry date "${row.expiryDate}" — try YYYY-MM-DD, DD/MM/YYYY, or "Nov 2026"`,
        });
        return;
      }
      expiryDate = parsed;
    }

    // Every channel price in a row is quoted per the same unit — priceForm, defaulting to
    // receivedForm if left blank. Each channel column is independently optional: leave it blank
    // to not set that channel's price from this row, same as leaving it unset in the single-item
    // flow — it just won't be pushable/sellable on that channel until someone sets it later.
    const priceForm = typeof row.priceForm === "string" && row.priceForm.trim() ? row.priceForm.trim() : receivedForm;
    if (!hierarchy.some((l) => l.unitName === priceForm)) {
      errors.push({ row: rowNumber, error: `${label}: priceForm "${priceForm}" must be one of the unitHierarchy levels` });
      return;
    }
    const prices: ParsedRow["prices"] = [];
    for (const channel of CHANNELS) {
      const raw = row[CHANNEL_FIELD[channel]];
      if (isMissing(raw)) continue;
      const amount = parseNumeric(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push({ row: rowNumber, error: `${label}: ${CHANNEL_LABEL[channel]} price must be a non-negative number` });
        return;
      }
      prices.push({ channel, priceForm, priceAmount: amount });
    }

    const dedupeKey = `${normalizeText(itemName)}|${normalizeText(brand)}|${normalizeText(size)}`;
    const isNewItem = !existingKeys.has(dedupeKey) && !seenInFile.has(dedupeKey);
    seenInFile.add(dedupeKey);

    const baseUnitQuantity = convertToBaseUnits(hierarchy, receivedForm, receivedQuantity);
    const purchaseUnitCost = baseUnitQuantity > 0 ? purchaseAmount / baseUnitQuantity : 0;
    const baseUnitName = hierarchy[hierarchy.length - 1].unitName;

    toReceive.push({
      rowNumber,
      itemName,
      brand,
      size,
      category,
      hierarchy,
      receivedForm,
      receivedQuantity,
      purchaseAmount,
      supplierName: row.supplierName || "",
      batchNumber: row.batchNumber || "",
      expiryDate,
      baseUnitQuantity,
      purchaseUnitCost,
      baseUnitName,
      productLabel: formatProductLabel({ itemName, brand, size }),
      isNewItem,
      prices,
    });
  });

  const priceCounts: Record<Channel, number> = {
    sister_store: 0,
    branch: 0,
    distributor: 0,
    wholesaler: 0,
    retailer: 0,
  };
  toReceive.forEach((r) => r.prices.forEach((p) => priceCounts[p.channel]++));

  return { errors, toReceive, priceCounts };
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const rows: IntakeRow[] = Array.isArray(body.rows) ? body.rows : [];
    const dryRun = body.dryRun === true;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }
    if (rows.length > 2000) {
      return NextResponse.json({ error: "Limit is 2000 rows per bulk receipt" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    const { errors, toReceive, priceCounts } = await analyzeRows(rows, scope);

    if (dryRun) {
      const newItems = toReceive.filter((r) => r.isNewItem).length;
      return NextResponse.json({
        dryRun: true,
        totalRows: rows.length,
        willReceive: { count: toReceive.length, newItems, existingItemBatches: toReceive.length - newItems },
        priceCounts,
        errors,
      });
    }

    let received = 0;
    for (const parsed of toReceive) {
      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => {
          let storeProduct = await StoreProduct.findOne(
            { ...scope, itemName: parsed.itemName, brand: parsed.brand, size: parsed.size },
            null,
            { session: dbSession }
          );

          if (!storeProduct) {
            const created = await StoreProduct.create(
              [
                {
                  ...scope,
                  itemName: parsed.itemName,
                  brand: parsed.brand,
                  size: parsed.size,
                  category: parsed.category,
                  baseUnitName: parsed.baseUnitName,
                  quantityInStock: 0,
                },
              ],
              { session: dbSession }
            );
            storeProduct = created[0];
          }

          const batchDocs = await StoreBatch.create(
            [
              {
                ...scope,
                storeProductId: storeProduct._id,
                productName: parsed.productLabel,
                unitHierarchy: parsed.hierarchy,
                receivedForm: parsed.receivedForm,
                receivedQuantity: parsed.receivedQuantity,
                baseUnitQuantity: parsed.baseUnitQuantity,
                remainingBaseUnitQuantity: parsed.baseUnitQuantity,
                purchaseAmount: parsed.purchaseAmount,
                purchaseUnitCost: parsed.purchaseUnitCost,
                supplierName: parsed.supplierName,
                batchNumber: parsed.batchNumber,
                expiryDate: parsed.expiryDate,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );
          const batch = batchDocs[0];

          await StoreProduct.findOneAndUpdate(
            { _id: storeProduct._id },
            { $inc: { quantityInStock: parsed.baseUnitQuantity } },
            { session: dbSession }
          );

          for (const price of parsed.prices) {
            await DispenseSetting.create(
              [
                {
                  pharmacyId: scope.pharmacyId,
                  storeId: scope.storeId,
                  storeBatchId: batch._id,
                  storeProductId: storeProduct._id,
                  channel: price.channel,
                  priceForm: price.priceForm,
                  priceAmount: price.priceAmount,
                  setByUserId: session.user.id,
                },
              ],
              { session: dbSession }
            );
          }

          await logActivity(dbSession, {
            pharmacyId: session.user.pharmacyId,
            scope: "store",
            storeId: scope.storeId,
            actorUserId: session.user.id,
            actorName: session.user.name ?? "Unknown",
            action: "intake",
            summary: `${session.user.name} received ${parsed.receivedQuantity} ${pluralize(parsed.receivedForm, parsed.receivedQuantity)} of ${parsed.productLabel} for ₦${parsed.purchaseAmount.toFixed(2)} (bulk receive)`,
            metadata: {
              receivedForm: parsed.receivedForm,
              receivedQuantity: parsed.receivedQuantity,
              baseUnitQuantity: parsed.baseUnitQuantity,
              purchaseAmount: parsed.purchaseAmount,
              pricesSet: parsed.prices.map((p) => p.channel),
            },
            refCollection: "StoreBatch",
            refId: batch._id,
          });
        });
        received++;
      } catch (err) {
        errors.push({ row: parsed.rowNumber, error: err instanceof Error ? err.message : "Failed to record this row" });
      } finally {
        await dbSession.endSession();
      }
    }

    return NextResponse.json({ received, errors }, { status: received === 0 ? 400 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
