"use client";

import { useEffect, useMemo, useState } from "react";
import ReceiptTemplate, { type ReceiptSale } from "../pos/ReceiptTemplate";
import ReceiptPrintOptions from "../pos/ReceiptPrintOptions";
import { setPosResume } from "@/lib/posResume";

export default function ReceiptsClient({
  branchId,
  pharmacyName,
  branchName,
  branchAddress,
}: {
  branchId: string | null;
  pharmacyName: string;
  branchName: string;
  branchAddress: string;
}) {
  const [receipts, setReceipts] = useState<ReceiptSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [printing, setPrinting] = useState<ReceiptSale | null>(null);
  const [confirmSale, setConfirmSale] = useState<ReceiptSale | null>(null);
  const [daysBack, setDaysBack] = useState(3);

  // Return Sale — same-day only; an earlier sale isn't offered this button at all.
  const [returnConfirmSale, setReturnConfirmSale] = useState<ReceiptSale | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  function isToday(iso: string): boolean {
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  async function confirmReturnSale() {
    if (!returnConfirmSale || returning) return;
    setReturning(true);
    setReturnError(null);
    try {
      const res = await fetch(`/api/sales/${returnConfirmSale._id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not return this sale");
      setPosResume(data.items);
      window.location.href = "/pos";
    } catch (e) {
      setReturnError(e instanceof Error ? e.message : "Could not return this sale");
      setReturning(false);
    }
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (branchId) params.set("branchId", branchId);
        const res = await fetch(`/api/receipts?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load receipts");
        if (!dead) {
          setReceipts(data.receipts);
          setDaysBack(data.daysBack ?? 3);
        }
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "Could not load receipts");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [branchId]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return receipts;
    return receipts.filter(
      (r) =>
        String(r.receiptNumber).toLowerCase().includes(t) ||
        (r.userName ?? "").toLowerCase().includes(t) ||
        r.items.some((i) => i.productName.toLowerCase().includes(t))
    );
  }, [receipts, q]);

  function reprint(r: ReceiptSale) {
    setPrinting(r);
    setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 500);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold text-zinc-900">Receipts</h1>
      <p className="mb-3 text-sm text-zinc-500">
        Find a sale from today or the last {daysBack} days and reprint its receipt.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search receipt number, item or cashier…"
        className="mb-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
      />

      {loading && <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!loading && !error && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">No receipts found.</p>
      )}

      <div className="space-y-2">
        {shown.map((r) => {
          const open = openId === r._id;
          return (
            <div key={r._id} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => setOpenId(open ? null : r._id)} className="min-w-0 flex-1 text-left">
                  <div className="text-sm font-semibold text-zinc-900">
                    #{r.receiptNumber} · ₦{r.totalAmount.toLocaleString()}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {new Date(r.timestamp).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {r.userName || "—"} · {r.items.length} item{r.items.length === 1 ? "" : "s"}
                  </div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => setConfirmSale(r)}
                    className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
                  >
                    Reprint
                  </button>
                  {isToday(r.timestamp) && (
                    <button
                      onClick={() => setReturnConfirmSale(r)}
                      className="text-xs font-semibold text-red-600 hover:text-red-800 hover:underline"
                    >
                      Return Sale
                    </button>
                  )}
                </div>
              </div>
              {open && (
                <ul className="mt-2 border-t border-zinc-100 pt-2 text-sm text-zinc-700">
                  {r.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {i.quantity} × {i.productName}
                      </span>
                      <span>₦{i.lineTotal.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {printing && (
        <ReceiptTemplate
          sale={printing}
          pharmacyName={pharmacyName}
          branchName={branchName}
          branchAddress={branchAddress}
        />
      )}

      {confirmSale && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setConfirmSale(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-zinc-900">Reprint receipt #{confirmSale.receiptNumber}</h2>
            <p className="mb-6 text-sm text-zinc-500">Check the printer settings, then print.</p>
            <ReceiptPrintOptions />
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const sale = confirmSale;
                  setConfirmSale(null);
                  reprint(sale);
                }}
                className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"
              >
                Print
              </button>
              <button
                onClick={() => setConfirmSale(null)}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {returnConfirmSale && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => !returning && setReturnConfirmSale(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-zinc-900">Return sale #{returnConfirmSale.receiptNumber}?</h2>
            <p className="mb-4 text-sm text-zinc-500">This will:</p>
            <ul className="mb-5 list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
              <li>
                Remove <b>₦{returnConfirmSale.totalAmount.toFixed(2)}</b> from today&apos;s sales total
              </li>
              <li>
                Put all <b>{returnConfirmSale.items.length}</b> item{returnConfirmSale.items.length === 1 ? "" : "s"} back in
                stock
              </li>
              <li>Make receipt #{returnConfirmSale.receiptNumber} invalid — any printed copy no longer matches</li>
              <li>Take you to the cart with those items loaded, ready to edit and resell</li>
            </ul>
            {returnError && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{returnError}</p>
            )}
            <div className="flex flex-col gap-3">
              <button
                onClick={confirmReturnSale}
                disabled={returning}
                className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {returning ? "Returning…" : "Yes, return this sale"}
              </button>
              <button
                onClick={() => setReturnConfirmSale(null)}
                disabled={returning}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
