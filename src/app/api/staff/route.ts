import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import Branch from "@/models/Branch";
import Store from "@/models/Store";
import { requireAdminApiSession, getBranchScope, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    // Admin is pharmacy-wide: see the whole staff roster, not just one branch.
    const [staff, branches, stores] = await Promise.all([
      User.find(
        { pharmacyId: session.user.pharmacyId },
        { passwordHash: 0, failedLoginAttempts: 0, lockedUntil: 0 }
      )
        .sort({ name: 1 })
        .lean(),
      Branch.find({ pharmacyId: session.user.pharmacyId }).select("branchName").lean(),
      Store.find({ pharmacyId: session.user.pharmacyId }).select("storeName").lean(),
    ]);

    const branchNames = new Map(branches.map((b) => [String(b._id), b.branchName]));
    const storeNames = new Map(stores.map((s) => [String(s._id), s.storeName]));

    const enriched = staff.map((member) => ({
      ...member,
      branchName: member.branchId ? branchNames.get(String(member.branchId)) ?? null : null,
      storeName: member.storeId ? storeNames.get(String(member.storeId)) ?? null : null,
    }));

    return NextResponse.json({ staff: enriched });
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
    if (!["admin", "staff", "store_manager", "store_keeper"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return NextResponse.json({ error: "Phone number already in use" }, { status: 409 });
    }

    let scope: Record<string, unknown>;
    if (role === "admin" || role === "store_manager") {
      scope = { pharmacyId: session.user.pharmacyId };
    } else if (role === "staff") {
      scope = getBranchScope(session, body.branchId);
    } else {
      scope = getStoreScope(session, body.storeId);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      ...scope,
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
