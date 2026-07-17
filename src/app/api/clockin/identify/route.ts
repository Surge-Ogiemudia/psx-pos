import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import StaffCredential from "@/models/StaffCredential";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// face-api.js's own recommended cutoff for "same person" on its 128-d descriptors.
const FACE_MATCH_THRESHOLD = 0.6;

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    const body = await request.json();
    getBranchScope(session, body.branchId); // kiosk device must be an authenticated retail session

    await dbConnect();

    if (body.method === "pin") {
      const pin = String(body.pin ?? "").trim();
      if (!/^\d{4,6}$/.test(pin)) {
        return NextResponse.json({ error: "Enter a 4-6 digit PIN" }, { status: 400 });
      }
      const candidates = await StaffCredential.find({
        pharmacyId: session.user.pharmacyId,
        pinHash: { $ne: null },
      }).lean();

      for (const cred of candidates) {
        if (cred.pinHash && (await bcrypt.compare(pin, cred.pinHash))) {
          return NextResponse.json({ userId: cred.userId, name: cred.name });
        }
      }
      return NextResponse.json({ error: "PIN not recognized" }, { status: 404 });
    }

    if (body.method === "face") {
      const descriptor = Array.isArray(body.descriptor) ? body.descriptor.map(Number) : null;
      if (!descriptor || descriptor.length !== 128 || descriptor.some((n: number) => !Number.isFinite(n))) {
        return NextResponse.json({ error: "Invalid face scan" }, { status: 400 });
      }
      const candidates = await StaffCredential.find({
        pharmacyId: session.user.pharmacyId,
        faceDescriptor: { $ne: null },
      }).lean();

      let best: { userId: unknown; name: string; distance: number } | null = null;
      for (const cred of candidates) {
        if (!cred.faceDescriptor || cred.faceDescriptor.length !== 128) continue;
        const distance = euclideanDistance(descriptor, cred.faceDescriptor);
        if (!best || distance < best.distance) best = { userId: cred.userId, name: cred.name, distance };
      }

      if (!best || best.distance > FACE_MATCH_THRESHOLD) {
        return NextResponse.json({ error: "Face not recognized" }, { status: 404 });
      }
      return NextResponse.json(best);
    }

    return NextResponse.json({ error: "Invalid method" }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
