"use client";

import { useEffect, useState } from "react";
import type { ShiftJSON, StaffJSON, ShiftType } from "@/lib/types";

interface ShiftManagementProps {
  branchId: string | null;
  staff: StaffJSON[];
}

const DAYS_OF_WEEK = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

const SHIFT_PRESETS: Record<ShiftType, { start: string; end: string }> = {
  morning: { start: "08:00", end: "14:00" },
  afternoon: { start: "14:00", end: "20:00" },
  evening: { start: "16:00", end: "22:00" },
  full_day: { start: "08:00", end: "20:00" },
  custom: { start: "08:00", end: "17:00" },
};

export default function ShiftManagement({ branchId, staff }: ShiftManagementProps) {
  const [shifts, setShifts] = useState<ShiftJSON[]>([]);
  const [dateStr, setDateStr] = useState<string>(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  // New shift form
  const [showForm, setShowForm] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState<string>(
    new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Default Mon-Fri
  const [targetStaffMode, setTargetStaffMode] = useState<"single" | "all" | "selected">("single");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    userId: "",
    date: new Date().toISOString().split("T")[0],
    type: "morning" as ShiftType,
    scheduledStartTime: "08:00",
    scheduledEndTime: "14:00",
    notes: "",
  });

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadShifts() {
    if (!branchId) return;
    setLoading(true);
    const res = await fetch(`/api/staff/shifts?branchId=${branchId}&start=${dateStr}&end=${dateStr}`);
    if (res.ok) {
      const data = await res.json();
      setShifts(data.shifts || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, dateStr]);

  const branchStaff = staff.filter((s) => s.branchId === branchId);

  function handleTypeChange(newType: ShiftType) {
    const preset = SHIFT_PRESETS[newType];
    setForm({
      ...form,
      type: newType,
      scheduledStartTime: preset ? preset.start : form.scheduledStartTime,
      scheduledEndTime: preset ? preset.end : form.scheduledEndTime,
    });
  }

  function toggleDayOfWeek(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function toggleStaffSelection(id: string) {
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSubmitShift() {
    if (!branchId) return;
    setMessage(null);
    setSubmitting(true);

    if (isBulkMode) {
      let userIdsToSchedule: string[] = [];
      if (targetStaffMode === "all") {
        userIdsToSchedule = branchStaff.map((s) => s._id);
      } else if (targetStaffMode === "selected") {
        userIdsToSchedule = selectedStaffIds;
      } else {
        if (!form.userId) {
          setMessage({ type: "error", text: "Please select a staff member." });
          setSubmitting(false);
          return;
        }
        userIdsToSchedule = [form.userId];
      }

      if (userIdsToSchedule.length === 0) {
        setMessage({ type: "error", text: "Please select at least one staff member to schedule." });
        setSubmitting(false);
        return;
      }

      if (daysOfWeek.length === 0) {
        setMessage({ type: "error", text: "Please select at least one day of the week." });
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/staff/shifts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          userIds: userIdsToSchedule,
          startDate,
          endDate,
          daysOfWeek,
          type: form.type,
          scheduledStartTime: form.scheduledStartTime,
          scheduledEndTime: form.scheduledEndTime,
          notes: form.notes,
        }),
      });

      const data = await res.json();
      setSubmitting(false);

      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Shifts successfully scheduled!" });
        setShowForm(false);
        loadShifts();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to schedule bulk shifts." });
      }
    } else {
      if (!form.userId) {
        setMessage({ type: "error", text: "Please select a staff member." });
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/staff/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, branchId }),
      });

      const data = await res.json();
      setSubmitting(false);

      if (res.ok) {
        setMessage({ type: "success", text: "Shift assigned successfully." });
        setShowForm(false);
        loadShifts();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create shift." });
      }
    }
  }

  async function deleteShift(id: string) {
    if (!confirm("Are you sure you want to delete this shift?")) return;
    const res = await fetch(`/api/staff/shifts/${id}`, { method: "DELETE" });
    if (res.ok) loadShifts();
  }

  if (!branchId) {
    return <div className="text-sm text-zinc-500">Please select a branch to view shifts.</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-900">Shifts</h2>
          <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-lg">
            <span className="text-xs text-zinc-500 font-medium pl-2">Viewing Date:</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm font-medium"
            />
          </div>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setMessage(null);
          }}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 shadow-sm"
        >
          {showForm ? "Cancel" : "+ Assign Shifts"}
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm font-medium ${
            message.type === "success" ? "bg-teal-50 text-teal-800 border border-teal-200" : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">
              {isBulkMode ? "Bulk / Multi-Day Shift Assignment" : "Single Day Shift Assignment"}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsBulkMode(false)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  !isBulkMode ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                Single Day
              </button>
              <button
                type="button"
                onClick={() => setIsBulkMode(true)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  isBulkMode ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                Date Range / Recurring ⚡
              </button>
            </div>
          </div>

          {/* Date & Range Settings */}
          {isBulkMode ? (
            <div className="space-y-3 bg-zinc-50/70 p-4 rounded-lg border border-zinc-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-600">Active Days of Week</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek([1, 2, 3, 4, 5])}
                      className="text-[11px] text-teal-700 hover:underline font-medium"
                    >
                      Weekdays (Mon-Fri)
                    </button>
                    <span className="text-zinc-300">|</span>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                      className="text-[11px] text-teal-700 hover:underline font-medium"
                    >
                      All 7 Days
                    </button>
                    <span className="text-zinc-300">|</span>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek([0, 6])}
                      className="text-[11px] text-teal-700 hover:underline font-medium"
                    >
                      Weekends
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(({ day, label }) => {
                    const active = daysOfWeek.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDayOfWeek(day)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          active
                            ? "bg-teal-700 border-teal-700 text-white shadow-xs"
                            : "bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Shift Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full max-w-xs rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
              />
            </div>
          )}

          {/* Staff Target Selection */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Staff Member(s)</label>
            {isBulkMode && (
              <div className="flex items-center gap-4 mb-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="radio"
                    name="targetStaffMode"
                    checked={targetStaffMode === "single"}
                    onChange={() => setTargetStaffMode("single")}
                  />
                  Single Staff
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="radio"
                    name="targetStaffMode"
                    checked={targetStaffMode === "all"}
                    onChange={() => setTargetStaffMode("all")}
                  />
                  All Branch Staff ({branchStaff.length})
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="radio"
                    name="targetStaffMode"
                    checked={targetStaffMode === "selected"}
                    onChange={() => setTargetStaffMode("selected")}
                  />
                  Select Multiple Staff
                </label>
              </div>
            )}

            {targetStaffMode === "single" && (
              <select
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                className="w-full max-w-sm rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">Select staff member...</option>
                {branchStaff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.role.replace("_", " ")})
                  </option>
                ))}
              </select>
            )}

            {isBulkMode && targetStaffMode === "selected" && (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-zinc-200 rounded-lg bg-zinc-50">
                {branchStaff.map((s) => {
                  const checked = selectedStaffIds.includes(s._id);
                  return (
                    <label
                      key={s._id}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border ${
                        checked ? "bg-teal-100 border-teal-300 text-teal-900" : "bg-white border-zinc-200 text-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStaffSelection(s._id)}
                      />
                      {s.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Shift Details (Type & Hours) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-100 pt-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Shift Type</label>
              <select
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value as ShiftType)}
                className="w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
              >
                <option value="morning">Morning (08:00 - 14:00)</option>
                <option value="afternoon">Afternoon (14:00 - 20:00)</option>
                <option value="evening">Evening (16:00 - 22:00)</option>
                <option value="full_day">Full Day (08:00 - 20:00)</option>
                <option value="custom">Custom Hours</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Start Time</label>
              <input
                type="time"
                value={form.scheduledStartTime}
                onChange={(e) => setForm({ ...form, scheduledStartTime: e.target.value })}
                className="w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">End Time</label>
              <input
                type="time"
                value={form.scheduledEndTime}
                onChange={(e) => setForm({ ...form, scheduledEndTime: e.target.value })}
                className="w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Notes (Optional)</label>
            <input
              placeholder="e.g. On-call duty, Santana branch main counter"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitShift}
              disabled={submitting}
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 shadow-sm flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  Scheduling...
                </>
              ) : isBulkMode ? (
                "Schedule Bulk Shifts ⚡"
              ) : (
                "Save Shift"
              )}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  Loading shifts...
                </td>
              </tr>
            ) : shifts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No shifts scheduled for {dateStr}.
                </td>
              </tr>
            ) : (
              shifts.map((shift) => {
                const staffMember = staff.find((s) => s._id === shift.userId);
                return (
                  <tr key={shift._id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-zinc-900">{staffMember?.name || "Unknown"}</td>
                    <td className="px-3 py-2 capitalize text-zinc-600">{shift.type.replace("_", " ")}</td>
                    <td className="px-3 py-2 text-zinc-600">
                      {shift.scheduledStartTime} - {shift.scheduledEndTime}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{shift.notes || "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => deleteShift(shift._id)} className="text-red-600 hover:underline">
                        Remove
                      </button>
                    </td>
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

