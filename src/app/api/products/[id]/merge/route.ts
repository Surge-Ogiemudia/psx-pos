import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { parseNumeric } from "@/lib/numberInput";
import { handleApiError } from "@/lib/apiError";

function missing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function earlierDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Folds an incoming "duplicate" addition into an existing product instead of creating a second
 * catalog row. mode "batch" = same product restocked under a new batch: quantities combine, the
 * soonest expiry wins (so FIFO-minded staff sell it first), and the new batch number is adopted.
 * mode "merge" = these were actually the same listing all along: quantities combine, soonest
 * expiry wins, and each price tier takes the higher of the two (per the admin's explicit choice).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/products/[id]/merge">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const mode = body.mode === "merge" ? "merge" : "batch";
    const scope = getBranchScope(session, body.branchId);

    const existing = await Product.findOne({ _id: id, ...scope });
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const incomingQuantity = missing(body.quantityInStock) ? 0 : parseNumeric(body.quantityInStock);
    if (Number.isNaN(incomingQuantity) || incomingQuantity < 0) {
      return NextResponse.json({ error: "Stock quantity must be a non-negative number" }, { status: 400 });
    }
    const incomingExpiry = body.expiryDate ? new Date(body.expiryDate) : null;
    if (body.expiryDate && Number.isNaN(incomingExpiry?.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      quantityInStock: existing.quantityInStock + incomingQuantity,
      expiryDate: earlierDate(existing.expiryDate ?? null, incomingExpiry),
    };

    if (mode === "merge") {
      const incomingRetail = missing(body.retailPrice) ? existing.retailPrice : parseNumeric(body.retailPrice);
      const incomingWholesale = missing(body.wholesalePrice) ? incomingRetail : parseNumeric(body.wholesalePrice);
      const incomingDistributor = missing(body.distributorPrice) ? incomingRetail : parseNumeric(body.distributorPrice);
      if ([incomingRetail, incomingWholesale, incomingDistributor].some((n) => Number.isNaN(n) || n < 0)) {
        return NextResponse.json({ error: "Prices must be non-negative numbers" }, { status: 400 });
      }
      update.retailPrice = Math.max(existing.retailPrice, incomingRetail);
      update.wholesalePrice = Math.max(existing.wholesalePrice, incomingWholesale);
      update.distributorPrice = Math.max(existing.distributorPrice, incomingDistributor);
    } else if (typeof body.batchNumber === "string" && body.batchNumber.trim()) {
      update.batchNumber = body.batchNumber.trim();
    }

    if (
      (!existing.unitHierarchy || existing.unitHierarchy.length === 0) &&
      Array.isArray(body.unitHierarchy) &&
      body.unitHierarchy.length > 0
    ) {
      update.unitHierarchy = body.unitHierarchy;
    }

    const updated = await Product.findOneAndUpdate({ _id: id }, { $set: update }, { new: true });
    return NextResponse.json({ product: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
