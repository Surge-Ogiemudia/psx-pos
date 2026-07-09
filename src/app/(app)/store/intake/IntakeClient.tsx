"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeBreakdown, pluralize, type UnitLevel } from "@/lib/unitHierarchy";
import { formatProductLabel, type ProductCategory } from "@/lib/types";
import { parseNumeric } from "@/lib/numberInput";

interface LevelForm {
  unitName: string;
  unitsPerParent: string;
}

interface SimilarStoreProduct {
  product: { itemName: string; brand: string; size: string; quantityInStock: number; baseUnitName: string };
  score: number;
}

const emptyLevels: LevelForm[] = [
  { unitName: "carton", unitsPerParent: "1" },
  { unitName: "piece", unitsPerParent: "1" },
];

export default function IntakeClient({ initialStoreId }: { initialStoreId: string }) {
  const router = useRouter();
  const [storeId] = useState(initialStoreId);
  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
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
  const [similarMatches, setSimilarMatches] = useState<SimilarStoreProduct[] | null>(null);
  const [checkingSimilar, setCheckingSimilar] = useState(false);

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

  async function goToConfirm() {
    setError(null);
    if (!storeId) return setError("No store selected.");
    if (!itemName.trim()) return setError("Item name is required.");
    if (!brand.trim()) {
      return setError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
    }
    if (!size.trim()) {
      return setError('Size is required — use "Standard" if the item has no size/strength variation.');
    }
    if (levels.some((l) => !l.unitName.trim())) return setError("Every unit level needs a name.");
    if (!levels.some((l) => l.unitName === receivedForm)) {
      return setError("Received form must match one of the unit levels.");
    }
    const qty = parseNumeric(receivedQuantity);
    if (!Number.isFinite(qty) || qty < 1) return setError("Received quantity must be at least 1.");
    const amount = parseNumeric(purchaseAmount);
    if (!Number.isFinite(amount) || amount < 0) return setError("Purchase amount must be a non-negative number.");

    setCheckingSimilar(true);
    const params = new URLSearchParams({ itemName: itemName.trim(), brand: brand.trim(), size: size.trim(), storeId });
    const simRes = await fetch(`/api/store-products/similar?${params}`);
    setCheckingSimilar(false);
    if (simRes.ok) {
      const data = await simRes.json();
      if (data.matches && data.matches.length > 0) {
        setSimilarMatches(data.matches);
        return;
      }
    }
    setStep("confirm");
  }

  function applySameProduct(match: SimilarStoreProduct) {
    setItemName(match.product.itemName);
    setBrand(match.product.brand);
    setSize(match.product.size);
    setSimilarMatches(null);
    setStep("confirm");
  }

  function confirmDifferentProduct() {
    setSimilarMatches(null);
    setStep("confirm");
  }

  const hierarchy: UnitLevel[] = levels.map((l, i) => ({
    unitName: l.unitName.trim(),
    unitsPerParent: i === 0 ? 1 : parseNumeric(l.unitsPerParent) || 1,
  }));

  let breakdown = null;
  let breakdownError: string | null = null;
  if (step === "confirm") {
    try {
      breakdown = describeBreakdown(hierarchy, receivedForm, parseNumeric(receivedQuantity), parseNumeric(purchaseAmount));
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
        itemName: itemName.trim(),
        brand: brand.trim(),
        size: size.trim(),
        category,
        unitHierarchy: hierarchy,
        receivedForm,
        receivedQuantity: parseNumeric(receivedQuantity),
        purchaseAmount: parseNumeric(purchaseAmount),
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
            Receiving <strong>{receivedQuantity}</strong> {pluralize(receivedForm, parseNumeric(receivedQuantity))} of{" "}
            <strong>{formatProductLabel({ itemName, brand, size })}</strong> for{" "}
            <strong>₦{parseNumeric(purchaseAmount).toFixed(2)}</strong>.
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

        <label className="mb-1 block text-sm font-medium text-zinc-700">Item name</label>
        <input
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="e.g. Tanzol"
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-zinc-700">Brand / manufacturer</label>
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="e.g. GSK"
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-zinc-700">Size / strength</label>
        <input
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder='e.g. 500mg, or "Standard" if none'
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
                    type="text"
                    inputMode="numeric"
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
              type="text"
              inputMode="numeric"
              value={receivedQuantity}
              onChange={(e) => setReceivedQuantity(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Purchase amount (₦)</label>
            <input
              type="text"
              inputMode="decimal"
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm sm:col-span-2"
          />
        </div>

        <button
          onClick={goToConfirm}
          disabled={checkingSimilar}
          className="w-full rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {checkingSimilar ? "Checking catalog..." : "Review"}
        </button>
      </div>

      {similarMatches && similarMatches.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h2 className="mb-2 text-base font-semibold text-zinc-900">Is this the same product?</h2>
            <p className="mb-3 text-sm text-zinc-600">
              You&apos;re receiving <strong>{formatProductLabel({ itemName, brand, size })}</strong>. A very
              similar item is already in this store&apos;s catalog:
            </p>
            <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <p className="font-medium text-zinc-900">{formatProductLabel(similarMatches[0].product)}</p>
              <p className="mt-1 text-zinc-600">
                Stock: {similarMatches[0].product.quantityInStock} {similarMatches[0].product.baseUnitName}
                {similarMatches[0].product.baseUnitName.endsWith("s") ? "" : "s"}
              </p>
              {similarMatches.length > 1 && (
                <p className="mt-1 text-xs text-zinc-500">+{similarMatches.length - 1} other similar match(es).</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => applySameProduct(similarMatches[0])}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Yes — same product, add this as a new batch
              </button>
              <button
                onClick={confirmDifferentProduct}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                No — this is a different product
              </button>
              <button onClick={() => setSimilarMatches(null)} className="text-xs text-zinc-500 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
