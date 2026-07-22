"use client";

import { useEffect, useState } from "react";
import type { StaffJSON, StoreJSON, StaffCredentialStatusJSON, BranchJSON } from "@/lib/types";
import StaffDirectory from "./components/StaffDirectory";
import ShiftManagement from "./components/ShiftManagement";
import StaffSettings from "./components/StaffSettings";
import AttendanceReport from "./components/AttendanceReport";

type Role = "admin" | "staff" | "store_manager" | "store_keeper" | "pharmacist";

const emptyForm = {
  name: "",
  role: "staff" as Role,
  phoneNumber: "",
  password: "",
  branchId: "",
  storeId: "",
  employmentType: "full_time",
  salaryType: "monthly",
  salaryAmount: 0,
};

type Tab = "directory" | "shifts" | "attendance" | "settings";

export default function StaffClient({ branchId, userRole }: { branchId: string | null; userRole: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("directory");
  const [staff, setStaff] = useState<StaffJSON[]>([]);
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [branches, setBranches] = useState<BranchJSON[]>([]);
  const [credentials, setCredentials] = useState<StaffCredentialStatusJSON[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  async function loadStaff() {
    const res = await fetch("/api/staff");
    if (res.ok) setStaff((await res.json()).staff);
  }

  async function loadCredentials() {
    if (userRole !== "admin") return;
    const res = await fetch("/api/staff/credentials");
    if (res.ok) setCredentials((await res.json()).credentials);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadStaff();
      loadCredentials();
      fetch("/api/stores")
        .then((res) => (res.ok ? res.json() : { stores: [] }))
        .then((data) => setStores(data.stores || []));
      fetch("/api/branches")
        .then((res) => (res.ok ? res.json() : { branches: [] }))
        .then((data) => setBranches(data.branches || []));
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStaff() {
    setError(null);
    const payload = {
      ...form,
      branchId: form.branchId || branchId, // fallback to active branch if not specified
    };

    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      <h1 className="mb-6 text-2xl font-bold text-zinc-900">Staff Management</h1>

      <div className="mb-6 border-b border-zinc-200">
        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("directory")}
            className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium ${
              activeTab === "directory"
                ? "border-teal-600 text-teal-600"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
            }`}
          >
            Directory
          </button>
          <button
            onClick={() => setActiveTab("shifts")}
            className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium ${
              activeTab === "shifts"
                ? "border-teal-600 text-teal-600"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
            }`}
          >
            Shifts
          </button>
          {userRole === "admin" && (
            <button
              onClick={() => setActiveTab("attendance")}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium ${
                activeTab === "attendance"
                  ? "border-teal-600 text-teal-600"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
              }`}
            >
              Attendance
            </button>
          )}
          {userRole === "admin" && (
            <button
              onClick={() => setActiveTab("settings")}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium ${
                activeTab === "settings"
                  ? "border-teal-600 text-teal-600"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
              }`}
            >
              Settings
            </button>
          )}
        </nav>
      </div>

      {activeTab === "directory" && (
        <StaffDirectory
          staff={staff}
          stores={stores}
          branches={branches}
          showForm={showForm}
          setShowForm={setShowForm}
          form={form}
          setForm={setForm}
          error={error}
          createStaff={createStaff}
          updateRole={updateRole}
          resetPassword={resetPassword}
          deleteStaff={deleteStaff}
          credentials={userRole === "admin" ? credentials : undefined}
          onCredentialsSaved={loadCredentials}
        />
      )}

      {activeTab === "shifts" && <ShiftManagement branchId={branchId} staff={staff} />}

      {activeTab === "attendance" && <AttendanceReport branchId={branchId} staff={staff} />}

      {activeTab === "settings" && <StaffSettings />}
    </div>
  );
}
