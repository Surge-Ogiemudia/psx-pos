"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { StoreBatchJSON, StoreProductJSON } from "@/lib/types";
import { pluralize } from "@/lib/unitHierarchy";
import BackButton from "@/components/BackButton";

export default function BatchListClient({ storeProductId }: { storeProductId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeId = searchParams.get("storeId") ?? "";
  const [product, setProduct] = useState<StoreProductJSON | null>(null);
  const [batches, setBatches] = useState<StoreBatchJSON[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [editForm, setEditForm] = useState({
    itemName: "",
    brand: "",
    size: "",
    category: "medicine",
  });
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!storeId) {
      const timeout = setTimeout(() => {
        setError("No store selected — go back to the Bulk Store dashboard and open this item from there.");
        setLoaded(true);
      }, 0);
      return () => clearTimeout(timeout);
    }
    async function load() {
      const [prodRes, batchRes] = await Promise.all([
        fetch(`/api/store-products/${storeProductId}?storeId=${storeId}`),
        fetch(`/api/store-products/${storeProductId}/batches?storeId=${storeId}`)
      ]);

      if (prodRes.ok) {
        const data = await prodRes.json();
        setProduct(data.product);
        setEditForm({
          itemName: data.product.itemName,
          brand: data.product.brand,
          size: data.product.size,
          category: data.product.category,
        });
      } else {
        const data = await prodRes.json().catch(() => ({}));
        setError(data.error || "Failed to load this item.");
      }

      if (batchRes.ok) {
        const data = await batchRes.json();
        setBatches(data.batches);
      }

      setLoaded(true);
    }
    load();
  }, [storeProductId, storeId]);

  async function saveEdit() {
    setError(null);
    if (!editForm.itemName.trim()) return setError("Item name is required.");
    if (!editForm.brand.trim()) return setError("Brand is required.");
    if (!editForm.size.trim()) return setError("Size is required.");

    const res = await fetch(`/api/store-products/${storeProductId}?storeId=${storeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (res.ok) {
      setProduct(data.product);
      setIsEditing(false);
    } else {
      setError(data.error || "Failed to update item.");
    }
  }

  async function deleteItem() {
    const stockWarning =
      product && product.quantityInStock > 0
        ? ` It currently has ${product.quantityInStock} ${product.baseUnitName} in stock across ${batches.length} batch${batches.length === 1 ? "" : "es"} — deleting it discards that stock permanently, with no write-off record.`
        : "";
    if (!confirm(`Are you sure you want to delete this product? This cannot be undone.${stockWarning}`)) return;
    setIsDeleting(true);
    const res = await fetch(`/api/store-products/${storeProductId}?storeId=${storeId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      router.push("/store");
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete item.");
      setIsDeleting(false);
    }
  }

  return (
    <div>
      <BackButton fallbackHref={storeId ? `/store?storeId=${storeId}` : "/store"} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {product && !isEditing ? (
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              {product.itemName}
            </h1>
            <p className="text-sm text-zinc-500">
              {product.brand} • {product.size} • {product.category}
            </p>
          </div>
        ) : product && isEditing ? (
          <div className="flex-1 max-w-lg">
            <h1 className="mb-3 text-lg font-semibold text-zinc-900">Edit item details</h1>
          </div>
        ) : loaded && error ? (
          <h1 className="text-xl font-bold text-red-600">{error}</h1>
        ) : (
          <h1 className="text-xl font-bold text-zinc-900">Loading...</h1>
        )}

        {product && !isEditing && (
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Edit item
            </button>
            <button
              onClick={deleteItem}
              disabled={isDeleting}
              title={product.quantityInStock > 0 ? "This item still has stock — deleting discards it" : ""}
              className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Delete item
            </button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mb-6 max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          
          <label className="mb-1 block text-sm font-medium text-zinc-700">Item name</label>
          <input
            value={editForm.itemName}
            onChange={(e) => setEditForm({ ...editForm, itemName: e.target.value })}
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />

          <label className="mb-1 block text-sm font-medium text-zinc-700">Brand</label>
          <input
            value={editForm.brand}
            onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />

          <label className="mb-1 block text-sm font-medium text-zinc-700">Size</label>
          <input
            value={editForm.size}
            onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />

          <label className="mb-1 block text-sm font-medium text-zinc-700">Category</label>
          <select
            value={editForm.category}
            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            className="mb-4 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="supermarket">Supermarket</option>
            <option value="medicine">Medicine</option>
            <option value="non-medicine">Non-medicine</option>
          </select>

          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              className="rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              Save changes
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setError(null);
                if (product) {
                  setEditForm({
                    itemName: product.itemName,
                    brand: product.brand,
                    size: product.size,
                    category: product.category,
                  });
                }
              }}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2 className="mb-3 mt-6 text-base font-semibold text-zinc-900">Batches</h2>
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
