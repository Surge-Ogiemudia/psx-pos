"use client";

import { useEffect, useState } from "react";
import type { ActivityLogJSON } from "@/lib/types";
import BackButton from "@/components/BackButton";

const ACTION_LABEL: Record<string, string> = {
  intake: "Received stock",
  dispense_setting: "Set a price",
  push: "Pushed stock",
  sell: "Sold stock",
  write_off: "Wrote off stock",
  store_created: "Store created",
  buyer_created: "New buyer",
  delete: "Deleted item",
};

export default function HistoryClient({ initialStoreId }: { initialStoreId: string }) {
  const [storeId, setStoreId] = useState(initialStoreId);
  const [entries, setEntries] = useState<ActivityLogJSON[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (storeId) return;
    fetch("/api/stores")
      .then((res) => res.json())
      .then((data) => {
        if (data.stores?.[0]) setStoreId(data.stores[0]._id);
      });
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    fetch(`/api/activity-log?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries || []);
        setLoaded(true);
      });
  }, [storeId]);

  return (
    <div>
      <BackButton fallbackHref={storeId ? `/store?storeId=${storeId}` : "/store"} />
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">History</h1>
      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry._id} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                {ACTION_LABEL[entry.action] || entry.action}
              </span>
              <span className="text-xs text-zinc-400">{new Date(entry.timestamp).toLocaleString()}</span>
            </div>
            <p className="text-sm text-zinc-800">{entry.summary}</p>
          </div>
        ))}
        {loaded && entries.length === 0 && (
          <p className="text-sm text-zinc-500">Nothing has happened at this store yet.</p>
        )}
      </div>
    </div>
  );
}
