import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Attendance from "@/models/Attendance";
import Shift from "@/models/Shift";
import StaffCredential from "@/models/StaffCredential";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { todayDateString } from "@/lib/attendance";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    await dbConnect();

    const date = todayDateString();
    const [attendance, shifts, creds] = await Promise.all([
      Attendance.find({ ...scope, date }).lean(),
      Shift.find({ ...scope, date }).lean(),
      StaffCredential.find({ pharmacyId: scope.pharmacyId }).select("userId name").lean(),
    ]);

    const nameById = new Map(creds.map((c) => [String(c.userId), c.name]));
    const attendanceByUser = new Map(attendance.map((a) => [String(a.userId), a]));
    const shiftByUser = new Map(shifts.map((s) => [String(s.userId), s]));

    const userIds = new Set<string>([...attendanceByUser.keys(), ...shiftByUser.keys()]);

    const roster = Array.from(userIds).map((userId) => {
      const a = attendanceByUser.get(userId);
      const s = shiftByUser.get(userId);
      return {
        userId,
        name: nameById.get(userId) ?? "Unknown",
        scheduledStartTime: s?.scheduledStartTime ?? null,
        scheduledEndTime: s?.scheduledEndTime ?? null,
        clockInTime: a?.clockInTime ?? null,
        clockOutTime: a?.clockOutTime ?? null,
        status: a?.status ?? (s ? "absent" : null),
        onDuty: !!(a?.clockInTime && !a?.clockOutTime),
        wasScheduled: !!s,
      };
    });

    roster.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ date, roster });
  } catch (error) {
    return handleApiError(error);
  }
}
