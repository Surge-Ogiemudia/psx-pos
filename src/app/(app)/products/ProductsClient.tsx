"use client";

import { useEffect, useState } from "react";
import type { ProductJSON } from "@/lib/types";

const emptyForm = {
  name: "",
  category: "medicine" as "medicine" | "non-medicine",
  quantityInStock: 0,
  retailPrice: 0,
  wholesalePrice: 0,
  distributorPrice: 0,
  batchNumber: "",
  expiryDate: "",
};

export default function ProductsClient({ isAdmin }: { isAdmin: boolean }) {
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductJSON>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/products${params}`);
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
      body: JSON.stringify(form),
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
      body: JSON.stringify(editForm),
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
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (res.ok) loadProducts();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Product catalog</h1>
        {isAdmin && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            {showForm ? "Cancel" : "Add product"}
          </button>
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
            onChange={(e) => setForm({ ...form, category: e.target.value as "medicine" | "non-medicine" })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="medicine">Medicine</option>
            <option value="non-medicine">Non-medicine</option>
          </select>
          <input
            type="number"
            placeholder="Stock qty"
            value={form.quantityInStock}
            onChange={(e) => setForm({ ...form, quantityInStock: Number(e.target.value) })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Retail price"
            value={form.retailPrice}
            onChange={(e) => setForm({ ...form, retailPrice: Number(e.target.value) })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Wholesale price"
            value={form.wholesalePrice}
            onChange={(e) => setForm({ ...form, wholesalePrice: Number(e.target.value) })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Distributor price"
            value={form.distributorPrice}
            onChange={(e) => setForm({ ...form, distributorPrice: Number(e.target.value) })}
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
                            setEditForm({ ...editForm, category: e.target.value as "medicine" | "non-medicine" })
                          }
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
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
                      <td className="px-3 py-2 text-zinc-600">${product.retailPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-600">${product.wholesalePrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-600">${product.distributorPrice.toFixed(2)}</td>
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
