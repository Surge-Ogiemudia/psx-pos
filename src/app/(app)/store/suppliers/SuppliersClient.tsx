"use client";

import { useEffect, useState } from "react";
import type { SupplierJSON, StoreBatchJSON } from "@/lib/types";
import { pluralize } from "@/lib/unitHierarchy";
import BackButton from "@/components/BackButton";

export default function SuppliersClient() {
  const [suppliers, setSuppliers] = useState<SupplierJSON[]>([]);
  const [selected, setSelected] = useState<SupplierJSON | null>(null);
  const [batches, setBatches] = useState<StoreBatchJSON[]>([]);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers || []));
  }, []);

  async function viewSupplier(supplier: SupplierJSON) {
    setSelected(supplier);
    const res = await fetch(`/api/suppliers/${supplier._id}`);
    const data = await res.json();
    setBatches(data.batches || []);
  }

  if (selected) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900">{selected.name}</h1>
          <button
            onClick={() => setSelected(null)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Back
          </button>
        </div>
        <p className="mb-4 text-sm text-zinc-600">
          ₦{selected.totalSupplyAmount.toFixed(2)} lifetime supplied
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 text-zinc-600">{new Date(batch.receivedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {batch.receivedQuantity} {pluralize(batch.receivedForm, batch.receivedQuantity)} of{" "}
                    {batch.productName}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900">₦{batch.purchaseAmount.toFixed(2)}</td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                    No batches received from this supplier yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackButton fallbackHref="/store" />
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Suppliers</h1>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Lifetime supplied</th>
              <th className="px-3 py-2">Last supply</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2">
                  <button
                    onClick={() => viewSupplier(supplier)}
                    className="font-medium text-teal-700 hover:underline"
                  >
                    {supplier.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-zinc-600">₦{supplier.totalSupplyAmount.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {supplier.lastSupplyAt ? new Date(supplier.lastSupplyAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No suppliers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
