import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProductRequest from "@/models/ProductRequest";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

const ACTIONS = ["approve", "resolve_duplicate", "reject"] as const;

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/product-requests/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const action = body.action;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const scope = getBranchScope(session, body.branchId);
    const existing = await ProductRequest.findOne({ _id: id, ...scope }).lean();
    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json({ error: "This request has already been reviewed" }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      reviewedByUserId: session.user.id,
      reviewedAt: new Date(),
      reviewNote: typeof body.note === "string" ? body.note.trim() : "",
    };

    if (action === "approve") {
      const productId = typeof body.productId === "string" ? body.productId : "";
      if (!productId) {
        return NextResponse.json({ error: "productId is required to approve" }, { status: 400 });
      }
      const product = await Product.findOne({ _id: productId, ...scope });
      if (!product) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      update.status = "approved";
      update.linkedProductId = product._id;
    } else if (action === "resolve_duplicate") {
      const productId = typeof body.productId === "string" ? body.productId : "";
      if (!productId) {
        return NextResponse.json({ error: "productId is required to resolve as a duplicate" }, { status: 400 });
      }
      // Reconcile: the item was already sold off-catalog, so decrement the matched product's
      // stock now to account for it — it never went through the normal stock-decrementing sale.
      const product = await Product.findOneAndUpdate(
        { _id: productId, ...scope, quantityInStock: { $gte: existing.quantitySold } },
        { $inc: { quantityInStock: -existing.quantitySold } },
        { new: true }
      );
      if (!product) {
        return NextResponse.json(
          { error: "Matched product not found, or has less stock than the quantity sold" },
          { status: 400 }
        );
      }
      update.status = "resolved_duplicate";
      update.linkedProductId = product._id;
    } else {
      update.status = "rejected";
    }

    const productRequest = await ProductRequest.findOneAndUpdate({ _id: id, ...scope }, { $set: update }, { new: true });

    return NextResponse.json({ request: productRequest });
  } catch (error) {
    return handleApiError(error);
  }
}
