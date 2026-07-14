"use client";

import { useEffect, useState } from "react";
import type { ShiftJSON, StaffJSON, ShiftType } from "@/lib/types";

interface ShiftManagementProps {
  branchId: string | null;
  staff: StaffJSON[];
}

export default function ShiftManagement({ branchId, staff }: ShiftManagementProps) {
  const [shifts, setShifts] = useState<ShiftJSON[]>([]);
  const [dateStr, setDateStr] = useState<string>(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  // New shift form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    date: new Date().toISOString().split("T")[0],
    type: "morning" as ShiftType,
    scheduledStartTime: "08:00",
    scheduledEndTime: "14:00",
    notes: "",
  });

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

  async function createShift() {
    if (!branchId) return;
    const res = await fetch("/api/staff/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, branchId }),
    });
    if (res.ok) {
      setShowForm(false);
      loadShifts();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to create shift");
    }
  }

  async function deleteShift(id: string) {
    if (!confirm("Are you sure you want to delete this shift?")) return;
    const res = await fetch(`/api/staff/shifts/${id}`, { method: "DELETE" });
    if (res.ok) loadShifts();
  }

  const branchStaff = staff.filter((s) => s.branchId === branchId);

  if (!branchId) {
    return <div className="text-sm text-zinc-500">Please select a branch to view shifts.</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-900">Shifts</h2>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          {showForm ? "Cancel" : "Assign shift"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <select
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select staff...</option>
            {branchStaff.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ShiftType })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
            <option value="full_day">Full Day</option>
            <option value="custom">Custom</option>
          </select>
          <input
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
            <span className="text-sm font-medium text-zinc-700">Start Time:</span>
            <input
              type="time"
              value={form.scheduledStartTime}
              onChange={(e) => setForm({ ...form, scheduledStartTime: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1 text-sm"
            />
            <span className="text-sm font-medium text-zinc-700 ml-4">End Time:</span>
            <input
              type="time"
              value={form.scheduledEndTime}
              onChange={(e) => setForm({ ...form, scheduledEndTime: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={createShift}
            className="col-span-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 sm:col-span-4"
          >
            Save shift
          </button>
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
                  No shifts scheduled for this day.
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
