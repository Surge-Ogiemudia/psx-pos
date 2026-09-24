import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { isMonakTriageLocked, triageLockedResponse } from "@/lib/monakTriageLock";

// A trimmed, paginated, branch-scoped slice of the product catalog — built for Monak Triage
// Mobile's offline sync (see useMonakTriageOfflineSync.ts), which needs just enough of the
// branch catalog to run the client-side duplicate-check (isDuplicateText, same as
// /api/products/[id]/possible-duplicates) without a live connection. Deliberately NOT the
// full product document — no costPrice/batchNumber/unitHierarchy/etc — same field selection
// the possible-duplicates route already uses for the identical purpose.
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (isMonakTriageLocked(session.user.pharmacyId)) return triageLockedResponse();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));

    const limitParam = request.nextUrl.searchParams.get("limit");
    const skipParam = request.nextUrl.searchParams.get("skip");
    const limit = limitParam ? Math.min(1000, Math.max(1, parseInt(limitParam, 10) || 0)) : 500;
    const skip = skipParam ? Math.max(0, parseInt(skipParam, 10) || 0) : 0;

    const [products, total] = await Promise.all([
      Product.find(scope)
        .select("itemName brand size imageUrl quantityInStock")
        .sort({ _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(scope),
    ]);

    return NextResponse.json({ products, total, timestamp: Date.now() });
  } catch (error) {
    return handleApiError(error);
  }
}
