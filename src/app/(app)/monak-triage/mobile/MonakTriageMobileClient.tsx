"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { cleanStr, diceSimilarity } from "@/lib/fuzzyMatch";
import { laneOf, VIEW_STORAGE_KEY } from "@/lib/triageLanes";

// ---------------------------------------------------------------------------
// Mobile "one card at a time" view of Monak Triage — built from the same live
// data/endpoints as the desktop 4-panel tool (MonakTriageClient.tsx). See that
// file for the canonical shapes; interfaces below are trimmed to what this
// screen actually renders.
// ---------------------------------------------------------------------------

interface AiDraft {
  _id: string;
  frontImageUrl: string;
  backImageUrl: string | null;
  quantityInStock: number;
  retailPrice: number | null;
  category: "medicine" | "non-medicine" | "supermarket";
  createdAt: string;
  status: "pending" | "processing" | "extracted" | "completed" | "error" | "dismissed" | "confirming" | "skipped";
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  extractedExpiryDate?: string | null;
  productId?: string | null;
}

interface Excel1Result {
  _id: string;
  itemName: string;
  expiryDate?: string;
  retailPrice: number;
  wholesalePrice: number;
}

interface CatalogMatch {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  quantityInStock: number;
}

interface SiblingDraft {
  draftId: string;
  productId: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  quantityInStock: number;
  createdAt: string;
}

interface SiblingKeptProduct {
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

// Same Excel-serial-date guard as desktop (MonakTriageClient.tsx normalizeExpiryDate) —
// monak-excel1's expiryDate field sometimes holds a raw Excel serial number as a string.
function normalizeExpiryDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^\d{4,6}$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 32000 && serial < 73000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + serial * 86400000).toISOString().slice(0, 10);
    }
    return "";
  }
  return trimmed.slice(0, 10);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Display-only match confidence — mirrors the same clean+Dice algorithm the
// monak-excel1 API uses server-side (lib/fuzzyMatch.ts) to rank results, since the
// API itself doesn't ship the numeric score back to the client.
function matchPct(query: string, candidate: string): number {
  const cleanQuery = cleanStr(query);
  const cleanCandidate = cleanStr(candidate);
  let score = diceSimilarity(cleanQuery, cleanCandidate);
  if (cleanQuery && cleanCandidate === cleanQuery) score = 1;
  else if (cleanQuery && cleanCandidate.startsWith(cleanQuery)) score = Math.max(score, 0.97);
  else if (cleanQuery && cleanCandidate.includes(cleanQuery)) score = Math.max(score, 0.9);
  return Math.round(score * 100);
}

