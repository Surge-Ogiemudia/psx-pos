import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import StoreBatch from "@/models/StoreBatch";
import DispenseSetting from "@/models/DispenseSetting";
import ActivityLog from "@/models/ActivityLog";
import { requireStoreApiSession, getStoreScope, ApiAuthError } from "@/lib/session";
import { parseNumeric } from "@/lib/numberInput";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const query: Record<string, unknown> = { ...scope };
    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [{ itemName: regex }, { brand: regex }, { size: regex }];
    }

    const storeProducts = await StoreProduct.find(query).sort({ itemName: 1, brand: 1 }).lean();

    // Stock is always tracked internally in base units (so batches with different packaging
    // never break the math) — but staff think in whatever form they received the product as,
    // not the smallest unit. Attach each product's most recently received hierarchy so the UI
    // can display "X cartons" instead of a meaningless count of the base unit.
    const batches = await StoreBatch.find({ ...scope, storeProductId: { $in: storeProducts.map((p) => p._id) } })
      .sort({ receivedAt: -1 })
      .select("storeProductId unitHierarchy")
      .lean();
    const hierarchyByProductId = new Map<string, (typeof batches)[number]["unitHierarchy"]>();
    for (const batch of batches) {
      const key = batch.storeProductId.toString();
      if (!hierarchyByProductId.has(key)) hierarchyByProductId.set(key, batch.unitHierarchy);
    }

    const withHierarchy = storeProducts.map((p) => ({
      ...p,
      displayUnitHierarchy: hierarchyByProductId.get(p._id.toString()) ?? null,
    }));

    return NextResponse.json({ storeProducts: withHierarchy });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      throw new ApiAuthError(403, "Only an admin or store manager can delete all items in a store");
    }
    await dbConnect();

    const scope = getStoreScope(session, request.nextUrl.searchParams.get("storeId"));
    // Require the caller to state how many rows they expect to wipe — catches a stale page
    // (someone else added items since it loaded) before it silently deletes more than shown.
    const expectedCount = parseNumeric(request.nextUrl.searchParams.get("expectedCount"));
    const actualCount = await StoreProduct.countDocuments(scope);
    if (Number.isNaN(expectedCount) || expectedCount !== actualCount) {
      return NextResponse.json(
        {
          error: `This store's item list has changed since you last checked — it now has ${actualCount} item${actualCount === 1 ? "" : "s"}. Refresh and try again.`,
          actualCount,
        },
        { status: 409 }
      );
    }

    const productIds = (await StoreProduct.find(scope).select("_id").lean()).map((p) => p._id);
    const batchIds = (
      await StoreBatch.find({ ...scope, storeProductId: { $in: productIds } })
        .select("_id")
        .lean()
    ).map((b) => b._id);

    await DispenseSetting.deleteMany({ storeBatchId: { $in: batchIds }, ...scope });
    await StoreBatch.deleteMany({ ...scope, storeProductId: { $in: productIds } });
    const result = await StoreProduct.deleteMany(scope);
    const deletedCount = result.deletedCount ?? 0;

    await ActivityLog.create({
      pharmacyId: scope.pharmacyId,
      scope: "store",
      storeId: scope.storeId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? "Unknown",
      action: "delete",
      summary: `${session.user.name} deleted all ${deletedCount} item${deletedCount === 1 ? "" : "s"} in this store`,
      metadata: { deletedCount },
      timestamp: new Date(),
    });

    return NextResponse.json({ deletedCount });
  } catch (error) {
    return handleApiError(error);
  }
}
