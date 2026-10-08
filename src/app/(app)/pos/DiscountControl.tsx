"use client";

import { useState } from "react";
import { parseNumeric } from "@/lib/numberInput";
import { amountOffFromPercent, formatAmount, formatPercent, percentFromAmountOff } from "@/lib/discount";

// Never more than 25% off without an admin actually logged into this terminal — the
// admin-approval gate for a larger discount reuses the real login/role check rather than
// a new PIN system, same trust model as the wholesale-mode lock elsewhere on this screen.
export const DISCOUNT_APPROVAL_THRESHOLD = 25;

// Per-line discount control — a red stepper that sits beside a price field. A cashier enters
// either ₦ off each unit (default) or a %. Whatever they enter is STORED as a percent, so the
// sale API, sale records, refunds and reports are unchanged. Enforces the >25% admin-approval
// rule right here at the input level, not just on submit, so staff get immediate feedback
// instead of a rejected sale later.
export type DiscountMode = "amount" | "percent";
export const DISCOUNT_MODE_KEY = "psxDiscountMode";
const DISCOUNT_AMOUNT_STEP = 10; // ₦ per +/- tap; any exact amount can be typed

export default function DiscountControl({
  value,
  onChange,
  isAdminSession,
  basePrice,
  mode,
  onModeChange,
}: {
  value: number | undefined; // the stored discount, always a percent
  onChange: (percent: number | undefined) => void;
  isAdminSession: boolean;
  basePrice: number; // price of ONE unit as sold on this line, before any discount
  mode: DiscountMode;
  onModeChange: (mode: DiscountMode) => void;
}) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // what's being typed, so "20." isn't rewritten mid-keystroke

  // ₦ mode needs a price to take money off of; fall back to % if the line has none yet.
  const amountMode = mode === "amount" && basePrice > 0;
  const currentAmount = amountOffFromPercent(basePrice, value);

  function applyPercent(next: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    if (clamped > DISCOUNT_APPROVAL_THRESHOLD && !isAdminSession) {
      onChange(DISCOUNT_APPROVAL_THRESHOLD);
      setBlocked("Over 25% needs an admin logged in on this terminal.");
      return;
    }
    setBlocked(null);
    onChange(clamped === 0 ? undefined : clamped);
  }

  // ₦ off one unit. Stored as the equivalent percent, so the sale API and everything after it
  // behave exactly as before.
  function applyAmount(next: number) {
    const amount = Math.max(0, Math.min(basePrice, next));
    const percent = percentFromAmountOff(basePrice, amount);
    if (percent > DISCOUNT_APPROVAL_THRESHOLD && !isAdminSession) {
      onChange(DISCOUNT_APPROVAL_THRESHOLD);
      setBlocked(
        `Over 25% (₦${formatAmount(amountOffFromPercent(basePrice, DISCOUNT_APPROVAL_THRESHOLD))}) needs an admin logged in on this terminal.`
      );
      return;
    }
    setBlocked(null);
    onChange(percent === 0 ? undefined : percent);
  }

  function step(direction: 1 | -1) {
    setDraft(null);
    if (amountMode) applyAmount(Math.max(0, currentAmount + direction * DISCOUNT_AMOUNT_STEP));
    else applyPercent((value ?? 0) + direction);
  }

  const shown = draft ?? (amountMode ? (currentAmount ? String(currentAmount) : "") : value !== undefined ? formatPercent(value) : "");

  return (
    <div>
      <div className="mb-0.5 flex justify-center gap-0.5 text-[9px] font-bold leading-none">
        {(["amount", "percent"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setDraft(null);
              setBlocked(null);
              onModeChange(m);
            }}
            className={`rounded px-1.5 py-0.5 ${
              mode === m ? "bg-red-600 text-white" : "border border-red-200 text-red-500 hover:bg-red-50"
            }`}
          >
            {m === "amount" ? "₦" : "%"}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-center gap-0.5">
        {amountMode && <span className="shrink-0 text-xs font-bold text-red-600">₦</span>}
        <input
          type="text"
          inputMode={amountMode ? "decimal" : "numeric"}
          value={shown}
          placeholder="0"
          onFocus={(e) => e.target.select()}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            const raw = e.target.value.trim();
            setDraft(raw);
            if (raw === "") {
              onChange(undefined);
              setBlocked(null);
              return;
            }
            const val = parseNumeric(raw);
            if (Number.isNaN(val)) return;
            if (amountMode) applyAmount(val);
            else applyPercent(val);
          }}
          className="w-full min-w-0 rounded border border-red-300 px-1 py-0 h-6 text-center text-xs font-bold text-red-700 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
        />
        {!amountMode && <span className="shrink-0 text-xs font-bold text-red-600">%</span>}
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-0.5">
        <button
          type="button"
          onClick={() => step(-1)}
          className="flex h-5 items-center justify-center rounded border border-red-300 text-xs font-bold leading-none text-red-700 hover:bg-red-50"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          className="flex h-5 items-center justify-center rounded border border-red-300 text-xs font-bold leading-none text-red-700 hover:bg-red-50"
        >
          +
        </button>
      </div>
      {amountMode && !!value && !blocked && (
        <p className="mt-0.5 text-center text-[9px] leading-tight text-red-400">≈ {formatPercent(value)}%</p>
      )}
      {blocked && <p className="mt-0.5 text-[9px] leading-tight text-red-500">{blocked}</p>}
    </div>
  );
}
