import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Branch from "@/models/Branch";
import { requireApiSession, requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const branches = await Branch.find({ pharmacyId: session.user.pharmacyId })
      .sort({ branchName: 1 })
      .lean();

    return NextResponse.json({ branches });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const branchName = typeof body.branchName === "string" ? body.branchName.trim() : "";
    const location = typeof body.location === "string" ? body.location : "";

    if (!branchName) {
      return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
    }

    const branch = await Branch.create({
      pharmacyId: session.user.pharmacyId,
      branchName,
      location,
    });

    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
