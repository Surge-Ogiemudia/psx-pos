import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const staff = await User.find(
      { pharmacyId: session.user.pharmacyId, branchId: session.user.branchId },
      { passwordHash: 0, failedLoginAttempts: 0, lockedUntil: 0 }
    )
      .sort({ name: 1 })
      .lean();

    return NextResponse.json({ staff });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const { name, role, phoneNumber, password } = body;

    if (!name || !phoneNumber || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!["admin", "staff"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return NextResponse.json({ error: "Phone number already in use" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      pharmacyId: session.user.pharmacyId,
      branchId: session.user.branchId,
      name,
      role,
      phoneNumber,
      passwordHash,
    });

    return NextResponse.json(
      { staff: { id: user._id, name: user.name, role: user.role, phoneNumber: user.phoneNumber } },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
