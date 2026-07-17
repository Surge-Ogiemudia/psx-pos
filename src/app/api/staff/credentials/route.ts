import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import StaffCredential from "@/models/StaffCredential";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const creds = await StaffCredential.find({ pharmacyId: session.user.pharmacyId })
      .select("userId hasFace faceEnrolledAt pinHash faceDescriptor")
      .lean();

    return NextResponse.json({
      credentials: creds.map((c) => ({
        userId: c.userId,
        hasPin: !!c.pinHash,
        hasFace: !!c.faceDescriptor,
        faceEnrolledAt: c.faceEnrolledAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    const body = await request.json();
    const userId = String(body.userId ?? "");
    const name = String(body.name ?? "").trim();
    if (!userId || !name) {
      return NextResponse.json({ error: "userId and name are required" }, { status: 400 });
    }

    await dbConnect();

    const update: Record<string, unknown> = { name };
    if (body.branchId) update.branchId = body.branchId;

    if (body.pin) {
      const pin = String(body.pin).trim();
      if (!/^\d{4,6}$/.test(pin)) {
        return NextResponse.json({ error: "PIN must be 4-6 digits" }, { status: 400 });
      }
      const others = await StaffCredential.find({
        pharmacyId: session.user.pharmacyId,
        userId: { $ne: userId },
        pinHash: { $ne: null },
      }).lean();
      for (const other of others) {
        if (other.pinHash && (await bcrypt.compare(pin, other.pinHash))) {
          return NextResponse.json({ error: "That PIN is already in use — choose another" }, { status: 409 });
        }
      }
      update.pinHash = await bcrypt.hash(pin, 10);
    }
    if (body.clear === "pin") update.pinHash = null;

    if (Array.isArray(body.faceDescriptor)) {
      const descriptor = body.faceDescriptor.map(Number);
      if (descriptor.length !== 128 || descriptor.some((n: number) => !Number.isFinite(n))) {
        return NextResponse.json({ error: "Invalid face scan" }, { status: 400 });
      }
      update.faceDescriptor = descriptor;
      update.faceEnrolledAt = new Date();
    }
    if (body.clear === "face") {
      update.faceDescriptor = null;
      update.faceEnrolledAt = null;
    }

    const cred = await StaffCredential.findOneAndUpdate(
      { pharmacyId: session.user.pharmacyId, userId },
      { $set: update, $setOnInsert: { pharmacyId: session.user.pharmacyId, userId } },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      credential: {
        userId: cred.userId,
        hasPin: !!cred.pinHash,
        hasFace: !!cred.faceDescriptor,
        faceEnrolledAt: cred.faceEnrolledAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
