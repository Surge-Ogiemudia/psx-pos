import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import MonakSnap from "@/models/MonakSnap";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const branchId = request.nextUrl.searchParams.get("branchId");
    const { pharmacyId, branchId: resolvedBranchId } = getBranchScope(session, branchId);

    const snaps = await MonakSnap.find({
      pharmacyId,
      branchId: resolvedBranchId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ snaps });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const { frontImageUrl, expiryImageUrl, quantity, branchId } = body as {
      frontImageUrl: string;
      expiryImageUrl: string;
      quantity: number;
      branchId?: string;
    };

    if (!frontImageUrl || !expiryImageUrl) {
      return NextResponse.json({ error: "Both image URLs are required" }, { status: 400 });
    }
    if (!quantity || quantity < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }

    const { pharmacyId, branchId: resolvedBranchId } = getBranchScope(session, branchId);

    const snap = await MonakSnap.create({
      pharmacyId,
      branchId: resolvedBranchId,
      frontImageUrl,
      expiryImageUrl,
      quantity: Number(quantity),
      status: "pending",
    });

    return NextResponse.json({ snap }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
