"use client";

import { useCallback, useEffect, useState } from "react";
import type { RosterEntryJSON } from "@/lib/types";
import FaceCapture from "@/components/FaceCapture";

type Mode = "pin" | "face";
type Candidate = { userId: string; name: string; method: Mode };
type PunchResult = { action: "clock_in" | "clock_out"; staffName: string; time: string };

function localTimeOfDay(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatTime(iso: string | null): string {
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

const STATUS_COLOR: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-700",
  late: "bg-amber-100 text-amber-700",
  half_day: "bg-orange-100 text-orange-700",
  early_exit: "bg-orange-100 text-orange-700",
  absent: "bg-red-100 text-red-700",
};

export default function ClockInClient({ branchId }: { branchId: string | null }) {
  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [roster, setRoster] = useState<RosterEntryJSON[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadRoster = useCallback(async () => {
    if (!branchId) return;
    const res = await fetch(`/api/clockin/roster?branchId=${branchId}`);
    if (res.ok) setRoster((await res.json()).roster || []);
  }, [branchId]);

  useEffect(() => {
    loadRoster();
    const t = setInterval(loadRoster, 20000);
    return () => clearInterval(t);
  }, [loadRoster]);

  function resetToIdle() {
    setPin("");
    setCandidate(null);
    setError(null);
  }

  async function submitPin() {
    if (!branchId || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clockin/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "pin", pin, branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "PIN not recognized");
        setPin("");
        return;
      }
      setCandidate({ userId: data.userId, name: data.name, method: "pin" });
    } finally {
      setBusy(false);
    }
  }

  async function handleFaceCapture(descriptor: number[]) {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clockin/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "face", descriptor, branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Face not recognized");
        return;
      }
      setCandidate({ userId: data.userId, name: data.name, method: "face" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmPunch() {
    if (!candidate || !branchId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/clockin/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: candidate.userId,
          method: candidate.method,
          branchId,
          localTimeOfDay: localTimeOfDay(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record attendance");
        setCandidate(null);
        return;
      }
      setResult({
        action: data.action,
        staffName: data.staffName,
        time: formatTime(data.action === "clock_in" ? data.attendance.clockInTime : data.attendance.clockOutTime),
      });
      setCandidate(null);
      loadRoster();
      setTimeout(() => setResult(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  if (!branchId) {
    return <div className="text-sm text-zinc-500">Select a branch to use the clock-in kiosk.</div>;
  }

  const onDuty = roster.filter((r) => r.onDuty);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl font-bold tabular-nums text-zinc-900">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-sm text-zinc-500">
            {now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>

        {result && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
            <p className="text-lg font-semibold text-emerald-800">
              {result.action === "clock_in" ? "Clocked in" : "Clocked out"} — {result.staffName}
            </p>
            <p className="text-sm text-emerald-700">at {result.time}</p>
          </div>
        )}

        {candidate ? (
          <div className="mx-auto max-w-sm rounded-lg border border-zinc-200 p-5 text-center">
            <p className="mb-4 text-lg text-zinc-900">
              Is this you, <span className="font-semibold">{candidate.name}</span>?
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={confirmPunch}
                disabled={busy}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                Yes, that&apos;s me
              </button>
              <button
                onClick={resetToIdle}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                No, cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                onClick={() => {
                  setMode("pin");
                  resetToIdle();
                }}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${mode === "pin" ? "bg-white shadow text-zinc-900" : "text-zinc-500"}`}
              >
                PIN
              </button>
              <button
                onClick={() => {
                  setMode("face");
                  resetToIdle();
                }}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${mode === "face" ? "bg-white shadow text-zinc-900" : "text-zinc-500"}`}
              >
                Face
              </button>
            </div>

            {error && <p className="mb-3 text-center text-sm text-red-600">{error}</p>}

            {mode === "pin" ? (
              <div className="mx-auto flex max-w-xs flex-col items-center gap-4">
                <div className="flex gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-3 w-3 rounded-full border border-zinc-400 ${i < pin.length ? "bg-zinc-800" : "bg-transparent"}`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((key) => (
                    <button
                      key={key}
                      disabled={busy}
                      onClick={() => {
                        if (key === "clear") setPin("");
                        else if (key === "back") setPin((p) => p.slice(0, -1));
                        else if (pin.length < 6) setPin((p) => p + key);
                      }}
                      className="h-14 w-14 rounded-lg border border-zinc-300 text-lg font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {key === "clear" ? "C" : key === "back" ? "⌫" : key}
                    </button>
                  ))}
                </div>
                <button
                  onClick={submitPin}
                  disabled={busy || pin.length < 4}
                  className="w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? "Checking…" : "Enter"}
                </button>
              </div>
            ) : (
              <FaceCapture onCapture={handleFaceCapture} busy={busy} captureLabel="Scan my face" />
            )}
          </>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">On duty now ({onDuty.length})</h2>
        <ul className="mb-4 space-y-1.5">
          {onDuty.length === 0 && <li className="text-sm text-zinc-400">Nobody clocked in yet.</li>}
          {onDuty.map((r) => (
            <li key={r.userId} className="flex items-center justify-between text-sm">
              <span className="text-zinc-800">{r.name}</span>
              <span className="text-xs text-zinc-500">since {formatTime(r.clockInTime)}</span>
            </li>
          ))}
        </ul>

        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Today&apos;s roster</h2>
        <ul className="space-y-1.5">
          {roster.length === 0 && <li className="text-sm text-zinc-400">No one scheduled or clocked in today.</li>}
          {roster.map((r) => (
            <li key={r.userId} className="flex items-center justify-between text-sm">
              <span className="text-zinc-800">
                {r.name}
                {!r.wasScheduled && r.clockInTime && (
                  <span className="ml-1 text-xs text-zinc-400">(unscheduled)</span>
                )}
              </span>
              {r.status && (
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
