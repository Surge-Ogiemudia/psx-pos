import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

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
      if (body[field] !== undefined) {
        update[field] = field === "expiryDate" && body[field] ? new Date(body[field]) : body[field];
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
    const result = await Product.deleteOne({ _id: id, ...scope });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
