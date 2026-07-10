"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DispenseChannel, DispenseSettingJSON, StoreBatchJSON } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { describeBreakdown } from "@/lib/unitHierarchy";
import { parseNumeric } from "@/lib/numberInput";

const CHANNELS: DispenseChannel[] = ["sister_store", "branch", "distributor", "wholesaler", "retailer"];

interface RowState {
  priceForm: string;
  priceAmount: string;
  saved: boolean;
  catalogUpdated: number | null;
  error: string | null;
  saving: boolean;
}

export default function DispenseSettingClient({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<StoreBatchJSON | null>(null);
  const [rows, setRows] = useState<Record<DispenseChannel, RowState>>({} as Record<DispenseChannel, RowState>);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/store-batches/${batchId}/dispense-settings`);
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data: { batch: StoreBatchJSON; settings: DispenseSettingJSON[] } = await res.json();
      setBatch(data.batch);

      const initialRows = {} as Record<DispenseChannel, RowState>;
      for (const channel of CHANNELS) {
        const existing = data.settings.find((s) => s.channel === channel);
        if (existing) {
          initialRows[channel] = {
            priceForm: existing.priceForm,
            priceAmount: String(existing.priceAmount),
            saved: true,
            catalogUpdated: null,
            error: null,
            saving: false,
          };
        } else if (channel === "sister_store") {
          // No markup by default for sister-store transfers — same as purchase amount.
          initialRows[channel] = {
            priceForm: data.batch.receivedForm,
            priceAmount: String(data.batch.purchaseAmount),
            saved: false,
            catalogUpdated: null,
            error: null,
            saving: false,
          };
        } else {
          initialRows[channel] = {
            priceForm: data.batch.unitHierarchy[0]?.unitName ?? "",
            priceAmount: "",
            saved: false,
            catalogUpdated: null,
            error: null,
            saving: false,
          };
        }
      }
      setRows(initialRows);
      setLoading(false);
    }, 0);
    return () => clearTimeout(timeout);
  }, [batchId]);

  function updateRow(channel: DispenseChannel, changes: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [channel]: { ...prev[channel], ...changes, saved: false, catalogUpdated: null } }));
  }

  async function saveChannel(channel: DispenseChannel) {
    const row = rows[channel];
    updateRow(channel, { saving: true, error: null });

    const amount = parseNumeric(row.priceAmount);
    if (!row.priceForm || !Number.isFinite(amount) || amount < 0) {
      updateRow(channel, { saving: false, error: "Enter a valid unit and a non-negative amount." });
      return;
    }

    const res = await fetch(`/api/store-batches/${batchId}/dispense-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, priceForm: row.priceForm, priceAmount: amount }),
    });
    const data = await res.json();
    if (!res.ok) {
      updateRow(channel, { saving: false, error: data.error || "Failed to save" });
      return;
    }
    setRows((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], saving: false, saved: true, catalogUpdated: data.catalogUpdated ?? null, error: null },
    }));
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>;
  if (!batch) return <p className="text-sm text-red-600">Batch not found.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">
          Set prices — {batch.productName}
        </h1>
        <Link
          href={`/store?storeId=${batch.storeId}`}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Done
        </Link>
      </div>

      <p className="mb-4 text-sm text-zinc-600">
        Received {batch.receivedQuantity} {batch.receivedForm}
        {batch.receivedQuantity === 1 ? "" : "s"} for ₦{batch.purchaseAmount.toFixed(2)}. Set what this batch is
        pushed or sold for on each channel below.
      </p>

      <div className="flex flex-col gap-4">
        {CHANNELS.map((channel) => {
          const row = rows[channel];
          if (!row) return null;
          let breakdown = null;
          try {
            const amount = parseNumeric(row.priceAmount);
            if (row.priceForm && Number.isFinite(amount)) {
              breakdown = describeBreakdown(batch.unitHierarchy, row.priceForm, 1, amount);
            }
          } catch {
            breakdown = null;
          }

          return (
            <div key={channel} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">{CHANNEL_LABEL[channel]}</h2>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-600">Amount for 1</span>
                <select
                  value={row.priceForm}
                  onChange={(e) => updateRow(channel, { priceForm: e.target.value })}
                  className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  {batch.unitHierarchy.map((level) => (
                    <option key={level.unitName} value={level.unitName}>
                      {level.unitName}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-zinc-600">=</span>
                <span className="text-sm text-zinc-600">₦</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.priceAmount}
                  onChange={(e) => updateRow(channel, { priceAmount: e.target.value })}
                  className="w-28 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => saveChannel(channel)}
                  disabled={row.saving}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {row.saving ? "Saving..." : row.saved ? "Saved" : "Save"}
                </button>
              </div>
              {row.error && <p className="text-sm text-red-600">{row.error}</p>}
              {breakdown && <p className="text-xs text-zinc-500">{breakdown.summarySentence}</p>}
              {(channel === "branch" || channel === "distributor" || channel === "wholesaler") &&
                row.catalogUpdated !== null && (
                <p className="text-xs text-teal-700">
                  {row.catalogUpdated > 0
                    ? `Updated ${row.catalogUpdated} branch catalog entr${row.catalogUpdated === 1 ? "y" : "ies"} to match, instantly — no push needed.`
                    : "No branch has this item yet, so nothing to update there — it'll apply automatically once one does."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
