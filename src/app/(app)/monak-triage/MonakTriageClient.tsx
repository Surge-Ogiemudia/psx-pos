"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ResilientThumb from "@/components/ResilientThumb";

interface AiDraft {
  _id: string;
  frontImageUrl: string;
  backImageUrl: string | null;
  quantityInStock: number;
  retailPrice: number | null;
  category: "medicine" | "non-medicine" | "supermarket";
  createdAt: string;
  status: "pending" | "processing" | "extracted" | "completed" | "error" | "dismissed" | "confirming";
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  extractedExpiryDate?: string | null;
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

// A live catalog product — a hit here means this exact item was already triaged and
// confirmed before, most likely re-photographed off a second shelf.
interface CatalogMatch {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  quantityInStock: number;
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

// Stable 3-way split so 3 operators can each work a fixed lane without colliding.
// Based on the item's own id (not its position in the list), so an item never jumps
// lanes as new snaps arrive and the newest-first order shifts underneath it.
const LANE_COUNT = 3;
function laneOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % LANE_COUNT;
}

const VIEW_STORAGE_KEY = "psx_monak_triage_view";

interface Props {
  branchId: string;
}

export default function MonakTriageClient({ branchId }: Props) {
  // Panel 1 state
  const [snaps, setSnaps] = useState<AiDraft[]>([]);
  const [dismissedSnaps, setDismissedSnaps] = useState<AiDraft[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedSnap, setSelectedSnap] = useState<AiDraft | null>(null);

  // Which lane this operator/computer is working — "all" or 0/1/2. Persisted per browser
  // so each of the 3 computers keeps its assignment across reloads.
  const [viewFilter, setViewFilter] = useState<"all" | number>("all");
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "0" || saved === "1" || saved === "2") setViewFilter(Number(saved));
  }, []);
  function chooseView(v: "all" | number) {
    setViewFilter(v);
    localStorage.setItem(VIEW_STORAGE_KEY, String(v));
  }

  // Panel 2 state
  const [p2Search, setP2Search] = useState("");
  const [p2Results, setP2Results] = useState<Excel1Result[]>([]);
  const [p2Loading, setP2Loading] = useState(false);

  // Live-catalog duplicate check — a hit means this item was already triaged before,
  // most likely re-photographed off a second shelf. Kept separate from the Excel1
  // reference-list results since clicking one means "merge stock", not "autofill".
  const [catalogMatches, setCatalogMatches] = useState<CatalogMatch[]>([]);
  const [mergeTarget, setMergeTarget] = useState<CatalogMatch | null>(null);
  const [mergeQuantity, setMergeQuantity] = useState(1);
  const [mergeExpiryDate, setMergeExpiryDate] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState("");

  // Panel 3 state
  const [p3Search, setP3Search] = useState("");
  const [p3Results, setP3Results] = useState<Excel2Result[]>([]);
  const [p3Loading, setP3Loading] = useState(false);

  // AI fallback scan (only used when a human search turns up no match)
  const [aiScanning, setAiScanning] = useState(false);
  const [aiScanError, setAiScanError] = useState("");

  // Full-resolution zoom overlay (thumbnails are compressed; zoom shows the original)
  const [zoomImage, setZoomImage] = useState<string | null>(null);

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
      const res = await fetch(`/api/products/ai-drafts?branchId=${branchId}`);
      if (!res.ok) return;
      const data = await res.json();
      const all: AiDraft[] = data.drafts ?? [];
      setSnaps(all.filter((d) => d.status !== "completed" && d.status !== "dismissed"));
      setDismissedSnaps(all.filter((d) => d.status === "dismissed"));
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

  // --------------- Panel 2: live-catalog duplicate check (same search term) ---------------
  useEffect(() => {
    if (!debouncedP2) {
      setCatalogMatches([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/products?search=${encodeURIComponent(debouncedP2)}&branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCatalogMatches((d.products ?? []).slice(0, 5));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedP2, branchId]);

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
  function selectSnap(snap: AiDraft) {
    setSelectedSnap(snap);
    setForm({
      ...EMPTY_FORM,
      itemName: snap.extractedItemName || "",
      brand: snap.extractedBrand || "",
      size: snap.extractedSize || "",
      category: snap.category,
      expiryDate: snap.extractedExpiryDate ? snap.extractedExpiryDate.slice(0, 10) : "",
      quantity: snap.quantityInStock,
      retailPrice: snap.retailPrice || 0,
    });
    setP2Search("");
    setP3Search("");
    setP2Results([]);
    setP3Results([]);
    setCatalogMatches([]);
    setMergeTarget(null);
    setMergeError("");
    setSaveError("");
    setAiScanError("");
  }

  // --------------- Open the merge-confirm view for a possible catalog duplicate ---------------
  function openMergeConfirm(match: CatalogMatch) {
    setMergeTarget(match);
    setMergeQuantity(form.quantity || 1);
    setMergeExpiryDate(form.expiryDate);
    setMergeError("");
  }

  // --------------- Merge this snap's stock into an existing product ---------------
  async function handleMerge() {
    if (!selectedSnap || !mergeTarget) return;
    setMerging(true);
    setMergeError("");
    try {
      const res = await fetch(`/api/products/ai-drafts/${selectedSnap._id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: mergeTarget._id,
          quantity: mergeQuantity,
          expiryDate: mergeExpiryDate || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Merge failed" }));
        throw new Error(err.error ?? "Merge failed");
      }

      setSnaps((prev) => prev.filter((s) => s._id !== selectedSnap._id));
      setSelectedSnap(null);
      setForm({ ...EMPTY_FORM });
      setMergeTarget(null);
      setP2Search("");
      setP3Search("");
      setP2Results([]);
      setP3Results([]);
      setCatalogMatches([]);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  // --------------- AI fallback: scan the image when no manual match was found ---------------
  async function handleAiScan() {
    if (!selectedSnap) return;
    setAiScanning(true);
    setAiScanError("");
    try {
      const res = await fetch(`/api/products/ai-drafts/${selectedSnap._id}/process?stageOnly=true`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI scan failed");

      const draft = json.draft as {
        extractedItemName?: string | null;
        extractedBrand?: string | null;
        extractedSize?: string | null;
        extractedExpiryDate?: string | null;
        status: AiDraft["status"];
      };

      setForm((f) => ({
        ...f,
        itemName: draft.extractedItemName || f.itemName,
        brand: draft.extractedBrand || f.brand,
        size: draft.extractedSize || f.size,
        expiryDate: draft.extractedExpiryDate ? draft.extractedExpiryDate.slice(0, 10) : f.expiryDate,
      }));

      // Keep the snap's own record in sync so re-selecting it later keeps the scan result
      const updated: AiDraft = {
        ...selectedSnap,
        status: draft.status,
        extractedItemName: draft.extractedItemName,
        extractedBrand: draft.extractedBrand,
        extractedSize: draft.extractedSize,
        extractedExpiryDate: draft.extractedExpiryDate,
      };
      setSelectedSnap(updated);
      setSnaps((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
    } catch (err) {
      setAiScanError(err instanceof Error ? err.message : "AI scan failed");
    } finally {
      setAiScanning(false);
    }
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
        backImageUrl: selectedSnap.backImageUrl,
      };

      const res = await fetch(`/api/products/ai-drafts/${selectedSnap._id}/confirm`, {
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

  // --------------- Dismiss snap (reversible — kept on record, hidden from queue) ---------------
  async function handleDismiss(snap: AiDraft) {
    if (!confirm("Move this item out of the triage queue? It stays on record and can be restored.")) return;
    try {
      const res = await fetch(`/api/products/ai-drafts/${snap._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) return;
      const dismissed = { ...snap, status: "dismissed" as const };
      setSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      setDismissedSnaps((prev) => [dismissed, ...prev]);
      if (selectedSnap?._id === snap._id) {
        setSelectedSnap(null);
        setForm({ ...EMPTY_FORM });
      }
    } catch {
      // silent
    }
  }

  // --------------- Restore a dismissed snap back into the queue ---------------
  async function handleRestore(snap: AiDraft) {
    try {
      const res = await fetch(`/api/products/ai-drafts/${snap._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      if (!res.ok) return;
      const restored = { ...snap, status: "pending" as const };
      setDismissedSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      setSnaps((prev) => [restored, ...prev]);
    } catch {
      // silent
    }
  }

  const laneCounts = [0, 1, 2].map((lane) => snaps.filter((s) => laneOf(s._id) === lane).length);
  const visibleSnaps = viewFilter === "all" ? snaps : snaps.filter((s) => laneOf(s._id) === viewFilter);

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
            <div className="flex items-center gap-2">
              {dismissedSnaps.length > 0 && (
                <button
                  onClick={() => setShowDismissed((v) => !v)}
                  className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                    showDismissed ? "bg-zinc-700 text-white" : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
                  }`}
                >
                  {showDismissed ? "← Back to queue" : `🗑 Dismissed (${dismissedSnaps.length})`}
                </button>
              )}
              {!showDismissed && (
                <span className="text-xs bg-zinc-200 text-zinc-600 rounded-full px-2 py-0.5 font-normal">
                  {visibleSnaps.length} pending
                </span>
              )}
            </div>
          </div>
          {!showDismissed && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-100 bg-white">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mr-1">Working:</span>
              <button
                onClick={() => chooseView("all")}
                className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                  viewFilter === "all" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                All ({snaps.length})
              </button>
              {[0, 1, 2].map((lane) => (
                <button
                  key={lane}
                  onClick={() => chooseView(lane)}
                  className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                    viewFilter === lane ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  View {lane + 1} ({laneCounts[lane]})
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {showDismissed ? (
              <>
                {dismissedSnaps.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center mt-8">Nothing dismissed.</div>
                )}
                {dismissedSnaps.map((snap) => (
                  <div key={snap._id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-2 opacity-80">
                    <div className="flex gap-2 items-start">
                      <ResilientThumb
                        src={snap.frontImageUrl}
                        alt="Front"
                        className="w-20 h-20"
                        size={96}
                        onClick={() => setZoomImage(snap.frontImageUrl)}
                      />
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-xs bg-zinc-200 text-zinc-700 rounded-full px-2 py-0.5 font-medium w-fit">
                          Qty: {snap.quantityInStock}
                        </span>
                        <span className="text-xs text-zinc-400">{timeAgo(snap.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestore(snap)}
                      className="w-full py-1.5 text-xs font-semibold rounded-lg bg-zinc-700 text-white hover:bg-zinc-800"
                    >
                      ↩ Restore to queue
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                {visibleSnaps.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center mt-8">
                    {snaps.length === 0
                      ? "No pending snaps. Waiting for new items…"
                      : "Nothing in this view right now."}
                  </div>
                )}
                {visibleSnaps.map((snap, idx) => {
                  const isSelected = selectedSnap?._id === snap._id;
                  const isPriority = idx < 4;
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
                        <ResilientThumb
                          src={snap.frontImageUrl}
                          alt="Front"
                          className="w-20 h-20"
                          size={96}
                          priority={isPriority}
                          onClick={() => setZoomImage(snap.frontImageUrl)}
                        />
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          {snap.backImageUrl && (
                            <ResilientThumb
                              src={snap.backImageUrl}
                              alt="Back / Expiry"
                              className="w-full h-12"
                              size={128}
                              priority={isPriority}
                              onClick={() => setZoomImage(snap.backImageUrl)}
                            />
                          )}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs bg-zinc-100 text-zinc-700 rounded-full px-2 py-0.5 font-medium">
                              Qty: {snap.quantityInStock}
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
                          onClick={() => handleDismiss(snap)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
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
                {/* Images preview — tap to zoom in on the original full-res photo */}
                <div className="flex gap-3">
                  <ResilientThumb
                    src={selectedSnap.frontImageUrl}
                    alt="Front"
                    label="Front"
                    className="flex-1 h-36"
                    size={256}
                    priority
                    onClick={() => setZoomImage(selectedSnap.frontImageUrl)}
                  />
                  <ResilientThumb
                    src={selectedSnap.backImageUrl}
                    alt="Back / Expiry"
                    label="Back"
                    className="flex-1 h-36"
                    size={256}
                    priority
                    onClick={() => selectedSnap.backImageUrl && setZoomImage(selectedSnap.backImageUrl)}
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

                {/* TEMP DEBUG — remove once the Panel 2 rendering bug is found */}
                <div className="rounded-lg border-2 border-red-500 bg-red-50 p-2 text-[10px] font-mono text-red-900 break-all">
                  DEBUG p2Search="{p2Search}" p2Loading={String(p2Loading)} p2Results.length=
                  {p2Results.length} catalogMatches.length={catalogMatches.length}
                  <br />
                  p2Results={JSON.stringify(p2Results)}
                  <br />
                  catalogMatches={JSON.stringify(catalogMatches)}
                </div>

                {/* Already in catalog — likely the same item re-photographed off another shelf */}
                {catalogMatches.length > 0 && (
                  <div className="rounded-lg border-2 border-amber-300 bg-amber-50 overflow-hidden">
                    <div className="px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-100">
                      ⚠️ Already in your catalog — same item?
                    </div>
                    {catalogMatches.map((m) => (
                      <button
                        key={m._id}
                        onClick={() => openMergeConfirm(m)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-amber-100 border-t border-amber-200 flex items-center gap-2"
                      >
                        <ResilientThumb src={m.imageUrl} alt={m.itemName} className="h-10 w-10 shrink-0" size={64} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-zinc-800 leading-tight truncate">
                            {m.itemName} · {m.size}
                          </span>
                          <span className="block text-xs text-zinc-500">{m.brand}</span>
                        </span>
                        <span className="text-xs font-semibold text-amber-700 shrink-0">
                          {m.quantityInStock} in stock
                        </span>
                      </button>
                    ))}
                  </div>
                )}

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

                {/* No match found — AI fallback, only shown once a search came up empty */}
                {p2Search.trim() && !p2Loading && p2Results.length === 0 && (
                  <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">No matches in the stock list for &quot;{p2Search}&quot;.</span>
                    <button
                      onClick={handleAiScan}
                      disabled={aiScanning}
                      className="py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {aiScanning ? "🤖 Reading image…" : "🤖 Can't find it — scan the image"}
                    </button>
                    {aiScanError && <span className="text-xs text-red-600">{aiScanError}</span>}
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
                <ResilientThumb
                  src={selectedSnap.frontImageUrl}
                  alt="Front"
                  label="Front"
                  className="flex-1 h-44"
                  size={256}
                  priority
                  onClick={() => setZoomImage(selectedSnap.frontImageUrl)}
                />
                <ResilientThumb
                  src={selectedSnap.backImageUrl}
                  alt="Back / Expiry"
                  label="Back"
                  className="flex-1 h-44"
                  size={256}
                  priority
                  onClick={() => selectedSnap.backImageUrl && setZoomImage(selectedSnap.backImageUrl)}
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

      {/* ================================================================ */}
      {/* MERGE CONFIRM MODAL — same item, additional stock from elsewhere  */}
      {/* ================================================================ */}
      {mergeTarget && selectedSnap && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div className="bg-amber-50 px-5 py-4 border-b border-amber-200 flex items-center justify-between">
              <h2 className="font-bold text-amber-900 text-lg">⚠️ Is this the same item?</h2>
              <button
                onClick={() => setMergeTarget(null)}
                className="text-zinc-400 hover:text-zinc-700 text-xl font-bold leading-none"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-5 flex flex-col gap-5">
              <p className="text-sm text-zinc-600">
                Compare the two photos below. If it&apos;s the same product just found on another
                shelf, add these units to the existing stock instead of creating a duplicate.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wide text-center">
                    New snap
                  </span>
                  <ResilientThumb
                    src={selectedSnap.frontImageUrl}
                    alt="New snap"
                    className="w-full h-40"
                    size={256}
                    priority
                    onClick={() => setZoomImage(selectedSnap.frontImageUrl)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-amber-700 uppercase tracking-wide text-center">
                    Existing in catalog
                  </span>
                  <ResilientThumb
                    src={mergeTarget.imageUrl}
                    alt="Existing product"
                    className="w-full h-40"
                    size={256}
                    priority
                    onClick={() => mergeTarget.imageUrl && setZoomImage(mergeTarget.imageUrl)}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm">
                <div className="font-semibold text-zinc-800">
                  {mergeTarget.itemName} · {mergeTarget.size}
                </div>
                <div className="text-zinc-500">{mergeTarget.brand}</div>
                <div className="text-zinc-500 mt-1">
                  Currently <span className="font-semibold text-zinc-700">{mergeTarget.quantityInStock}</span> in stock
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Additional Quantity Found
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={mergeQuantity}
                    onChange={(e) => setMergeQuantity(Math.max(1, Number(e.target.value)))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Expiry Date (this batch)
                  </label>
                  <input
                    type="date"
                    value={mergeExpiryDate}
                    onChange={(e) => setMergeExpiryDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              {mergeError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                  ⚠️ {mergeError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-200 flex gap-3">
              <button
                onClick={() => setMergeTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 font-semibold text-sm hover:bg-zinc-50"
              >
                ✕ Not the same item
              </button>
              <button
                onClick={handleMerge}
                disabled={merging || mergeQuantity < 1}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {merging ? "Adding…" : `✅ Add ${mergeQuantity} to existing stock`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* ZOOM OVERLAY — full-resolution original, for reading fine print   */}
      {/* ================================================================ */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomImage(null)}
        >
          <button
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 text-white hover:text-zinc-300 bg-black/50 rounded-full p-2"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImage}
            alt="Full resolution"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
