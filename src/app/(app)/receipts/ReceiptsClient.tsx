"use client";

import { useEffect, useMemo, useState } from "react";
import ReceiptTemplate, { type ReceiptSale } from "../pos/ReceiptTemplate";

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
  const [daysBack, setDaysBack] = useState(3);

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
                <button
                  onClick={() => reprint(r)}
                  className="shrink-0 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Reprint
                </button>
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
    </div>
  );
}
