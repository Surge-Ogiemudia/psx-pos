import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Branch from "@/models/Branch";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const update: Record<string, unknown> = {};
    if (typeof body.branchName === "string" && body.branchName.trim()) update.branchName = body.branchName.trim();
    if (typeof body.location === "string") update.location = body.location;

    const branch = await Branch.findOneAndUpdate(
      { _id: id, pharmacyId: session.user.pharmacyId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!branch) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }

    return NextResponse.json({ branch });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const result = await Branch.deleteOne({ _id: id, pharmacyId: session.user.pharmacyId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
