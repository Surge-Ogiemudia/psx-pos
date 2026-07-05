"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoreBatchJSON } from "@/lib/types";
import { pluralize } from "@/lib/unitHierarchy";

export default function BatchListClient({ storeProductId }: { storeProductId: string }) {
  const [batches, setBatches] = useState<StoreBatchJSON[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/store-products/${storeProductId}/batches`);
      if (res.ok) setBatches((await res.json()).batches);
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timeout);
  }, [storeProductId]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Batches</h1>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Remaining</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Expiry</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 text-zinc-600">
                  {batch.receivedQuantity} {pluralize(batch.receivedForm, batch.receivedQuantity)} (₦
                  {batch.purchaseAmount.toFixed(2)})
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {batch.remainingBaseUnitQuantity} pieces
                </td>
                <td className="px-3 py-2 text-zinc-600">₦{batch.purchaseUnitCost.toFixed(2)}/piece</td>
                <td className="px-3 py-2 text-zinc-600">{batch.expiryDate ? batch.expiryDate.slice(0, 10) : "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/store/batches/${batch._id}/dispense`} className="text-teal-700 hover:underline">
                    Set prices
                  </Link>
                </td>
              </tr>
            ))}
            {loaded && batches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No batches yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
