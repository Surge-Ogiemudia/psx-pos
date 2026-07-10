"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoreJSON, StoreProductJSON } from "@/lib/types";
import { describeStock } from "@/lib/unitHierarchy";

export default function StoreDashboardClient({
  fixedStoreId,
  canDelete,
}: {
  fixedStoreId: string | null;
  canDelete: boolean;
}) {
  const canSwitch = !fixedStoreId;
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [storeId, setStoreId] = useState<string>(fixedStoreId ?? "");
  const [products, setProducts] = useState<StoreProductJSON[]>([]);
  const [loaded, setLoaded] = useState(!canSwitch);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllCount, setDeleteAllCount] = useState<number | null>(null);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [deleteAllSubmitting, setDeleteAllSubmitting] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);

  function loadProducts() {
    if (!storeId) return;
    fetch(`/api/store-products?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => setProducts(data.storeProducts || []));
  }

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

  useEffect(loadProducts, [storeId]);

  async function openDeleteAllConfirm() {
    setDeleteAllError(null);
    setDeleteAllConfirmText("");
    setDeleteAllCount(null);
    setDeleteAllOpen(true);
    const res = await fetch(`/api/store-products?storeId=${storeId}`);
    if (res.ok) {
      setDeleteAllCount((await res.json()).storeProducts.length);
    } else {
      setDeleteAllError("Couldn't load the current item count — try again.");
    }
  }

  async function confirmDeleteAll() {
    if (deleteAllCount === null || deleteAllConfirmText !== "DELETE") return;
    setDeleteAllSubmitting(true);
    setDeleteAllError(null);
    try {
      const params = new URLSearchParams({ storeId, expectedCount: String(deleteAllCount) });
      const res = await fetch(`/api/store-products?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteAllError(data.error || "Failed to delete this store's items");
        setDeleteAllCount(typeof data.actualCount === "number" ? data.actualCount : deleteAllCount);
        setDeleteAllConfirmText("");
        return;
      }
      setDeleteAllOpen(false);
      loadProducts();
    } finally {
      setDeleteAllSubmitting(false);
    }
  }

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
          href={`/store/intake/bulk?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Bulk receive
        </Link>
        <Link
          href={`/store/push-sell?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Push / Sell
        </Link>
        <Link
          href={`/store/push-sell/bulk?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Bulk push
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
              <th className="px-3 py-2">Item name</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 font-medium text-zinc-900">
                  <Link
                    href={`/store/products/${product._id}/batches?storeId=${storeId}`}
                    className="text-teal-700 hover:underline"
                  >
                    {product.itemName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-600">{product.brand}</td>
                <td className="px-3 py-2 text-zinc-600">{product.size}</td>
                <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {describeStock(product.quantityInStock, product.displayUnitHierarchy, product.baseUnitName)}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No stock received yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canDelete && storeId && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-red-900">Danger zone</h2>
          <p className="mb-3 text-sm text-red-800">
            Permanently delete every item in this store — all batches, stock, and price settings go with it.
            This cannot be undone.
          </p>
          {!deleteAllOpen ? (
            <button
              onClick={openDeleteAllConfirm}
              className="rounded-lg border border-red-600 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Delete all items in this store
            </button>
          ) : (
            <div className="rounded border border-red-300 bg-white p-3">
              {deleteAllCount === null ? (
                <p className="text-sm text-zinc-600">Checking the current item count...</p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-zinc-800">
                    This will permanently delete <strong>{deleteAllCount}</strong> item
                    {deleteAllCount === 1 ? "" : "s"} from this store, along with their batches and price
                    settings. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <input
                    type="text"
                    value={deleteAllConfirmText}
                    onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="mb-2 w-full max-w-xs rounded border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                </>
              )}
              {deleteAllError && <p className="mb-2 text-sm text-red-600">{deleteAllError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={confirmDeleteAll}
                  disabled={deleteAllCount === null || deleteAllConfirmText !== "DELETE" || deleteAllSubmitting}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {deleteAllSubmitting
                    ? "Deleting..."
                    : deleteAllCount === null
                    ? "Loading..."
                    : `Permanently delete ${deleteAllCount} item${deleteAllCount === 1 ? "" : "s"}`}
                </button>
                <button
                  onClick={() => setDeleteAllOpen(false)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
