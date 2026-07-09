"use client";

import { useEffect, useState } from "react";
import { formatProductLabel, type ProductCategory, type ProductJSON, type ProductRequestJSON } from "@/lib/types";
import { getExpiryStatus, EXPIRY_ROW_CLASS, EXPIRY_TEXT_CLASS } from "@/lib/expiry";

const emptyForm = {
  itemName: "",
  brand: "",
  size: "",
  category: "supermarket" as ProductCategory,
  quantityInStock: "",
  retailPrice: "",
  wholesalePrice: "",
  distributorPrice: "",
  batchNumber: "",
  expiryDate: "",
};

interface LevelForm {
  unitName: string;
  unitsPerParent: string;
}

const BULK_FIELDS = [
  "itemName",
  "brand",
  "size",
  "category",
  "quantityInStock",
  "retailPrice",
  "wholesalePrice",
  "distributorPrice",
  "batchNumber",
  "expiryDate",
  "unitHierarchy",
] as const;

const BULK_TEMPLATE =
  "itemName,brand,size,category,quantityInStock,retailPrice,batchNumber,expiryDate,unitHierarchy\n" +
  "Ibuprofen,GSK,200mg,medicine,50,5.00,IBU-01,2027-01-31,carton:1>box:4>pack:10\n" +
  "Groundnut oil,Mamador,1L,non-medicine,20,3200,,";

function parseCsv(text: string): { rows: Record<string, string>[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { rows: [], error: "Paste a header row plus at least one product row." };
  }
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { rows };
}

