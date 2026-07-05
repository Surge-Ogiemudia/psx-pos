"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeBreakdown, pluralize, type UnitLevel } from "@/lib/unitHierarchy";
import type { ProductCategory } from "@/lib/types";

interface LevelForm {
  unitName: string;
  unitsPerParent: string;
}

const emptyLevels: LevelForm[] = [
  { unitName: "carton", unitsPerParent: "1" },
  { unitName: "piece", unitsPerParent: "1" },
];

export default function IntakeClient({ initialStoreId }: { initialStoreId: string }) {
  const router = useRouter();
  const [storeId] = useState(initialStoreId);
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("supermarket");
  const [levels, setLevels] = useState<LevelForm[]>(emptyLevels);
  const [receivedForm, setReceivedForm] = useState("carton");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addLevel() {
    // Insert before the last level, since the last level is always the base unit.
    setLevels((prev) => [...prev.slice(0, -1), { unitName: "", unitsPerParent: "1" }, prev[prev.length - 1]]);
  }

  function removeLevel(index: number) {
    if (levels.length <= 1) return;
    setLevels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLevel(index: number, changes: Partial<LevelForm>) {
    setLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function goToConfirm() {
    setError(null);
    if (!storeId) return setError("No store selected.");
    if (!productName.trim()) return setError("Product name is required.");
    if (levels.some((l) => !l.unitName.trim())) return setError("Every unit level needs a name.");
    if (!levels.some((l) => l.unitName === receivedForm)) {
      return setError("Received form must match one of the unit levels.");
    }
    const qty = Number(receivedQuantity);
    if (!Number.isFinite(qty) || qty < 1) return setError("Received quantity must be at least 1.");
    const amount = Number(purchaseAmount);
    if (!Number.isFinite(amount) || amount < 0) return setError("Purchase amount must be a non-negative number.");
    setStep("confirm");
  }

  const hierarchy: UnitLevel[] = levels.map((l, i) => ({
    unitName: l.unitName.trim(),
    unitsPerParent: i === 0 ? 1 : Number(l.unitsPerParent) || 1,
  }));

  let breakdown = null;
  let breakdownError: string | null = null;
  if (step === "confirm") {
    try {
      breakdown = describeBreakdown(hierarchy, receivedForm, Number(receivedQuantity), Number(purchaseAmount));
    } catch (err) {
      breakdownError = err instanceof Error ? err.message : "Could not compute breakdown.";
    }
  }

  async function submitIntake() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/store-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        productName: productName.trim(),
        category,
        unitHierarchy: hierarchy,
        receivedForm,
        receivedQuantity: Number(receivedQuantity),
        purchaseAmount: Number(purchaseAmount),
        supplierName,
        batchNumber,
        expiryDate: expiryDate || undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Failed to record intake.");
      return;
    }
    router.push(`/store/batches/${data.batch._id}/dispense`);
  }

  if (step === "confirm") {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Confirm receipt</h1>
        <div className="max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm text-zinc-700">
            Receiving <strong>{receivedQuantity}</strong> {pluralize(receivedForm, Number(receivedQuantity))} of{" "}
            <strong>{productName}</strong> for <strong>₦{Number(purchaseAmount).toFixed(2)}</strong>.
          </p>

          {breakdownError && <p className="mb-3 text-sm text-red-600">{breakdownError}</p>}

          {breakdown && (
            <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <p className="mb-2 text-zinc-700">{breakdown.summarySentence}</p>
              <table className="w-full text-left text-xs text-zinc-600">
                <thead>
                  <tr>
                    <th className="pb-1">Unit</th>
                    <th className="pb-1">Quantity</th>
                    <th className="pb-1">Amount per unit</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.levels.map((l) => (
                    <tr key={l.unitName}>
                      <td className="py-0.5">{l.unitName}</td>
                      <td className="py-0.5">{l.quantity}</td>
                      <td className="py-0.5">₦{l.amountPerUnit.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => setStep("form")}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Edit
            </button>
            <button
              onClick={submitIntake}
              disabled={submitting || !!breakdownError}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Confirm & receive stock"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Receive stock</h1>
      <div className="max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <label className="mb-1 block text-sm font-medium text-zinc-700">Product name</label>
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="e.g. Tanzol 500mg"
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-zinc-700">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ProductCategory)}
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="supermarket">Supermarket</option>
          <option value="medicine">Medicine</option>
          <option value="non-medicine">Non-medicine</option>
        </select>

        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Packaging (largest to smallest — last one is the base unit)
        </label>
        <div className="mb-2 flex flex-col gap-2">
          {levels.map((level, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={level.unitName}
                onChange={(e) => updateLevel(i, { unitName: e.target.value })}
                placeholder={i === 0 ? "carton" : i === levels.length - 1 ? "piece" : "box"}
                className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              {i > 0 && (
                <>
                  <span className="text-xs text-zinc-500">per</span>
                  <input
                    type="number"
                    min={1}
                    value={level.unitsPerParent}
                    onChange={(e) => updateLevel(i, { unitsPerParent: e.target.value })}
                    className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                  <span className="text-xs text-zinc-500">{levels[i - 1].unitName || "unit"}</span>
                </>
              )}
              <button
                type="button"
                onClick={() => removeLevel(i)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLevel}
          className="mb-3 text-sm text-teal-700 hover:underline"
        >
          + Add smaller unit
        </button>

        <label className="mb-1 block text-sm font-medium text-zinc-700">Received form</label>
        <select
          value={receivedForm}
          onChange={(e) => setReceivedForm(e.target.value)}
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          {levels.map((l, i) => (
            <option key={i} value={l.unitName}>
              {l.unitName || `level ${i + 1}`}
            </option>
          ))}
        </select>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Quantity received</label>
            <input
              type="number"
              min={1}
              value={receivedQuantity}
              onChange={(e) => setReceivedQuantity(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Purchase amount (₦)</label>
            <input
              type="number"
              min={0}
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <input
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Supplier (optional)"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            placeholder="Batch number (optional)"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </div>

        <button
          onClick={goToConfirm}
          className="w-full rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Review
        </button>
      </div>
    </div>
  );
}
