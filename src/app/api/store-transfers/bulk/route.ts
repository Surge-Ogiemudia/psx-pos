import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import Branch from "@/models/Branch";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { executeTransfer } from "@/lib/storeTransfer";
import { handleApiError } from "@/lib/apiError";
import { parseNumeric } from "@/lib/numberInput";

// Each item gets its own full transaction (draw down source stock, create the destination
// record) since a partial write here — stock decremented with nothing recorded at the other
// end — would be worse than a timeout. A large batch can take a while; give it more room than
// the platform default before treating it as hung.
export const maxDuration = 300;

interface BulkPushItem {
  storeProductId?: string;
  form?: string;
  quantity?: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      destinationType,
      toStoreId,
      toBranchId,
    }: {
      destinationType?: "store" | "branch";
      toStoreId?: string;
      toBranchId?: string;
    } = body;
    const items: BulkPushItem[] = Array.isArray(body.items) ? body.items : [];

    if (destinationType !== "store" && destinationType !== "branch") {
      return NextResponse.json({ error: "Invalid destination type" }, { status: 400 });
    }
    if (destinationType === "store" && !toStoreId) {
      return NextResponse.json({ error: "Destination store is required" }, { status: 400 });
    }
    if (destinationType === "branch" && !toBranchId) {
      return NextResponse.json({ error: "Destination branch is required" }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Select at least one item to push" }, { status: 400 });
    }
    if (items.length > 2000) {
      return NextResponse.json({ error: "Limit is 2000 items per bulk push" }, { status: 400 });
    }

    const scope = getStoreScope(session, body.storeId);
    if (destinationType === "store" && toStoreId === scope.storeId) {
      return NextResponse.json({ error: "Cannot push to the same store" }, { status: 400 });
    }

    const sourceStore = await Store.findById(scope.storeId).lean();
    const destinationName =
      destinationType === "store"
        ? (await Store.findById(toStoreId).lean())?.storeName
        : (await Branch.findById(toBranchId).lean())?.branchName;
    if (!destinationName) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    const results: { storeProductId: string; error?: string; totalValue?: number; batchesInvolved?: number }[] = [];
    let pushed = 0;

    for (const item of items) {
      const storeProductId = item.storeProductId || "";
      const form = item.form || "";
      const qty = parseNumeric(item.quantity);

      if (!storeProductId || !form) {
        results.push({ storeProductId, error: "Missing product or form" });
        continue;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        results.push({ storeProductId, error: "Quantity must be at least 1" });
        continue;
      }

      const dbSession = await mongoose.startSession();
      try {
        let outcome: Awaited<ReturnType<typeof executeTransfer>> | null = null;
        await dbSession.withTransaction(async () => {
          outcome = await executeTransfer({
            pharmacyId: scope.pharmacyId,
            storeId: scope.storeId,
            storeProductId,
            form,
            quantity: qty,
            destinationType,
            toStoreId,
            toBranchId,
            sourceStoreName: sourceStore?.storeName ?? "The store",
            destinationName,
            actorUserId: session.user.id,
            actorName: session.user.name ?? "Unknown",
            dbSession,
          });
        });
        results.push({ storeProductId, totalValue: outcome!.totalValue, batchesInvolved: outcome!.batchesInvolved });
        pushed++;
      } catch (err) {
        results.push({ storeProductId, error: err instanceof Error ? err.message : "Push failed" });
      } finally {
        await dbSession.endSession();
      }
    }

    return NextResponse.json({ pushed, results }, { status: pushed === 0 ? 400 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
