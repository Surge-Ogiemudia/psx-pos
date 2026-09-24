import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ImportBatch from "@/models/ImportBatch";
import DeletionLog from "@/models/DeletionLog";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, requireApiSession, requireItemManagerApiSession, getBranchScope } from "@/lib/session";
import { normalizeText } from "@/lib/productSimilarity";
import { parseNumeric } from "@/lib/numberInput";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
import { syncProductsToPsx, deleteProductsFromPsx, getPharmacySlug } from "@/lib/psxSync";
import { fuzzyRank } from "@/lib/fuzzyMatch";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Store keepers may add/edit items but never see cost prices — strip them server-side.
function hideCostFromKeeper<T extends { costPrice?: number }>(role: string, list: T[]): T[] {
  return role === "store_keeper" ? list.map((p) => ({ ...p, costPrice: 0 })) : list;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const lastSyncedAt = request.nextUrl.searchParams.get("lastSyncedAt");
    const limit = request.nextUrl.searchParams.get("limit");
    
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

    if (search) {
      // Was a literal whole-string substring match with no ranking — cheap to break in two
      // ways: (1) "Panadol Extra" vs "PanadolExtra"/"panadol-extra" never matched at all
      // (spaces/punctuation/case all had to line up exactly), and (2) results were sliced
      // to 50 in whatever order Mongo happened to return them, not ranked by relevance —
      // so a broad query with >50 matches could bury the exact item you typed, and typing
      // MORE of its name (which should only ever narrow an already-good result set) was
      // sometimes the only way to get it under the 50-item cap. Fixed by widening DB
      // candidates on a per-word basis (same pattern as monak-excel1/2), then ranking by
      // Dice-coefficient similarity over a symbols/spaces/case-stripped comparison — same
      // proven approach already used for triage's price matching and duplicate detection.
      const exactBarcodeQuery = { ...query, barcode: search };
      const barcodeMatches = await Product.find(exactBarcodeQuery).limit(5).lean();

      const words = search
        .split(/[^a-zA-Z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 1);

      const candidateQuery =
        words.length > 0
          ? { ...query, $or: words.map((w) => ({ itemName: { $regex: escapeRegex(w), $options: "i" } })) }
          : { ...query, itemName: { $regex: escapeRegex(search), $options: "i" } };

      const candidates = await Product.find(candidateQuery).limit(300).lean();

      const ranked = fuzzyRank(search, candidates, (p) => `${p.itemName} ${p.brand}`, {
        limit: 50,
        minScore: 0.2,
      });

      const seenIds = new Set(barcodeMatches.map((p) => String(p._id)));
      const products = [...barcodeMatches, ...ranked.filter((p) => !seenIds.has(String(p._id)))].slice(0, 50);

      return NextResponse.json({ products: hideCostFromKeeper(session.user.role, products) });
    }

    // skip is opt-in and only used by the POS offline sync's chunked fetch (see
    // usePosOfflineSync.ts) — every other caller (admin Catalog listing, the "Delete All"
    // confirmation count) keeps its existing unbounded-unless-limit-passed behavior
    // untouched, since that count in particular needs to stay a true total.
    const skip = request.nextUrl.searchParams.get("skip");
    let productsQuery = Product.find(query).sort({ itemName: 1, brand: 1 });
    if (skip) {
      productsQuery = productsQuery.skip(parseInt(skip, 10));
    }
    if (limit) {
      productsQuery = productsQuery.limit(parseInt(limit, 10));
    }
    const products = await productsQuery.lean();

    return NextResponse.json({ products: hideCostFromKeeper(session.user.role, products), fullSyncRequired, timestamp: serverTime });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireItemManagerApiSession();
    await dbConnect();

    const body = await request.json();
    if (session.user.role === "store_keeper") delete body.costPrice;
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
      imageUrl,
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
              imageUrl: imageUrl || null,
              quantityInStock: initialQuantity,
              alertQuantity: initialAlertQuantity,
              retailPrice: retail,
              wholesalePrice: missing(wholesalePrice) ? 0 : parseNumeric(wholesalePrice),
              distributorPrice: missing(distributorPrice) ? 0 : parseNumeric(distributorPrice),
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
