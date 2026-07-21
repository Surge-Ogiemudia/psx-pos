import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import Branch from "@/models/Branch";
import Store from "@/models/Store";
import { requireAdminApiSession, getBranchScope, getStoreScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { getMainPsxUrl } from "@/lib/mainPsx";

export async function GET() {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const mainPsxUrl = getMainPsxUrl();

    // Fetch staff from Main PSX
    const psxResponse = await fetch(`${mainPsxUrl}/api/staff?pharmacyId=${session.user.pharmacyId}`, {
      headers: {
        "Authorization": `Bearer ${process.env.INTERNAL_API_KEY || 'psx-internal-key-123'}`
      }
    });

    const data = await psxResponse.json();
    const staffFromPsx = psxResponse.ok ? data.staff : [];

    // Admin is pharmacy-wide: see the whole staff roster, not just one branch.
    const [branches, stores] = await Promise.all([
      Branch.find({ pharmacyId: session.user.pharmacyId }).select("branchName").lean(),
      Store.find({ pharmacyId: session.user.pharmacyId }).select("storeName").lean(),
    ]);

    const branchNames = new Map(branches.map((b) => [String(b._id), b.branchName]));
    const storeNames = new Map(stores.map((s) => [String(s._id), s.storeName]));

    const enriched = staffFromPsx.map((member: any) => ({
      _id: member.id, // Map Main PSX id back to _id for POS UI
      name: member.name,
      phoneNumber: member.phoneNumber,
      role: member.role,
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
    const {
      name,
      role,
      phoneNumber,
      password,
      employmentType,
      salaryType,
      salaryAmount,
    } = body;

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

    // Forward the request to Main PSX API
    const mainPsxUrl = getMainPsxUrl();

    const psxResponse = await fetch(`${mainPsxUrl}/api/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.INTERNAL_API_KEY || 'psx-internal-key-123'}`
      },
      body: JSON.stringify({
        name,
        role,
        phoneNumber,
        password,
        pharmacyId: session.user.pharmacyId,
        branchId: body.branchId,
        storeId: body.storeId,
        employmentType: employmentType || "full_time",
        salaryType: salaryType || "monthly",
        salaryAmount: salaryAmount || 0,
      })
    });

    const data = await psxResponse.json();

    if (!psxResponse.ok) {
      return NextResponse.json({ error: data.error || "Failed to create staff in Main PSX" }, { status: psxResponse.status });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    // Save to local POS database so branchId is accessible for POS login
    const user = await User.create({
      _id: data.user.id, // Keep IDs perfectly in sync
      name,
      role,
      phoneNumber,
      passwordHash,
      pharmacyId: session.user.pharmacyId,
      branchId: body.branchId || null,
      storeId: body.storeId || null,
      employmentType: employmentType || "full_time",
      salaryType: salaryType || "monthly",
      salaryAmount: salaryAmount || 0,
      status: "active",
    });

    return NextResponse.json(
      { staff: data.user },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
