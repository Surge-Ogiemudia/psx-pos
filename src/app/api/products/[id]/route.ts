import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import DeletionLog from "@/models/DeletionLog";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, requireApiSession, getBranchScope, ApiAuthError } from "@/lib/session";
import { verifyEditApproval } from "@/lib/adminApproval";
import ActivityLog from "@/models/ActivityLog";
import { parseNumeric } from "@/lib/numberInput";
import { formatProductLabel } from "@/lib/types";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";
import { syncProductsToPsx, deleteProductsFromPsx, getPharmacySlug } from "@/lib/psxSync";
import { parseExpiryDate } from "@/lib/parseExpiryDate";

const NUMERIC_FIELDS = new Set(["retailPrice", "wholesalePrice", "distributorPrice", "costPrice", "alertQuantity", "quantityInStock"]);

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await ctx.params;
    const product = await Product.findById(id);
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // Admins edit directly. A staff member can edit only with a fresh admin-approval token
    // (issued by /api/auth/verify-admin after an admin typed their password for this product).
    const session = await requireApiSession();
    const { id } = await ctx.params;
    let approvedBy: { adminId: string; adminName: string } | null = null;
    const isKeeper = session.user.role === "store_keeper" && !!session.user.branchId;
    if (session.user.role !== "admin" && !isKeeper) {
      const claims = verifyEditApproval(request.headers.get("x-admin-approval"), {
        pharmacyId: String(session.user.pharmacyId),
        productId: String(id),
      });
      if (!claims || !["staff"].includes(session.user.role)) {
        throw new ApiAuthError(403, "Admin approval required");
      }
      approvedBy = { adminId: claims.adminId, adminName: claims.adminName };
    }
    await dbConnect();

    const body = await request.json();
    const allowedFields = [
      "itemName",
      "brand",
      "size",
      "category",
      "unitHierarchy",
      "quantityInStock",
      "alertQuantity",
      "retailPrice",
      "wholesalePrice",
      "distributorPrice",
      "costPrice",
      "batchNumber",
      "expiryDate",
      "barcode",
      "imageUrl",
    ] as const;

    const update: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] === undefined) continue;
      if (field === "expiryDate") {
        update[field] = parseExpiryDate(body[field]);
      } else if (NUMERIC_FIELDS.has(field)) {
        const parsed = parseNumeric(body[field]);
        if (Number.isNaN(parsed) || parsed < 0) {
          return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
        }
        update[field] = parsed;
      } else {
        update[field] = body[field];
      }
    }

    // Store keepers can edit items but never change (or see) cost prices.
    if (isKeeper) delete update.costPrice;

    const scope = getBranchScope(session, body.branchId);

    // Fetch the existing doc first so we can compute needsReviewReason off the FINAL
    // post-update values (existing value for any field not present in this PATCH),
    // and fold it into the same $set — one atomic write, not a second round trip.
    const existing = await Product.findOne({ _id: id, ...scope }).lean();
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const finalBrand = "brand" in update ? (update.brand as string) : existing.brand;
    const finalSize = "size" in update ? (update.size as string) : existing.size;
    const finalExpiryDate = "expiryDate" in update ? (update.expiryDate as Date | null) : existing.expiryDate;
    const finalRetailPrice = "retailPrice" in update ? (update.retailPrice as number) : existing.retailPrice;

    // Same reason strings/logic as ai-drafts/[id]/confirm/route.ts.
    const needsReviewReason: string[] = [];
    if (!finalBrand?.trim()) needsReviewReason.push("missing_brand");
    if (!finalSize?.trim()) needsReviewReason.push("missing_size");
    if (!finalExpiryDate) needsReviewReason.push("missing_expiry");
    if (!finalRetailPrice || finalRetailPrice <= 0) needsReviewReason.push("missing_price");
    update.needsReviewReason = needsReviewReason;

    const product = await Product.findOneAndUpdate(
      { _id: id, ...scope },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (approvedBy) {
      ActivityLog.create({
        pharmacyId: session.user.pharmacyId,
        scope: "branch",
        branchId: scope.branchId,
        storeId: null,
        actorUserId: session.user.id,
        actorName: session.user.name ?? "Staff",
        action: "stock_adjustment",
        summary: `${session.user.name ?? "Staff"} edited ${product.itemName}, approved by ${approvedBy.adminName}`,
        metadata: { approvedByAdminId: approvedBy.adminId, approvedByAdminName: approvedBy.adminName, fields: Object.keys(update) },
        refCollection: "products",
        refId: product._id,
        timestamp: new Date(),
      }).catch(() => {});
    }

    // Fire-and-forget PSX sync for updated medicine
    if (product && product.category === "medicine") {
      const slug = await getPharmacySlug(session.user.pharmacyId);
      if (slug) {
        syncProductsToPsx(slug, [product]).catch(() => {});
      }
    }

    return NextResponse.json({ product });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const product = await Product.findOne({ _id: id, ...scope }).lean();
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await Product.deleteOne({ _id: id, ...scope });
    await ProductBatch.deleteMany({ productId: id, ...scope });

    const label = formatProductLabel(product);
    await DeletionLog.create({
      ...scope,
      type: "single",
      deletedByUserId: session.user.id,
      deletedByName: session.user.name ?? "Unknown",
      itemCount: 1,
      summary: `Deleted "${label}"`,
      productSnapshot: product,
      csvContent: productsToCsv([product]),
      csvFileName: `deleted-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
    });

    // Fire-and-forget PSX sync for deleted medicine
    if (product) {
      const slug = await getPharmacySlug(session.user.pharmacyId);
      if (slug) {
        deleteProductsFromPsx(slug, [product]).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