// Vercel Edge WebP thumbnail URL — same trick as ResilientThumb.tsx, reimplemented
// here (rather than importing the component) so the photo card can control its own
// full-bleed layout/toggle instead of ResilientThumb's fixed thumbnail chrome.
function imgSrc(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  return url.startsWith("http") ? `/_next/image?url=${encodeURIComponent(url)}&w=${size}&q=80` : url;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const PRICE_CHIPS = [500, 1000, 2000, 5000];

// The Next.js image optimizer occasionally fails on these (large raw camera photos) —
// falls back to the original, unoptimized URL rather than sitting on a broken image icon.
// Same resilience pattern as ResilientThumb.tsx. Keyed by rawSrc so it resets per photo.
function TriagePhoto({
  optimizedSrc,
  rawSrc,
  alt,
  className,
}: {
  optimizedSrc: string;
  rawSrc: string;
  alt: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={rawSrc}
      src={hasError ? rawSrc : optimizedSrc}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}

interface Props {
  branchId: string;
}

export default function MonakTriageMobileClient({ branchId }: Props) {
  // ------------------------------------------------------------------ queue
  const [rawQueue, setRawQueue] = useState<AiDraft[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/ai-drafts?branchId=${branchId}`);
      if (!res.ok) return;
      const data = await res.json();
      const all: AiDraft[] = data.drafts ?? [];
      const active = all.filter(
        (d) => d.status !== "completed" && d.status !== "dismissed" && d.status !== "skipped" && d.status !== "confirming"
      );
      setRawQueue(active);
      setQueueLoaded(true);
    } catch {
      // silent — keep whatever we already had
    }
  }, [branchId]);

  useEffect(() => {
    fetchQueue();
    pollingRef.current = setInterval(fetchQueue, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchQueue]);

  // Which lane this operator/phone is working — "all" or 0/1/2. Same partitioning and
  // same localStorage key as the desktop tool (src/lib/triageLanes.ts), so "View 1" means
  // the identical set of items on both. Persists across refresh until changed here.
  const [viewFilter, setViewFilter] = useState<"all" | number>("all");
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "0" || saved === "1" || saved === "2") setViewFilter(Number(saved));
  }, []);
  function chooseView(v: "all" | number) {
    setViewFilter(v);
    localStorage.setItem(VIEW_STORAGE_KEY, String(v));
  }
  const laneCounts = [0, 1, 2].map((lane) => rawQueue.filter((d) => laneOf(d._id) === lane).length);
  const queue = useMemo(
    () => (viewFilter === "all" ? rawQueue : rawQueue.filter((d) => laneOf(d._id) === viewFilter)),
    [rawQueue, viewFilter]
  );

  // Land on the first item once the queue first loads, and follow along if the current
  // item disappears from underneath us (e.g. another operator took it, or the view just changed).
  useEffect(() => {
    if (!queueLoaded) return;
    if (currentId && queue.some((d) => d._id === currentId)) return;
    setCurrentId(queue[0]?._id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueLoaded, queue]);

  const currentIndex = currentId ? queue.findIndex((d) => d._id === currentId) : -1;
  const currentDraft = currentIndex >= 0 ? queue[currentIndex] : null;

  function goTo(id: string | null) {
    setCurrentId(id);
  }

  // Removes the just-processed item(s) from the live queue and advances to whichever
  // remaining item was sitting immediately after the current one.
  function goNext(removeIds: string[]) {
    setRawQueue((prev) => prev.filter((d) => !removeIds.includes(d._id)));
    const remaining = queue.filter((d) => !removeIds.includes(d._id));
    const nextAfterCurrent = remaining.find((d) => queue.indexOf(d) > currentIndex);
    setCurrentId(nextAfterCurrent?._id ?? remaining[0]?._id ?? null);
  }

  // Simple positional back-step through the still-live queue — not an "undo" of a
  // save/skip/merge (those are terminal, same as desktop), just a way to glance back
  // at the card before this one without touching anything.
  function goPrev() {
    if (currentIndex > 0) setCurrentId(queue[currentIndex - 1]._id);
  }

  // ------------------------------------------------------------------ form
  const [form, setForm] = useState<ProductForm>({ ...EMPTY_FORM });
  const [activePhoto, setActivePhoto] = useState<"front" | "back">("front");
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [showQueueBrowser, setShowQueueBrowser] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);

  useEffect(() => {
    if (!currentDraft) {
      setForm({ ...EMPTY_FORM });
      return;
    }
    setForm({
      ...EMPTY_FORM,
      itemName: currentDraft.extractedItemName || "",
      brand: currentDraft.extractedBrand || "",
      size: currentDraft.extractedSize || "",
      category: currentDraft.category,
      expiryDate: currentDraft.extractedExpiryDate ? currentDraft.extractedExpiryDate.slice(0, 10) : "",
      quantity: currentDraft.quantityInStock,
      retailPrice: currentDraft.retailPrice || 0,
    });
    setActivePhoto("front");
    setSaveError("");
    setSkipError("");
  }, [currentDraft?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ------------------------------------------------------- suggestions (P2)
  const searchTerm = form.itemName;
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [suggestions, setSuggestions] = useState<Excel1Result[]>([]);

  useEffect(() => {
    if (!debouncedSearch.trim() || !currentDraft) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/monak-excel1?search=${encodeURIComponent(debouncedSearch)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSuggestions(d.results ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, currentDraft?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rankedSuggestions = useMemo(
    () =>
      suggestions
        .map((s) => ({ ...s, pct: matchPct(debouncedSearch, s.itemName) }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 5),
    [suggestions, debouncedSearch]
  );

  function applySuggestion(r: Excel1Result) {
    setForm((f) => ({
      ...f,
      itemName: r.itemName,
      expiryDate: normalizeExpiryDate(r.expiryDate) || f.expiryDate,
      retailPrice: r.retailPrice,
      wholesalePrice: r.wholesalePrice,
    }));
  }

  // ------------------------------------------------- catalog duplicate check
  const [catalogMatches, setCatalogMatches] = useState<CatalogMatch[]>([]);
  useEffect(() => {
    if (!debouncedSearch.trim() || !currentDraft) {
      setCatalogMatches([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/monak-catalog-check?search=${encodeURIComponent(debouncedSearch)}&branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCatalogMatches(d.products ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, branchId, currentDraft?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [catalogSheetTarget, setCatalogSheetTarget] = useState<CatalogMatch | null>(null);
  const [catalogMergeQty, setCatalogMergeQty] = useState(1);
  const [catalogMergeExpiry, setCatalogMergeExpiry] = useState("");
  const [catalogMerging, setCatalogMerging] = useState(false);
  const [catalogMergeError, setCatalogMergeError] = useState("");

  function openCatalogSheet(m: CatalogMatch) {
    setCatalogSheetTarget(m);
    setCatalogMergeQty(form.quantity || 1);
    setCatalogMergeExpiry(form.expiryDate);
    setCatalogMergeError("");
  }

  async function confirmCatalogMerge() {
    if (!currentDraft || !catalogSheetTarget) return;
    setCatalogMerging(true);
    setCatalogMergeError("");
    try {
      const res = await fetch(`/api/products/ai-drafts/${currentDraft._id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: catalogSheetTarget._id,
          quantity: catalogMergeQty,
          expiryDate: catalogMergeExpiry || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Merge failed" }));
        throw new Error(err.error ?? "Merge failed");
      }
      setCatalogSheetTarget(null);
      goNext([currentDraft._id]);
    } catch (err) {
      setCatalogMergeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setCatalogMerging(false);
    }
  }

  // --------------------------------------------------- sibling duplicates
  // Detection only — nothing here writes anything. The explicit "Merge selected
  // into this item" action below is the ONLY path that calls merge-duplicates,
  // mirroring the hard rule from the desktop tool: nothing auto-merges.
  const [siblingDrafts, setSiblingDrafts] = useState<SiblingDraft[]>([]);
  const [siblingKeptProduct, setSiblingKeptProduct] = useState<SiblingKeptProduct | null>(null);
  const [siblingPanelOpen, setSiblingPanelOpen] = useState(true);
  const [siblingSelection, setSiblingSelection] = useState<Record<string, boolean>>({});
  const [siblingFinalQty, setSiblingFinalQty] = useState(0);
  const [siblingQtyTouched, setSiblingQtyTouched] = useState(false);
  const [siblingMerging, setSiblingMerging] = useState(false);
  const [siblingMergeError, setSiblingMergeError] = useState("");

  useEffect(() => {
    if (!currentDraft) {
      setSiblingDrafts([]);
      setSiblingKeptProduct(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/products/ai-drafts/${currentDraft._id}/siblings`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const sibs: SiblingDraft[] = d.siblings ?? [];
        setSiblingDrafts(sibs);
        setSiblingKeptProduct(d.keptProduct ?? null);
        const initialSelection: Record<string, boolean> = {};
        for (const s of sibs) initialSelection[s.draftId] = true;
        setSiblingSelection(initialSelection);
        setSiblingQtyTouched(false);
        setSiblingPanelOpen(true);
        setSiblingMergeError("");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentDraft?._id]);

  const siblingCombinedQty =
    (siblingKeptProduct?.quantityInStock ?? 0) +
    siblingDrafts.filter((s) => siblingSelection[s.draftId]).reduce((sum, s) => sum + s.quantityInStock, 0);

  // Live-recompute the suggested total whenever a checkbox is toggled, unless the
  // operator has already typed their own number into the field.
  useEffect(() => {
    if (!siblingQtyTouched) setSiblingFinalQty(siblingCombinedQty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingCombinedQty]);

  function toggleSibling(draftId: string) {
    setSiblingSelection((prev) => ({ ...prev, [draftId]: !prev[draftId] }));
  }

  const selectedSiblingIds = siblingDrafts.filter((s) => siblingSelection[s.draftId]).map((s) => s.draftId);

  async function handleSiblingMerge() {
    if (!currentDraft) return;
    if (selectedSiblingIds.length === 0) {
      setSiblingMergeError("Select at least one duplicate, or leave them unchecked and Save & Next normally.");
      return;
    }
    setSiblingMerging(true);
    setSiblingMergeError("");
    try {
      const res = await fetch(`/api/products/ai-drafts/${currentDraft._id}/merge-duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siblingDraftIds: selectedSiblingIds,
          finalQuantity: siblingFinalQty,
          itemName: form.itemName,
          brand: form.brand,
          size: form.size || "Standard",
          category: form.category,
          expiryDate: form.expiryDate || null,
          retailPrice: form.retailPrice,
          wholesalePrice: form.wholesalePrice,
          distributorPrice: form.distributorPrice,
          frontImageUrl: currentDraft.frontImageUrl,
          backImageUrl: currentDraft.backImageUrl,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Merge failed");
      goNext([currentDraft._id, ...selectedSiblingIds]);
    } catch (err) {
      setSiblingMergeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setSiblingMerging(false);
    }
  }

  // --------------------------------------------------------------- skip
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState("");

  async function handleSkip() {
    if (!currentDraft) return;
    setSkipping(true);
    setSkipError("");
    try {
      const res = await fetch(`/api/products/ai-drafts/${currentDraft._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Skip failed" }));
        throw new Error(err.error ?? "Skip failed");
      }
      goNext([currentDraft._id]);
    } catch (err) {
      setSkipError(err instanceof Error ? err.message : "Skip failed");
    } finally {
      setSkipping(false);
    }
  }

  // ------------------------------------------------------- save & next
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSaveAndNext() {
    if (!currentDraft) return;
    if (!form.itemName.trim()) {
      setSaveError("Item name is required.");
      setShowEditSheet(true);
      return;
    }
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
        frontImageUrl: currentDraft.frontImageUrl,
        backImageUrl: currentDraft.backImageUrl,
      };
      const res = await fetch(`/api/products/ai-drafts/${currentDraft._id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error ?? "Save failed");
      }
      goNext([currentDraft._id]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------- render
  const total = queue.length;
  const position = currentIndex >= 0 ? currentIndex + 1 : 0;
  const progressPct = total > 0 ? Math.round((position / total) * 100) : 0;

  const frontUrl = currentDraft ? imgSrc(currentDraft.frontImageUrl, 640) : null;
  const backUrl = currentDraft ? imgSrc(currentDraft.backImageUrl, 640) : null;
  const activeUrl = activePhoto === "front" ? frontUrl : backUrl;
  const activeRawUrl = currentDraft ? (activePhoto === "front" ? currentDraft.frontImageUrl : currentDraft.backImageUrl) : null;

  const categoryLabel =
    form.category === "medicine" ? "💊 Medicine" : form.category === "supermarket" ? "🛒 Supermarket" : "📦 Non-Medicine";

  if (!queueLoaded) {
    return (
      <div className="-mx-4 -my-6 sm:-mx-6 min-h-[70vh] flex items-center justify-center bg-zinc-950">
        <span className="text-zinc-400 text-sm">Loading queue…</span>
      </div>
    );
  }

  if (!currentDraft) {
    return (
      <div className="-mx-4 -my-6 sm:-mx-6 min-h-[70vh] flex flex-col items-center justify-center gap-2 bg-zinc-950 text-center px-6">
        <span className="text-4xl">✅</span>
        <span className="text-zinc-100 font-semibold">Queue is clear</span>
        <span className="text-zinc-500 text-sm">Nothing pending for this branch right now.</span>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 bg-zinc-950 text-zinc-50 min-h-[calc(100vh-4rem)]">
      <div className="mx-auto w-full max-w-md flex flex-col min-h-[calc(100vh-4rem)]">
        {/* Progress bar */}
        <div className="h-[5px] bg-zinc-900 shrink-0">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/90 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-[11px] font-extrabold text-emerald-400">
              M
            </div>
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-400">Monak Pharmacy</div>
              <div className="text-[11px] font-medium text-zinc-400">Triage — Mobile</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {viewFilter !== "all" && (
              <div className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400">
                View {(viewFilter as number) + 1}
              </div>
            )}
            <div className="rounded-full bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-xs font-bold text-zinc-300">
              {position}
              <span className="text-zinc-500"> / {total}</span>
            </div>
            <button
              aria-label="Switch view"
              onClick={() => setShowQueueBrowser(true)}
              className="w-8 h-8 rounded-[10px] bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center justify-center"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pt-3.5 pb-3 flex flex-col gap-3">
          {/* Photo card */}
          <div className="relative rounded-3xl bg-zinc-900 border border-zinc-800 overflow-hidden">
            <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex items-center justify-between">
              <div className="flex gap-1.5">
                <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {categoryLabel}
                </span>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-bold bg-zinc-950/80 text-zinc-200 border border-zinc-700">
                  📦 {form.quantity} counted
                </span>
              </div>
              <div className="flex bg-zinc-950/85 border border-zinc-700 rounded-full p-0.5">
                <button
                  onClick={() => setActivePhoto("front")}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                    activePhoto === "front" ? "bg-emerald-500 text-emerald-950" : "text-zinc-400"
                  }`}
                >
                  Front
                </button>
                <button
                  onClick={() => setActivePhoto("back")}
                  disabled={!backUrl}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold disabled:opacity-30 ${
                    activePhoto === "back" ? "bg-emerald-500 text-emerald-950" : "text-zinc-400"
                  }`}
                >
                  Back
                </button>
              </div>
            </div>
            <button
              className="h-[190px] w-full flex items-center justify-center bg-zinc-950"
              onClick={() => activeUrl && setZoomImage(activePhoto === "front" ? currentDraft.frontImageUrl : currentDraft.backImageUrl)}
            >
              {activeUrl && activeRawUrl ? (
                <TriagePhoto
                  optimizedSrc={activeUrl}
                  rawSrc={activeRawUrl}
                  alt={activePhoto}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-500 text-[11px] text-center">
                  No {activePhoto}
                  <br />
                  photo
                </div>
              )}
            </button>
          </div>

          {/* Identity card */}
          <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-[19px] font-extrabold leading-tight text-white">
                {form.itemName || "Unnamed item"}
              </h1>
              <button
                onClick={() => setShowEditSheet(true)}
                className="shrink-0 text-[11px] font-bold text-zinc-400 hover:text-zinc-200 px-0.5"
              >
                ✏️ Edit
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5 flex-wrap">
              {form.brand && (
                <span className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200">{form.brand}</span>
              )}
              {form.size && (
                <span className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200">{form.size}</span>
              )}
              {!form.brand && !form.size && (
                <span className="text-[11px] text-zinc-500">No brand/size yet — tap a match below or Edit</span>
              )}
            </div>

            <div className="mt-3.5 pt-3 border-t border-zinc-800">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-500 mb-2">
                Tap to match — no typing
              </div>
              <div className="flex flex-col gap-1.5">
                {rankedSuggestions.length === 0 && (
                  <div className="text-[11px] text-zinc-500">
                    {form.itemName.trim() ? "No matches in the stock list — use Edit to type it manually." : "Waiting for a name to search…"}
                  </div>
                )}
                {rankedSuggestions.map((s) => {
                  const active = s.itemName === form.itemName;
                  return (
                    <button
                      key={s._id}
                      onClick={() => applySuggestion(s)}
                      className={`text-left flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border ${
                        active ? "bg-emerald-500/10 border-emerald-500/40" : "bg-zinc-800 border-zinc-700"
                      }`}
                    >
                      <span className="text-xs font-bold text-zinc-200 leading-tight">{s.itemName}</span>
                      <span className="text-[11px] font-extrabold text-emerald-400 shrink-0">{s.pct}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Already-in-catalog warning — same "review, don't blindly trust" pattern as
              the sibling-duplicate banner below, driven by monak-catalog-check. */}
          {catalogMatches.length > 0 && (
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/40 overflow-hidden">
              <div className="px-3.5 py-2 text-xs font-extrabold text-rose-300">⚠️ Already in your catalog?</div>
              <div className="px-2 pb-2 flex flex-col gap-1.5">
                {catalogMatches.map((m) => (
                  <button
                    key={m._id}
                    onClick={() => openCatalogSheet(m)}
                    className="text-left flex items-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-zinc-200 truncate">
                        {m.itemName} · {m.size}
                      </span>
                      <span className="block text-[11px] text-zinc-500 truncate">{m.brand}</span>
                    </span>
                    <span className="text-[11px] font-bold text-rose-300 shrink-0">{m.quantityInStock} in stock</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sibling-duplicate warning — still-pending queue items that look like the
              same physical item. Nothing merges until the explicit button below is tapped. */}
          {siblingDrafts.length > 0 && (
            <div className="rounded-[20px] bg-amber-500/10 border border-amber-500/35 overflow-hidden">
              <button
                onClick={() => setSiblingPanelOpen((v) => !v)}
                className="w-full text-left flex items-center justify-between gap-2 px-3.5 py-3"
              >
                <span className="text-xs font-extrabold text-amber-400">
                  ⚠️ {siblingDrafts.length} more of {siblingDrafts.length === 1 ? "this" : "these"} still waiting in the queue
                </span>
                <span className="text-sm text-amber-400">{siblingPanelOpen ? "▲" : "▼"}</span>
              </button>
              {siblingPanelOpen && (
                <div className="px-3.5 pb-3.5 flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    {siblingDrafts.map((s) => {
                      const checked = !!siblingSelection[s.draftId];
                      const thumb = imgSrc(s.frontImageUrl || s.imageUrl, 96);
                      return (
                        <label
                          key={s.draftId}
                          onClick={() => toggleSibling(s.draftId)}
                          className="flex items-center gap-2 rounded-xl bg-zinc-900 border border-zinc-700 px-2.5 py-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSibling(s.draftId)}
                            className="w-4 h-4 accent-amber-500 shrink-0"
                          />
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt={s.itemName} className="w-[30px] h-[30px] rounded-lg object-cover bg-zinc-800 shrink-0" />
                          ) : (
                            <div className="w-[30px] h-[30px] rounded-lg bg-zinc-800 shrink-0" />
                          )}
                          <span className="flex-1 min-w-0 text-[11px] text-zinc-300 truncate">
                            {s.itemName} · {s.size}
                          </span>
                          <span className="text-[11px] font-extrabold text-amber-400 shrink-0">+{s.quantityInStock}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2.5">
                    <span className="text-[11px] font-bold text-emerald-200">Combined quantity</span>
                    <input
                      type="number"
                      min={0}
                      value={siblingFinalQty}
                      onChange={(e) => {
                        setSiblingQtyTouched(true);
                        setSiblingFinalQty(Math.max(0, Number(e.target.value)));
                      }}
                      className="w-20 bg-transparent text-right text-[15px] font-extrabold text-emerald-400 outline-none"
                    />
                  </div>

                  {siblingMergeError && <div className="text-[11px] text-red-400">{siblingMergeError}</div>}

                  <button
                    onClick={handleSiblingMerge}
                    disabled={siblingMerging || selectedSiblingIds.length === 0}
                    className="w-full rounded-xl bg-amber-500 disabled:opacity-40 py-2.5 text-xs font-extrabold text-amber-950"
                  >
                    {siblingMerging ? "Merging…" : "Merge selected into this item →"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Price card */}
          <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-[18px]">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-400">Retail price</span>
            <div className="mt-2 flex items-center rounded-2xl bg-zinc-950 border-2 border-emerald-500/40 px-4 py-3">
              <span className="text-2xl font-extrabold text-emerald-500 mr-1.5">₦</span>
              <input
                type="number"
                min={0}
                value={form.retailPrice}
                onChange={(e) => updateForm("retailPrice", Math.max(0, Number(e.target.value)))}
                className="flex-1 bg-transparent text-[28px] font-extrabold text-white outline-none w-full"
              />
            </div>
            <div className="mt-2.5 flex gap-1.5 flex-wrap">
              {PRICE_CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => updateForm("retailPrice", form.retailPrice + amt)}
                  className="rounded-[10px] bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-[11px] font-bold text-zinc-200"
                >
                  +₦{amt.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {saveError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-3.5 py-2.5 text-xs">
              ⚠️ {saveError}
            </div>
          )}
          {skipError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-3.5 py-2.5 text-xs">
              ⚠️ {skipError}
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/95 shrink-0">
          <button
            onClick={goPrev}
            disabled={currentIndex <= 0}
            className="h-[50px] rounded-2xl bg-zinc-900 border border-zinc-800 px-3.5 text-[11px] font-bold text-zinc-300 disabled:opacity-30"
          >
            ← Prev
          </button>
          <button
            onClick={handleSkip}
            disabled={skipping}
            className="h-[50px] rounded-2xl bg-zinc-900 border border-zinc-800 px-3.5 text-[11px] font-bold text-zinc-400 disabled:opacity-40"
          >
            {skipping ? "Skipping…" : "Skip →"}
          </button>
          <button
            onClick={handleSaveAndNext}
            disabled={saving || !form.itemName.trim()}
            className="flex-1 h-[50px] rounded-2xl bg-emerald-500 disabled:opacity-40 text-[13px] font-extrabold text-emerald-950 flex items-center justify-center gap-1.5"
          >
            {saving ? "Saving…" : "Save & Next →"}
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Browse queue overlay                                              */}
      {/* ---------------------------------------------------------------- */}
      {showQueueBrowser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end sm:items-center sm:justify-center">
          <div className="w-full sm:max-w-md bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-bold text-zinc-100">Browse queue ({queue.length})</span>
              <button onClick={() => setShowQueueBrowser(false)} className="text-zinc-400 text-xl leading-none px-1">
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-zinc-800 shrink-0 overflow-x-auto">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mr-0.5 shrink-0">View:</span>
              <button
                onClick={() => chooseView("all")}
                className={`shrink-0 text-xs rounded-full px-2.5 py-1 font-bold ${
                  viewFilter === "all" ? "bg-emerald-500 text-emerald-950" : "bg-zinc-900 border border-zinc-700 text-zinc-300"
                }`}
              >
                All ({rawQueue.length})
              </button>
              {[0, 1, 2].map((lane) => (
                <button
                  key={lane}
                  onClick={() => chooseView(lane)}
                  className={`shrink-0 text-xs rounded-full px-2.5 py-1 font-bold ${
                    viewFilter === lane ? "bg-emerald-500 text-emerald-950" : "bg-zinc-900 border border-zinc-700 text-zinc-300"
                  }`}
                >
                  View {lane + 1} ({laneCounts[lane]})
                </button>
              ))}
            </div>
            <div className="overflow-y-auto p-3 flex flex-col gap-2">
              {queue.map((d, idx) => {
                const thumb = imgSrc(d.frontImageUrl, 96);
                return (
                  <button
                    key={d._id}
                    onClick={() => {
                      goTo(d._id);
                      setShowQueueBrowser(false);
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${
                      d._id === currentId ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-zinc-500 w-5 shrink-0">{idx + 1}</span>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover bg-zinc-800 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-zinc-200 truncate">
                        {d.extractedItemName || "Unread snap"}
                      </span>
                      <span className="block text-[10px] text-zinc-500">
                        Qty {d.quantityInStock} · {timeAgo(d.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Edit sheet — manual fallback for name/brand/size/category/expiry  */}
      {/* ---------------------------------------------------------------- */}
      {showEditSheet && (
        <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end sm:items-center sm:justify-center">
          <div className="w-full sm:max-w-md bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-bold text-zinc-100">Edit item</span>
              <button onClick={() => setShowEditSheet(false)} className="text-zinc-400 text-xl leading-none px-1">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-3">
              <Field label="Item Name">
                <input
                  type="text"
                  value={form.itemName}
                  onChange={(e) => updateForm("itemName", e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Brand">
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => updateForm("brand", e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Size / Strength">
                <input
                  type="text"
                  value={form.size}
                  onChange={(e) => updateForm("size", e.target.value)}
                  placeholder="Standard"
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(e) => updateForm("category", e.target.value as ProductForm["category"])}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  <option value="medicine">Medicine</option>
                  <option value="non-medicine">Non-Medicine</option>
                  <option value="supermarket">Supermarket</option>
                </select>
              </Field>
              <Field label="Expiry Date">
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => updateForm("expiryDate", e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Quantity">
                <input
                  type="number"
                  min={0}
                  value={form.quantity}
                  onChange={(e) => updateForm("quantity", Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
            <div className="p-4 border-t border-zinc-800 shrink-0">
              <button
                onClick={() => setShowEditSheet(false)}
                className="w-full py-3 rounded-xl bg-emerald-500 text-emerald-950 font-extrabold text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Catalog-duplicate merge sheet                                     */}
      {/* ---------------------------------------------------------------- */}
      {catalogSheetTarget && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex flex-col justify-end sm:items-center sm:justify-center">
          <div className="w-full sm:max-w-md bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rose-500/30 bg-rose-500/10 rounded-t-3xl sm:rounded-t-3xl shrink-0">
              <span className="text-sm font-bold text-rose-200">Is this the same item?</span>
              <button onClick={() => setCatalogSheetTarget(null)} className="text-zinc-400 text-xl leading-none px-1">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-3">
              <p className="text-xs text-zinc-400">
                Already in the catalog as{" "}
                <span className="font-semibold text-zinc-200">
                  {catalogSheetTarget.itemName} · {catalogSheetTarget.size}
                </span>{" "}
                ({catalogSheetTarget.brand}), currently {catalogSheetTarget.quantityInStock} in stock. If this is the same
                product found on another shelf, add these units to it instead of creating a duplicate.
              </p>
              <Field label="Additional Quantity Found">
                <input
                  type="number"
                  min={1}
                  value={catalogMergeQty}
                  onChange={(e) => setCatalogMergeQty(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-400"
                />
              </Field>
              <Field label="Expiry Date (this batch)">
                <input
                  type="date"
                  value={catalogMergeExpiry}
                  onChange={(e) => setCatalogMergeExpiry(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-400"
                />
              </Field>
              {catalogMergeError && <div className="text-[11px] text-red-400">{catalogMergeError}</div>}
            </div>
            <div className="p-4 border-t border-zinc-800 flex gap-2 shrink-0">
              <button
                onClick={() => setCatalogSheetTarget(null)}
                className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-300 font-semibold text-sm"
              >
                Not the same
              </button>
              <button
                onClick={confirmCatalogMerge}
                disabled={catalogMerging || catalogMergeQty < 1}
                className="flex-1 py-3 rounded-xl bg-rose-500 disabled:opacity-40 text-rose-950 font-extrabold text-sm"
              >
                {catalogMerging ? "Adding…" : `Add ${catalogMergeQty} to stock`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Full-resolution zoom overlay                                      */}
      {/* ---------------------------------------------------------------- */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomImage} alt="Zoomed" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
