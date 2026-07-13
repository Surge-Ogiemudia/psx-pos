"use client";

import { useState } from "react";
import { slugify, firstWordSlug } from "@/lib/slug";

const emptyForm = {
  pharmacyName: "",
  slug: "",
  slugTouched: false,
  branchName: "Main Branch",
  location: "",
  adminName: "",
  adminPhone: "",
  adminPassword: "",
  brandColor: "#0f766e",
  logoUrl: "",
  email: "",
  phone: "",
  address: "",
  storeName: "",
};

interface Result {
  slug: string;
  loginUrl: string;
  adminPhone: string;
  adminPassword: string;
}

export default function OnboardFormClient() {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  function updatePharmacyName(value: string) {
    setForm((prev) => ({
      ...prev,
      pharmacyName: value,
      slug: prev.slugTouched ? prev.slug : firstWordSlug(value),
    }));
  }

  async function submit() {
    setError(null);
    if (!form.pharmacyName.trim()) return setError("Pharmacy name is required.");
    if (!form.adminName.trim()) return setError("Admin name is required.");
    if (!form.adminPhone.trim()) return setError("Admin phone is required.");

    setSubmitting(true);
    const res = await fetch("/api/platform-onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pharmacyName: form.pharmacyName,
        slug: form.slug,
        branchName: form.branchName,
        location: form.location,
        adminName: form.adminName,
        adminPhone: form.adminPhone,
        adminPassword: form.adminPassword,
        brandColor: form.brandColor,
        logoUrl: form.logoUrl,
        email: form.email,
        phone: form.phone,
        address: form.address,
        storeName: form.storeName,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Failed to onboard pharmacy");
      return;
    }
    setResult(data);
  }

  if (result) {
    return (
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">Pharmacy onboarded</h1>
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm">
          <div className="mb-2">
            <span className="font-medium text-zinc-700">Login URL: </span>
            <span className="text-zinc-900">{result.loginUrl}</span>
          </div>
          <div className="mb-2">
            <span className="font-medium text-zinc-700">Phone: </span>
            <span className="text-zinc-900">{result.adminPhone}</span>
          </div>
          <div>
            <span className="font-medium text-zinc-700">Password: </span>
            <span className="text-zinc-900">{result.adminPassword}</span>
          </div>
        </div>
        <p className="mb-4 text-sm text-zinc-600">
          Copy these and share them with the pharmacy admin. Two manual steps still needed before their URL
          works: add <code className="rounded bg-zinc-100 px-1 py-0.5">{result.slug}.pos.psx.ng</code> as a
          domain in Vercel (Connect to Production), then add whatever CNAME record Vercel shows you at
          psx.ng&apos;s DNS provider.
        </p>
        <button
          onClick={() => {
            setResult(null);
            setForm(emptyForm);
          }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Onboard another
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">Onboard a pharmacy</h1>
      <p className="mb-6 text-sm text-zinc-500">Creates the pharmacy, a branch, and its admin account.</p>

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Pharmacy name *</label>
          <input
            value={form.pharmacyName}
            onChange={(e) => updatePharmacyName(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Slug (subdomain — {form.slug || "..."}.pos.psx.ng)
          </label>
          <input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: slugify(e.target.value), slugTouched: true })}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Branch name</label>
            <input
              value={form.branchName}
              onChange={(e) => setForm({ ...form, branchName: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Location (optional)</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Admin name *</label>
            <input
              value={form.adminName}
              onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Admin phone *</label>
            <input
              value={form.adminPhone}
              onChange={(e) => setForm({ ...form, adminPhone: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Admin password (optional — auto-generated if left blank)
          </label>
          <input
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Brand color</label>
            <input
              type="text"
              value={form.brandColor}
              onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Logo URL (optional)</label>
            <input
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Contact email (optional)</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Contact phone (optional)</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Address (optional)</label>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Bulk store name (optional — only if they need one on day one)
          </label>
          <input
            value={form.storeName}
            onChange={(e) => setForm({ ...form, storeName: e.target.value })}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="mt-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Create pharmacy"}
        </button>
      </div>
    </div>
  );
}
