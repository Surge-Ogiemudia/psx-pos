"use client";

import { useEffect, useState } from "react";
import type { StaffJSON, StoreJSON } from "@/lib/types";

type Role = "admin" | "staff" | "store_manager" | "store_keeper";

const ROLE_LABEL: Record<Role, string> = {
  staff: "Staff",
  admin: "Admin",
  store_manager: "Store Manager",
  store_keeper: "Store Keeper",
};

const emptyForm = { name: "", role: "staff" as Role, phoneNumber: "", password: "", storeId: "" };

export default function StaffClient({ branchId }: { branchId: string | null }) {
  const [staff, setStaff] = useState<StaffJSON[]>([]);
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  async function loadStaff() {
    const res = await fetch("/api/staff");
    if (res.ok) setStaff((await res.json()).staff);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadStaff();
      fetch("/api/stores")
        .then((res) => (res.ok ? res.json() : { stores: [] }))
        .then((data) => setStores(data.stores || []));
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  async function createStaff() {
    setError(null);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create staff account");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    loadStaff();
  }

  async function updateRole(id: string, role: "admin" | "staff") {
    await fetch(`/api/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    loadStaff();
  }

  async function resetPassword(id: string) {
    const password = prompt("Enter a new password (min 8 characters):");
    if (!password) return;
    const res = await fetch(`/api/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to reset password");
    }
  }

  async function deleteStaff(id: string) {
    if (!confirm("Remove this staff member?")) return;
    const res = await fetch(`/api/staff/${id}`, { method: "DELETE" });
    if (res.ok) loadStaff();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Staff accounts</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          {showForm ? "Cancel" : "Add staff"}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Phone number"
            value={form.phoneNumber}
            onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="staff">Staff (retail branch)</option>
            <option value="admin">Admin</option>
            <option value="store_manager">Store Manager (all bulk stores)</option>
            <option value="store_keeper">Store Keeper (one bulk store)</option>
          </select>
          <input
            type="password"
            placeholder="Temporary password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          {form.role === "store_keeper" && (
            <select
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm sm:col-span-4"
            >
              <option value="">Select a store...</option>
              {stores.map((store) => (
                <option key={store._id} value={store._id}>
                  {store.storeName}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={createStaff}
            className="col-span-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 sm:col-span-4"
          >
            Create account
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 font-medium text-zinc-900">{member.name}</td>
                <td className="px-3 py-2 text-zinc-600">{member.phoneNumber}</td>
                <td className="px-3 py-2">
                  {member.role === "admin" || member.role === "staff" ? (
                    <select
                      value={member.role}
                      onChange={(e) => updateRole(member._id, e.target.value as "admin" | "staff")}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="text-zinc-700">{ROLE_LABEL[member.role]}</span>
                  )}
                </td>
                <td className="flex gap-3 px-3 py-2">
                  <button onClick={() => resetPassword(member._id)} className="text-teal-700 hover:underline">
                    Reset password
                  </button>
                  <button onClick={() => deleteStaff(member._id)} className="text-red-600 hover:underline">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
