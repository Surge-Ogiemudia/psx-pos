import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import Branch from "@/models/Branch";
import StoreTransfer from "@/models/StoreTransfer";
import { requireStoreApiSession, getStoreScope } from "@/lib/session";
import { executeTransfer } from "@/lib/storeTransfer";
import { handleApiError } from "@/lib/apiError";
import { parseNumeric } from "@/lib/numberInput";

export async function GET(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const storeId = request.nextUrl.searchParams.get("storeId");
    const scope = getStoreScope(session, storeId);

    const transfers = await StoreTransfer.find({ pharmacyId: scope.pharmacyId, fromStoreId: scope.storeId })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({ transfers });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStoreApiSession();
    await dbConnect();

    const body = await request.json();
    const {
      storeProductId,
      form,
      quantity,
      destinationType,
      toStoreId,
      toBranchId,
    }: {
      storeProductId?: string;
      form?: string;
      quantity?: number;
      destinationType?: "store" | "branch";
      toStoreId?: string;
      toBranchId?: string;
    } = body;

    if (destinationType !== "store" && destinationType !== "branch") {
      return NextResponse.json({ error: "Invalid destination type" }, { status: 400 });
    }
    if (destinationType === "store" && !toStoreId) {
      return NextResponse.json({ error: "Destination store is required" }, { status: 400 });
    }
    if (destinationType === "branch" && !toBranchId) {
      return NextResponse.json({ error: "Destination branch is required" }, { status: 400 });
    }
    const qty = parseNumeric(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }
    if (!storeProductId || !form) {
      return NextResponse.json({ error: "storeProductId and form are required" }, { status: 400 });
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

    const dbSession = await mongoose.startSession();
    try {
      let response: Awaited<ReturnType<typeof executeTransfer>> | null = null;
      await dbSession.withTransaction(async () => {
        response = await executeTransfer({
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

      return NextResponse.json(response, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
