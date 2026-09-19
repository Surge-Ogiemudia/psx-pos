"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface MonakSnap {
  _id: string;
  frontImageUrl: string;
  expiryImageUrl: string;
  quantity: number;
  createdAt: string;
  status: "pending" | "processed";
}

interface Excel1Result {
  _id: string;
  itemName: string;
  expiryDate?: string;
  retailPrice: number;
  wholesalePrice: number;
}

interface Excel2Result {
  _id: string;
  itemName: string;
  category?: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

interface ProductForm {
  itemName: string;
  brand: string;
  size: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string;
  quantity: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

const EMPTY_FORM: ProductForm = {
  itemName: "",
  brand: "",
  size: "",
  category: "medicine",
  expiryDate: "",
  quantity: 1,
  retailPrice: 0,
  wholesalePrice: 0,
  distributorPrice: 0,
};

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface Props {
  branchId: string;
}

export default function MonakTriageClient({ branchId }: Props) {
  // Panel 1 state
  const [snaps, setSnaps] = useState<MonakSnap[]>([]);
  const [selectedSnap, setSelectedSnap] = useState<MonakSnap | null>(null);

  // Panel 2 state
  const [p2Search, setP2Search] = useState("");
  const [p2Results, setP2Results] = useState<Excel1Result[]>([]);
  const [p2Loading, setP2Loading] = useState(false);

  // Panel 3 state
  const [p3Search, setP3Search] = useState("");
  const [p3Results, setP3Results] = useState<Excel2Result[]>([]);
  const [p3Loading, setP3Loading] = useState(false);

  // Shared form state
  const [form, setForm] = useState<ProductForm>({ ...EMPTY_FORM });

  // Confirm modal
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Debounced search terms
  const debouncedP2 = useDebounce(p2Search, 300);
  const debouncedP3 = useDebounce(p3Search, 300);

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --------------- Fetch snaps ---------------
  const fetchSnaps = useCallback(async () => {
    try {
      const res = await fetch(`/api/monak-snaps?branchId=${branchId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSnaps(data.snaps ?? []);
    } catch {
      // silent
    }
  }, [branchId]);

  useEffect(() => {
    fetchSnaps();
    pollingRef.current = setInterval(fetchSnaps, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchSnaps]);

  // --------------- Panel 2 Search ---------------
  useEffect(() => {
    if (!debouncedP2) {
      setP2Results([]);
      return;
    }
    let cancelled = false;
    setP2Loading(true);
    fetch(`/api/monak-excel1?search=${encodeURIComponent(debouncedP2)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setP2Results(d.results ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setP2Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedP2]);

  // --------------- Panel 3 Search ---------------
  useEffect(() => {
    if (!debouncedP3) {
      setP3Results([]);
      return;
    }
    let cancelled = false;
    setP3Loading(true);
    fetch(`/api/monak-excel2?search=${encodeURIComponent(debouncedP3)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setP3Results(d.results ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setP3Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedP3]);

  // --------------- Select snap ---------------
  function selectSnap(snap: MonakSnap) {
    setSelectedSnap(snap);
    setForm({ ...EMPTY_FORM, quantity: snap.quantity });
    setP2Search("");
    setP3Search("");
    setP2Results([]);
    setP3Results([]);
    setSaveError("");
  }

  // --------------- Apply Excel1 result ---------------
  function applyExcel1(result: Excel1Result) {
    setForm((f) => ({
      ...f,
      itemName: result.itemName,
      expiryDate: result.expiryDate ?? "",
      retailPrice: result.retailPrice,
      wholesalePrice: result.wholesalePrice,
    }));
  }

  // --------------- Apply Excel2 result ---------------
  function applyExcel2(result: Excel2Result) {
    setForm((f) => ({
      ...f,
      retailPrice: result.retailPrice,
      wholesalePrice: result.wholesalePrice,
      distributorPrice: result.distributorPrice,
    }));
  }

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --------------- Save to catalog ---------------
  async function handleSave() {
    if (!selectedSnap) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        itemName: form.itemName,
        brand: form.brand,
        size: form.size || "Standard",
        category: form.category,
        expiryDate: form.expiryDate || null,
        quantity: form.quantity,
        retailPrice: form.retailPrice,
        wholesalePrice: form.wholesalePrice,
        distributorPrice: form.distributorPrice,
        frontImageUrl: selectedSnap.frontImageUrl,
        expiryImageUrl: selectedSnap.expiryImageUrl,
      };

      const res = await fetch(`/api/monak-snaps/${selectedSnap._id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error ?? "Save failed");
      }

      // Remove from queue
      setSnaps((prev) => prev.filter((s) => s._id !== selectedSnap._id));
      setSelectedSnap(null);
      setForm({ ...EMPTY_FORM });
      setShowModal(false);
      setP2Search("");
      setP3Search("");
      setP2Results([]);
      setP3Results([]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // --------------- Delete snap ---------------
  async function handleDelete(snap: MonakSnap) {
    if (!confirm("Delete this snap from the queue?")) return;
    try {
      await fetch(`/api/monak-snaps/${snap._id}`, { method: "DELETE" });
      setSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      if (selectedSnap?._id === snap._id) {
        setSelectedSnap(null);
        setForm({ ...EMPTY_FORM });
      }
    } catch {
      // silent
    }
  }

  return (
    // Break out of the layout's max-w-6xl by using negative margins
    <div className="-mx-4 -my-6 sm:-mx-6">
      <div className="grid grid-cols-3 gap-4 h-[calc(100vh-4rem)] p-4">

        {/* ============================================================ */}
        {/* PANEL 1 — Live Queue                                          */}
        {/* ============================================================ */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow">
          <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 font-semibold text-zinc-700 flex items-center justify-between">
            <span>📥 Live Queue</span>
            <span className="text-xs bg-zinc-200 text-zinc-600 rounded-full px-2 py-0.5 font-normal">
              {snaps.length} pending
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {snaps.length === 0 && (
              <div className="text-zinc-400 text-sm text-center mt-8">
                No pending snaps. Waiting for new items…
              </div>
            )}
            {snaps.map((snap) => {
              const isSelected = selectedSnap?._id === snap._id;
              return (
                <div
                  key={snap._id}
                  className={`rounded-lg border p-3 flex flex-col gap-2 cursor-pointer transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 shadow-md"
                      : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  <div className="flex gap-2 items-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={snap.frontImageUrl}
                      alt="Front"
                      className="w-20 h-20 rounded object-cover border border-zinc-200 shrink-0"
                    />
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={snap.expiryImageUrl}
                        alt="Expiry"
                        className="w-full h-12 rounded object-cover border border-zinc-200"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs bg-zinc-100 text-zinc-700 rounded-full px-2 py-0.5 font-medium">
                          Qty: {snap.quantity}
                        </span>
                        <span className="text-xs text-zinc-400">{timeAgo(snap.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => selectSnap(snap)}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Triage →
                    </button>
                    <button
                      onClick={() => handleDelete(snap)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PANEL 2 — Match Name                                          */}
        {/* ============================================================ */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow">
          <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 font-semibold text-zinc-700">
            📋 Match from Stock List
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {!selectedSnap ? (
              <div className="text-zinc-400 text-sm text-center mt-8">
                Select a snap from the queue to begin triaging
              </div>
            ) : (
              <>
                {/* Images preview */}
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedSnap.frontImageUrl}
                    alt="Front"
                    className="flex-1 rounded-lg object-contain border border-zinc-200 max-h-36 bg-zinc-50"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedSnap.expiryImageUrl}
                    alt="Expiry"
                    className="flex-1 rounded-lg object-contain border border-zinc-200 max-h-36 bg-zinc-50"
                  />
                </div>

                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search stock list by name…"
                    value={p2Search}
                    onChange={(e) => setP2Search(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {p2Loading && (
                    <span className="absolute right-3 top-2 text-xs text-zinc-400">searching…</span>
                  )}
                </div>

                {/* Results */}
                {p2Results.length > 0 && (
                  <div className="rounded-lg border border-zinc-200 overflow-hidden">
                    {p2Results.map((r) => (
                      <button
                        key={r._id}
                        onClick={() => applyExcel1(r)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-zinc-100 last:border-b-0 flex justify-between items-start gap-2"
                      >
                        <span className="font-medium text-zinc-800 leading-tight">{r.itemName}</span>
                        <span className="text-xs text-zinc-500 shrink-0 text-right">
                          <span className="block">₦{r.retailPrice?.toLocaleString()}</span>
                          {r.expiryDate && <span className="block text-zinc-400">{r.expiryDate}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Form fields - name side */}
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Item Name</label>
                    <input
                      type="text"
                      value={form.itemName}
                      onChange={(e) => updateForm("itemName", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="e.g. Amoxicillin"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Size / Strength</label>
                    <input
                      type="text"
                      value={form.size}
                      onChange={(e) => updateForm("size", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="e.g. 500mg, 1L, Standard"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Brand</label>
                    <input
                      type="text"
                      value={form.brand}
                      onChange={(e) => updateForm("brand", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="e.g. Emzor, Beecham"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Category</label>
                    <select
                      value={form.category}
                      onChange={(e) => updateForm("category", e.target.value as ProductForm["category"])}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="medicine">Medicine</option>
                      <option value="non-medicine">Non-Medicine</option>
                      <option value="supermarket">Supermarket</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Expiry Date</label>
                    <input
                      type="date"
                      value={form.expiryDate}
                      onChange={(e) => updateForm("expiryDate", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PANEL 3 — Match Price                                         */}
        {/* ============================================================ */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow">
          <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 font-semibold text-zinc-700">
            💰 Match Prices
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {!selectedSnap ? (
              <div className="text-zinc-400 text-sm text-center mt-8">
                Select a snap to match prices
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search price list by name…"
                    value={p3Search}
                    onChange={(e) => setP3Search(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {p3Loading && (
                    <span className="absolute right-3 top-2 text-xs text-zinc-400">searching…</span>
                  )}
                </div>

                {/* Results */}
                {p3Results.length > 0 && (
                  <div className="rounded-lg border border-zinc-200 overflow-hidden">
                    {p3Results.map((r) => (
                      <button
                        key={r._id}
                        onClick={() => applyExcel2(r)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-zinc-100 last:border-b-0 flex justify-between items-start gap-2"
                      >
                        <span className="font-medium text-zinc-800 leading-tight">{r.itemName}</span>
                        <span className="text-xs text-zinc-500 shrink-0 text-right">
                          <span className="block">Ret: ₦{r.retailPrice?.toLocaleString()}</span>
                          <span className="block text-zinc-400">Dist: ₦{r.distributorPrice?.toLocaleString()}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Price fields */}
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Retail Price (₦)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={form.retailPrice}
                      onChange={(e) => updateForm("retailPrice", Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Wholesale Price (₦)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={form.wholesalePrice}
                      onChange={(e) => updateForm("wholesalePrice", Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Distributor Price (₦)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={form.distributorPrice}
                      onChange={(e) => updateForm("distributorPrice", Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={form.quantity}
                      onChange={(e) => updateForm("quantity", Math.max(1, Number(e.target.value)))}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {/* Confirm button */}
                <button
                  onClick={() => { setSaveError(""); setShowModal(true); }}
                  disabled={!form.itemName || !form.brand}
                  className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed mt-auto"
                >
                  ✅ Confirm &amp; Save
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* CONFIRMATION MODAL                                                */}
      {/* ================================================================ */}
      {showModal && selectedSnap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div className="bg-zinc-50 px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h2 className="font-bold text-zinc-800 text-lg">Review &amp; Confirm Product</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-zinc-700 text-xl font-bold leading-none"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-5 flex flex-col gap-5">
              {/* Images */}
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedSnap.frontImageUrl}
                  alt="Front"
                  className="flex-1 rounded-xl object-contain border border-zinc-200 max-h-44 bg-zinc-50"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedSnap.expiryImageUrl}
                  alt="Expiry"
                  className="flex-1 rounded-xl object-contain border border-zinc-200 max-h-44 bg-zinc-50"
                />
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Item Name *</label>
                  <input
                    type="text"
                    value={form.itemName}
                    onChange={(e) => updateForm("itemName", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Brand *</label>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={(e) => updateForm("brand", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Size / Strength</label>
                  <input
                    type="text"
                    value={form.size}
                    onChange={(e) => updateForm("size", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Standard"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => updateForm("category", e.target.value as ProductForm["category"])}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="medicine">Medicine</option>
                    <option value="non-medicine">Non-Medicine</option>
                    <option value="supermarket">Supermarket</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Expiry Date</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => updateForm("expiryDate", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => updateForm("quantity", Math.max(1, Number(e.target.value)))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Retail Price (₦)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.retailPrice}
                    onChange={(e) => updateForm("retailPrice", Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Wholesale Price (₦)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.wholesalePrice}
                    onChange={(e) => updateForm("wholesalePrice", Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Distributor Price (₦)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.distributorPrice}
                    onChange={(e) => updateForm("distributorPrice", Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              {saveError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                  ⚠️ {saveError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-200 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 font-semibold text-sm hover:bg-zinc-50"
              >
                Back to Edit
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.itemName || !form.brand}
                className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "💾 Save to Catalog"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
