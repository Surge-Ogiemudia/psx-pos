"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { describeBreakdown, pluralize, type UnitLevel } from "@/lib/unitHierarchy";
import { formatProductLabel, type ProductCategory, type SupplierJSON } from "@/lib/types";
import { parseNumeric } from "@/lib/numberInput";
import BackButton from "@/components/BackButton";

interface LevelForm {
  unitName: string;
  unitsPerParent: string;
}

interface SearchResult {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  category: ProductCategory;
  quantityInStock: number;
  baseUnitName: string;
}

interface StoreBatchLite {
  unitHierarchy: UnitLevel[];
  receivedAt: string;
}

const emptyLevels: LevelForm[] = [
  { unitName: "carton", unitsPerParent: "1" },
  { unitName: "piece", unitsPerParent: "1" },
];

export default function IntakeClient({
  initialStoreId,
  initialExistingProductId,
}: {
  initialStoreId: string;
  initialExistingProductId?: string;
}) {
  const router = useRouter();
  const [storeId] = useState(initialStoreId);

  const [step, setStep] = useState<"search" | "form" | "confirm">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(!!initialExistingProductId);

  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [category, setCategory] = useState<ProductCategory>("supermarket");
  const [levels, setLevels] = useState<LevelForm[]>(emptyLevels);
  const [receivedForm, setReceivedForm] = useState("carton");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierJSON[]>([]);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Search-as-you-type against this store's existing items, so receiving stock starts with
  // "do we already have this?" instead of assuming it's new and only finding out afterward.
  useEffect(() => {
    if (!storeId) return;
    const timeout = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams({ storeId, search: searchQuery.trim() });
        const res = await fetch(`/api/store-products?${params}`);
        if (res.ok) {
          setSearchResults((await res.json()).storeProducts || []);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchQuery, storeId]);

  async function searchSuppliers(query: string) {
    setSupplierName(query);
    if (!query.trim()) {
      setSupplierResults([]);
      return;
    }
    const res = await fetch(`/api/suppliers?search=${encodeURIComponent(query.trim())}`);
    const data = await res.json();
    setSupplierResults(data.suppliers || []);
  }

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

  // receivedForm and levels are independent state — renaming or removing a level can leave
  // receivedForm pointing at a unit name that no longer exists, even though the dropdown (which
  // can only display options that still exist) looks correct. Re-sync it whenever that happens.
  useEffect(() => {
    if (levels.length > 0 && !levels.some((l) => l.unitName === receivedForm)) {
      const timeout = setTimeout(() => {
        setReceivedForm(levels[levels.length - 1].unitName);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [levels, receivedForm]);

  async function selectExisting(item: SearchResult) {
    setSelectedExistingId(item._id);
    setItemName(item.itemName);
    setBrand(item.brand);
    setSize(item.size);
    setCategory(item.category);

    let lvls = emptyLevels;
    let form = "carton";
    try {
      const res = await fetch(`/api/store-products/${item._id}/batches?storeId=${storeId}`);
      if (res.ok) {
        const batches: StoreBatchLite[] = (await res.json()).batches || [];
        if (batches.length > 0) {
          const mostRecent = [...batches].sort(
            (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
          )[0];
          lvls = mostRecent.unitHierarchy.map((l) => ({ unitName: l.unitName, unitsPerParent: String(l.unitsPerParent) }));
          form = mostRecent.unitHierarchy[mostRecent.unitHierarchy.length - 1].unitName;
        }
      }
    } catch {
      // Fall back to the defaults below — packaging can still be edited by hand.
    }
    setLevels(lvls);
    setReceivedForm(form);
    setStep("form");
  }

  // Jumped here from an item's Batches page — skip search and go straight into the form,
  // pre-selected for that item, same as picking it from the search results below would.
  useEffect(() => {
    if (!initialExistingProductId || !storeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/store-products/${initialExistingProductId}?storeId=${storeId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          await selectExisting(data.product);
        }
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectNew() {
    setSelectedExistingId(null);
    setItemName(searchQuery.trim());
    setBrand("");
    setSize("");
    setCategory("supermarket");
    setLevels(emptyLevels);
    setReceivedForm("carton");
    setStep("form");
  }

  function backToSearch() {
    setError(null);
    setStep("search");
  }

  function goToConfirm() {
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

  if (step === "search" && loadingExisting) {
    return (
      <div>
        <BackButton fallbackHref={storeId ? `/store?storeId=${storeId}` : "/store"} />
        <h1 className="mb-1 text-lg font-semibold text-zinc-900">Receive stock</h1>
        <p className="text-sm text-zinc-500">Loading item...</p>
      </div>
    );
  }

  if (step === "search") {
    return (
      <div>
        <BackButton fallbackHref={storeId ? `/store?storeId=${storeId}` : "/store"} />
        <h1 className="mb-1 text-lg font-semibold text-zinc-900">Receive stock</h1>
        <p className="mb-4 text-sm text-zinc-600">
          Search for the item first — if it&apos;s already in this store, you&apos;ll just be adding a new
          batch to it. Only add it as new if nothing matches.
        </p>
        <div className="max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search item name, brand, or size..."
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            autoFocus
          />

          {searching && <p className="text-sm text-zinc-500">Searching...</p>}

          {!searching && searchQuery.trim() && searchResults.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {searchResults.map((item) => (
                <button
                  key={item._id}
                  onClick={() => selectExisting(item)}
                  className="rounded border border-zinc-200 p-2 text-left text-sm hover:border-teal-600 hover:bg-teal-50"
                >
                  <p className="font-medium text-zinc-900">{formatProductLabel(item)}</p>
                  <p className="text-xs text-zinc-500">
                    {item.category} · {item.quantityInStock} {item.baseUnitName}
                    {item.quantityInStock === 1 ? "" : "s"} in stock
                  </p>
                </button>
              ))}
            </div>
          )}

          {!searching && searchQuery.trim() && searchResults.length === 0 && (
            <p className="mb-3 text-sm text-zinc-500">No matching item found in this store yet.</p>
          )}

          <button
            onClick={selectNew}
            className="w-full rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
          >
            {searchQuery.trim() ? `+ Add "${searchQuery.trim()}" as a new item` : "+ Add as a new item"}
          </button>
        </div>
      </div>
    );
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
      <button onClick={backToSearch} className="mb-3 flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900">
        ← Change item
      </button>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Receive stock</h1>
      <div className="max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {selectedExistingId ? (
          <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-medium text-zinc-900">{formatProductLabel({ itemName, brand, size })}</p>
            <p className="text-xs text-zinc-500">
              {category} — adding a new batch to this existing item. To change its name/brand/size, edit it from
              the Catalog instead.
            </p>
          </div>
        ) : (
          <>
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
          </>
        )}

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
          <div className="relative">
            <input
              value={supplierName}
              onChange={(e) => searchSuppliers(e.target.value)}
              placeholder="Supplier (optional) — new or existing"
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            {supplierResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded border border-zinc-200 bg-white text-sm shadow-sm">
                {supplierResults.map((s) => (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSupplierName(s.name);
                        setSupplierResults([]);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-zinc-50"
                    >
                      {s.name} — ₦{s.totalSupplyAmount.toFixed(2)} lifetime
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          className="w-full rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Review
        </button>
      </div>
    </div>
  );
}
