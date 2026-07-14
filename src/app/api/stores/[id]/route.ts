import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
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
    if (typeof body.storeName === "string" && body.storeName.trim()) update.storeName = body.storeName.trim();
    if (typeof body.location === "string") update.location = body.location;

    const store = await Store.findOneAndUpdate(
      { _id: id, pharmacyId: session.user.pharmacyId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    return NextResponse.json({ store });
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

    const result = await Store.deleteOne({ _id: id, pharmacyId: session.user.pharmacyId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
