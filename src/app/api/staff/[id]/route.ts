import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { getMainPsxUrl } from "@/lib/mainPsx";

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
    if (body.name !== undefined) update.name = body.name;
    if (body.branchId !== undefined) update.branchId = body.branchId || null;
    if (body.storeId !== undefined) update.storeId = body.storeId || null;
    if (body.role !== undefined) {
      if (!["admin", "staff", "store_manager", "store_keeper", "pharmacist"].includes(body.role)) {
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

    const mainPsxUrl = getMainPsxUrl();
    const psxResponse = await fetch(`${mainPsxUrl}/api/staff/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.INTERNAL_API_KEY || 'psx-internal-key-123'}`
      },
      body: JSON.stringify(body)
    });

    if (!psxResponse.ok) {
       // Best effort, ignore if it fails on main psx as it might be out of sync
    }

    const user = await User.findOneAndUpdate(
      { _id: id, pharmacyId: session.user.pharmacyId },
      { $set: update },
      {
        new: true,
        runValidators: true,
        projection: { passwordHash: 0, failedLoginAttempts: 0, lockedUntil: 0 },
      }
    );

    // If local user is missing but we're trying to patch, it's fine
    return NextResponse.json({ staff: user || { _id: id } });
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

    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const mainPsxUrl = getMainPsxUrl();
    const psxResponse = await fetch(`${mainPsxUrl}/api/staff/${id}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${process.env.INTERNAL_API_KEY || 'psx-internal-key-123'}`
      }
    });

    if (!psxResponse.ok) {
       // Best effort delete on Main PSX
    }

    await User.deleteOne({ _id: id, pharmacyId: session.user.pharmacyId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
