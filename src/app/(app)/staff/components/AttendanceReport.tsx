"use client";

import { useEffect, useState } from "react";
import type { AttendanceJSON, ShiftJSON, StaffJSON } from "@/lib/types";
import { computeDayPay } from "@/lib/attendance";

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  present: "On time",
  late: "Late",
  half_day: "Half day",
  early_exit: "Left early",
  absent: "Absent",
};

interface Row {
  staff: StaffJSON;
  scheduledDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalHours: number;
  estimatedPay: number;
}

export default function AttendanceReport({ branchId, staff }: { branchId: string | null; staff: StaffJSON[] }) {
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [attendance, setAttendance] = useState<AttendanceJSON[]>([]);
  const [shifts, setShifts] = useState<ShiftJSON[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    fetch(`/api/staff/attendance?branchId=${branchId}&start=${start}&end=${end}`)
      .then((res) => (res.ok ? res.json() : { attendance: [], shifts: [] }))
      .then((data) => {
        setAttendance(data.attendance || []);
        setShifts(data.shifts || []);
      })
      .finally(() => setLoading(false));
  }, [branchId, start, end]);

  if (!branchId) {
    return <div className="text-sm text-zinc-500">Please select a branch to view attendance.</div>;
  }

  const branchStaff = staff.filter((s) => s.branchId === branchId);

  const todaysAttendance = attendance.filter((a) => a.date === todayStr());
  const lateToday = todaysAttendance.filter((a) => a.status === "late");
  const workedToday = todaysAttendance.filter((a) => a.clockInTime);
  const scheduledUserIdsToday = new Set(shifts.filter((s) => s.date === todayStr()).map((s) => s.userId));
  const notClockedInToday = branchStaff.filter(
    (s) => scheduledUserIdsToday.has(s._id) && !todaysAttendance.some((a) => a.userId === s._id && a.clockInTime)
  );

  const rows: Row[] = branchStaff.map((member) => {
    const memberAttendance = attendance.filter((a) => a.userId === member._id);
    const memberShifts = shifts.filter((s) => s.userId === member._id);
    const scheduledDates = new Set(memberShifts.map((s) => s.date));
    const presentDates = new Set(memberAttendance.filter((a) => a.clockInTime).map((a) => a.date));
    const absentDays = Array.from(scheduledDates).filter((d) => !presentDates.has(d)).length;
    const totalHours = memberAttendance.reduce((sum, a) => sum + (a.actualHoursWorked || 0), 0);
    const estimatedPay = memberAttendance.reduce(
      (sum, a) =>
        sum +
        computeDayPay({
          salaryType: member.salaryType,
          salaryAmount: member.salaryAmount,
          hoursWorked: a.actualHoursWorked || 0,
        }),
      0
    );

    return {
      staff: member,
      scheduledDays: scheduledDates.size,
      presentDays: presentDates.size,
      lateDays: memberAttendance.filter((a) => a.status === "late").length,
      absentDays,
      totalHours: Math.round(totalHours * 100) / 100,
      estimatedPay: Math.round(estimatedPay * 100) / 100,
    };
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-600">
          From{" "}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm text-zinc-600">
          To{" "}
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Worked today</p>
          <p className="text-2xl font-bold text-zinc-900">{workedToday.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Late today</p>
          <p className="text-2xl font-bold text-amber-600">{lateToday.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Not clocked in yet</p>
          <p className="text-2xl font-bold text-red-600">{notClockedInToday.length}</p>
          {notClockedInToday.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500">{notClockedInToday.map((s) => s.name).join(", ")}</p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Scheduled</th>
              <th className="px-3 py-2">Present</th>
              <th className="px-3 py-2">Late</th>
              <th className="px-3 py-2">Absent</th>
              <th className="px-3 py-2">Hours</th>
              <th className="px-3 py-2">Est. pay</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  No staff assigned to this branch.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.staff._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-zinc-900">{row.staff.name}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.scheduledDays}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.presentDays}</td>
                  <td className="px-3 py-2 text-amber-600">{row.lateDays || "—"}</td>
                  <td className="px-3 py-2 text-red-600">{row.absentDays || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.totalHours}</td>
                  <td className="px-3 py-2 text-zinc-600">₦{row.estimatedPay.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-900">Today&apos;s punches</h3>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Clock in</th>
              <th className="px-3 py-2">Clock out</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {todaysAttendance.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No one has clocked in today.
                </td>
              </tr>
            ) : (
              todaysAttendance.map((a) => {
                const member = branchStaff.find((s) => s._id === a.userId);
                return (
                  <tr key={a._id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-zinc-900">{member?.name || "Unknown"}</td>
                    <td className="px-3 py-2 text-zinc-600">{formatTime(a.clockInTime)}</td>
                    <td className="px-3 py-2 text-zinc-600">{formatTime(a.clockOutTime)}</td>
                    <td className="px-3 py-2 text-zinc-600">{STATUS_LABEL[a.status] ?? a.status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
