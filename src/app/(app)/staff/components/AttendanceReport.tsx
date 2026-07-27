"use client";

import { useEffect, useState } from "react";
import type { AttendanceJSON, PunchLogJSON, ShiftJSON, StaffJSON } from "@/lib/types";
import { computeDayPay } from "@/lib/attendance";

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  present: "On time",
  late: "Late",
  half_day: "Half day",
  early_exit: "Left early",
  absent: "Absent",
};

const VERIFY_MODE_LABEL: Record<number, string> = {
  1: "Fingerprint",
  4: "Card",
  0: "Password",
  15: "Face",
  20: "Face",
};

function getPresetDates(preset: "today" | "week" | "month" | "last_month"): { start: string; end: string } {
  const now = new Date();
  if (preset === "today") {
    const d = now.toISOString().split("T")[0];
    return { start: d, end: d };
  }
  if (preset === "week") {
    const d = new Date(now);
    const day = d.getDay();
    const diffToMon = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diffToMon));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      start: mon.toISOString().split("T")[0],
      end: sun.toISOString().split("T")[0],
    };
  }
  if (preset === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: first.toISOString().split("T")[0],
      end: last.toISOString().split("T")[0],
    };
  }
  // last_month
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: first.toISOString().split("T")[0],
    end: last.toISOString().split("T")[0],
  };
}

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
  const [activePreset, setActivePreset] = useState<"today" | "week" | "month" | "last_month" | "custom">("today");

  const [attendance, setAttendance] = useState<AttendanceJSON[]>([]);
  const [shifts, setShifts] = useState<ShiftJSON[]>([]);
  const [punches, setPunches] = useState<PunchLogJSON[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedStaffMember, setSelectedStaffMember] = useState<StaffJSON | null>(null);
  const [activeView, setActiveView] = useState<"summary" | "raw_punches">("summary");

  function applyPreset(preset: "today" | "week" | "month" | "last_month") {
    setActivePreset(preset);
    const dates = getPresetDates(preset);
    setStart(dates.start);
    setEnd(dates.end);
  }

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    fetch(`/api/staff/attendance?branchId=${branchId}&start=${start}&end=${end}`)
      .then((res) => (res.ok ? res.json() : { attendance: [], shifts: [], punches: [] }))
      .then((data) => {
        setAttendance(data.attendance || []);
        setShifts(data.shifts || []);
        setPunches(data.punches || []);
      })
      .finally(() => setLoading(false));
  }, [branchId, start, end]);

  if (!branchId) {
    return <div className="text-sm text-zinc-500">Please select a branch to view attendance.</div>;
  }

  const branchStaff = staff.filter((s) => s.branchId === branchId);

  // Overall Statistics for Date Range
  const totalScheduledShifts = shifts.length;
  const totalOnTime = attendance.filter((a) => a.status === "present").length;
  const totalLate = attendance.filter((a) => a.status === "late").length;
  const punctualityRate = totalScheduledShifts > 0 ? Math.round((totalOnTime / totalScheduledShifts) * 100) : 100;

  const totalRangeHours = attendance.reduce((sum, a) => sum + (a.actualHoursWorked || 0), 0);

  const totalRangePay = branchStaff.reduce((total, member) => {
    const memberAttendance = attendance.filter((a) => a.userId === member._id || a.userId === member.localId);
    return (
      total +
      memberAttendance.reduce(
        (sum, a) =>
          sum +
          computeDayPay({
            salaryType: member.salaryType,
            salaryAmount: member.salaryAmount,
            hoursWorked: a.actualHoursWorked || 0,
          }),
        0
      )
    );
  }, 0);

  const rows: Row[] = branchStaff.map((member) => {
    const memberAttendance = attendance.filter((a) => a.userId === member._id || a.userId === member.localId);
    const memberShifts = shifts.filter((s) => s.userId === member._id || s.userId === member.localId);
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
      {/* Top Filter & View Controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 bg-zinc-100 p-1.5 rounded-xl border border-zinc-200">
          <button
            type="button"
            onClick={() => applyPreset("today")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activePreset === "today" ? "bg-teal-700 text-white shadow-xs" : "text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => applyPreset("week")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activePreset === "week" ? "bg-teal-700 text-white shadow-xs" : "text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => applyPreset("month")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activePreset === "month" ? "bg-teal-700 text-white shadow-xs" : "text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => applyPreset("last_month")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activePreset === "last_month" ? "bg-teal-700 text-white shadow-xs" : "text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            Last Month
          </button>

          <div className="flex items-center gap-1 pl-2 border-l border-zinc-300">
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setActivePreset("custom");
                setStart(e.target.value);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium"
            />
            <span className="text-xs text-zinc-400">to</span>
            <input
              type="date"
              value={end}
              onChange={(e) => {
                setActivePreset("custom");
                setEnd(e.target.value);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
          <button
            type="button"
            onClick={() => setActiveView("summary")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeView === "summary" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Attendance Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveView("raw_punches")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeView === "raw_punches" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Raw Biometric Logs ({punches.length})
          </button>
        </div>
      </div>

      {/* Dynamic Range Analysis KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Punctuality Rate</p>
          <p className="mt-1 text-2xl font-black text-teal-800">{punctualityRate}%</p>
          <p className="mt-0.5 text-xs text-zinc-500">{totalOnTime} of {totalScheduledShifts} shifts on time</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Total Hours Logged</p>
          <p className="mt-1 text-2xl font-black text-zinc-900">{Math.round(totalRangeHours * 10) / 10} hrs</p>
          <p className="mt-0.5 text-xs text-zinc-500">Across {branchStaff.length} active staff</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Late Shifts</p>
          <p className="mt-1 text-2xl font-black text-amber-800">{totalLate}</p>
          <p className="mt-0.5 text-xs text-amber-600 font-medium">Clock-in past schedule</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-800">Est. Total Payroll</p>
          <p className="mt-1 text-2xl font-black text-teal-950">₦{Math.round(totalRangePay).toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-teal-700 font-medium">Calculated for selected period</p>
        </div>
      </div>

      {activeView === "summary" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600">Staff Attendance Summary Table</h3>
            <span className="text-xs text-zinc-400">Click any row to view detailed punch breakdown</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-2.5">Staff Name</th>
                <th className="px-4 py-2.5">Scheduled</th>
                <th className="px-4 py-2.5">Present</th>
                <th className="px-4 py-2.5">Late</th>
                <th className="px-4 py-2.5">Absent</th>
                <th className="px-4 py-2.5">Total Hours</th>
                <th className="px-4 py-2.5">Est. Pay</th>
                <th className="px-4 py-2.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    Loading attendance analytics...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No staff assigned to this branch.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.staff._id}
                    onClick={() => setSelectedStaffMember(row.staff)}
                    className="border-b border-zinc-100 last:border-0 hover:bg-teal-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">{row.staff.name}</div>
                      <div className="text-xs text-zinc-400 capitalize">{row.staff.role.replace("_", " ")}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 font-medium">{row.scheduledDays} days</td>
                    <td className="px-4 py-3 text-teal-700 font-semibold">{row.presentDays} days</td>
                    <td className="px-4 py-3 text-amber-600 font-medium">{row.lateDays || "—"}</td>
                    <td className="px-4 py-3 text-red-600 font-medium">{row.absentDays || "—"}</td>
                    <td className="px-4 py-3 text-zinc-700 font-bold">{row.totalHours} hrs</td>
                    <td className="px-4 py-3 text-zinc-900 font-bold">₦{row.estimatedPay.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-semibold text-teal-700 hover:underline">View Log →</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Raw Biometric Logs Table */
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600">Raw ZKTeco Machine Punches ({punches.length})</h3>
            <span className="text-xs text-zinc-400">Direct hardware audit trail</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Staff Member</th>
                <th className="px-4 py-2.5">Punch Action</th>
                <th className="px-4 py-2.5">Verify Mode</th>
                <th className="px-4 py-2.5">Device Serial</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Loading biometric logs...
                  </td>
                </tr>
              ) : punches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No physical machine punches recorded for this period.
                  </td>
                </tr>
              ) : (
                punches.map((p) => {
                  const member = branchStaff.find((s) => s._id === p.userId || s.localId === p.userId);
                  const isCheckIn = p.punchStatus === 0;
                  const isCheckOut = p.punchStatus === 1;
                  return (
                    <tr key={p._id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-900">{formatDateTime(p.punchTime)}</td>
                      <td className="px-4 py-2.5 text-zinc-700 font-semibold">{member?.name || "Unknown Staff"}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            isCheckIn
                              ? "bg-teal-100 text-teal-800"
                              : isCheckOut
                              ? "bg-blue-100 text-blue-800"
                              : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          {isCheckIn ? "Check-In (0)" : isCheckOut ? "Check-Out (1)" : `Auto (${p.punchStatus})`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-600 font-medium">
                        {VERIFY_MODE_LABEL[p.verifyMode] || `Mode ${p.verifyMode}`}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{p.deviceSerialNumber}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff Attendance Drill-Down Modal */}
      {selectedStaffMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-zinc-200 bg-zinc-50/80 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">{selectedStaffMember.name} — Attendance Log</h3>
                <p className="text-xs text-zinc-500">
                  Range: {start} to {end} • Role: {selectedStaffMember.role.replace("_", " ")}
                </p>
              </div>
              <button
                onClick={() => setSelectedStaffMember(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {(() => {
                const memberAttendance = attendance.filter(
                  (a) => a.userId === selectedStaffMember._id || a.userId === selectedStaffMember.localId
                );
                const memberShifts = shifts.filter(
                  (s) => s.userId === selectedStaffMember._id || s.userId === selectedStaffMember.localId
                );
                const memberPunches = punches.filter(
                  (p) => p.userId === selectedStaffMember._id || p.userId === selectedStaffMember.localId
                );

                const totalHrs = memberAttendance.reduce((sum, a) => sum + (a.actualHoursWorked || 0), 0);
                const totalPay = memberAttendance.reduce(
                  (sum, a) =>
                    sum +
                    computeDayPay({
                      salaryType: selectedStaffMember.salaryType,
                      salaryAmount: selectedStaffMember.salaryAmount,
                      hoursWorked: a.actualHoursWorked || 0,
                    }),
                  0
                );

                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                        <span className="text-xs font-semibold text-zinc-500 uppercase block">Shifts Scheduled</span>
                        <span className="text-xl font-bold text-zinc-900">{memberShifts.length}</span>
                      </div>
                      <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                        <span className="text-xs font-semibold text-teal-800 uppercase block">Days Present</span>
                        <span className="text-xl font-bold text-teal-900">
                          {memberAttendance.filter((a) => a.clockInTime).length}
                        </span>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                        <span className="text-xs font-semibold text-amber-800 uppercase block">Late Shifts</span>
                        <span className="text-xl font-bold text-amber-900">
                          {memberAttendance.filter((a) => a.status === "late").length}
                        </span>
                      </div>
                      <div className="rounded-lg border border-teal-200 bg-teal-100/50 p-3">
                        <span className="text-xs font-semibold text-teal-900 uppercase block">Total Pay</span>
                        <span className="text-xl font-black text-teal-950">₦{Math.round(totalPay).toLocaleString()}</span>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-600">Daily Punch & Shift History</h4>
                      <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
                        {memberShifts.length === 0 && memberAttendance.length === 0 ? (
                          <div className="p-4 text-center text-xs text-zinc-500">No shifts or attendance records found for this date range.</div>
                        ) : (
                          memberShifts.map((shift) => {
                            const att = memberAttendance.find((a) => a.date === shift.date);
                            const dayPunches = memberPunches.filter((p) => new Date(p.punchTime).toISOString().split("T")[0] === shift.date);

                            return (
                              <div key={shift._id} className="p-3 bg-white space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                  <div className="font-bold text-zinc-900 flex items-center gap-2">
                                    <span>{shift.date}</span>
                                    <span className="text-xs font-medium text-zinc-500 capitalize">({shift.type.replace("_", " ")})</span>
                                  </div>
                                  <div>
                                    {att?.status ? (
                                      <span
                                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                          att.status === "present"
                                            ? "bg-teal-100 text-teal-800"
                                            : att.status === "late"
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-red-100 text-red-800"
                                        }`}
                                      >
                                        {STATUS_LABEL[att.status] || att.status}
                                      </span>
                                    ) : (
                                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                                        No Clock-In
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="text-xs text-zinc-600 flex flex-wrap items-center justify-between gap-2 bg-zinc-50 p-2 rounded">
                                  <div>
                                    <span className="text-zinc-400">Scheduled:</span> {shift.scheduledStartTime} - {shift.scheduledEndTime}
                                  </div>
                                  <div>
                                    <span className="text-zinc-400">Clock In/Out:</span> {formatTime(att?.clockInTime)} — {formatTime(att?.clockOutTime)}
                                  </div>
                                  <div className="font-semibold text-zinc-900">
                                    Worked: {att?.actualHoursWorked || 0} hrs
                                  </div>
                                </div>

                                {dayPunches.length > 0 && (
                                  <div className="text-[11px] text-zinc-500 pl-1 pt-0.5 flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-zinc-600">Hardware Punches ({dayPunches.length}):</span>
                                    {dayPunches.map((dp) => (
                                      <span key={dp._id} className="bg-zinc-100 px-1.5 py-0.5 rounded font-mono text-[10px]">
                                        {new Date(dp.punchTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                        ({dp.punchStatus === 0 ? "In" : dp.punchStatus === 1 ? "Out" : "Auto"})
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="border-t border-zinc-200 bg-zinc-50 p-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedStaffMember(null)}
                className="rounded-lg bg-zinc-800 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

