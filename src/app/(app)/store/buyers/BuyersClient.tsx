"use client";

import { useEffect, useState } from "react";
import type { BuyerJSON, BuyerType, StoreSaleJSON } from "@/lib/types";
import { pluralize } from "@/lib/unitHierarchy";

const TYPE_LABEL: Record<BuyerType, string> = {
  distributor: "Distributor",
  wholesaler: "Wholesaler",
  retailer: "Retailer",
};

export default function BuyersClient() {
  const [buyers, setBuyers] = useState<BuyerJSON[]>([]);
  const [filter, setFilter] = useState<BuyerType | "all">("all");
  const [selected, setSelected] = useState<BuyerJSON | null>(null);
  const [sales, setSales] = useState<StoreSaleJSON[]>([]);

  useEffect(() => {
    const params = filter === "all" ? "" : `?type=${filter}`;
    fetch(`/api/buyers${params}`)
      .then((res) => res.json())
      .then((data) => setBuyers(data.buyers || []));
  }, [filter]);

  async function viewBuyer(buyer: BuyerJSON) {
    setSelected(buyer);
    const res = await fetch(`/api/buyers/${buyer._id}`);
    const data = await res.json();
    setSales(data.sales || []);
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
          {TYPE_LABEL[selected.buyerType]} · ₦{selected.totalPurchaseAmount.toFixed(2)} lifetime purchases
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 text-zinc-600">{new Date(sale.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {sale.soldQuantity} {pluralize(sale.soldForm, sale.soldQuantity)} of {sale.productName}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{sale.paymentMethod.replace("_", " ")}</td>
                  <td className="px-3 py-2 font-medium text-zinc-900">₦{sale.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                    No purchases yet.
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
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Buyers</h1>
      <div className="mb-4 flex gap-2">
        {(["all", "distributor", "wholesaler", "retailer"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === t ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
          >
            {t === "all" ? "All" : TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Lifetime purchases</th>
              <th className="px-3 py-2">Last purchase</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => (
              <tr key={buyer._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2">
                  <button onClick={() => viewBuyer(buyer)} className="font-medium text-teal-700 hover:underline">
                    {buyer.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-zinc-600">{TYPE_LABEL[buyer.buyerType]}</td>
                <td className="px-3 py-2 text-zinc-600">₦{buyer.totalPurchaseAmount.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {buyer.lastPurchaseAt ? new Date(buyer.lastPurchaseAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {buyers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No buyers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
