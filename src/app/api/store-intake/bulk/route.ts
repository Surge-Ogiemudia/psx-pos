import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import ActivityLog from "@/models/ActivityLog";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { convertToBaseUnits, parseHierarchyString, type UnitLevel } from "@/lib/unitHierarchy";
import { normalizeText } from "@/lib/productSimilarity";
import { parseExpiryDateLoose } from "@/lib/dateInput";
import { parseNumeric } from "@/lib/numberInput";
import { formatProductLabel, type ProductCategory } from "@/lib/types";
import { handleApiError } from "@/lib/apiError";

// Bulk files can run into the thousands of rows — give this route more room than the
// platform default before treating it as hung.
export const maxDuration = 60;

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

function itemKey(itemName: string, brand: string, size: string): string {
  return `${normalizeText(itemName)}|${normalizeText(brand)}|${normalizeText(size)}`;
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

function analyzeRows(
  rows: IntakeRow[],
  existingKeyToId: Map<string, string>
): { errors: { row: number; error: string }[]; toReceive: ParsedRow[]; priceCounts: Record<Channel, number> } {
  const errors: { row: number; error: string }[] = [];
  const toReceive: ParsedRow[] = [];
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

    const dedupeKey = itemKey(itemName, brand, size);
    const isNewItem = !existingKeyToId.has(dedupeKey) && !seenInFile.has(dedupeKey);
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
    const existingProducts = await StoreProduct.find(scope).select("itemName brand size").lean();
    const existingKeyToId = new Map(
      existingProducts.map((p) => [itemKey(p.itemName, p.brand, p.size), p._id.toString()])
    );

    const { errors, toReceive, priceCounts } = analyzeRows(rows, existingKeyToId);

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

    if (toReceive.length === 0) {
      return NextResponse.json({ received: 0, errors }, { status: 400 });
    }

    // Bulk-write in a handful of round trips instead of one full transaction per row — with
    // thousands of rows, a per-row transaction loop is slow enough to blow past the platform's
    // request timeout and leave the client stuck with no response. This trades strict
    // all-or-nothing atomicity for speed, same trade-off the catalog's bulk importer already
    // makes (a single insertMany, no transaction wrapper).
    const keyToId = new Map(existingKeyToId);
    const newItemKeys: string[] = [];
    const newItemDocs: Record<string, unknown>[] = [];
    for (const r of toReceive) {
      const key = itemKey(r.itemName, r.brand, r.size);
      if (!keyToId.has(key) && !newItemKeys.includes(key)) {
        newItemKeys.push(key);
        newItemDocs.push({
          ...scope,
          itemName: r.itemName,
          brand: r.brand,
          size: r.size,
          category: r.category,
          baseUnitName: r.baseUnitName,
          quantityInStock: 0,
        });
      }
    }
    if (newItemDocs.length > 0) {
      const created = await StoreProduct.insertMany(newItemDocs);
      created.forEach((doc, i) => keyToId.set(newItemKeys[i], String(doc._id)));
    }

    const now = new Date();
    const batchDocs = toReceive.map((r) => ({
      ...scope,
      storeProductId: keyToId.get(itemKey(r.itemName, r.brand, r.size)),
      productName: r.productLabel,
      unitHierarchy: r.hierarchy,
      receivedForm: r.receivedForm,
      receivedQuantity: r.receivedQuantity,
      baseUnitQuantity: r.baseUnitQuantity,
      remainingBaseUnitQuantity: r.baseUnitQuantity,
      purchaseAmount: r.purchaseAmount,
      purchaseUnitCost: r.purchaseUnitCost,
      supplierName: r.supplierName,
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate,
      receivedByUserId: session.user.id,
      receivedAt: now,
    }));
    const insertedBatches = await StoreBatch.insertMany(batchDocs);

    const priceDocs: Record<string, unknown>[] = [];
    toReceive.forEach((r, i) => {
      const batch = insertedBatches[i];
      for (const price of r.prices) {
        priceDocs.push({
          pharmacyId: scope.pharmacyId,
          storeId: scope.storeId,
          storeBatchId: batch._id,
          storeProductId: batch.storeProductId,
          channel: price.channel,
          priceForm: price.priceForm,
          priceAmount: price.priceAmount,
          setByUserId: session.user.id,
        });
      }
    });
    if (priceDocs.length > 0) {
      await DispenseSetting.insertMany(priceDocs);
    }

    const incByProductId = new Map<string, number>();
    toReceive.forEach((r) => {
      const id = keyToId.get(itemKey(r.itemName, r.brand, r.size))!;
      incByProductId.set(id, (incByProductId.get(id) ?? 0) + r.baseUnitQuantity);
    });
    await StoreProduct.bulkWrite(
      [...incByProductId.entries()].map(([id, inc]) => ({
        updateOne: { filter: { _id: id }, update: { $inc: { quantityInStock: inc } } },
      }))
    );

    await ActivityLog.create({
      pharmacyId: scope.pharmacyId,
      scope: "store",
      storeId: scope.storeId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? "Unknown",
      action: "intake",
      summary: `${session.user.name} bulk-received ${toReceive.length} row${toReceive.length === 1 ? "" : "s"} (${newItemDocs.length} new item${newItemDocs.length === 1 ? "" : "s"})`,
      metadata: { rows: toReceive.length, newItems: newItemDocs.length, priceCounts },
      timestamp: now,
    });

    return NextResponse.json({ received: toReceive.length, errors }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
