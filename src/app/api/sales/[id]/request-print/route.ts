import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Sale from "@/models/Sale";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    
    const { id } = await params;
    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));

    const sale = await Sale.findOneAndUpdate(
      { _id: id, ...scope },
      { $set: { printStatus: "pending" } },
      { new: true }
    );

    if (!sale) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, sale });
  } catch (error) {
    return handleApiError(error);
  }
}
