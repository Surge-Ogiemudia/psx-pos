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
  const [emptyNotice, setEmptyNotice] = useState(false);

  const scopeParam = scope === "store" ? "storeId" : "branchId";

  async function load(): Promise<StoreTransferJSON[]> {
    if (!scopeId) return [];
    setRefreshing(true);
    let result: StoreTransferJSON[] = [];
    const res = await fetch(`/api/store-transfers/pending?${scopeParam}=${scopeId}`);
    if (res.ok) {
      const data = await res.json();
      result = data.transfers || [];
      setTransfers(result);
      setSelected(new Set());
    }
    setRefreshing(false);
    return result;
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);

  // One click does the contextually right thing: check for pushes, and if there turn out to be
  // any, open straight to the list — no separate "refresh" vs. "view" action to remember. If
  // there's nothing, say so briefly instead of leaving the click looking like it did nothing.
  async function handleClick() {
    const result = await load();
    setExpanded(result.length > 0);
    if (result.length === 0) {
      setEmptyNotice(true);
      setTimeout(() => setEmptyNotice(false), 2500);
    } else {
      setEmptyNotice(false);
    }
  }

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
    const ids = Array.from(selected);
    let totalReceived = 0;
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const res = await fetch("/api/store-transfers/receive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [scopeParam]: scopeId, transferIds: chunk }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage({ type: "error", text: data.error || `Failed after receiving ${totalReceived}` });
          setSubmitting(false);
          await load();
          return;
        }
        totalReceived += (data.received || 0);
      }
      setMessage({ type: "success", text: `Received ${totalReceived} transfer${totalReceived === 1 ? "" : "s"}.` });
    } catch (err) {
      setMessage({ type: "error", text: "Network error during receive" });
    }
    setSubmitting(false);
    await load();
  }

  async function receiveAllItems() {
    setSubmitting(true);
    setMessage(null);
    let totalReceived = 0;
    try {
      while (true) {
        const res = await fetch("/api/store-transfers/receive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [scopeParam]: scopeId, receiveAll: true, limit: 50 }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage({ type: "error", text: data.error || `Failed after receiving ${totalReceived}` });
          break;
        }
        if (!data.received || data.received === 0) {
          if (totalReceived === 0) {
            setMessage({ type: "error", text: "No pending transfers found" });
          } else {
            setMessage({ type: "success", text: `Received all ${totalReceived} transfer${totalReceived === 1 ? "" : "s"}.` });
          }
          break;
        }
        totalReceived += data.received;
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error during bulk pull" });
    }
    setSubmitting(false);
    setExpanded(false);
    await load();
  }

  const hasPending = transfers.length > 0;

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={refreshing}
        title={`Pull for this ${scope} — click to check for incoming pushes`}
        className="flex w-14 flex-col items-center gap-1 disabled:opacity-50"
      >
        <span
          className={`relative flex h-9 w-9 items-center justify-center rounded-md ${
            hasPending ? "bg-amber-500 text-white" : "bg-zinc-100 text-zinc-500"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
              clipRule="evenodd"
            />
          </svg>
          {hasPending && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {transfers.length === 200 ? "200+" : transfers.length}
            </span>
          )}
        </span>
        <span className="text-center text-[10px] font-medium text-zinc-600">Pull</span>
      </button>

      {emptyNotice && !hasPending && (
        <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-zinc-200 bg-white p-2 text-center text-xs text-zinc-600 shadow-lg">
          No push to this {scope} for now.
        </div>
      )}

      {expanded && hasPending && (
        <div className="absolute right-0 top-full z-10 mt-2 w-80 max-h-[80vh] overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm shadow-lg">
          <div className="mb-3 border-b border-amber-200 pb-3">
            <p className="mb-2 text-sm text-zinc-600">You can instantly receive all pending items without reviewing them.</p>
            <button
              onClick={receiveAllItems}
              disabled={submitting}
              className="w-full rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {submitting ? "Receiving All..." : "Bulk Pull (Receive All)"}
            </button>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-amber-900">
              Or review {transfers.length === 200 ? "latest 200" : transfers.length} items:
            </span>
            <button
              onClick={() => {
                if (selected.size === transfers.length) {
                  setSelected(new Set());
                } else {
                  setSelected(new Set(transfers.map((t) => t._id)));
                }
              }}
              className="text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              {selected.size === transfers.length ? "Deselect all" : "Select all"}
            </button>
          </div>
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
