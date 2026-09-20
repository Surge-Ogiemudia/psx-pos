import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import DuplicateReviewDecision from "@/models/DuplicateReviewDecision";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

interface DismissPayload {
  branchId?: string;
  productIds: string[];
}

// Persists "these are not duplicates" so a dismissed group never resurfaces from the
// /api/products/duplicates detection scan. Stored per PAIR (not per group), normalized so
// productIdA < productIdB, because a pair is the smallest unit the scan actually checks —
// a group of 3+ is dismissed by writing every pairwise combination in one batch.
export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = (await request.json()) as DismissPayload;
    const scope = getBranchScope(session, body.branchId);
    const productIds = Array.from(new Set((body.productIds ?? []).filter(Boolean)));

    if (productIds.length < 2) {
      return NextResponse.json({ error: "At least two productIds are required" }, { status: 400 });
    }

    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [];
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const [productIdA, productIdB] = [productIds[i], productIds[j]].sort();
        ops.push({
          updateOne: {
            filter: { pharmacyId: scope.pharmacyId, branchId: scope.branchId, productIdA, productIdB },
            update: {
              $set: {
                pharmacyId: scope.pharmacyId,
                branchId: scope.branchId,
                productIdA,
                productIdB,
                decision: "not_duplicate",
                reviewedByUserId: session.user.id,
                reviewedAt: now,
              },
            },
            upsert: true,
          },
        });
      }
    }

    await DuplicateReviewDecision.bulkWrite(ops);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
