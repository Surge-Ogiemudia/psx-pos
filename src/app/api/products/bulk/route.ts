import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ImportBatch from "@/models/ImportBatch";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { normalizeText, findSimilarProducts } from "@/lib/productSimilarity";
import { parseNumeric } from "@/lib/numberInput";
import { parseExpiryDateLoose } from "@/lib/dateInput";
import { handleApiError } from "@/lib/apiError";

interface BulkRow {
  itemName?: string;
  brand?: string;
  size?: string;
  category?: string;
  quantityInStock?: string | number;
  retailPrice?: string | number;
  wholesalePrice?: string | number;
  distributorPrice?: string | number;
  batchNumber?: string;
  expiryDate?: string;
  unitHierarchy?: string;
}

type BulkErrorType =
  | "missing_field"
  | "invalid_category"
  | "invalid_price"
  | "invalid_quantity"
  | "invalid_date"
  | "invalid_hierarchy";

interface BulkError {
  row: number;
  type: BulkErrorType;
  error: string;
}

interface DuplicateRef {
  row: number;
  itemName: string;
  brand: string;
  size: string;
}

interface ExistingDuplicateRef extends DuplicateRef {
  existing: { _id: string; quantityInStock: number; retailPrice: number };
}

interface FileDuplicateRef extends DuplicateRef {
  firstRow: number;
}

/**
 * Parse a compact unit-hierarchy string like "carton:1>box:4>piece:10" into
 * [{unitName, unitsPerParent}]. The first level's unitsPerParent is always
 * forced to 1 (it's the root). Returns null if the string is empty/missing.
 */
