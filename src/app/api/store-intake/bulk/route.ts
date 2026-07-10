import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { convertToBaseUnits, parseHierarchyString, pluralize } from "@/lib/unitHierarchy";
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
}

const CATEGORIES: ProductCategory[] = ["medicine", "non-medicine", "supermarket"];

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const rows: IntakeRow[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }
    if (rows.length > 2000) {
      return NextResponse.json({ error: "Limit is 2000 rows per bulk receipt" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    const errors: { row: number; error: string }[] = [];
    let received = 0;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 1;
      const itemName = typeof row.itemName === "string" ? row.itemName.trim() : "";
      const brand = typeof row.brand === "string" ? row.brand.trim() : "";
      const size = typeof row.size === "string" ? row.size.trim() : "";
      const label = itemName ? `"${itemName}"` : "this row";

      if (!itemName) {
        errors.push({ row: rowNumber, error: "Missing item name — every row needs one" });
        continue;
      }
      if (!brand) {
        errors.push({ row: rowNumber, error: `${label}: missing brand` });
        continue;
      }
      if (!size) {
        errors.push({ row: rowNumber, error: `${label}: missing size (use "Standard" if none)` });
        continue;
      }
      const categoryInput = isMissing(row.category) ? "supermarket" : row.category;
      if (!CATEGORIES.includes(categoryInput as ProductCategory)) {
        errors.push({
          row: rowNumber,
          error: `${label}: category must be "medicine", "non-medicine", or "supermarket", got "${row.category}"`,
        });
        continue;
      }
      const category = categoryInput as ProductCategory;
      const hierarchy = parseHierarchyString(row.unitHierarchy);
      if (!hierarchy || hierarchy.length === 0) {
        errors.push({
          row: rowNumber,
          error: `${label}: unitHierarchy is required, e.g. "carton:1>box:4>piece:10"`,
        });
        continue;
      }
      if (hierarchy.some((l) => !l.unitName)) {
        errors.push({ row: rowNumber, error: `${label}: every unit level in unitHierarchy needs a name` });
        continue;
      }
      const receivedForm = typeof row.receivedForm === "string" ? row.receivedForm.trim() : "";
      if (!hierarchy.some((l) => l.unitName === receivedForm)) {
        errors.push({
          row: rowNumber,
          error: `${label}: receivedForm "${receivedForm}" must be one of the unitHierarchy levels`,
        });
        continue;
      }
      const receivedQuantity = parseNumeric(row.receivedQuantity);
      if (!Number.isFinite(receivedQuantity) || receivedQuantity < 1) {
        errors.push({ row: rowNumber, error: `${label}: received quantity must be at least 1` });
        continue;
      }
      const purchaseAmount = parseNumeric(row.purchaseAmount);
      if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) {
        errors.push({ row: rowNumber, error: `${label}: purchase amount must be a non-negative number` });
        continue;
      }
      let expiryDate: Date | null = null;
      if (row.expiryDate) {
        const parsed = parseExpiryDateLoose(row.expiryDate);
        if (!parsed) {
          errors.push({
            row: rowNumber,
            error: `${label}: couldn't understand expiry date "${row.expiryDate}" — try YYYY-MM-DD, DD/MM/YYYY, or "Nov 2026"`,
          });
          continue;
        }
        expiryDate = parsed;
      }

      const baseUnitQuantity = convertToBaseUnits(hierarchy, receivedForm, receivedQuantity);
      const purchaseUnitCost = baseUnitQuantity > 0 ? purchaseAmount / baseUnitQuantity : 0;
      const baseUnitName = hierarchy[hierarchy.length - 1].unitName;
      const productLabel = formatProductLabel({ itemName, brand, size });

      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => {
          let storeProduct = await StoreProduct.findOne(
            { ...scope, itemName, brand, size },
            null,
            { session: dbSession }
          );

          if (!storeProduct) {
            const created = await StoreProduct.create(
              [{ ...scope, itemName, brand, size, category, baseUnitName, quantityInStock: 0 }],
              { session: dbSession }
            );
            storeProduct = created[0];
          }

          const batchDocs = await StoreBatch.create(
            [
              {
                ...scope,
                storeProductId: storeProduct._id,
                productName: productLabel,
                unitHierarchy: hierarchy,
                receivedForm,
                receivedQuantity,
                baseUnitQuantity,
                remainingBaseUnitQuantity: baseUnitQuantity,
                purchaseAmount,
                purchaseUnitCost,
                supplierName: row.supplierName || "",
                batchNumber: row.batchNumber || "",
                expiryDate,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );
          const batch = batchDocs[0];

          await StoreProduct.findOneAndUpdate(
            { _id: storeProduct._id },
            { $inc: { quantityInStock: baseUnitQuantity } },
            { session: dbSession }
          );

          await logActivity(dbSession, {
            pharmacyId: session.user.pharmacyId,
            scope: "store",
            storeId: scope.storeId,
            actorUserId: session.user.id,
            actorName: session.user.name ?? "Unknown",
            action: "intake",
            summary: `${session.user.name} received ${receivedQuantity} ${pluralize(receivedForm, receivedQuantity)} of ${productLabel} for ₦${purchaseAmount.toFixed(2)} (bulk receive)`,
            metadata: { receivedForm, receivedQuantity, baseUnitQuantity, purchaseAmount },
            refCollection: "StoreBatch",
            refId: batch._id,
          });
        });
        received++;
      } catch (err) {
        errors.push({ row: rowNumber, error: err instanceof Error ? err.message : "Failed to record this row" });
      } finally {
        await dbSession.endSession();
      }
    }

    return NextResponse.json({ received, errors }, { status: received === 0 ? 400 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
