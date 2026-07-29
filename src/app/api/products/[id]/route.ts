import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import DeletionLog from "@/models/DeletionLog";
import ProductBatch from "@/models/ProductBatch";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { parseNumeric } from "@/lib/numberInput";
import { formatProductLabel } from "@/lib/types";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";
import { syncProductsToPsx, deleteProductsFromPsx, getPharmacySlug } from "@/lib/psxSync";

const NUMERIC_FIELDS = new Set(["retailPrice", "wholesalePrice", "distributorPrice", "alertQuantity"]);

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
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    // quantityInStock is deliberately not editable here — it has to go through
    // /adjust-stock so the change is reconciled against batch history instead of just
    // overwriting the flat number and leaving it out of sync with expiry/batch tracking.
    const allowedFields = [
      "itemName",
      "brand",
      "size",
      "category",
      "unitHierarchy",
      "alertQuantity",
      "retailPrice",
      "wholesalePrice",
      "distributorPrice",
      "batchNumber",
      "expiryDate",
    ] as const;

    const update: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] === undefined) continue;
      if (field === "expiryDate") {
        update[field] = body[field] ? new Date(body[field]) : null;
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

    const scope = getBranchScope(session, body.branchId);
    const product = await Product.findOneAndUpdate(
      { _id: id, ...scope },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
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
