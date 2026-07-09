import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
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
      unitsPerParent: i === 0 ? 1 : Math.max(1, Number(countStr) || 1),
    };
  });
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const rows: BulkRow[] = Array.isArray(body.products) ? body.products : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: "No products provided" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: "Limit is 500 products per import" }, { status: 400 });
    }

    const scope = getBranchScope(session, body.branchId);
    const errors: { row: number; error: string }[] = [];
    const toInsert: Record<string, unknown>[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const itemName = typeof row.itemName === "string" ? row.itemName.trim() : "";
      const brand = typeof row.brand === "string" ? row.brand.trim() : "";
      const size = typeof row.size === "string" ? row.size.trim() : "";
      // Once we know the item name, reference it in later errors so a pharmacist scanning
      // the report knows exactly which product to fix without cross-referencing row numbers.
      const label = itemName ? `"${itemName}"` : "this row";

      if (!itemName) {
        errors.push({ row: rowNumber, error: "Missing item name — every row needs one" });
        return;
      }
      if (!brand) {
        errors.push({
          row: rowNumber,
          error: `${label}: missing brand — if it's not printed on the packaging, look up the manufacturer and enter it`,
        });
        return;
      }
      if (!size) {
        errors.push({
          row: rowNumber,
          error: `${label}: missing size — enter the strength/size, or "Standard" if the item has no size variation`,
        });
        return;
      }
      const category = isMissing(row.category) ? "supermarket" : row.category;
      if (!["medicine", "non-medicine", "supermarket"].includes(category as string)) {
        errors.push({
          row: rowNumber,
          error: `${label}: category must be "medicine", "non-medicine", or "supermarket", got "${row.category}"`,
        });
        return;
      }
      if (isMissing(row.retailPrice)) {
        errors.push({ row: rowNumber, error: `${label}: missing selling (retail) price` });
        return;
      }
      const retailPrice = Number(row.retailPrice);
      // Wholesale/distributor default to the retail price when left blank — a quick
      // stock-take only needs item, qty, and selling price.
      const wholesalePrice = isMissing(row.wholesalePrice) ? retailPrice : Number(row.wholesalePrice);
      const distributorPrice = isMissing(row.distributorPrice) ? retailPrice : Number(row.distributorPrice);
      if ([retailPrice, wholesalePrice, distributorPrice].some((n) => Number.isNaN(n) || n < 0)) {
        errors.push({ row: rowNumber, error: `${label}: prices must be non-negative numbers` });
        return;
      }
      const quantityInStock = isMissing(row.quantityInStock) ? 0 : Number(row.quantityInStock);
      if (Number.isNaN(quantityInStock) || quantityInStock < 0) {
        errors.push({ row: rowNumber, error: `${label}: stock quantity must be a non-negative number` });
        return;
      }
      let expiryDate: Date | null = null;
      if (row.expiryDate) {
        const parsed = new Date(row.expiryDate);
        if (Number.isNaN(parsed.getTime())) {
          errors.push({ row: rowNumber, error: `${label}: invalid expiry date "${row.expiryDate}" — use YYYY-MM-DD` });
          return;
        }
        expiryDate = parsed;
      }

      const hierarchy = parseHierarchyString(row.unitHierarchy as string | undefined);
      if (hierarchy && hierarchy.some((l) => !l.unitName)) {
        errors.push({ row: rowNumber, error: `${label}: every unit level in unitHierarchy needs a name` });
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

      toInsert.push({
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
      });
    });

    if (toInsert.length > 0) {
      await Product.insertMany(toInsert);
    }

    return NextResponse.json(
      { created: toInsert.length, errors },
      { status: toInsert.length === 0 ? 400 : 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
