"use client";

import { useState } from "react";
import FaceCapture from "@/components/FaceCapture";
import type { StaffCredentialStatusJSON } from "@/lib/types";

interface StaffCredentialsModalProps {
  userId: string;
  name: string;
  branchId?: string | null;
  status: StaffCredentialStatusJSON | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export default function StaffCredentialsModal({ userId, name, branchId, status, onClose, onSaved }: StaffCredentialsModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name, branchId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setMessage(successMessage);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4-6 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    await save({ pin }, "PIN saved");
    setPin("");
    setConfirmPin("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">Clock-in credentials — {name}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            ✕
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mb-3 text-sm text-emerald-600">{message}</p>}

        <div className="mb-5 border-b border-zinc-200 pb-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-700">
            PIN {status?.hasPin && <span className="text-xs text-emerald-600">(set)</span>}
          </h3>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              inputMode="numeric"
              placeholder="New PIN (4-6 digits)"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="Confirm PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={savePin}
              disabled={busy}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              Save PIN
            </button>
            {status?.hasPin && (
              <button
                onClick={() => save({ clear: "pin" }, "PIN cleared")}
                disabled={busy}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-red-600 hover:bg-zinc-50"
              >
                Clear PIN
              </button>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-700">
            Face {status?.hasFace && <span className="text-xs text-emerald-600">(enrolled)</span>}
          </h3>
          {showFaceCapture ? (
            <FaceCapture
              busy={busy}
              captureLabel={status?.hasFace ? "Re-scan face" : "Capture face"}
              onCapture={async (descriptor) => {
                await save({ faceDescriptor: descriptor }, "Face enrolled");
                setShowFaceCapture(false);
              }}
            />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowFaceCapture(true)}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                {status?.hasFace ? "Re-enroll face" : "Enroll face"}
              </button>
              {status?.hasFace && (
                <button
                  onClick={() => save({ clear: "face" }, "Face data cleared")}
                  disabled={busy}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-red-600 hover:bg-zinc-50"
                >
                  Clear face
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
