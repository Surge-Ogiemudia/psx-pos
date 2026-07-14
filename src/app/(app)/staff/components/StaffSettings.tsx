"use client";

import { useEffect, useState } from "react";
import type { PharmacySettingsJSON, ShiftSettingsJSON } from "@/lib/types";

export default function StaffSettings() {
  const [settings, setSettings] = useState<PharmacySettingsJSON | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/pharmacy/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSettings(data);
        }
      });
  }, []);

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

      <div className="mt-6 flex justify-end">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
