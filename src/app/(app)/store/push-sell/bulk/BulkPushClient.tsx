"use client";

import { useEffect, useState } from "react";
import { formatProductLabel, type StoreJSON, type StoreProductJSON } from "@/lib/types";
import type { BranchOption } from "@/lib/branchScope";
import { describeStock } from "@/lib/unitHierarchy";
import { parseNumeric } from "@/lib/numberInput";
import BackButton from "@/components/BackButton";

type Step = "destination" | "select" | "confirm" | "results";
type DestinationType = "store" | "branch";

interface RowState {
  checked: boolean;
  quantity: string;
}

interface PushResult {
  storeProductId: string;
  error?: string;
  totalValue?: number;
  batchesInvolved?: number;
}

export default function BulkPushClient({ initialStoreId }: { initialStoreId: string }) {
  const [storeId] = useState(initialStoreId);
  const [step, setStep] = useState<Step>("destination");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [destinationType, setDestinationType] = useState<DestinationType>("branch");
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [destinationId, setDestinationId] = useState("");

  const [products, setProducts] = useState<StoreProductJSON[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const [results, setResults] = useState<PushResult[]>([]);
  const [pushedCount, setPushedCount] = useState(0);

  useEffect(() => {
    if (!storeId) return;
    fetch("/api/branches")
      .then((res) => res.json())
      .then((data) => setBranches(data.branches || []));
    fetch("/api/stores")
      .then((res) => res.json())
      .then((data) => setStores((data.stores || []).filter((s: StoreJSON) => s._id !== storeId)));
  }, [storeId]);

  async function switchDestinationType(type: DestinationType) {
    setDestinationType(type);
    setDestinationId("");
  }

  function goToSelect() {
    if (!destinationId) {
      setError("Choose a destination first.");
      return;
    }
    setError(null);
    fetch(`/api/store-products?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => {
        const list: StoreProductJSON[] = (data.storeProducts || []).filter(
          (p: StoreProductJSON) => p.quantityInStock > 0
        );
        setProducts(list);
        const initial: Record<string, RowState> = {};
        list.forEach((p) => {
          initial[p._id] = { checked: false, quantity: String(p.quantityInStock) };
        });
        setRows(initial);
        setStep("select");
      });
  }

  function toggleRow(id: string) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], checked: !prev[id].checked } }));
  }

  function setRowQuantity(id: string, quantity: string) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], quantity } }));
  }

  function selectAll() {
    setRows((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        next[id] = { ...next[id], checked: true };
      });
      return next;
    });
  }

  function clearAll() {
    setRows((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        next[id] = { ...next[id], checked: false };
      });
      return next;
    });
  }

  const selectedProducts = products.filter((p) => rows[p._id]?.checked);

  function goToConfirm() {
    setError(null);
    if (selectedProducts.length === 0) {
      setError("Select at least one item to push.");
      return;
    }
    for (const p of selectedProducts) {
      const qty = parseNumeric(rows[p._id].quantity);
      if (!Number.isFinite(qty) || qty < 1) {
        setError(`${formatProductLabel(p)}: quantity must be at least 1.`);
        return;
      }
    }
    setStep("confirm");
  }

  async function submitBulkPush() {
    setSubmitting(true);
    setError(null);
    const items = selectedProducts.map((p) => ({
      storeProductId: p._id,
      form: p.baseUnitName,
      quantity: parseNumeric(rows[p._id].quantity),
    }));
    const res = await fetch("/api/store-transfers/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        destinationType,
        toStoreId: destinationType === "store" ? destinationId : undefined,
        toBranchId: destinationType === "branch" ? destinationId : undefined,
        items,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok && !data.pushed) {
      setError(data.error || "Bulk push failed.");
      return;
    }
    setResults(data.results || []);
    setPushedCount(data.pushed || 0);
    setStep("results");
  }

  function labelFor(storeProductId: string): string {
    const product = products.find((p) => p._id === storeProductId);
    return product ? formatProductLabel(product) : storeProductId;
  }

  if (step === "destination") {
    return (
      <div>
        <BackButton fallbackHref={storeId ? `/store/push-sell?storeId=${storeId}` : "/store"} />
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Bulk push</h1>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => switchDestinationType("branch")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${destinationType === "branch" ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
          >
            Retail branch
          </button>
          <button
            onClick={() => switchDestinationType("store")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${destinationType === "store" ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
          >
            Sister store
          </button>
        </div>

        <select
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          className="mb-3 w-full max-w-sm rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Select a destination...</option>
          {destinationType === "store"
            ? stores.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.storeName}
                </option>
              ))
            : branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.branchName}
                </option>
              ))}
        </select>

        <div>
          <button
            onClick={goToSelect}
            disabled={!destinationId}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step === "select") {
    return (
      <div>
        <h1 className="mb-2 text-lg font-semibold text-zinc-900">Select items to push</h1>
        <p className="mb-3 text-sm text-zinc-500">
          Each item defaults to its full remaining stock, pushed in its base unit — edit any quantity below, or
          uncheck items you don&apos;t want to include.
        </p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="mb-3 flex gap-2">
          <button onClick={selectAll} className="text-sm font-medium text-teal-700 hover:underline">
            Select all
          </button>
          <button onClick={clearAll} className="text-sm font-medium text-zinc-500 hover:underline">
            Clear all
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">In stock</th>
                <th className="px-3 py-2">Quantity to push</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rows[product._id]?.checked ?? false}
                      onChange={() => toggleRow(product._id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900">{formatProductLabel(product)}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {describeStock(product.quantityInStock, product.displayUnitHierarchy, product.baseUnitName)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={rows[product._id]?.quantity ?? ""}
                      onChange={(e) => setRowQuantity(product._id, e.target.value)}
                      disabled={!rows[product._id]?.checked}
                      className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50"
                    />{" "}
                    <span className="text-xs text-zinc-500">{product.baseUnitName}</span>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                    No stock to push.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={goToConfirm}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Review ({selectedProducts.length} selected)
          </button>
          <button
            onClick={() => setStep("destination")}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Confirm bulk push</h1>
        <p className="mb-3 text-sm text-zinc-700">
          Pushing <strong>{selectedProducts.length}</strong> item{selectedProducts.length === 1 ? "" : "s"} to{" "}
          <strong>
            {destinationType === "store"
              ? stores.find((s) => s._id === destinationId)?.storeName
              : branches.find((b) => b._id === destinationId)?.branchName}
          </strong>
          .
        </p>
        <div className="mb-4 max-h-64 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
          {selectedProducts.map((p) => (
            <div key={p._id} className="flex justify-between border-b border-zinc-200 py-1 last:border-0">
              <span>{formatProductLabel(p)}</span>
              <span className="text-zinc-500">
                {rows[p._id].quantity} {p.baseUnitName}
              </span>
            </div>
          ))}
        </div>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setStep("select")}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Edit
          </button>
          <button
            onClick={submitBulkPush}
            disabled={submitting}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Pushing..." : "Confirm push"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Bulk push results</h1>
      <p className="mb-3 text-sm text-teal-700">
        Pushed {pushedCount} of {results.length} item{results.length === 1 ? "" : "s"} successfully — awaiting
        receipt at the destination.
      </p>
      {results.some((r) => r.error) && (
        <ul className="mb-4 list-disc pl-5 text-sm text-red-600">
          {results
            .filter((r) => r.error)
            .map((r) => (
              <li key={r.storeProductId}>
                {labelFor(r.storeProductId)}: {r.error}
              </li>
            ))}
        </ul>
      )}
      <a href={storeId ? `/store?storeId=${storeId}` : "/store"} className="text-sm font-medium text-teal-700 hover:underline">
        Back to Bulk Store
      </a>
    </div>
  );
}
