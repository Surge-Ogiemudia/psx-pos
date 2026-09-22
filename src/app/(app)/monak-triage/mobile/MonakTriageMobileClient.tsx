"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { laneOf, VIEW_STORAGE_KEY } from "@/lib/triageLanes";
import { useMonakTriageOfflineSync } from "./useMonakTriageOfflineSync";
import { findLocalDuplicateCandidates, searchLocalPriceList } from "@/lib/triageOfflineMatch";
import { triageDb } from "@/lib/monakTriageDb";

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
  // ---------------------------------------------------------- offline sync
  // Stage 1 of the offline plan: browsing/reviewing/editing the queue works with zero network
  // calls once synced (catalog + price list cached here); Confirm/Skip/Merge still require a
  // live connection, same as today — see useMonakTriageOfflineSync.ts for the caching shape.
  const {
    isOnline,
    syncStatus,
    catalog,
    priceList,
    saveDraftsSnapshot,
    loadCachedDrafts,
    resyncReferenceData,
    pendingActions,
    syncPendingActions,
  } = useMonakTriageOfflineSync(branchId);
  // Stage 2 of the offline plan: Confirm & Save / Skip queue locally instead of failing
  // outright while offline — see handleSaveAndNext/handleSkip below and useMonakTriageOfflineSync
  // for the drain. "Syncing" counts as still-pending from the operator's point of view (it just
  // means a replay attempt happens to be in flight right now); "failed" is a genuine server
  // rejection and needs their attention. Merge is unaffected — still direct-only.
  const [showSyncIssues, setShowSyncIssues] = useState(false);
  const pendingSyncCount = pendingActions.filter((a) => a.status === "pending" || a.status === "syncing").length;
  const failedActions = pendingActions.filter((a) => a.status === "failed");
  // The catalog sync is paginated (13+ requests for a few thousand products) and runs
  // independently of the queue fetch, which is usually a single fast request — so on a
  // fresh load, an operator can easily reach their first item before the catalog has
  // finished its first pass. An empty catalog at that moment is "still syncing", not
  // "broken" or "genuinely nothing there", and must not be shown as the same thing.
  // hasCachedReferenceData isn't granular enough for this (it's true if EITHER catalog OR
  // priceList has data), so this checks syncStatus directly for an in-progress sync instead.
  const catalogStillSyncingFirstPass =
    catalog.length === 0 && isOnline && (syncStatus === "Initializing…" || syncStatus.startsWith("Syncing"));

  // ------------------------------------------------------------------ queue
  const [rawQueue, setRawQueue] = useState<AiDraft[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueLoadError, setQueueLoadError] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The true count across the whole branch, even though only a batch of it is actually
  // fetched below — so the UI can say "showing 150 of 2,765" instead of quietly implying
  // the queue only has 150 items in it. Offline, this just falls back to the cached count.
  const [queueTotalOnServer, setQueueTotalOnServer] = useState(0);

  // Fetching the entire active queue (thousands of drafts, each carrying image URLs) on
  // every 5s poll was a real, measured cost and latency problem — this caps each fetch to
  // the newest 150 instead. Lane (View 1/2/3) counts below are computed only from what's
  // actually fetched, so they can undercount relative to desktop's full-queue view when
  // the true backlog is larger than one batch; that's an explicit, known trade-off being
  // tried here, not an oversight.
  const QUEUE_BATCH_LIMIT = 150;

  // Reads always resolve from IndexedDB (loadCachedDrafts), not straight off the network
  // response — when online this fetch's job is to keep that cache fresh, mirroring how
  // usePosOfflineSync treats the network as the thing that feeds IndexedDB, not the UI
  // directly. Offline, this skips the network entirely and just re-reads the cache.
  const fetchQueue = useCallback(async () => {
    if (!isOnline) {
      const cached = await loadCachedDrafts();
      setRawQueue(cached);
      setQueueTotalOnServer(cached.length);
      setQueueLoaded(true);
      setQueueLoadError(false);
      return;
    }
    try {
      const res = await fetch(`/api/products/ai-drafts?branchId=${branchId}&limit=${QUEUE_BATCH_LIMIT}`);
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      const all: AiDraft[] = data.drafts ?? [];
      const active = all.filter(
        (d) => d.status !== "completed" && d.status !== "dismissed" && d.status !== "skipped" && d.status !== "confirming"
      );
      setRawQueue(active);
      setQueueTotalOnServer(data.total ?? active.length);
      setQueueLoaded(true);
      setQueueLoadError(false);
      saveDraftsSnapshot(active).catch((err) => console.error("Failed to cache queue for offline use:", err));
    } catch {
      // Network attempt failed even though we appear online (e.g. a flaky connection) — fall
      // back to whatever's cached rather than leaving the screen stuck on its previous state.
      const cached = await loadCachedDrafts();
      setRawQueue(cached);
      setQueueTotalOnServer(cached.length);
      setQueueLoaded(true);
      setQueueLoadError(cached.length === 0);
    }
  }, [branchId, isOnline, loadCachedDrafts, saveDraftsSnapshot]);

  useEffect(() => {
    fetchQueue();
    // Only poll the network while online — offline there's nothing new to fetch, and polling
    // would just repeatedly hit the browser's own offline fetch failure.
    if (isOnline) {
      pollingRef.current = setInterval(fetchQueue, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchQueue, isOnline]);

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
  // Tracked separately from the candidates array itself — an empty array must never be
  // ambiguous between "checked, genuinely none" and "the check failed/never finished", or
  // a slow/failed connection would silently look identical to "no duplicates found" and
  // let a real duplicate slip through unseen.
  const [dupeCheckStatus, setDupeCheckStatus] = useState<"loading" | "done" | "error">("loading");

  // Runs entirely against the cached catalog (src/lib/triageOfflineMatch.ts, sharing the same
  // isDuplicateText used by the live /api/products/[id]/possible-duplicates endpoint) instead
  // of calling that endpoint — works offline, and online it's just as accurate since the
  // catalog stays synced in the background. An empty cached catalog (never synced, or a wiped
  // cache) is surfaced as an error state rather than a silent "no duplicates found", since
  // those two cases must never look the same to the operator.
  const runDuplicateCheck = useCallback(() => {
    if (!currentDraft?.productId) {
      setDuplicateCandidates([]);
      setDupeCheckStatus("done");
      return;
    }
    if (catalog.length === 0) {
      // Still syncing its first pass (common right after a fresh load, since the queue
      // fetch is one request but the catalog sync is many) — keep showing "loading" rather
      // than a premature "failed", since nothing has actually gone wrong yet.
      setDupeCheckStatus(catalogStillSyncingFirstPass ? "loading" : "error");
      return;
    }
    setDuplicateCandidates(findLocalDuplicateCandidates(currentDraft.productId, catalog));
    setDupeCheckStatus("done");
  }, [currentDraft?.productId, catalog, catalogStillSyncingFirstPass]);

  useEffect(() => {
    setDupeIndex(0);
    runDuplicateCheck();
  }, [currentDraft?._id, currentDraft?.productId, runDuplicateCheck]);

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
    const payload = { status: "skipped" };

    // Offline: queue it and move on immediately — no reason to make the operator wait for a
    // round-trip that can't happen right now. useMonakTriageOfflineSync drains this on
    // reconnect (see syncPendingActions there).
    if (!isOnline) {
      await triageDb.pendingActions.add({
        actionType: "skip",
        draftId: currentDraft._id,
        payload,
        status: "pending",
        createdAt: Date.now(),
      });
      // Also drop it from the local drafts cache — goNext only removes it from this
      // render's in-memory queue. Without this, an app reload while still offline (phone
      // backgrounded and killed, tab refreshed) would re-read the untouched IndexedDB
      // cache and show this draft again, risking a second queued action for it.
      await triageDb.drafts.delete(currentDraft._id);
      setSkipping(false);
      goNext([currentDraft._id]);
      return;
    }

    try {
      const res = await fetch(`/api/products/ai-drafts/${currentDraft._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

    // Same offline branch as handleSkip above — queue and advance right away rather than
    // blocking the operator on a network call that can't succeed right now.
    if (!isOnline) {
      await triageDb.pendingActions.add({
        actionType: "confirm",
        draftId: currentDraft._id,
        payload,
        status: "pending",
        createdAt: Date.now(),
      });
      // See the matching comment in handleSkip above — keep the local cache in sync so a
      // reload while still offline doesn't resurface an already-queued draft.
      await triageDb.drafts.delete(currentDraft._id);
      setSaving(false);
      goNext([currentDraft._id]);
      return;
    }

    try {
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

  // Runs entirely against the cached price list (src/lib/triageOfflineMatch.ts, sharing the
  // same fuzzyRank used by the live /api/monak-excel2 endpoint) instead of calling that
  // endpoint — synchronous and fast enough to run on every debounced keystroke even against
  // the full multi-thousand-row list, so there's no loading state to show anymore. An empty
  // cached price list (never synced yet) surfaces as its own message rather than silently
  // returning zero matches.
  const [priceMatches, setPriceMatches] = useState<PriceMatch[]>([]);
  const priceListUnavailable = priceList.length === 0;
  useEffect(() => {
    if (stage !== "price" || !debouncedPriceSearch.trim() || priceListUnavailable) {
      setPriceMatches([]);
      return;
    }
    setPriceMatches(searchLocalPriceList(debouncedPriceSearch, priceList));
  }, [debouncedPriceSearch, stage, priceList, priceListUnavailable]);

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

  // Distinct from "queue is clear" below — this is offline with nothing ever cached (a brand
  // new device/browser, or a cleared cache), not "everything's been processed". Those two must
  // never look the same, or an operator could mistake "we have no data" for "you're done".
  if (queueLoadError && rawQueue.length === 0) {
    return (
      <div className="-mx-4 -my-6 sm:-mx-6 min-h-[70vh] flex flex-col items-center justify-center gap-2 bg-zinc-950 text-center px-6">
        <span className="text-4xl">📡</span>
        <span className="text-zinc-100 font-semibold">No cached queue yet</span>
        <span className="text-zinc-500 text-sm">Connect to the internet once to load the queue for offline use.</span>
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
              {queueTotalOnServer > rawQueue.length && (
                <span className="text-zinc-600"> (of {queueTotalOnServer} total)</span>
              )}
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

        {/* Offline/sync status strip — same visual language as POS's "Online"/"Offline Mode"
            indicator (PosClient.tsx), adapted to this screen's dark theme. */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/60 bg-zinc-950/70 shrink-0 text-[10px]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold ${
              isOnline ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-red-500"}`} />
            <span>{isOnline ? "Online" : "Offline — showing cached data"}</span>
          </span>
          <span className="text-zinc-600">{syncStatus}</span>
          {pendingSyncCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 font-bold">
              {pendingSyncCount} pending sync
            </span>
          )}
          {failedActions.length > 0 && (
            <button
              onClick={() => setShowSyncIssues(true)}
              className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 px-2 py-0.5 font-bold"
            >
              {failedActions.length} sync {failedActions.length === 1 ? "issue" : "issues"}
            </button>
          )}
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
                    disabled={dupeMerging || !isOnline}
                    title={!isOnline ? "Reconnect to save" : undefined}
                    className="flex-1 py-3 rounded-xl bg-amber-500 disabled:opacity-40 text-amber-950 font-extrabold text-xs"
                  >
                    {dupeMerging ? "Merging…" : !isOnline ? "Reconnect to merge" : "✓ Same item — merge"}
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
            {priceListUnavailable && (
              <span className="text-[11px] text-red-400">⚠️ Price list not cached yet — connect once to load it.</span>
            )}
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
            card above has its own two explicit actions (merge / not the same). Skip and
            Confirm & Save queue locally and sync later when offline (stage 2 of the offline
            plan — see useMonakTriageOfflineSync.ts); Prev and Proceed are pure navigation and
            stay available offline too. Merge still requires a live connection — see its own
            "Reconnect to merge" button in the duplicates step above. */}
        {stage !== "duplicates" && (
          <div className="flex flex-col gap-1.5 px-4 py-3 border-t border-zinc-800 bg-zinc-950/95 shrink-0">
            {!isOnline && (
              <div className="text-center text-[10px] font-bold text-amber-400">
                Offline — Skip/Save will queue and sync automatically once reconnected
              </div>
            )}
            <div className="flex items-center gap-2">
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
                dupeCheckStatus === "error" ? (
                  <button
                    onClick={() => {
                      // The catalog cache is most likely just empty/stale (never synced, or
                      // this is a fresh device) rather than a transient failure — kick a
                      // resync as well as retrying the check itself.
                      resyncReferenceData();
                      runDuplicateCheck();
                    }}
                    className="flex-1 h-[50px] rounded-2xl bg-red-500/15 border border-red-500/40 text-[12px] font-extrabold text-red-300 flex items-center justify-center gap-1.5"
                  >
                    ⚠️ Duplicate check unavailable — tap to retry
                  </button>
                ) : (
                  <button
                    onClick={() => setStage(duplicateCandidates.length > 0 ? "duplicates" : "price")}
                    disabled={!form.itemName.trim() || dupeCheckStatus === "loading"}
                    className="flex-1 h-[50px] rounded-2xl bg-emerald-500 disabled:opacity-40 text-[13px] font-extrabold text-emerald-950 flex items-center justify-center gap-1.5"
                  >
                    {dupeCheckStatus === "loading" ? "Checking for duplicates…" : "Proceed →"}
                  </button>
                )
              ) : (
                <button
                  onClick={handleSaveAndNext}
                  disabled={saving || !form.itemName.trim()}
                  className="flex-1 h-[50px] rounded-2xl bg-emerald-500 disabled:opacity-40 text-[13px] font-extrabold text-emerald-950 flex items-center justify-center gap-1.5"
                >
                  {saving ? "Saving…" : !isOnline ? "✓ Queue & Save" : "✓ Confirm & Save"}
                </button>
              )}
            </div>
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
      {/* Sync issues overlay — failed Confirm/Skip replays (a genuine server rejection,      */}
      {/* not just "still offline"), reviewable one at a time rather than silently vanishing. */}
      {/* ---------------------------------------------------------------- */}
      {showSyncIssues && (
        <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end sm:items-center sm:justify-center">
          <div className="w-full sm:max-w-md bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-bold text-zinc-100">Sync issues ({failedActions.length})</span>
              <button onClick={() => setShowSyncIssues(false)} className="text-zinc-400 text-xl leading-none px-1">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-3 flex flex-col gap-2">
              {failedActions.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-8">No sync issues.</p>
              ) : (
                failedActions.map((a) => (
                  <div key={a.id} className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-100 truncate">
                          {a.actionType === "confirm" ? "Confirm & Save" : "Skip"} —{" "}
                          {typeof a.payload.itemName === "string" && a.payload.itemName ? a.payload.itemName : a.draftId}
                        </p>
                        <p className="text-[10px] text-zinc-500">{new Date(a.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="shrink-0 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">
                        Failed
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-tight text-red-300 font-medium">
                      {a.errorMessage || "Sync failed."}
                    </p>
                    <div className="mt-3 pt-3 border-t border-red-500/20 flex gap-2">
                      <button
                        onClick={async () => {
                          await triageDb.pendingActions.update(a.id!, { status: "pending", errorMessage: undefined });
                          if (isOnline) syncPendingActions();
                        }}
                        className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-200 px-3 py-1.5 rounded-lg font-semibold transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm("Discard this queued action? This cannot be undone.")) {
                            await triageDb.pendingActions.delete(a.id!);
                          }
                        }}
                        className="text-xs bg-transparent border border-red-500/30 hover:bg-red-500/10 text-red-300 px-3 py-1.5 rounded-lg font-semibold transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))
              )}
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
