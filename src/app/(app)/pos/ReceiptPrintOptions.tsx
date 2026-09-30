"use client";

import { useState } from "react";
import { getReceiptPaper, setReceiptPaper, getReceiptLongMode, setReceiptLongMode, type ReceiptPaper } from "@/lib/receiptPaper";

// The paper-size / long-receipt choice shown before every print — a fresh sale (PosClient's
// "Sale Successful!" prompt) and a reprint (Reports, Receipts) alike, so a till set to 80mm or
// long-receipt mode stays that way for reprints too instead of silently falling back to the
// 58mm default. Reads/writes its own per-device setting (receiptPaper.ts) — no props needed.
export default function ReceiptPrintOptions() {
  const [paper, setPaper] = useState<ReceiptPaper>(() => getReceiptPaper());
  const [longMode, setLongModeState] = useState(() => getReceiptLongMode());

  return (
    <>
      <div className="mb-4 flex items-center justify-center gap-2 text-xs text-zinc-600">
        <span>Receipt paper:</span>
        {(["58", "80"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => {
              setReceiptPaper(w);
              setPaper(w);
            }}
            className={`rounded-full border px-3 py-1 font-semibold ${
              paper === w ? "border-teal-700 bg-teal-700 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            {w}mm
          </button>
        ))}
      </div>
      <label className="mb-4 flex items-center justify-center gap-2 text-xs text-zinc-600">
        <input
          type="checkbox"
          checked={longMode}
          onChange={(e) => {
            setReceiptLongMode(e.target.checked);
            setLongModeState(e.target.checked);
          }}
        />
        Long receipt (wholesale) — for this computer only, use if long receipts print cut into pieces
      </label>
    </>
  );
}
