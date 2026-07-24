import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import { requirePageSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin" && session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await dbConnect();
    const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();
    if (!pharmacy) return NextResponse.json({ error: "Pharmacy not found" }, { status: 404 });

    return NextResponse.json({
      shiftSettings: pharmacy.shiftSettings || {},
      payrollSettings: pharmacy.payrollSettings || {},
      attendanceSettings: pharmacy.attendanceSettings || { allowWebClockIn: true },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { shiftSettings, payrollSettings, attendanceSettings } = await request.json();

    await dbConnect();
    const pharmacy = await Pharmacy.findById(session.user.pharmacyId);
    if (!pharmacy) return NextResponse.json({ error: "Pharmacy not found" }, { status: 404 });

    if (shiftSettings) {
      pharmacy.shiftSettings = { ...pharmacy.shiftSettings, ...shiftSettings };
    }
    if (payrollSettings) {
      pharmacy.payrollSettings = { ...pharmacy.payrollSettings, ...payrollSettings };
    }
    if (attendanceSettings) {
      pharmacy.attendanceSettings = { ...pharmacy.attendanceSettings, ...attendanceSettings };
    }

    await pharmacy.save();

    return NextResponse.json({
      shiftSettings: pharmacy.shiftSettings,
      payrollSettings: pharmacy.payrollSettings,
      attendanceSettings: pharmacy.attendanceSettings,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
