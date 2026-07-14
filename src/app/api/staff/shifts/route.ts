import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Shift from "@/models/Shift";
import { requirePageSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePageSession();
    await dbConnect();

    // Staff can only see their own shifts (or maybe branch shifts?). Admin sees all.
    const query: any = { pharmacyId: session.user.pharmacyId };
    
    // For now, let's fetch all shifts for the active branch
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    if (branchId) query.branchId = branchId;
    
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    
    if (start && end) {
      query.date = { $gte: start, $lte: end };
    }

    const shifts = await Shift.find(query).lean();
    return NextResponse.json({ shifts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { branchId, userId, date, scheduledStartTime, scheduledEndTime, type, notes } = body;

    if (!branchId || !userId || !date || !scheduledStartTime || !scheduledEndTime || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await dbConnect();

    const shift = await Shift.create({
      pharmacyId: session.user.pharmacyId,
      branchId,
      userId,
      date,
      scheduledStartTime,
      scheduledEndTime,
      type,
      notes,
      createdBy: session.user.id,
    });

    return NextResponse.json({ shift });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
