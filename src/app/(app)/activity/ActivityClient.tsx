"use client";

import { useEffect, useState } from "react";
import type { ActivityLogJSON } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  product_create: "Added product",
  sell: "Sale completed",
  refund: "Refund processed",
};

export default function ActivityClient({ branchId }: { branchId: string | null }) {
  const [entries, setEntries] = useState<ActivityLogJSON[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/activity-log?scope=branch&branchId=${branchId}`)
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries || []);
        setLoaded(true);
      });
  }, [branchId]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Activity</h1>
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
            <p className="mt-1 text-xs text-zinc-500">{entry.actorName}</p>
          </div>
        ))}
        {loaded && entries.length === 0 && (
          <p className="text-sm text-zinc-500">Nothing has happened at this branch yet.</p>
        )}
      </div>
    </div>
  );
}
