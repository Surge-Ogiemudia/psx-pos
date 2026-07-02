import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/staff/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const body = await request.json();
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.role !== undefined) {
      if (!["admin", "staff"].includes(body.role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      update.role = body.role;
    }
    if (body.password) {
      if (String(body.password).length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      update.passwordHash = await bcrypt.hash(body.password, 12);
      update.failedLoginAttempts = 0;
      update.lockedUntil = null;
    }

    const user = await User.findOneAndUpdate(
      { _id: id, pharmacyId: session.user.pharmacyId, branchId: session.user.branchId },
      { $set: update },
      {
        new: true,
        runValidators: true,
        projection: { passwordHash: 0, failedLoginAttempts: 0, lockedUntil: 0 },
      }
    );

    if (!user) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    return NextResponse.json({ staff: user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/staff/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const result = await User.deleteOne({
      _id: id,
      pharmacyId: session.user.pharmacyId,
      branchId: session.user.branchId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
