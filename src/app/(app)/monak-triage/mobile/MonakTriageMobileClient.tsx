"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
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

// A duplicates step candidate — another live product (same branch) that looks like the
// same physical item as the one currently being triaged. Product vs product: every draft
// already has its own live product now, so there's no separate "still pending" case anymore.
interface DuplicateCandidate {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  quantityInStock: number;
}

// A monak-excel2 price-list match — tapping one fills retail/wholesale/distributor at once.
interface PriceMatch {
  _id: string;
  itemName: string;
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

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Vercel Edge WebP thumbnail URL — same trick as ResilientThumb.tsx, reimplemented
// here (rather than importing the component) so the photo card can control its own
// full-bleed layout/toggle instead of ResilientThumb's fixed thumbnail chrome.
function imgSrc(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  // q must be in next.config.ts's allowed images.qualities list — no explicit list is
  // configured, so Next 16 defaults to only allowing q=75; anything else 400s.
  return url.startsWith("http") ? `/_next/image?url=${encodeURIComponent(url)}&w=${size}&q=75` : url;
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
    setStage("identity");
    setSaveError("");
    setSkipError("");
  }, [currentDraft?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ------------------------------------------------------------- journey
  // identity -> (duplicates, only if any exist) -> price. Resets to "identity" whenever a
  // new draft loads, in the form-reset effect above.
  const [stage, setStage] = useState<"identity" | "duplicates" | "price">("identity");

  // --------------------------------------------------- possible duplicates
  // Product vs product — every draft already has its own live product now, so this one
  // check replaces what used to be two separate lookups (still-queued siblings vs catalog).
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [dupeIndex, setDupeIndex] = useState(0);

  useEffect(() => {
    setDupeIndex(0);
    if (!currentDraft?.productId) {
      setDuplicateCandidates([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/products/${currentDraft.productId}/possible-duplicates`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDuplicateCandidates(d.candidates ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentDraft?._id, currentDraft?.productId]);

  const currentDupe = duplicateCandidates[dupeIndex] ?? null;
  const [dupeFinalQty, setDupeFinalQty] = useState(0);
  const [dupeMerging, setDupeMerging] = useState(false);
  const [dupeError, setDupeError] = useState("");

  // Default suggestion is the sum of both counts — but it's a suggestion, not the answer.
  // Two real duplicate snaps can carry genuinely different counts (54 counted once, 20
  // counted again later), and only an operator looking at both photos can say what's real.
  useEffect(() => {
    setDupeError("");
    if (currentDupe) setDupeFinalQty(form.quantity + currentDupe.quantityInStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDupe?._id]);

  function handleDupeNotSame() {
    setDupeError("");
    if (dupeIndex + 1 < duplicateCandidates.length) {
      setDupeIndex((i) => i + 1);
    } else {
      setStage("price");
    }
  }

  async function handleDupeMerge() {
    if (!currentDraft?.productId || !currentDupe) return;
    setDupeMerging(true);
    setDupeError("");
    try {
      const res = await fetch(`/api/products/merge-pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keptProductId: currentDraft.productId,
          retireProductId: currentDupe._id,
          finalQuantity: dupeFinalQty,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Merge failed");
      updateForm("quantity", dupeFinalQty);
      // The merged candidate drops out of the list; everything after it shifts down into
      // this same index, so dupeIndex itself doesn't need to move — unless this was the
      // last one, in which case there's nothing left to compare and we move on to price.
      const remaining = duplicateCandidates.filter((c) => c._id !== currentDupe._id);
      setDuplicateCandidates(remaining);
      if (dupeIndex >= remaining.length) setStage("price");
    } catch (err) {
      setDupeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setDupeMerging(false);
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

  // -------------------------------------------------------- price match
  // Independent from the item name so an operator can search the price list slightly
  // differently if needed — starts pre-filled with the item name each time this stage
  // is reached, same as desktop's Match Prices panel.
  const [priceSearch, setPriceSearch] = useState("");
  useEffect(() => {
    if (stage === "price") setPriceSearch(form.itemName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  const debouncedPriceSearch = useDebounce(priceSearch, 300);

  const [priceMatches, setPriceMatches] = useState<PriceMatch[]>([]);
  useEffect(() => {
    if (stage !== "price" || !debouncedPriceSearch.trim()) {
      setPriceMatches([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/monak-excel2?search=${encodeURIComponent(debouncedPriceSearch)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPriceMatches(d.results ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedPriceSearch, stage]);

  function applyPriceMatch(m: PriceMatch) {
    setForm((f) => ({
      ...f,
      retailPrice: m.retailPrice,
      wholesalePrice: m.wholesalePrice,
      distributorPrice: m.distributorPrice,
    }));
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
          {stage === "identity" && (
          <>
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

          {/* Identity card — mirrors desktop Panel 2's form fields exactly (same order,
              same fields), directly editable inline rather than behind an Edit button. */}
          <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
            <Field label="Item Name">
              <input
                type="text"
                value={form.itemName}
                onChange={(e) => updateForm("itemName", e.target.value)}
                placeholder="e.g. Amoxicillin"
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Size / Strength">
              <input
                type="text"
                value={form.size}
                onChange={(e) => updateForm("size", e.target.value)}
                placeholder="e.g. 500mg, 1L, Standard"
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Brand">
              <input
                type="text"
                value={form.brand}
                onChange={(e) => updateForm("brand", e.target.value)}
                placeholder="e.g. Emzor, Beecham"
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => updateForm("category", e.target.value as ProductForm["category"])}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
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
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
          </div>
          {skipError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-3.5 py-2.5 text-xs">
              ⚠️ {skipError}
            </div>
          )}
          </>
          )}

          {/* Duplicates step — one comparison at a time, current item vs one candidate.
              Nothing ever merges without this explicit choice; "not the same" just moves on. */}
          {stage === "duplicates" && currentDupe && (() => {
            const dupeThumb = imgSrc(currentDupe.imageUrl, 320);
            return (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-400">
                    Possible duplicate — {dupeIndex + 1} of {duplicateCandidates.length}
                  </span>
                  <button
                    onClick={() => setStage("identity")}
                    className="text-[11px] font-bold text-zinc-500 hover:text-zinc-300"
                  >
                    ← Back to item
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
                    <div className="h-[140px] flex items-center justify-center bg-zinc-950">
                      {activeUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={activeUrl} alt={form.itemName} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-zinc-600 text-[11px]">No photo</span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <span className="block text-xs font-bold text-zinc-100 truncate">{form.itemName || "This item"}</span>
                      <span className="block text-[11px] text-zinc-500 truncate">{form.brand} · {form.size}</span>
                      <span className="block text-[11px] font-bold text-emerald-400 mt-1">Qty: {form.quantity}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
                    <div className="h-[140px] flex items-center justify-center bg-zinc-950">
                      {dupeThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={dupeThumb} alt={currentDupe.itemName} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-zinc-600 text-[11px]">No photo</span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <span className="block text-xs font-bold text-zinc-100 truncate">{currentDupe.itemName}</span>
                      <span className="block text-[11px] text-zinc-500 truncate">{currentDupe.brand} · {currentDupe.size}</span>
                      <span className="block text-[11px] font-bold text-amber-400 mt-1">Qty: {currentDupe.quantityInStock}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2.5">
                  <span className="text-[11px] font-bold text-emerald-200">If the same — combined quantity</span>
                  <input
                    type="number"
                    min={0}
                    value={dupeFinalQty}
                    onChange={(e) => setDupeFinalQty(Math.max(0, Number(e.target.value)))}
                    className="w-20 bg-transparent text-right text-[15px] font-extrabold text-emerald-400 outline-none"
                  />
                </div>

                {dupeError && <div className="text-[11px] text-red-400">⚠️ {dupeError}</div>}

                <div className="flex gap-2">
                  <button
                    onClick={handleDupeNotSame}
                    disabled={dupeMerging}
                    className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-300 font-bold text-xs disabled:opacity-40"
                  >
                    ✕ Different — keep separate
                  </button>
                  <button
                    onClick={handleDupeMerge}
                    disabled={dupeMerging}
                    className="flex-1 py-3 rounded-xl bg-amber-500 disabled:opacity-40 text-amber-950 font-extrabold text-xs"
                  >
                    {dupeMerging ? "Merging…" : "✓ Same item — merge"}
                  </button>
                </div>
              </div>
            );
          })()}

          {stage === "price" && (
          <>
          {/* Match Prices — same idea as desktop's panel: search the price list, tap a
              match to fill retail/wholesale/distributor at once, or type prices manually. */}
          <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-400">💰 Match Prices</span>
            <input
              type="text"
              value={priceSearch}
              onChange={(e) => setPriceSearch(e.target.value)}
              placeholder="Search price list…"
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            {priceMatches.length > 0 && (
              <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                {priceMatches.map((m) => (
                  <button
                    key={m._id}
                    onClick={() => applyPriceMatch(m)}
                    className="text-left flex items-center justify-between gap-2 rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2"
                  >
                    <span className="text-xs font-bold text-zinc-200 leading-tight truncate">{m.itemName}</span>
                    <span className="text-[11px] text-zinc-400 shrink-0">
                      Ret: ₦{m.retailPrice.toLocaleString()}
                      <span className="text-zinc-600"> · Dist: ₦{m.distributorPrice.toLocaleString()}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Price card */}
          <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-[18px] flex flex-col gap-3">
            <div>
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Wholesale Price (₦)">
                <input
                  type="number"
                  min={0}
                  value={form.wholesalePrice}
                  onChange={(e) => updateForm("wholesalePrice", Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Distributor Price (₦)">
                <input
                  type="number"
                  min={0}
                  value={form.distributorPrice}
                  onChange={(e) => updateForm("distributorPrice", Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </Field>
            </div>

            <Field label="Quantity">
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => updateForm("quantity", Math.max(0, Number(e.target.value)))}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
          </div>

          {saveError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-3.5 py-2.5 text-xs">
              ⚠️ {saveError}
            </div>
          )}
          </>
          )}
        </div>

        {/* Bottom action bar — hidden during the duplicates step, since the comparison
            card above has its own two explicit actions (merge / not the same). */}
        {stage !== "duplicates" && (
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
            {stage === "identity" ? (
              <button
                onClick={() => setStage(duplicateCandidates.length > 0 ? "duplicates" : "price")}
                disabled={!form.itemName.trim()}
                className="flex-1 h-[50px] rounded-2xl bg-emerald-500 disabled:opacity-40 text-[13px] font-extrabold text-emerald-950 flex items-center justify-center gap-1.5"
              >
                Proceed →
              </button>
            ) : (
              <button
                onClick={handleSaveAndNext}
                disabled={saving || !form.itemName.trim()}
                className="flex-1 h-[50px] rounded-2xl bg-emerald-500 disabled:opacity-40 text-[13px] font-extrabold text-emerald-950 flex items-center justify-center gap-1.5"
              >
                {saving ? "Saving…" : "✓ Confirm & Save"}
              </button>
            )}
          </div>
        )}
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
