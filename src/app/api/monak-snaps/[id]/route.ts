import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import MonakSnap from "@/models/MonakSnap";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;

    const snap = await MonakSnap.findOneAndDelete({ _id: id, pharmacyId });
    if (!snap) {
      return NextResponse.json({ error: "Snap not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
