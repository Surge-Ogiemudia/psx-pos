"use client";

import { useEffect, useState } from "react";
import type { StoreJSON } from "@/lib/types";

const emptyForm = { storeName: "", location: "" };

export default function StoresClient() {
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoreJSON>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadStores() {
    const res = await fetch("/api/stores");
    if (res.ok) setStores((await res.json()).stores);
  }

  useEffect(() => {
    const timeout = setTimeout(loadStores, 0);
    return () => clearTimeout(timeout);
  }, []);

  async function createStore() {
    setError(null);
    const res = await fetch("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create store");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    loadStores();
  }

  function startEdit(store: StoreJSON) {
    setEditingId(store._id);
    setEditForm({ storeName: store.storeName, location: store.location || "" });
  }

  async function saveEdit(id: string) {
    setError(null);
    const res = await fetch(`/api/stores/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update store");
      return;
    }
    setEditingId(null);
    loadStores();
  }

  async function deleteStore(id: string) {
    if (!confirm("Delete this store?")) return;
    const res = await fetch(`/api/stores/${id}`, { method: "DELETE" });
    if (res.ok) loadStores();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Bulk stores</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          {showForm ? "Cancel" : "Add store"}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <input
            placeholder="Store name"
            value={form.storeName}
            onChange={(e) => setForm({ ...form, storeName: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Location (optional)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={createStore}
            className="col-span-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Save store
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => {
              const editing = editingId === store._id;
              return (
                <tr key={store._id} className="border-b border-zinc-100 last:border-0">
                  {editing ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.storeName || ""}
                          onChange={(e) => setEditForm({ ...editForm, storeName: e.target.value })}
                          className="w-40 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.location || ""}
                          onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                          className="w-48 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="flex gap-2 px-3 py-2">
                        <button onClick={() => saveEdit(store._id)} className="text-teal-700 hover:underline">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:underline">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium text-zinc-900">{store.storeName}</td>
                      <td className="px-3 py-2 text-zinc-600">{store.location || "—"}</td>
                      <td className="flex gap-3 px-3 py-2">
                        <button onClick={() => startEdit(store)} className="text-teal-700 hover:underline">
                          Edit
                        </button>
                        <button onClick={() => deleteStore(store._id)} className="text-red-600 hover:underline">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {stores.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No stores yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
