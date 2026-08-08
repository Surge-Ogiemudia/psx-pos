import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ImportBatch from "@/models/ImportBatch";
import DeletionLog from "@/models/DeletionLog";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, requireApiSession, getBranchScope } from "@/lib/session";
import { normalizeText, productSearchScore } from "@/lib/productSimilarity";
import { parseNumeric } from "@/lib/numberInput";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
import { syncProductsToPsx, deleteProductsFromPsx, getPharmacySlug } from "@/lib/psxSync";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const lastSyncedAt = request.nextUrl.searchParams.get("lastSyncedAt");
    
    const query: Record<string, unknown> = getBranchScope(
      session,
      request.nextUrl.searchParams.get("branchId")
    );

    let fullSyncRequired = false;
    const serverTime = new Date().getTime();

    if (lastSyncedAt && !search) {
      const syncDate = new Date(Number(lastSyncedAt));
      // If a deletion occurred since we last synced, we can't just delta sync 
      // because we wouldn't know exactly which IDs were removed easily.
      // Force a full clean sync instead.
      const recentDeletion = await DeletionLog.findOne({
        ...query,
        createdAt: { $gt: syncDate }
      }).lean();

      if (recentDeletion) {
        fullSyncRequired = true;
      } else {
        query.updatedAt = { $gt: syncDate };
      }
    }

    const products = await Product.find(query).sort({ itemName: 1, brand: 1 }).lean();

    if (!search) {
      return NextResponse.json({ products, fullSyncRequired, timestamp: serverTime });
    }

    // Exact barcode match takes absolute precedence
    const exactBarcodeMatch = products.find((p) => p.barcode && p.barcode === search);
    if (exactBarcodeMatch) {
      return NextResponse.json({ products: [exactBarcodeMatch] });
    }

    // Search-as-you-type: rank by prefix/substring match first, then typo-tolerant fuzzy match
    // (e.g. "Swiss" also finds "Swoss"/"Suoss"), so a single letter still shows sensible results.
    const ranked = products
      .map((p) => ({ product: p, score: productSearchScore(search, p) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return NextResponse.json({ products: ranked.map((r) => r.product) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      branchId,
      itemName,
      brand,
      size,
      category,
      quantityInStock,
      alertQuantity,
      retailPrice,
      wholesalePrice,
      distributorPrice,
      costPrice,
      batchNumber,
      expiryDate,
      unitHierarchy,
      barcode,
    } = body;

    const NUMERIC_FIELDS = new Set(["retailPrice", "wholesalePrice", "distributorPrice", "costPrice", "alertQuantity", "quantityInStock"]);
    const missing = (v: unknown) => v === undefined || v === null || v === "";
    const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    // Only the selling (retail) price is optional to relax — item name, brand, and size are
    // always required so the same item can never be entered inconsistently across rows.
    if (!trimmed(itemName)) {
      return NextResponse.json({ error: "Item name is required" }, { status: 400 });
    }
    if (!trimmed(brand)) {
      return NextResponse.json(
        { error: "Brand is required — if it's not printed on the packaging, look up the manufacturer" },
        { status: 400 }
      );
    }
    if (!trimmed(size)) {
      return NextResponse.json(
        { error: 'Size is required — use "Standard" if the item has no size/strength variation' },
        { status: 400 }
      );
    }
    if (!category) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }
    if (missing(retailPrice)) {
      return NextResponse.json({ error: "Selling (retail) price is required" }, { status: 400 });
    }
    if (!["medicine", "non-medicine", "supermarket"].includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const retail = parseNumeric(retailPrice);
    if (Number.isNaN(retail) || retail < 0) {
      return NextResponse.json({ error: "Selling (retail) price must be a non-negative number" }, { status: 400 });
    }
    const scope = getBranchScope(session, branchId);

    // Hard invariant: two products can never share the same itemName+brand+size (case/whitespace
    // insensitive) in the same scope — that combination *is* the product, by schema design.
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactMatch = await Product.findOne({
      ...scope,
      itemName: { $regex: `^${escapeRegex(normalizeText(trimmed(itemName)))}$`, $options: "i" },
      brand: { $regex: `^${escapeRegex(normalizeText(trimmed(brand)))}$`, $options: "i" },
      size: { $regex: `^${escapeRegex(normalizeText(trimmed(size)))}$`, $options: "i" },
    }).lean();
    if (exactMatch) {
      return NextResponse.json(
        {
          error: "A product with this exact item name, brand, and size already exists",
          existingProductId: String(exactMatch._id),
        },
        { status: 409 }
      );
    }

    // Validate unitHierarchy if provided: must be an array of {unitName, unitsPerParent}.
    let hierarchy: { unitName: string; unitsPerParent: number }[] | undefined;
    if (Array.isArray(unitHierarchy) && unitHierarchy.length > 0) {
      hierarchy = unitHierarchy.map((l: { unitName?: string; unitsPerParent?: number }, i: number) => ({
        unitName: (l.unitName || "").trim(),
        unitsPerParent: i === 0 ? 1 : Math.max(1, parseNumeric(l.unitsPerParent) || 1),
      }));
      if (hierarchy.some((l) => !l.unitName)) {
        return NextResponse.json({ error: "Every unit level needs a name" }, { status: 400 });
      }
    }

    const initialQuantity = missing(quantityInStock) ? 0 : parseNumeric(quantityInStock);
    const initialBatchNumber = batchNumber || "";
    const initialExpiryDate = expiryDate ? new Date(expiryDate) : null;
    // Defaults to ~20% of initial stock (floor of 1 once there's any stock at all) so a
    // reorder-point alert works without every product needing manual configuration — still
    // overridable per-product via the request body.
    const initialAlertQuantity = missing(alertQuantity)
      ? initialQuantity > 0
        ? Math.max(1, Math.round(initialQuantity * 0.2))
        : 0
      : Math.max(0, parseNumeric(alertQuantity) || 0);

    const dbSession = await mongoose.startSession();
    let product: any;
    try {
      await dbSession.withTransaction(async () => {
        const created = await Product.create(
          [
            {
              ...scope,
              itemName: trimmed(itemName),
              brand: trimmed(brand),
              size: trimmed(size),
              category,
              quantityInStock: initialQuantity,
              alertQuantity: initialAlertQuantity,
              retailPrice: retail,
              wholesalePrice: missing(wholesalePrice) ? retail : parseNumeric(wholesalePrice),
              distributorPrice: missing(distributorPrice) ? retail : parseNumeric(distributorPrice),
              batchNumber: initialBatchNumber,
              expiryDate: initialExpiryDate,
              barcode: trimmed(barcode),
              ...(hierarchy ? { unitHierarchy: hierarchy } : {}),
            },
          ],
          { session: dbSession }
        );
        product = created[0];

        if (initialQuantity > 0) {
          await ProductBatch.create(
            [
              {
                ...scope,
                productId: product._id,
                quantity: initialQuantity,
                remainingQuantity: initialQuantity,
                batchNumber: initialBatchNumber,
                expiryDate: initialExpiryDate,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );
        }

        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "product_create",
          summary: `Added ${formatProductLabel(product!)} to the catalog`,
          refCollection: "Product",
          refId: product!._id,
        });
      });
    } finally {
      await dbSession.endSession();
    }

    // Fire-and-forget PSX sync
    if (product && product.category === "medicine") {
      const slug = await getPharmacySlug(session.user.pharmacyId);
      if (slug) {
        syncProductsToPsx(slug, [product]).catch(() => {});
      }
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    // Require the caller to state how many rows they expect to wipe — catches a stale page
    // (someone else added items since it loaded) before it silently deletes more than shown.
    const expectedCount = parseNumeric(request.nextUrl.searchParams.get("expectedCount"));
    const actualCount = await Product.countDocuments(scope);
    if (Number.isNaN(expectedCount) || expectedCount !== actualCount) {
      return NextResponse.json(
        {
          error: `The catalog has changed since you last checked — it now has ${actualCount} item${actualCount === 1 ? "" : "s"}. Refresh and try again.`,
          actualCount,
        },
        { status: 409 }
      );
    }

    const productsToDelete = await Product.find(scope).lean();

    const dbSession = await mongoose.startSession();
    let deletedCount = 0;
    try {
      await dbSession.withTransaction(async () => {
        const result = await Product.deleteMany(scope, { session: dbSession });
        deletedCount = result.deletedCount ?? 0;
        await ImportBatch.deleteMany(scope, { session: dbSession });
        await ProductBatch.deleteMany(scope, { session: dbSession });

        if (productsToDelete.length > 0) {
          await DeletionLog.create(
            [
              {
                ...scope,
                type: "delete_all",
                deletedByUserId: session.user.id,
                deletedByName: session.user.name ?? "Unknown",
                itemCount: productsToDelete.length,
                summary: `Deleted the entire catalog (${productsToDelete.length} item${productsToDelete.length === 1 ? "" : "s"})`,
                csvContent: productsToCsv(productsToDelete),
                csvFileName: `deleted-catalog-${new Date().toISOString().slice(0, 10)}.csv`,
              },
            ],
            { session: dbSession }
          );
        }
      });
    } finally {
      await dbSession.endSession();
    }

    // Fire-and-forget PSX sync for deleted medicines
    if (productsToDelete && productsToDelete.length > 0) {
      const slug = await getPharmacySlug(session.user.pharmacyId);
      if (slug) {
        deleteProductsFromPsx(slug, productsToDelete).catch(() => {});
      }
    }

    return NextResponse.json({ deletedCount });
  } catch (error) {
    return handleApiError(error);
  }
}
