"use client";

import { useEffect, useState } from "react";
import type { PharmacySettingsJSON, ShiftSettingsJSON, BranchJSON } from "@/lib/types";

export default function StaffSettings({ branches }: { branches: BranchJSON[] }) {
  const [settings, setSettings] = useState<PharmacySettingsJSON | null>(null);
  const [saving, setSaving] = useState(false);

  // Biometric Devices
  const [devices, setDevices] = useState<{ _id: string; name: string; serialNumber: string; branchId: string; lastSeen: string | null; lastLog?: string | null }[]>([]);
  const [newDevice, setNewDevice] = useState({ name: "", serialNumber: "", branchId: "" });
  const [savingDevice, setSavingDevice] = useState(false);

  useEffect(() => {
    fetch("/api/pharmacy/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSettings(data);
        }
      });

    fetch("/api/biometric-devices")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setDevices(data));
  }, []);

  async function addDevice() {
    if (!newDevice.name || !newDevice.serialNumber || !newDevice.branchId) {
      alert("Please fill all device fields");
      return;
    }
    setSavingDevice(true);
    const res = await fetch("/api/biometric-devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newDevice),
    });
    setSavingDevice(false);
    if (res.ok) {
      const added = await res.json();
      setDevices([...devices, added]);
      setNewDevice({ name: "", serialNumber: "", branchId: "" });
    } else {
      const data = await res.json();
      alert(data.error || "Failed to add device");
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    await fetch("/api/pharmacy/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    alert("Settings saved successfully!");
  }

  function updateShiftSetting(key: keyof ShiftSettingsJSON, value: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      shiftSettings: {
        ...settings.shiftSettings,
        [key]: value,
      },
    });
  }

  function updateAttendanceSetting(key: "allowWebClockIn", value: boolean) {
    if (!settings) return;
    setSettings({
      ...settings,
      attendanceSettings: {
        ...(settings.attendanceSettings || { allowWebClockIn: true }),
        [key]: value,
      },
    });
  }

  if (!settings) return <div className="text-sm text-zinc-500">Loading settings...</div>;

  const { shiftSettings } = settings;

  return (
    <div className="max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900">Shift Time Presets</h2>
      <p className="mb-6 text-sm text-zinc-600">
        Configure the default start and end times for preset shift blocks. These times will auto-fill when assigning a shift.
      </p>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-zinc-100 pb-4">
          <span className="font-medium text-zinc-800">Morning Shift</span>
          <input
            type="time"
            value={shiftSettings.morningStart || "08:00"}
            onChange={(e) => updateShiftSetting("morningStart", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <input
            type="time"
            value={shiftSettings.morningEnd || "14:00"}
            onChange={(e) => updateShiftSetting("morningEnd", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-zinc-100 pb-4">
          <span className="font-medium text-zinc-800">Afternoon Shift</span>
          <input
            type="time"
            value={shiftSettings.afternoonStart || "14:00"}
            onChange={(e) => updateShiftSetting("afternoonStart", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <input
            type="time"
            value={shiftSettings.afternoonEnd || "20:00"}
            onChange={(e) => updateShiftSetting("afternoonEnd", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-zinc-100 pb-4">
          <span className="font-medium text-zinc-800">Evening Shift</span>
          <input
            type="time"
            value={shiftSettings.eveningStart || "20:00"}
            onChange={(e) => updateShiftSetting("eveningStart", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <input
            type="time"
            value={shiftSettings.eveningEnd || "08:00"}
            onChange={(e) => updateShiftSetting("eveningEnd", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
          <span className="font-medium text-zinc-800">Full Day</span>
          <input
            type="time"
            value={shiftSettings.fullDayStart || "08:00"}
            onChange={(e) => updateShiftSetting("fullDayStart", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <input
            type="time"
            value={shiftSettings.fullDayEnd || "20:00"}
            onChange={(e) => updateShiftSetting("fullDayEnd", e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </div>
      </div>

      <h2 className="mb-4 mt-8 text-lg font-semibold text-zinc-900">Attendance Features</h2>
      <p className="mb-6 text-sm text-zinc-600">
        Control how your staff can clock in and out for their shifts.
      </p>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={settings.attendanceSettings?.allowWebClockIn ?? true}
            onChange={(e) => updateAttendanceSetting("allowWebClockIn", e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-teal-600 focus:ring-teal-600"
          />
          <span className="text-sm font-medium text-zinc-800">
            Enable Web Clock-In Kiosk
          </span>
        </label>
        <p className="ml-7 text-sm text-zinc-500">
          If you have a physical biometric machine (like ZKTeco), you may want to disable the web kiosk so staff are forced to use the physical device.
        </p>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="rounded-lg bg-teal-700 px-6 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className="mt-8 border-t border-zinc-200 pt-8">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">ZKTeco Biometric Devices</h2>
        <p className="mb-6 text-sm text-zinc-600">
          Register ADMS-compatible biometric devices to receive live attendance pushes.
        </p>

        <div className="mb-6 space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          {devices.length === 0 ? (
            <p className="text-sm text-zinc-500">No devices registered yet.</p>
          ) : (
            <div className="space-y-3">
              {devices.map((d) => (
                <div key={d._id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-zinc-800">{d.name}</p>
                      <p className="text-xs text-zinc-500">SN: {d.serialNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-zinc-600">
                        Branch: {branches.find(b => b._id === d.branchId)?.branchName || "Unknown"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "Never"}
                      </p>
                    </div>
                  </div>
                  {d.lastLog && (
                    <div className="mt-2 rounded bg-zinc-800 p-2 text-xs text-green-400 font-mono break-all whitespace-pre-wrap">
                      Last payload received:<br/>{d.lastLog}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
          <h3 className="text-sm font-semibold text-zinc-900">Add New Device</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <input
              type="text"
              placeholder="Device Name (e.g., Front Door)"
              value={newDevice.name}
              onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Serial Number (e.g., TTQ...)"
              value={newDevice.serialNumber}
              onChange={(e) => setNewDevice({ ...newDevice, serialNumber: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
            <select
              value={newDevice.branchId}
              onChange={(e) => setNewDevice({ ...newDevice, branchId: e.target.value })}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">Select Branch</option>
              {branches.map(b => (
                <option key={b._id} value={b._id}>{b.branchName}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              onClick={addDevice}
              disabled={savingDevice}
              className="rounded bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {savingDevice ? "Adding..." : "Add Device"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
