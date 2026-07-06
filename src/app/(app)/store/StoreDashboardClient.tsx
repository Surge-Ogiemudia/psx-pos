"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoreJSON, StoreProductJSON } from "@/lib/types";
import { describeStock } from "@/lib/unitHierarchy";

export default function StoreDashboardClient({ fixedStoreId }: { fixedStoreId: string | null }) {
  const canSwitch = !fixedStoreId;
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [storeId, setStoreId] = useState<string>(fixedStoreId ?? "");
  const [products, setProducts] = useState<StoreProductJSON[]>([]);
  const [loaded, setLoaded] = useState(!canSwitch);

  useEffect(() => {
    if (!canSwitch) return;
    fetch("/api/stores")
      .then((res) => res.json())
      .then((data) => {
        setStores(data.stores);
        if (data.stores.length > 0) setStoreId(data.stores[0]._id);
        setLoaded(true);
      });
  }, [canSwitch]);

  useEffect(() => {
    if (!storeId) return;
    fetch(`/api/store-products?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => setProducts(data.storeProducts || []));
  }, [storeId]);

  if (canSwitch && loaded && stores.length === 0) {
    return (
      <div>
        <h1 className="mb-3 text-lg font-semibold text-zinc-900">Bulk store</h1>
        <p className="text-sm text-zinc-500">
          No stores have been set up yet. An admin can create one from the Stores page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-zinc-900">Bulk store</h1>
        {canSwitch && stores.length > 1 && (
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            {stores.map((store) => (
              <option key={store._id} value={store._id}>
                {store.storeName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={`/store/intake?storeId=${storeId}`}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Receive stock
        </Link>
        <Link
          href={`/store/push-sell?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Push / Sell
        </Link>
        <Link
          href={`/store/history?storeId=${storeId}`}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          History
        </Link>
        <Link
          href="/store/buyers"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Buyers
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 font-medium text-zinc-900">
                  <Link href={`/store/products/${product._id}/batches`} className="text-teal-700 hover:underline">
                    {product.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {describeStock(product.quantityInStock, product.displayUnitHierarchy, product.baseUnitName)}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No stock received yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
