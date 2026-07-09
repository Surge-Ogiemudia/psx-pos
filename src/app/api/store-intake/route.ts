import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { convertToBaseUnits, pluralize, type UnitLevel } from "@/lib/unitHierarchy";
import { handleApiError } from "@/lib/apiError";
import { formatProductLabel, type ProductCategory } from "@/lib/types";

interface IntakeBody {
  storeId?: string;
  itemName?: string;
  brand?: string;
  size?: string;
  category?: ProductCategory;
  unitHierarchy?: UnitLevel[];
  receivedForm?: string;
  receivedQuantity?: number;
  purchaseAmount?: number;
  supplierName?: string;
  batchNumber?: string;
  expiryDate?: string;
}

const CATEGORIES: ProductCategory[] = ["medicine", "non-medicine", "supermarket"];

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body: IntakeBody = await request.json();
    const itemName = typeof body.itemName === "string" ? body.itemName.trim() : "";
    const brand = typeof body.brand === "string" ? body.brand.trim() : "";
    const size = typeof body.size === "string" ? body.size.trim() : "";
    const category = CATEGORIES.includes(body.category as ProductCategory) ? body.category! : "supermarket";
    const hierarchy = Array.isArray(body.unitHierarchy) ? body.unitHierarchy : [];
    const receivedForm = typeof body.receivedForm === "string" ? body.receivedForm.trim() : "";
    const receivedQuantity = Number(body.receivedQuantity);
    const purchaseAmount = Number(body.purchaseAmount);

    if (!itemName) return NextResponse.json({ error: "Item name is required" }, { status: 400 });
    if (!brand) {
      return NextResponse.json(
        { error: "Brand is required — if it's not printed on the packaging, look up the manufacturer" },
        { status: 400 }
      );
    }
    if (!size) {
      return NextResponse.json(
        { error: 'Size is required — use "Standard" if the item has no size/strength variation' },
        { status: 400 }
      );
    }
    if (hierarchy.length === 0) {
      return NextResponse.json({ error: "At least one unit level is required" }, { status: 400 });
    }
    for (const level of hierarchy) {
      if (!level.unitName || !Number.isFinite(level.unitsPerParent) || level.unitsPerParent < 1) {
        return NextResponse.json(
          { error: "Each unit level needs a name and a positive units-per-parent count" },
          { status: 400 }
        );
      }
    }
    if (!hierarchy.some((l) => l.unitName === receivedForm)) {
      return NextResponse.json(
        { error: `"${receivedForm}" must be one of the defined unit levels` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(receivedQuantity) || receivedQuantity < 1) {
      return NextResponse.json({ error: "Received quantity must be at least 1" }, { status: 400 });
    }
    if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) {
      return NextResponse.json({ error: "Purchase amount must be a non-negative number" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    const baseUnitQuantity = convertToBaseUnits(hierarchy, receivedForm, receivedQuantity);
    const purchaseUnitCost = baseUnitQuantity > 0 ? purchaseAmount / baseUnitQuantity : 0;
    const baseUnitName = hierarchy[hierarchy.length - 1].unitName;
    const productLabel = formatProductLabel({ itemName, brand, size });

    const dbSession = await mongoose.startSession();
    try {
      let result: { storeProduct: unknown; batch: unknown } | null = null;

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
              supplierName: body.supplierName || "",
              batchNumber: body.batchNumber || "",
              expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
              receivedByUserId: session.user.id,
              receivedAt: new Date(),
            },
          ],
          { session: dbSession }
        );
        const batch = batchDocs[0];

        storeProduct = await StoreProduct.findOneAndUpdate(
          { _id: storeProduct._id },
          { $inc: { quantityInStock: baseUnitQuantity } },
          { new: true, session: dbSession }
        );

        await logActivity(dbSession, {
          pharmacyId: session.user.pharmacyId,
          scope: "store",
          storeId: scope.storeId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "intake",
          summary: `${session.user.name} received ${receivedQuantity} ${pluralize(receivedForm, receivedQuantity)} of ${productLabel} for ₦${purchaseAmount.toFixed(2)}`,
          metadata: { receivedForm, receivedQuantity, baseUnitQuantity, purchaseAmount },
          refCollection: "StoreBatch",
          refId: batch._id,
        });

        result = { storeProduct, batch };
      });

      return NextResponse.json(result, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
