import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import DeletionLog from "@/models/DeletionLog";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { parseNumeric } from "@/lib/numberInput";
import { formatProductLabel } from "@/lib/types";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";

const NUMERIC_FIELDS = new Set(["quantityInStock", "retailPrice", "wholesalePrice", "distributorPrice"]);

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/products/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const allowedFields = [
      "itemName",
      "brand",
      "size",
      "category",
      "quantityInStock",
      "unitHierarchy",
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

    return NextResponse.json({ product });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/products/[id]">
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
