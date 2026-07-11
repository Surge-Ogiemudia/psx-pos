"use client";

import { useEffect, useState } from "react";
import type { StoreTransferJSON } from "@/lib/types";
import { pluralize } from "@/lib/unitHierarchy";

export default function IncomingBanner({ scope, scopeId }: { scope: "store" | "branch"; scopeId: string | null }) {
  const [transfers, setTransfers] = useState<StoreTransferJSON[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const scopeParam = scope === "store" ? "storeId" : "branchId";

  async function load() {
    if (!scopeId) return;
    setRefreshing(true);
    const res = await fetch(`/api/store-transfers/pending?${scopeParam}=${scopeId}`);
    if (res.ok) {
      const data = await res.json();
      setTransfers(data.transfers || []);
      setSelected(new Set());
    }
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function receiveSelected() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setMessage(null);
    const res = await fetch("/api/store-transfers/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [scopeParam]: scopeId, transferIds: [...selected] }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setMessage({ type: "error", text: data.error || "Failed to receive transfers" });
      return;
    }
    setMessage({ type: "success", text: `Received ${data.received} transfer${data.received === 1 ? "" : "s"}.` });
    await load();
  }

  const hasPending = transfers.length > 0;

  return (
    <div className="relative flex items-center gap-1.5 text-xs text-zinc-500">
      <button
        onClick={() => hasPending && setExpanded((v) => !v)}
        disabled={!hasPending}
        className={hasPending ? "hover:text-zinc-700" : "cursor-default"}
      >
        {transfers.length} push{transfers.length === 1 ? "" : "es"} pending
      </button>
      <button
        onClick={load}
        disabled={refreshing}
        title="Check for new pushes"
        className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
      >
        ↻
      </button>

      {expanded && hasPending && (
        <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left shadow-lg">
          <div className="flex flex-col gap-2">
            {transfers.map((t) => (
              <label
                key={t._id}
                className="flex cursor-pointer items-start gap-3 rounded border border-amber-200 bg-white p-2 text-sm"
              >
                <input type="checkbox" checked={selected.has(t._id)} onChange={() => toggle(t._id)} className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-900">
                      {t.pushedQuantity} {pluralize(t.pushedForm, t.pushedQuantity)} of {t.productName}
                    </span>
                    <span className="text-xs text-zinc-400">{new Date(t.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-zinc-600">₦{t.totalValue.toFixed(2)}</p>
                </div>
              </label>
            ))}
          </div>
          <button
            onClick={receiveSelected}
            disabled={submitting || selected.size === 0}
            className="mt-3 w-full rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Receiving..." : `Receive selected (${selected.size})`}
          </button>
          {message && (
            <p className={`mt-2 text-sm ${message.type === "success" ? "text-teal-700" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
