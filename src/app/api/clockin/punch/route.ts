import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Attendance from "@/models/Attendance";
import Shift from "@/models/Shift";
import StaffCredential from "@/models/StaffCredential";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { todayDateString, computeClockInStatus, computeClockOutStatus, hoursBetween } from "@/lib/attendance";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    const body = await request.json();
    const scope = getBranchScope(session, body.branchId);

    const userId = String(body.userId ?? "");
    const method = body.method === "face" ? "face" : "pin";
    const localTimeOfDay = typeof body.localTimeOfDay === "string" ? body.localTimeOfDay : null;
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    await dbConnect();

    const cred = await StaffCredential.findOne({ pharmacyId: scope.pharmacyId, userId }).lean();
    if (!cred) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

    const date = todayDateString();
    const now = new Date();

    const shift = await Shift.findOne({ ...scope, userId, date }).sort({ scheduledStartTime: 1 }).lean();
    const existing = await Attendance.findOne({ pharmacyId: scope.pharmacyId, userId, date });

    // No open session for today (either their first punch, or they already clocked out earlier) -> clock in.
    if (!existing || existing.clockOutTime) {
      if (existing) {
        const reopened = await Attendance.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              clockInTime: now,
              clockOutTime: null,
              clockInMethod: method,
              branchId: scope.branchId,
              ...(shift ? { shiftId: shift._id } : {}),
            },
          },
          { new: true }
        );
        return NextResponse.json({ action: "clock_in", attendance: reopened, staffName: cred.name });
      }

      const status = computeClockInStatus({ localTimeOfDay, scheduledStartTime: shift?.scheduledStartTime ?? null });
      const created = await Attendance.create({
        pharmacyId: scope.pharmacyId,
        branchId: scope.branchId,
        userId,
        shiftId: shift?._id ?? null,
        date,
        clockInTime: now,
        clockOutTime: null,
        status,
        clockInMethod: method,
        actualHoursWorked: 0,
        recordedBy: session.user.id,
      });
      return NextResponse.json({ action: "clock_in", attendance: created, staffName: cred.name });
    }

    // Open session exists (clockInTime set, clockOutTime null) -> clock out and accumulate hours.
    const sessionHours = existing.clockInTime ? hoursBetween(existing.clockInTime, now) : 0;
    const totalHoursWorked = Math.round((existing.actualHoursWorked + sessionHours) * 100) / 100;
    const wasLate = existing.status === "late";

    existing.clockOutTime = now;
    existing.clockOutMethod = method;
    existing.actualHoursWorked = totalHoursWorked;
    existing.status = computeClockOutStatus({
      localTimeOfDay,
      totalHoursWorked,
      scheduledStartTime: shift?.scheduledStartTime ?? null,
      scheduledEndTime: shift?.scheduledEndTime ?? null,
      wasLate,
    });
    await existing.save();

    return NextResponse.json({ action: "clock_out", attendance: existing, staffName: cred.name });
  } catch (error) {
    return handleApiError(error);
  }
}
