"use client";

import { useEffect, useState } from "react";
import type { BranchJSON } from "@/lib/types";

const emptyForm = { branchName: "", location: "" };

export default function BranchesClient() {
  const [branches, setBranches] = useState<BranchJSON[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<BranchJSON>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadBranches() {
    const res = await fetch("/api/branches");
    if (res.ok) setBranches((await res.json()).branches);
  }

  useEffect(() => {
    const timeout = setTimeout(loadBranches, 0);
    return () => clearTimeout(timeout);
  }, []);

  async function createBranch() {
    setError(null);
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create branch");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    loadBranches();
  }

  function startEdit(branch: BranchJSON) {
    setEditingId(branch._id);
    setEditForm({ branchName: branch.branchName, location: branch.location || "" });
  }

  async function saveEdit(id: string) {
    setError(null);
    const res = await fetch(`/api/branches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update branch");
      return;
    }
    setEditingId(null);
    loadBranches();
  }

  async function deleteBranch(id: string) {
    if (!confirm("Delete this branch?")) return;
    const res = await fetch(`/api/branches/${id}`, { method: "DELETE" });
    if (res.ok) loadBranches();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Retail branches</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          {showForm ? "Cancel" : "Add branch"}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <input
            placeholder="Branch name"
            value={form.branchName}
            onChange={(e) => setForm({ ...form, branchName: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Location (optional)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={createBranch}
            className="col-span-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Save branch
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
            {branches.map((branch) => {
              const editing = editingId === branch._id;
              return (
                <tr key={branch._id} className="border-b border-zinc-100 last:border-0">
                  {editing ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.branchName || ""}
                          onChange={(e) => setEditForm({ ...editForm, branchName: e.target.value })}
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
                        <button onClick={() => saveEdit(branch._id)} className="text-teal-700 hover:underline">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:underline">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium text-zinc-900">{branch.branchName}</td>
                      <td className="px-3 py-2 text-zinc-600">{branch.location || "—"}</td>
                      <td className="flex gap-3 px-3 py-2">
                        <button onClick={() => startEdit(branch)} className="text-teal-700 hover:underline">
                          Edit
                        </button>
                        <button onClick={() => deleteBranch(branch._id)} className="text-red-600 hover:underline">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {branches.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No branches yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
