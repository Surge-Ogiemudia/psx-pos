"use client";

import { useCallback, useEffect, useState } from "react";

export type PanelCustomer = { _id: string; name: string; phoneNumber: string; buyerType: string };

type Purchase = {
  id: string;
  source: "pos" | "store";
  date: string;
  receiptNumber: string;
  branch: string;
  total: number;
  items: { name: string; quantity: number; lineTotal: number }[];
};

type Detail = { customer: PanelCustomer; purchaseCount: number; totalSpent: number; purchases: Purchase[] };

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

// Edit a customer's name/phone and see everything they've bought. Replaces the Current Sale
// panel while open; the cart underneath is left alone.
export default function CustomerPanel({
  customerId,
  branchId,
  onClose,
  onSaved,
}: {
  customerId: string;
  branchId: string | null;
  onClose: () => void;
  onSaved: (customer: PanelCustomer) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/pos-customers/${customerId}${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || "Could not load this customer");
        return;
      }
      setDetail(data);
      setName(data.customer.name);
      setPhone(data.customer.phoneNumber);
    } catch {
      setLoadError("Could not reach the server — check the connection and try again.");
    }
  }, [customerId, query]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function save() {
    if (saving || !detail) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/pos-customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phoneNumber: phone, branchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.customer) {
        setDetail({ ...detail, customer: data.customer });
        setName(data.customer.name);
        setPhone(data.customer.phoneNumber);
        setSaveMsg({ type: "ok", text: "Saved" });
        onSaved(data.customer);
      } else {
        setSaveMsg({ type: "error", text: data.error || "Could not save" });
      }
    } catch {
      setSaveMsg({ type: "error", text: "Could not reach the server — check the connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  const dirty = !!detail && (name.trim() !== detail.customer.name || phone.trim() !== detail.customer.phoneNumber);

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto rounded-lg bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Customer</h2>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-teal-700 hover:underline">
          ← Back to sale
        </button>
      </div>

      {loadError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      ) : !detail ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-amber-800">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
            />
            <label className="block text-xs font-semibold uppercase tracking-wider text-amber-800">Phone</label>
            <input
              value={phone}
              inputMode="tel"
              onChange={(e) => setPhone(e.target.value)}
              placeholder="No phone on record"
              className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
            />
            {saveMsg && (
              <p className={`text-xs font-medium ${saveMsg.type === "ok" ? "text-teal-700" : "text-red-600"}`}>{saveMsg.text}</p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || !name.trim()}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <p className="text-[11px] text-zinc-500">Receipts already printed keep the name they had at the time.</p>
          </div>

          <div className="mb-2 mt-4 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">Previous purchases</h3>
            <span className="text-xs text-zinc-500">
              {detail.purchaseCount} {detail.purchaseCount === 1 ? "sale" : "sales"} · {naira(detail.totalSpent)}
            </span>
          </div>
          {detail.purchases.length === 0 ? (
            <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">0 sales yet.</p>
          ) : (
            <ul className="space-y-2">
              {detail.purchases.map((p) => (
                <li key={`${p.source}-${p.id}`} className="rounded-lg border border-zinc-200 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900">
                      {new Date(p.date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      <span className="ml-1.5 text-xs font-normal text-zinc-500">
                        {p.branch}
                        {p.receiptNumber ? ` · #${p.receiptNumber}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-zinc-900">{naira(p.total)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
                    {p.items.map((i, idx) => (
                      <li key={idx} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{i.name}</span>
                        <span className="shrink-0">× {i.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