export default function ProductsClient({
  isAdmin,
  branchId,
}: {
  isAdmin: boolean;
  branchId: string | null;
}) {
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductJSON>>({});
  const [error, setError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(
    null
  );
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Unit hierarchy builder state for the single-add form
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [levels, setLevels] = useState<LevelForm[]>([
    { unitName: "carton", unitsPerParent: "1" },
    { unitName: "piece", unitsPerParent: "1" },
  ]);

  // Unit hierarchy builder state for inline edit
  const [editHierarchyEnabled, setEditHierarchyEnabled] = useState(false);
  const [editLevels, setEditLevels] = useState<LevelForm[]>([]);

  // Pending "sold as custom, not in catalog yet" requests filed from POS, awaiting review.
  const [productRequests, setProductRequests] = useState<ProductRequestJSON[]>([]);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [matchingRequestId, setMatchingRequestId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchResults, setMatchResults] = useState<ProductJSON[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);

  function addLevel() {
    setLevels((prev) => [...prev.slice(0, -1), { unitName: "", unitsPerParent: "1" }, prev[prev.length - 1]]);
  }

  function removeLevel(index: number) {
    if (levels.length <= 1) return;
    setLevels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLevel(index: number, changes: Partial<LevelForm>) {
    setLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function addEditLevel() {
    setEditLevels((prev) => [...prev.slice(0, -1), { unitName: "", unitsPerParent: "1" }, prev[prev.length - 1]]);
  }

  function removeEditLevel(index: number) {
    if (editLevels.length <= 1) return;
    setEditLevels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateEditLevel(index: number, changes: Partial<LevelForm>) {
    setEditLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function buildHierarchy(lvls: LevelForm[]): { unitName: string; unitsPerParent: number }[] {
    return lvls.map((l, i) => ({
      unitName: l.unitName.trim(),
      unitsPerParent: i === 0 ? 1 : Math.max(1, Number(l.unitsPerParent) || 1),
    }));
  }

  /** How many base (smallest) units make up one of the largest unit. */
  function getBaseUnitsPerLargest(lvls: LevelForm[]): number {
    let result = 1;
    for (let i = 1; i < lvls.length; i++) {
      result *= Math.max(1, Number(lvls[i].unitsPerParent) || 1);
    }
    return result;
  }

  async function loadProducts() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/products?${params}`);
    if (res.ok) setProducts((await res.json()).products);
  }

  useEffect(() => {
    const timeout = setTimeout(loadProducts, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function loadProductRequests() {
    if (!isAdmin) return;
    const params = new URLSearchParams({ status: "pending" });
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/product-requests?${params}`);
    if (res.ok) setProductRequests((await res.json()).requests);
  }

  useEffect(() => {
    const timeout = setTimeout(loadProductRequests, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, branchId]);

  useEffect(() => {
    if (!matchingRequestId || !matchSearch.trim()) {
      const timeout = setTimeout(() => setMatchResults([]), 0);
      return () => clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      const params = new URLSearchParams({ search: matchSearch.trim() });
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
      if (res.ok) setMatchResults((await res.json()).products.slice(0, 8));
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [matchingRequestId, matchSearch, branchId]);

  function approveRequest(request: ProductRequestJSON) {
    setRequestError(null);
    setApprovingRequestId(request._id);
    setShowForm(true);
    setBulkMode(false);
    setForm({
      ...emptyForm,
      itemName: request.itemName,
      brand: request.brand,
      size: request.size,
      category: request.category,
      retailPrice: String(request.requestedPrice),
    });
  }

  async function linkRequestToProduct(requestId: string, productId: string, action: "resolve_duplicate" | "approve") {
    setRequestError(null);
    const res = await fetch(`/api/product-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, productId, branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRequestError(data.error || "Failed to update request");
      return;
    }
    setMatchingRequestId(null);
    setMatchSearch("");
    setMatchResults([]);
    loadProductRequests();
  }

  async function rejectRequest(requestId: string) {
    if (!confirm("Reject this request? No product will be created or adjusted.")) return;
    setRequestError(null);
    const res = await fetch(`/api/product-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRequestError(data.error || "Failed to reject request");
      return;
    }
    loadProductRequests();
  }

  async function createProduct() {
    setError(null);
    if (!form.itemName.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!form.brand.trim()) {
      setError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
      return;
    }
    if (!form.size.trim()) {
      setError('Size is required — use "Standard" if the item has no size/strength variation.');
      return;
    }
    const payload: Record<string, unknown> = { ...form, branchId };
    if (hierarchyEnabled && levels.length > 0) {
      const hierarchy = buildHierarchy(levels);
      if (hierarchy.some((l) => !l.unitName)) {
        setError("Every unit level needs a name.");
        return;
      }
      payload.unitHierarchy = hierarchy;
      // Prices are entered as per-largest-unit; convert to per-base-unit for storage.
      const divisor = getBaseUnitsPerLargest(levels);
      if (payload.retailPrice) payload.retailPrice = Number(payload.retailPrice) / divisor;
      if (payload.wholesalePrice) payload.wholesalePrice = Number(payload.wholesalePrice) / divisor;
      if (payload.distributorPrice) payload.distributorPrice = Number(payload.distributorPrice) / divisor;
    }
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create product");
      return;
    }
    if (approvingRequestId) {
      await linkRequestToProduct(approvingRequestId, data.product._id, "approve");
      setApprovingRequestId(null);
    }
    setForm(emptyForm);
    setShowForm(false);
    setHierarchyEnabled(false);
    setLevels([
      { unitName: "carton", unitsPerParent: "1" },
      { unitName: "piece", unitsPerParent: "1" },
    ]);
    loadProducts();
  }

  function startEdit(product: ProductJSON) {
    setEditingId(product._id);
    if (product.unitHierarchy && product.unitHierarchy.length > 0) {
      setEditHierarchyEnabled(true);
      const editLvls = product.unitHierarchy.map((l) => ({
        unitName: l.unitName,
        unitsPerParent: String(l.unitsPerParent),
      }));
      setEditLevels(editLvls);
      // Convert stored per-base-unit prices back to per-largest-unit for display.
      const multiplier = getBaseUnitsPerLargest(editLvls);
      setEditForm({
        itemName: product.itemName,
        brand: product.brand,
        size: product.size,
        category: product.category,
        quantityInStock: product.quantityInStock,
        retailPrice: Math.round(product.retailPrice * multiplier * 100) / 100,
        wholesalePrice: Math.round(product.wholesalePrice * multiplier * 100) / 100,
        distributorPrice: Math.round(product.distributorPrice * multiplier * 100) / 100,
        batchNumber: product.batchNumber || "",
        expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
      });
    } else {
      setEditHierarchyEnabled(false);
      setEditLevels([
        { unitName: "carton", unitsPerParent: "1" },
        { unitName: "piece", unitsPerParent: "1" },
      ]);
      setEditForm({
        itemName: product.itemName,
        brand: product.brand,
        size: product.size,
        category: product.category,
        quantityInStock: product.quantityInStock,
        retailPrice: product.retailPrice,
        wholesalePrice: product.wholesalePrice,
        distributorPrice: product.distributorPrice,
        batchNumber: product.batchNumber || "",
        expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
      });
    }
  }

  async function saveEdit(id: string) {
    setError(null);
    if (!String(editForm.itemName || "").trim()) {
      setError("Item name is required.");
      return;
    }
    if (!String(editForm.brand || "").trim()) {
      setError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
      return;
    }
    if (!String(editForm.size || "").trim()) {
      setError('Size is required — use "Standard" if the item has no size/strength variation.');
      return;
    }
    const payload: Record<string, unknown> = { ...editForm, branchId };
    if (editHierarchyEnabled && editLevels.length > 0) {
      const hierarchy = buildHierarchy(editLevels);
      if (hierarchy.some((l) => !l.unitName)) {
        setError("Every unit level needs a name.");
        return;
      }
      payload.unitHierarchy = hierarchy;
      // Prices are displayed as per-largest-unit; convert to per-base-unit for storage.
      const divisor = getBaseUnitsPerLargest(editLevels);
      if (payload.retailPrice) payload.retailPrice = Number(payload.retailPrice) / divisor;
      if (payload.wholesalePrice) payload.wholesalePrice = Number(payload.wholesalePrice) / divisor;
      if (payload.distributorPrice) payload.distributorPrice = Number(payload.distributorPrice) / divisor;
    } else {
      // Clear hierarchy if user toggled it off
      payload.unitHierarchy = null;
    }
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update product");
      return;
    }
    setEditingId(null);
    loadProducts();
  }

  async function deleteProduct(id: string) {
    if (!confirm("Delete this product?")) return;
    const params = branchId ? `?branchId=${branchId}` : "";
    const res = await fetch(`/api/products/${id}${params}`, { method: "DELETE" });
    if (res.ok) loadProducts();
  }

  async function importBulk() {
    setBulkError(null);
    setBulkResult(null);

    const { rows, error: parseError } = parseCsv(bulkText);
    if (parseError) {
      setBulkError(parseError);
      return;
    }

    const products = rows.map((row) => {
      const product: Record<string, string> = {};
      BULK_FIELDS.forEach((field) => {
        product[field] = row[field.toLowerCase()] ?? "";
      });
      return product;
    });

    setBulkSubmitting(true);
    const res = await fetch("/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products, branchId }),
    });
    const data = await res.json();
    setBulkSubmitting(false);

    if (!res.ok && !data.created) {
      setBulkError(data.error || "Import failed");
      return;
    }

    setBulkResult({ created: data.created, errors: data.errors || [] });
    if ((data.errors || []).length === 0) setBulkText("");
    loadProducts();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Product catalog</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowForm((v) => !v);
                setBulkMode(false);
                setApprovingRequestId(null);
                setForm(emptyForm);
              }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              {showForm ? "Cancel" : "Add product"}
            </button>
            <button
              onClick={() => {
                setBulkMode((v) => !v);
                setShowForm(false);
              }}
              className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
            >
              {bulkMode ? "Cancel" : "Bulk add"}
            </button>
          </div>
        )}
      </div>

      {isAdmin && productRequests.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-amber-900">
            Pending item requests ({productRequests.length})
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Sold at POS as a custom item because it wasn&apos;t in the catalog. Add it as a new product, or match
            it to an existing product to reconcile the stock that already left the shelf.
          </p>
          {requestError && <p className="mb-2 text-sm text-red-600">{requestError}</p>}
          <div className="flex flex-col gap-3">
            {productRequests.map((req) => (
              <div key={req._id} className="rounded border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-zinc-900">
                      {formatProductLabel(req)} <span className="text-zinc-400">({req.category})</span>
                    </span>
                    <p className="text-xs text-zinc-500">
                      Sold {req.quantitySold} at ₦{req.requestedPrice.toFixed(2)} each by {req.requestedByName} on{" "}
                      {new Date(req.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveRequest(req)}
                      className="rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      Add as new product
                    </button>
                    <button
                      onClick={() => {
                        setMatchingRequestId(matchingRequestId === req._id ? null : req._id);
                        setMatchSearch("");
                        setMatchResults([]);
                      }}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Match existing product
                    </button>
                    <button
                      onClick={() => rejectRequest(req._id)}
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {matchingRequestId === req._id && (
                  <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2">
                    <input
                      placeholder="Search existing products..."
                      value={matchSearch}
                      onChange={(e) => setMatchSearch(e.target.value)}
                      className="mb-2 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-col gap-1">
                      {matchResults.map((product) => (
                        <button
                          key={product._id}
                          onClick={() => linkRequestToProduct(req._id, product._id, "resolve_duplicate")}
                          className="rounded px-2 py-1 text-left text-sm text-teal-700 hover:bg-teal-100"
                        >
                          {formatProductLabel(product)} — Stock: {product.quantityInStock}
                        </button>
                      ))}
                      {matchSearch.trim() && matchResults.length === 0 && (
                        <p className="px-2 py-1 text-xs text-zinc-500">No matches.</p>
                      )}
                    </div>
                    <p className="mt-1 px-2 text-xs text-zinc-500">
                      Selecting a product deducts {req.quantitySold} from its stock, reconciling the sale.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      />

      {(() => {
        const expired = products.filter((p) => getExpiryStatus(p.expiryDate).level === "expired");
        const urgent = products.filter((p) => getExpiryStatus(p.expiryDate).level === "urgent");
        const warning = products.filter((p) => getExpiryStatus(p.expiryDate).level === "warning");
        if (expired.length === 0 && urgent.length === 0 && warning.length === 0) return null;
        return (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {expired.length > 0 && <span className="mr-3 font-semibold text-red-700">{expired.length} expired</span>}
            {urgent.length > 0 && (
              <span className="mr-3 font-semibold text-orange-700">{urgent.length} expiring within 30 days</span>
            )}
            {warning.length > 0 && <span>{warning.length} expiring within 90 days</span>}
          </div>
        );
      })()}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {isAdmin && showForm && (
        <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <input
            placeholder="Item name (e.g. Amlodipine)"
            value={form.itemName}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Brand / manufacturer"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder='Size / strength (e.g. 5mg, 1L, "Standard")'
            value={form.size}
            onChange={(e) => setForm({ ...form, size: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as ProductCategory })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="supermarket">Supermarket</option>
            <option value="medicine">Medicine</option>
            <option value="non-medicine">Non-medicine</option>
          </select>
          <input
            type="number"
            placeholder="Stock qty"
            value={form.quantityInStock}
            onChange={(e) => setForm({ ...form, quantityInStock: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Retail price"
            value={form.retailPrice}
            onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Wholesale price (optional)"
            value={form.wholesalePrice}
            onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Distributor price (optional)"
            value={form.distributorPrice}
            onChange={(e) => setForm({ ...form, distributorPrice: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Batch number (optional)"
            value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            placeholder="Expiry date (optional)"
            value={form.expiryDate}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />

          {/* Unit hierarchy (packaging form) builder */}
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={hierarchyEnabled}
                onChange={(e) => setHierarchyEnabled(e.target.checked)}
                className="rounded border-zinc-300"
              />
              Define packaging forms (e.g. carton → box → piece)
            </label>
            {hierarchyEnabled && (
              <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-2 text-xs text-zinc-500">
                  Largest unit first, smallest (base) unit last. POS will let staff sell in any of these forms.
                </p>
                {levels.length >= 2 && levels[0].unitName && levels[levels.length - 1].unitName && (
                  <p className="mb-2 rounded bg-teal-50 px-2 py-1 text-xs text-teal-700">
                    💡 Prices above are per <strong>{levels[0].unitName}</strong>. Stock qty is in{" "}
                    <strong>{levels[levels.length - 1].unitName}s</strong> (smallest unit).
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {levels.map((level, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={level.unitName}
                        onChange={(e) => updateLevel(i, { unitName: e.target.value })}
                        placeholder={i === 0 ? "e.g. carton" : i === levels.length - 1 ? "e.g. piece" : "e.g. box"}
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
                  className="mt-2 text-sm text-teal-700 hover:underline"
                >
                  + Add unit level
                </button>
              </div>
            )}
          </div>

          <button
            onClick={createProduct}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 sm:col-span-2 lg:col-span-4"
          >
            Save product
          </button>
        </div>
      )}

      {isAdmin && bulkMode && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm text-zinc-600">
            Paste CSV with a header row:{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
              itemName,brand,size,category,quantityInStock,retailPrice,batchNumber,expiryDate,unitHierarchy
            </code>
            . <strong>itemName, brand, size, and retailPrice are all required for every row</strong> — brand
            is the manufacturer (look it up if it isn&apos;t printed on the packaging), size is the
            strength/measurement (use &quot;Standard&quot; if the item has no size variation). Category must
            be &quot;supermarket&quot;, &quot;medicine&quot;, or &quot;non-medicine&quot; — defaults to
            &quot;supermarket&quot; if left blank. wholesalePrice/distributorPrice (optional extra columns)
            default to retailPrice, and batchNumber/expiryDate (YYYY-MM-DD) are optional. unitHierarchy uses
            the format{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
              carton:1&gt;box:4&gt;piece:10
            </code>{" "}
            (largest to smallest, with units-per-parent after the colon) — leave blank if not needed.
          </p>
          <p className="mb-2 text-sm text-zinc-600">
            Any row missing itemName, brand, size, or retailPrice is rejected — the report below names
            the exact row and item, what&apos;s missing, and what to enter. Valid rows in the same
            upload still go through.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={8}
            placeholder={BULK_TEMPLATE}
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          {bulkError && <p className="mb-2 text-sm text-red-600">{bulkError}</p>}
          {bulkResult && (
            <div className="mb-3 text-sm">
              <p className="text-teal-700">
                Imported {bulkResult.created} product{bulkResult.created === 1 ? "" : "s"}.
              </p>
              {bulkResult.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-red-600">
                  {bulkResult.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            onClick={importBulk}
            disabled={bulkSubmitting || !bulkText.trim()}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {bulkSubmitting ? "Importing..." : "Import products"}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Item name</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">{isAdmin ? "Retail" : "Selling price"}</th>
              {isAdmin && (
                <>
                  <th className="px-3 py-2">Wholesale</th>
                  <th className="px-3 py-2">Distributor</th>
                </>
              )}
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Expiry</th>
              {isAdmin && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const editing = editingId === product._id;
              const expiryStatus = getExpiryStatus(product.expiryDate);
              return (
                <tr
                  key={product._id}
                  className={`border-b border-zinc-100 last:border-0 ${EXPIRY_ROW_CLASS[expiryStatus.level]}`}
                >
                  {editing ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.itemName || ""}
                          onChange={(e) => setEditForm({ ...editForm, itemName: e.target.value })}
                          className="w-28 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.brand || ""}
                          onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                          className="w-24 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.size || ""}
                          onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editForm.category}
                          onChange={(e) =>
                            setEditForm({ ...editForm, category: e.target.value as ProductCategory })
                          }
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
                          <option value="supermarket">Supermarket</option>
                          <option value="medicine">Medicine</option>
                          <option value="non-medicine">Non-medicine</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="min-w-[120px]">
                          <label className="flex items-center gap-1 text-xs text-zinc-600">
                            <input
                              type="checkbox"
                              checked={editHierarchyEnabled}
                              onChange={(e) => setEditHierarchyEnabled(e.target.checked)}
                              className="rounded border-zinc-300"
                            />
                            Forms
                          </label>
                          {editHierarchyEnabled && (
                            <div className="mt-1 flex flex-col gap-1">
                              {editLevels.map((level, i) => (
                                <div key={i} className="flex items-center gap-1">
                                  <input
                                    value={level.unitName}
                                    onChange={(e) => updateEditLevel(i, { unitName: e.target.value })}
                                    placeholder={i === 0 ? "e.g. carton" : "e.g. piece"}
                                    className="w-20 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                                  />
                                  {i > 0 && (
                                    <>
                                      <span className="text-[10px] text-zinc-400">×</span>
                                      <input
                                        type="number"
                                        min={1}
                                        value={level.unitsPerParent}
                                        onChange={(e) => updateEditLevel(i, { unitsPerParent: e.target.value })}
                                        className="w-10 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                                      />
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeEditLevel(i)}
                                    className="text-[10px] text-red-500 hover:underline"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={addEditLevel}
                                className="text-[10px] text-teal-700 hover:underline"
                              >
                                + level
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editForm.quantityInStock}
                          onChange={(e) =>
                            setEditForm({ ...editForm, quantityInStock: Number(e.target.value) })
                          }
                          className="w-16 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editForm.retailPrice}
                          onChange={(e) => setEditForm({ ...editForm, retailPrice: Number(e.target.value) })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editForm.wholesalePrice}
                          onChange={(e) => setEditForm({ ...editForm, wholesalePrice: Number(e.target.value) })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editForm.distributorPrice}
                          onChange={(e) =>
                            setEditForm({ ...editForm, distributorPrice: Number(e.target.value) })
                          }
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.batchNumber || ""}
                          onChange={(e) => setEditForm({ ...editForm, batchNumber: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={editForm.expiryDate ? String(editForm.expiryDate).slice(0, 10) : ""}
                          onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })}
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="flex gap-2 px-3 py-2">
                        <button
                          onClick={() => saveEdit(product._id)}
                          className="text-teal-700 hover:underline"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:underline">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium text-zinc-900">{product.itemName}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.brand}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.size}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                      <td className="px-3 py-2 text-zinc-600">
                        {product.unitHierarchy && product.unitHierarchy.length > 0
                          ? product.unitHierarchy.map((l) => l.unitName).join(" → ")
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{product.quantityInStock}</td>
                      <td className="px-3 py-2 text-zinc-600">₦{product.retailPrice.toFixed(2)}</td>
                      {isAdmin && (
                        <>
                          <td className="px-3 py-2 text-zinc-600">₦{product.wholesalePrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-zinc-600">₦{product.distributorPrice.toFixed(2)}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-zinc-600">{product.batchNumber || "—"}</td>
                      <td className={`px-3 py-2 ${EXPIRY_TEXT_CLASS[expiryStatus.level]}`}>
                        {product.expiryDate ? product.expiryDate.slice(0, 10) : "—"}
                        {expiryStatus.label && <div className="text-xs">{expiryStatus.label}</div>}
                      </td>
                      {isAdmin && (
                        <td className="flex gap-2 px-3 py-2">
                          <button onClick={() => startEdit(product)} className="text-teal-700 hover:underline">
                            Edit
                          </button>
                          <button
                            onClick={() => deleteProduct(product._id)}
                            className="text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 12 : 9} className="px-3 py-6 text-center text-zinc-500">
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
