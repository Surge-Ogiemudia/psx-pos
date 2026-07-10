"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ProductJSON, ProductBatchJSON } from "@/lib/types";
import { formatProductLabel } from "@/lib/types";
import { getExpiryStatus, EXPIRY_ROW_CLASS, EXPIRY_TEXT_CLASS } from "@/lib/expiry";
import BackButton from "@/components/BackButton";

export default function BatchListClient({ productId }: { productId: string }) {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branchId") ?? "";
  const [product, setProduct] = useState<ProductJSON | null>(null);
  const [batches, setBatches] = useState<ProductBatchJSON[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const params = branchId ? `?branchId=${branchId}` : "";
      const [prodRes, batchRes] = await Promise.all([
        fetch(`/api/products/${productId}${params}`),
        fetch(`/api/products/${productId}/batches${params}`),
      ]);

      if (prodRes.ok) {
        setProduct((await prodRes.json()).product);
      } else {
        const data = await prodRes.json().catch(() => ({}));
        setError(data.error || "Failed to load this product.");
      }

      if (batchRes.ok) {
        setBatches((await batchRes.json()).batches);
      }

      setLoaded(true);
    }
    load();
  }, [productId, branchId]);

  const trackedTotal = batches.reduce((sum, b) => sum + b.remainingQuantity, 0);
  const untracked = product ? Math.max(0, product.quantityInStock - trackedTotal) : 0;

  return (
    <div>
      <BackButton fallbackHref={branchId ? `/products?branchId=${branchId}` : "/products"} />
      <div className="mb-4">
        {product ? (
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{formatProductLabel(product)}</h1>
            <p className="text-sm text-zinc-500">
              {product.category} • {product.quantityInStock} in stock
            </p>
          </div>
        ) : loaded && error ? (
          <h1 className="text-xl font-bold text-red-600">{error}</h1>
        ) : (
          <h1 className="text-xl font-bold text-zinc-900">Loading...</h1>
        )}
      </div>

      {untracked > 0 && (
        <p className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm text-zinc-600">
          {untracked} of the {product?.quantityInStock} in stock {untracked === 1 ? "isn't" : "aren't"} tied to a
          batch below — stock added before batch tracking started, or adjusted directly, has no batch record.
        </p>
      )}

      <h2 className="mb-3 mt-6 text-base font-semibold text-zinc-900">Batches</h2>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Remaining</th>
              <th className="px-3 py-2">Batch number</th>
              <th className="px-3 py-2">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const expiryStatus = getExpiryStatus(batch.expiryDate);
              return (
                <tr
                  key={batch._id}
                  className={`border-b border-zinc-100 last:border-0 ${EXPIRY_ROW_CLASS[expiryStatus.level]}`}
                >
                  <td className="px-3 py-2 text-zinc-600">{new Date(batch.receivedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {batch.remainingQuantity} / {batch.quantity}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{batch.batchNumber || "—"}</td>
                  <td className={`px-3 py-2 ${EXPIRY_TEXT_CLASS[expiryStatus.level]}`}>
                    {batch.expiryDate ? batch.expiryDate.slice(0, 10) : "—"}
                    {expiryStatus.label && <div className="text-xs">{expiryStatus.label}</div>}
                  </td>
                </tr>
              );
            })}
            {loaded && batches.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No batches recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
