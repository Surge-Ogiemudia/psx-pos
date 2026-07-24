import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import BiometricDevice from "@/models/BiometricDevice";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const devices = await BiometricDevice.find({ pharmacyId: session.user.pharmacyId }).lean();
    return NextResponse.json(devices);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const { serialNumber, name, branchId } = body;

    if (!serialNumber || !name || !branchId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const device = await BiometricDevice.create({
      pharmacyId: session.user.pharmacyId,
      branchId,
      serialNumber: serialNumber.trim(),
      name: name.trim(),
    });

    return NextResponse.json(device);
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ error: "Device with this serial number already exists" }, { status: 400 });
    }
    return handleApiError(error);
  }
}