function parseHierarchyString(raw: string | undefined): { unitName: string; unitsPerParent: number }[] | null {
  if (!raw || !raw.trim()) return null;
  const levels = raw.split(">").map((part) => part.trim());
  return levels.map((part, i) => {
    const [unitName, countStr] = part.split(":").map((s) => s.trim());
    return {
      unitName: unitName || "",
      unitsPerParent: i === 0 ? 1 : Math.max(1, parseNumeric(countStr) || 1),
    };
  });
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Validates and classifies every row in a bulk import into exactly one bucket: a hard
 * validation error, an exact duplicate of a product already in the system, an exact duplicate
 * of an earlier row in the same file, a fuzzy near-match that needs a human call, or a clean
 * row ready to insert. Shared by the dry-run analysis and the real commit so the preview a
 * pharmacist sees is guaranteed to match what actually happens when they proceed.
 */
async function analyzeRows(rows: BulkRow[], scope: Record<string, unknown>) {
  const errors: BulkError[] = [];
  const existingDuplicates: ExistingDuplicateRef[] = [];
  const fileDuplicates: FileDuplicateRef[] = [];
  const needsReview: { row: number; product: Record<string, unknown>; candidate: Record<string, unknown> }[] = [];
  const toInsert: Record<string, unknown>[] = [];

  const existingProducts = await Product.find(scope)
    .select("itemName brand size quantityInStock retailPrice wholesalePrice distributorPrice batchNumber expiryDate")
    .lean();
  const existingByKey = new Map(
    existingProducts.map((p) => [`${normalizeText(p.itemName)}|${normalizeText(p.brand)}|${normalizeText(p.size)}`, p])
  );
  const seenInBatch = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const itemName = typeof row.itemName === "string" ? row.itemName.trim() : "";
    const brand = typeof row.brand === "string" ? row.brand.trim() : "";
    const size = typeof row.size === "string" ? row.size.trim() : "";
    // Once we know the item name, reference it in later errors so a pharmacist scanning
    // the report knows exactly which product to fix without cross-referencing row numbers.
    const label = itemName ? `"${itemName}"` : "this row";

    if (!itemName) {
      errors.push({ row: rowNumber, type: "missing_field", error: "Missing item name — every row needs one" });
      return;
    }
    if (!brand) {
      errors.push({
        row: rowNumber,
        type: "missing_field",
        error: `${label}: missing brand — if it's not printed on the packaging, look up the manufacturer and enter it`,
      });
      return;
    }
    if (!size) {
      errors.push({
        row: rowNumber,
        type: "missing_field",
        error: `${label}: missing size — enter the strength/size, or "Standard" if the item has no size variation`,
      });
      return;
    }

    const dedupeKey = `${normalizeText(itemName)}|${normalizeText(brand)}|${normalizeText(size)}`;
    const existingMatch = existingByKey.get(dedupeKey);
    if (existingMatch) {
      existingDuplicates.push({
        row: rowNumber,
        itemName,
        brand,
        size,
        existing: {
          _id: String(existingMatch._id),
          quantityInStock: existingMatch.quantityInStock,
          retailPrice: existingMatch.retailPrice,
        },
      });
      return;
    }
    const firstRow = seenInBatch.get(dedupeKey);
    if (firstRow !== undefined) {
      fileDuplicates.push({ row: rowNumber, itemName, brand, size, firstRow });
      return;
    }
    seenInBatch.set(dedupeKey, rowNumber);

    const category = isMissing(row.category) ? "supermarket" : row.category;
    if (!["medicine", "non-medicine", "supermarket"].includes(category as string)) {
      errors.push({
        row: rowNumber,
        type: "invalid_category",
        error: `${label}: category must be "medicine", "non-medicine", or "supermarket", got "${row.category}"`,
      });
      return;
    }
    if (isMissing(row.retailPrice)) {
      errors.push({ row: rowNumber, type: "missing_field", error: `${label}: missing selling (retail) price` });
      return;
    }
    const retailPrice = parseNumeric(row.retailPrice);
    // Wholesale/distributor default to the retail price when left blank — a quick
    // stock-take only needs item, qty, and selling price.
    const wholesalePrice = isMissing(row.wholesalePrice) ? retailPrice : parseNumeric(row.wholesalePrice);
    const distributorPrice = isMissing(row.distributorPrice) ? retailPrice : parseNumeric(row.distributorPrice);
    if ([retailPrice, wholesalePrice, distributorPrice].some((n) => Number.isNaN(n) || n < 0)) {
      errors.push({ row: rowNumber, type: "invalid_price", error: `${label}: prices must be non-negative numbers` });
      return;
    }
    const quantityInStock = isMissing(row.quantityInStock) ? 0 : parseNumeric(row.quantityInStock);
    if (Number.isNaN(quantityInStock) || quantityInStock < 0) {
      errors.push({
        row: rowNumber,
        type: "invalid_quantity",
        error: `${label}: stock quantity must be a non-negative number`,
      });
      return;
    }
    let expiryDate: Date | null = null;
    if (row.expiryDate) {
      const parsed = parseExpiryDateLoose(row.expiryDate);
      if (!parsed) {
        errors.push({
          row: rowNumber,
          type: "invalid_date",
          error: `${label}: couldn't understand expiry date "${row.expiryDate}" — try YYYY-MM-DD, DD/MM/YYYY, or "Nov 2026"`,
        });
        return;
      }
      expiryDate = parsed;
    }

    const hierarchy = parseHierarchyString(row.unitHierarchy as string | undefined);
    if (hierarchy && hierarchy.some((l) => !l.unitName)) {
      errors.push({
        row: rowNumber,
        type: "invalid_hierarchy",
        error: `${label}: every unit level in unitHierarchy needs a name`,
      });
      return;
    }

    // When a hierarchy is defined, prices in the CSV are per-largest-unit
    // (e.g. per carton). Divide to per-base-unit for storage.
    let storedRetail = retailPrice;
    let storedWholesale = wholesalePrice;
    let storedDistributor = distributorPrice;
    if (hierarchy && hierarchy.length >= 2) {
      let divisor = 1;
      for (let i = 1; i < hierarchy.length; i++) {
        divisor *= hierarchy[i].unitsPerParent;
      }
      storedRetail = retailPrice / divisor;
      storedWholesale = wholesalePrice / divisor;
      storedDistributor = distributorPrice / divisor;
    }

    const productData = {
      ...scope,
      itemName,
      brand,
      size,
      category,
      quantityInStock,
      retailPrice: storedRetail,
      wholesalePrice: storedWholesale,
      distributorPrice: storedDistributor,
      batchNumber: row.batchNumber || "",
      expiryDate,
      ...(hierarchy ? { unitHierarchy: hierarchy } : {}),
    };

    const fuzzyMatches = findSimilarProducts({ itemName, brand, size }, existingProducts).filter((m) => !m.exact);
    if (fuzzyMatches.length > 0) {
      needsReview.push({ row: rowNumber, product: productData, candidate: fuzzyMatches[0].product });
      return;
    }

    toInsert.push(productData);
  });

  const byCategory: Record<string, number> = { medicine: 0, "non-medicine": 0, supermarket: 0 };
  toInsert.forEach((p) => {
    const cat = p.category as string;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  });

  return { errors, existingDuplicates, fileDuplicates, needsReview, toInsert, byCategory };
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const rows: BulkRow[] = Array.isArray(body.products) ? body.products : [];
    const dryRun = body.dryRun === true;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No products provided" }, { status: 400 });
    }
    if (rows.length > 2000) {
      return NextResponse.json({ error: "Limit is 2000 products per import" }, { status: 400 });
    }

    const scope = getBranchScope(session, body.branchId);
    const { errors, existingDuplicates, fileDuplicates, needsReview, toInsert, byCategory } = await analyzeRows(
      rows,
      scope
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalRows: rows.length,
        willAdd: { count: toInsert.length, byCategory },
        existingDuplicates,
        fileDuplicates,
        needsReview,
        errors,
      });
    }

    let importBatch = null;
    if (toInsert.length > 0) {
      const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 200) : "";
      const [batch] = await ImportBatch.create([
        {
          ...scope,
          uploadedByUserId: session.user.id,
          uploadedByName: session.user.name ?? "Unknown",
          fileName,
          itemCount: toInsert.length,
        },
      ]);
      importBatch = batch;
      const insertedProducts = await Product.insertMany(toInsert.map((p) => ({ ...p, importBatchId: batch._id })));

      const now = new Date();
      const batchDocs = insertedProducts
        .filter((p) => p.quantityInStock > 0)
        .map((p) => ({
          ...scope,
          productId: p._id,
          quantity: p.quantityInStock,
          remainingQuantity: p.quantityInStock,
          batchNumber: p.batchNumber || "",
          expiryDate: p.expiryDate,
          receivedByUserId: session.user.id,
          receivedAt: now,
        }));
      if (batchDocs.length > 0) {
        await ProductBatch.insertMany(batchDocs);
      }
    }

    return NextResponse.json(
      {
        created: toInsert.length,
        importBatchId: importBatch ? String(importBatch._id) : null,
        byCategory,
        existingDuplicates,
        fileDuplicates,
        errors,
        needsReview,
      },
      { status: toInsert.length === 0 && needsReview.length === 0 ? 400 : 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
