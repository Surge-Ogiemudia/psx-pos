"use client";

import { Fragment, useState } from "react";
import type { StaffJSON, StoreJSON, StaffCredentialStatusJSON, BranchJSON } from "@/lib/types";
import StaffCredentialsModal from "./StaffCredentialsModal";

type Role = "admin" | "staff" | "store_manager" | "store_keeper" | "pharmacist";

const ROLE_LABEL: Record<Role, string> = {
  staff: "Staff",
  admin: "Admin",
  store_manager: "Store Manager",
  store_keeper: "Store Keeper",
  pharmacist: "Pharmacist",
};

interface StaffDirectoryProps {
  staff: StaffJSON[];
  stores: StoreJSON[];
  branches: BranchJSON[];
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  form: any;
  setForm: (f: any) => void;
  error: string | null;
  createStaff: () => void;
  updateRole: (id: string, role: "admin" | "staff") => void;
  updateBranch: (id: string, branchId: string) => void;
  resetPassword: (id: string) => void;
  deleteStaff: (id: string) => void;
  credentials?: StaffCredentialStatusJSON[];
  onCredentialsSaved?: () => void;
}

export default function StaffDirectory({
  staff,
  stores,
  branches,
  showForm,
  setShowForm,
  form,
  setForm,
  error,
  createStaff,
  updateRole,
  updateBranch,
  resetPassword,
  deleteStaff,
  credentials,
  onCredentialsSaved,
}: StaffDirectoryProps) {
  const [credentialTarget, setCredentialTarget] = useState<StaffJSON | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const credentialByUserId = new Map((credentials ?? []).map((c) => [c.userId, c]));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Directory</h2>
        <button
          onClick={() => setShowForm(!showForm)}
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
            <option value="pharmacist">Pharmacist</option>
          </select>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Temporary password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded border border-zinc-300 py-1.5 pl-2 pr-8 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.05 10.05 0 011.563-.063c4.478 0 8.268 2.943 9.543 7a9.97 9.97 0 01-1.563 3.029m-5.858 5.908L3 3l18 18" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          <input
            placeholder="ZKTeco Device ID (Optional)"
            value={form.employeeId || ""}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={form.employmentType}
            onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
            <option value="contract">Contract</option>
          </select>
          <select
            value={form.salaryType}
            onChange={(e) => setForm({ ...form, salaryType: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="monthly">Monthly Salary</option>
            <option value="hourly">Hourly Rate</option>
          </select>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-500">₦</span>
            <input
              type="number"
              placeholder="Salary amount"
              value={form.salaryAmount || ""}
              onChange={(e) => setForm({ ...form, salaryAmount: Number(e.target.value) })}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          {form.role === "store_keeper" && (
            <select
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select a store...</option>
              {stores.map((store) => (
                <option key={store._id} value={store._id}>
                  {store.storeName}
                </option>
              ))}
            </select>
          )}
          {form.role === "staff" && (
            <select
              value={form.branchId || ""}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            >
              <option value="">Default to active branch...</option>
              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.branchName}
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
              <th className="px-3 py-2">Device ID</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">Branch / Store</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupStaff(staff).map((section) => (
              <Fragment key={section.label}>
                <tr className="bg-zinc-50">
                  <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {section.label} ({section.members.length})
                  </td>
                </tr>
                {section.members.map((member) => (
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
                    <td className="px-3 py-2 text-zinc-600">{member.employeeId || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">
                      <div className="capitalize">
                        {(member.employmentType || "full_time").replace("_", " ")}
                      </div>
                      <div className="text-xs">
                        ₦{(member.salaryAmount || 0).toLocaleString()} / {member.salaryType || "monthly"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {branches.length > 0 && (member.role === "staff" || member.role === "pharmacist") ? (
                        <select
                          value={member.branchId || ""}
                          onChange={(e) => updateBranch(member._id, e.target.value)}
                          className="rounded border border-zinc-300 px-2 py-1 text-sm"
                        >
                          <option value="">Select branch...</option>
                          {branches.map((b) => (
                            <option key={b._id} value={b._id}>
                              {b.branchName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        member.branchName || member.storeName || "—"
                      )}
                    </td>
                    <td className="flex flex-wrap gap-3 px-3 py-2">
                      <button onClick={() => resetPassword(member._id)} className="text-teal-700 hover:underline">
                        Reset password
                      </button>
                      {credentials !== undefined && (
                        <button onClick={() => setCredentialTarget(member)} className="text-teal-700 hover:underline">
                          Clock-in PIN/Face
                          {(() => {
                            const c = credentialByUserId.get(member._id);
                            return c?.hasPin || c?.hasFace ? " ✓" : "";
                          })()}
                        </button>
                      )}
                      <button onClick={() => deleteStaff(member._id)} className="text-red-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {credentialTarget && (
        <StaffCredentialsModal
          userId={credentialTarget._id}
          name={credentialTarget.name}
          branchId={credentialTarget.branchId}
          status={credentialByUserId.get(credentialTarget._id)}
          onClose={() => setCredentialTarget(null)}
          onSaved={() => onCredentialsSaved?.()}
        />
      )}
    </div>
  );
}

interface StaffSection {
  label: string;
  members: StaffJSON[];
}

function groupStaff(staff: StaffJSON[]): StaffSection[] {
  const admins = staff.filter((s) => s.role === "admin");
  const storeManagers = staff.filter((s) => s.role === "store_manager");

  const byBranch = new Map<string, StaffJSON[]>();
  staff
    .filter((s) => s.role === "staff")
    .forEach((s) => {
      const key = s.branchName || "Unassigned branch";
      byBranch.set(key, [...(byBranch.get(key) || []), s]);
    });

  const byStore = new Map<string, StaffJSON[]>();
  staff
    .filter((s) => s.role === "store_keeper")
    .forEach((s) => {
      const key = s.storeName || "Unassigned store";
      byStore.set(key, [...(byStore.get(key) || []), s]);
    });

  const sections: StaffSection[] = [];
  if (admins.length > 0) sections.push({ label: "Admin", members: admins });
  if (storeManagers.length > 0) {
    sections.push({ label: "Store Manager (all bulk stores)", members: storeManagers });
  }
  Array.from(byBranch.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([label, members]) => sections.push({ label: `${label} (branch)`, members }));
  Array.from(byStore.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([label, members]) => sections.push({ label: `${label} (bulk store)`, members }));

  return sections;
}
