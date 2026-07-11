import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { requireApiSession, getStoreScope, getBranchScope } from "@/lib/session";
import { receiveTransfers } from "@/lib/storeTransfer";
import { handleApiError } from "@/lib/apiError";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const transferIds: string[] = Array.isArray(body.transferIds) ? body.transferIds : [];
    if (transferIds.length === 0) {
      return NextResponse.json({ error: "Select at least one transfer to receive" }, { status: 400 });
    }

    let destinationType: "store" | "branch";
    let toStoreId: string | undefined;
    let toBranchId: string | undefined;
    let pharmacyId: string;

    if (body.storeId) {
      const scope = getStoreScope(session, body.storeId);
      destinationType = "store";
      toStoreId = scope.storeId;
      pharmacyId = scope.pharmacyId;
    } else if (body.branchId) {
      const scope = getBranchScope(session, body.branchId);
      destinationType = "branch";
      toBranchId = scope.branchId;
      pharmacyId = scope.pharmacyId;
    } else {
      return NextResponse.json({ error: "storeId or branchId is required" }, { status: 400 });
    }

    const dbSession = await mongoose.startSession();
    try {
      let response: Awaited<ReturnType<typeof receiveTransfers>> | null = null;
      await dbSession.withTransaction(async () => {
        response = await receiveTransfers({
          pharmacyId,
          destinationType,
          toStoreId,
          toBranchId,
          transferIds,
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
