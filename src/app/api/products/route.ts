import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireAdminApiSession, requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const query: Record<string, unknown> = getBranchScope(
      session,
      request.nextUrl.searchParams.get("branchId")
    );
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const products = await Product.find(query).sort({ name: 1 }).lean();
    return NextResponse.json({ products });
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
      name,
      category,
      quantityInStock,
      retailPrice,
      wholesalePrice,
      distributorPrice,
      batchNumber,
      expiryDate,
      unitHierarchy,
    } = body;

    const missing = (v: unknown) => v === undefined || v === null || v === "";
    // Only the selling (retail) price is required — wholesale/distributor tiers are an
    // optional refinement for pharmacies that want them, defaulting to the retail price
    // so a quick stock-take (item, qty, selling price) doesn't need all three typed in.
    if (!name || !category || missing(retailPrice)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!["medicine", "non-medicine", "supermarket"].includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const retail = Number(retailPrice);
    const scope = getBranchScope(session, branchId);

    // Validate unitHierarchy if provided: must be an array of {unitName, unitsPerParent}.
    let hierarchy: { unitName: string; unitsPerParent: number }[] | undefined;
    if (Array.isArray(unitHierarchy) && unitHierarchy.length > 0) {
      hierarchy = unitHierarchy.map((l: { unitName?: string; unitsPerParent?: number }, i: number) => ({
        unitName: (l.unitName || "").trim(),
        unitsPerParent: i === 0 ? 1 : Math.max(1, Number(l.unitsPerParent) || 1),
      }));
      if (hierarchy.some((l) => !l.unitName)) {
        return NextResponse.json({ error: "Every unit level needs a name" }, { status: 400 });
      }
    }

    const product = await Product.create({
      ...scope,
      name,
      category,
      quantityInStock: missing(quantityInStock) ? 0 : Number(quantityInStock),
      retailPrice: retail,
      wholesalePrice: missing(wholesalePrice) ? retail : Number(wholesalePrice),
      distributorPrice: missing(distributorPrice) ? retail : Number(distributorPrice),
      batchNumber: batchNumber || "",
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      ...(hierarchy ? { unitHierarchy: hierarchy } : {}),
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
