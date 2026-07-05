"use client";

import { useEffect, useState } from "react";
import type { ProductCategory, ProductJSON } from "@/lib/types";

const emptyForm = {
  name: "",
  category: "supermarket" as ProductCategory,
  quantityInStock: "",
  retailPrice: "",
  wholesalePrice: "",
  distributorPrice: "",
  batchNumber: "",
  expiryDate: "",
};

const BULK_FIELDS = [
  "name",
  "category",
  "quantityInStock",
  "retailPrice",
  "wholesalePrice",
  "distributorPrice",
  "batchNumber",
  "expiryDate",
] as const;

const BULK_TEMPLATE =
  "name,category,quantityInStock,retailPrice,batchNumber,expiryDate\n" +
  "Ibuprofen 200mg (20 tabs),medicine,50,5.00,IBU-01,2027-01-31\n" +
  "Milo 400g,non-medicine,20,3200,,";

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

  async function createProduct() {
    setError(null);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create product");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    loadProducts();
  }

  function startEdit(product: ProductJSON) {
    setEditingId(product._id);
    setEditForm({
      name: product.name,
      category: product.category,
      quantityInStock: product.quantityInStock,
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
      distributorPrice: product.distributorPrice,
      batchNumber: product.batchNumber || "",
      expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
    });
  }

  async function saveEdit(id: string) {
    setError(null);
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, branchId }),
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

      <input
        type="text"
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {isAdmin && showForm && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm sm:col-span-1"
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
          <button
            onClick={createProduct}
            className="col-span-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 sm:col-span-4"
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
              name,category,quantityInStock,retailPrice,batchNumber,expiryDate
            </code>
            . Category must be &quot;supermarket&quot;, &quot;medicine&quot;, or &quot;non-medicine&quot; —
            defaults to &quot;supermarket&quot; if left blank. Only name and retailPrice are otherwise
            required; wholesalePrice/distributorPrice (optional extra columns) default to retailPrice,
            and batchNumber/expiryDate (YYYY-MM-DD) are optional.
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
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Retail</th>
              <th className="px-3 py-2">Wholesale</th>
              <th className="px-3 py-2">Distributor</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Expiry</th>
              {isAdmin && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const editing = editingId === product._id;
              return (
                <tr key={product._id} className="border-b border-zinc-100 last:border-0">
                  {editing ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.name || ""}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-32 rounded border border-zinc-300 px-1.5 py-1"
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
                      <td className="px-3 py-2 font-medium text-zinc-900">{product.name}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.quantityInStock}</td>
                      <td className="px-3 py-2 text-zinc-600">₦{product.retailPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-600">₦{product.wholesalePrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-600">₦{product.distributorPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.batchNumber || "—"}</td>
                      <td className="px-3 py-2 text-zinc-600">
                        {product.expiryDate ? product.expiryDate.slice(0, 10) : "—"}
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
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
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
