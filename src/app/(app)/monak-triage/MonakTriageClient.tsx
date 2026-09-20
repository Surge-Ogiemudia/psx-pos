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
  status: "pending" | "processing" | "extracted" | "completed" | "error" | "dismissed" | "confirming" | "skipped";
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  extractedExpiryDate?: string | null;
  // Set once the pre-open bulk-publish flow has already created a live Product for this
  // draft — status stays "extracted" so it's still shown here, but it's already sellable.
  productId?: string | null;
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

// A completed AiDraftProduct merged with the Product it produced — feeds the "Processed
// Items" review log (Panel 4). needsReviewReason mirrors the flags set at save time when
// brand/size/expiry/price weren't actually known.
type ReviewReason = "missing_brand" | "missing_size" | "missing_expiry" | "missing_price";

interface ProcessedItem {
  _id: string;
  productId: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string | null;
  needsReviewReason: string[];
  createdAt: string;
}

const REASON_LABELS: Record<string, string> = {
  missing_brand: "Missing Brand",
  missing_size: "Missing Size",
  missing_expiry: "Missing Expiry",
  missing_price: "Missing Price",
};

// A live catalog Product that a duplicate scan flagged as possibly the same physical item as
// one or more other live Products — feeds Panel 4's "Possible Duplicates" tab. frontImageUrl/
// backImageUrl come from the originating AiDraftProduct(s) when one exists; imageUrl is the
// product's own (always-present) fallback for pre-existing catalog entries with no draft.
interface DuplicateProduct {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  quantityInStock: number;
  imageUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  createdAt: string;
}

interface DuplicateGroup {
  groupKey: string;
  matchType: "exact" | "fuzzy";
  products: DuplicateProduct[];
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

// MonakExcel1's expiryDate field sometimes holds a raw Excel serial-date number as a
// string (e.g. "46692" from an unconverted spreadsheet export) instead of a real date.
// new Date("46692") doesn't error — it silently creates a date in year 46692. A native
// <input type="date"> then just shows blank for that (invalid YYYY-MM-DD), so the bad
// value sits unnoticed in form state until it gets saved. Detect and convert it here.
function normalizeExpiryDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^\d{4,6}$/.test(trimmed)) {
    const serial = Number(trimmed);
    // Sane Excel serial range for pharmacy stock (roughly years 1990-2100).
    if (serial > 32000 && serial < 73000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + serial * 86400000).toISOString().slice(0, 10);
    }
    return ""; // out-of-range numeric junk — don't guess, leave blank for a human to set
  }
  // Already a normal date-like string (e.g. "2027-05-01" or an ISO timestamp) — keep as-is.
  return trimmed.slice(0, 10);
}

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

// Panel 1 instant search — matches case-insensitively against whatever the AI extraction
// sweep has filled in (name/brand/size, which may still be blank for un-swept items) plus
// the stringified quantity, so an operator can search by "qty 30" even before extraction.
function matchesQueueSearch(snap: AiDraft, query: string): boolean {
  const haystack = [snap.extractedItemName, snap.extractedBrand, snap.extractedSize, String(snap.quantityInStock)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

const VIEW_STORAGE_KEY = "psx_monak_triage_view";

interface Props {
  branchId: string;
}

export default function MonakTriageClient({ branchId }: Props) {
  // Panel 1 state
  const [snaps, setSnaps] = useState<AiDraft[]>([]);
  const [skippedSnaps, setSkippedSnaps] = useState<AiDraft[]>([]);
  const [dismissedSnaps, setDismissedSnaps] = useState<AiDraft[]>([]);
  const [queueView, setQueueView] = useState<"active" | "skipped" | "dismissed">("active");
  const [selectedSnap, setSelectedSnap] = useState<AiDraft | null>(null);

  // Instant client-side search over whichever Panel 1 list is currently on screen (active,
  // skipped, or dismissed). Pure text filter over data already loaded in the browser — no
  // API call, no debounce needed.
  const [queueSearch, setQueueSearch] = useState("");

  // Caps how many Live Queue rows actually mount into the DOM at once — with thousands
  // of items in "All" view, rendering every row (2 images each) up front is what makes
  // the screen sit blank for a few seconds even after the data has already arrived.
  // "Load more" grows this in batches instead of paying for the whole list up front.
  const RENDER_BATCH = 60;
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);

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

  // AI-read fast lane — defaults to showing only snaps the background AI extraction
  // sweep has already staged (status "extracted"), since those need only a glance +
  // price match. Toggle back to "All" to see plain "pending" items the sweep hasn't
  // reached yet, or "error" ones. Composes with viewFilter (lane), doesn't replace it.
  const [aiReadOnly, setAiReadOnly] = useState(true);

  // Emergency pre-open safety valve: push every AI-read item straight into the catalog,
  // price flagged missing rather than blocking. Scoped to the whole branch, not the
  // operator's current lane — it's a one-time global action, not day-to-day lane work.
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkConfirmError, setBulkConfirmError] = useState("");
  const [bulkConfirmSuccessMsg, setBulkConfirmSuccessMsg] = useState("");

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

  // "Edit existing product" mode — entered from Panel 4 (Processed Items). Mutually
  // exclusive with selectedSnap: reopens a Product already in the live catalog into
  // Panel 2/3 for fixing, instead of triaging a fresh AiDraftProduct snap. Save in this
  // mode PATCHes the Product directly (see handleSaveEdit) rather than going through the
  // draft-confirm/merge endpoints, so it gets its own dedicated saving/error state rather
  // than reusing saving/saveError, which are tightly coupled to the confirm modal + snap flow.
  const [editingProduct, setEditingProduct] = useState<ProcessedItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveError, setEditSaveError] = useState("");

  // Debounced search terms
  const debouncedP2 = useDebounce(p2Search, 300);
  const debouncedP3 = useDebounce(p3Search, 300);

  // Panel 4 — Processed Items (review log) state
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);
  const [processedExpanded, setProcessedExpanded] = useState(false);
  const [processedTab, setProcessedTab] = useState<"clean" | "flagged" | "duplicates">("clean");
  const [flaggedReasonFilter, setFlaggedReasonFilter] = useState<"all" | ReviewReason>("all");

  // Panel 4 — "Possible Duplicates" tab state. Detected live from /api/products/duplicates
  // (not lane-filtered, not cached client-side) whenever this tab is opened.
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState("");
  // The confirm step both duplicate actions require before anything is written — mirrors
  // the mergeTarget confirm-view pattern used for Panel 2's catalog-duplicate merge.
  const [dupConfirm, setDupConfirm] = useState<{ mode: "merge" | "dismiss"; group: DuplicateGroup } | null>(null);
  const [dupKeptId, setDupKeptId] = useState("");
  const [dupFinalQty, setDupFinalQty] = useState(0);
  const [dupSubmitting, setDupSubmitting] = useState(false);
  const [dupError, setDupError] = useState("");

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processedPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scroll target for the "Continue to Price Matching" button (Panel 2 -> Panel 3).
  // Panel 3 is already live as soon as a snap is selected — this button is purely
  // a visual "next step" cue, not a gate.
  const panel3Ref = useRef<HTMLDivElement>(null);

  // Scroll target for jumping into Panel 2 when a Processed Item is opened for edit from
  // Panel 4, which lives below the 3-panel grid and may be scrolled out of view.
  const panel2Ref = useRef<HTMLDivElement>(null);

  // --------------- Fetch snaps ---------------
  const fetchSnaps = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/ai-drafts?branchId=${branchId}`);
      if (!res.ok) return;
      const data = await res.json();
      const all: AiDraft[] = data.drafts ?? [];
      // "confirming" is a brief in-flight state while a save transaction is still
      // running (create product, create batch, log activity) — without excluding it
      // here, a poll landing mid-save would show the item as if it's still pending,
      // undoing the optimistic removal from handleSave/handleMerge and making a
      // just-confirmed item look like it "came back" until a later poll catches up.
      setSnaps(
        all.filter(
          (d) => d.status !== "completed" && d.status !== "dismissed" && d.status !== "skipped" && d.status !== "confirming"
        )
      );
      setSkippedSnaps(all.filter((d) => d.status === "skipped"));
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

  // Switching lanes/AI-read filter/search/tab should start back at the top of the
  // (now-shorter) list rather than staying scrolled deep into a stale render window.
  useEffect(() => {
    setRenderLimit(RENDER_BATCH);
  }, [queueView, viewFilter, aiReadOnly, queueSearch]);

  // --------------- Fetch processed items (Panel 4 — review log, pharmacy/branch-wide) ---------------
  // Not lane-filtered — this is an audit log across every operator's work, same as the
  // existing Dismissed bucket. Fetched on mount (and lightly refreshed) so the collapsed
  // header's count stays accurate even before the panel is expanded.
  const fetchProcessed = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/ai-drafts/processed?branchId=${branchId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProcessedItems(data.items ?? []);
    } catch {
      // silent
    }
  }, [branchId]);

  useEffect(() => {
    fetchProcessed();
    processedPollingRef.current = setInterval(fetchProcessed, 30000);
    return () => {
      if (processedPollingRef.current) clearInterval(processedPollingRef.current);
    };
  }, [fetchProcessed]);

  // --------------- Fetch possible-duplicate candidate groups (Panel 4, "Possible Duplicates" tab) ---------------
  // Lazily scanned on demand (whenever this tab is open) rather than polled continuously —
  // it's a whole-catalog scan, not a lightweight lookup, and nobody's watching it every 30s.
  const fetchDuplicates = useCallback(async () => {
    setDuplicatesLoading(true);
    setDuplicatesError("");
    try {
      const res = await fetch(`/api/products/duplicates?branchId=${branchId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load duplicate candidates");
      setDuplicateGroups(data.groups ?? []);
    } catch (err) {
      setDuplicatesError(err instanceof Error ? err.message : "Failed to load duplicate candidates");
    } finally {
      setDuplicatesLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    if (processedExpanded && processedTab === "duplicates") {
      fetchDuplicates();
    }
  }, [processedExpanded, processedTab, fetchDuplicates]);

  // --------------- Bulk-confirm every AI-read item (emergency pre-open safety valve) ---------------
  async function handleBulkConfirm() {
    setBulkConfirming(true);
    setBulkConfirmError("");
    setBulkConfirmSuccessMsg("");
    try {
      const res = await fetch(`/api/products/ai-drafts/bulk-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Bulk confirm failed");

      setShowBulkConfirmModal(false);
      setBulkConfirmSuccessMsg(`✅ ${json.count} item${json.count === 1 ? "" : "s"} published — still here for review.`);
      fetchSnaps();
      fetchProcessed();
    } catch (err) {
      setBulkConfirmError(err instanceof Error ? err.message : "Bulk confirm failed");
    } finally {
      setBulkConfirming(false);
    }
  }

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
    // Dedicated fuzzy-matching endpoint (see its own comment) — the shared /api/products
    // search does a literal whole-string match and stopped catching duplicates once this
    // search box started auto-filling from the longer AI-extracted item name.
    fetch(`/api/monak-catalog-check?search=${encodeURIComponent(debouncedP2)}&branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCatalogMatches(d.products ?? []);
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
    setEditingProduct(null);
    setEditSaveError("");
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
    // Auto-seed Panel 3's price search from the AI-extracted name the moment a snap is
    // selected, so suggestions are already sitting there even before the operator types
    // anything in Panel 2. Leave it empty when the sweep hasn't reached this snap yet —
    // same as before.
    setP3Search(snap.extractedItemName || "");
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

  // --------------- Open the confirm view for merging a possible-duplicate group into one product ---------------
  function openDupMergeConfirm(group: DuplicateGroup) {
    const kept = group.products.reduce(
      (best, p) => (p.quantityInStock > best.quantityInStock ? p : best),
      group.products[0]
    );
    setDupConfirm({ mode: "merge", group });
    setDupKeptId(kept._id);
    setDupFinalQty(group.products.reduce((sum, p) => sum + p.quantityInStock, 0));
    setDupError("");
  }

  // --------------- Open the confirm view for dismissing a possible-duplicate group ---------------
  function openDupDismissConfirm(group: DuplicateGroup) {
    setDupConfirm({ mode: "dismiss", group });
    setDupError("");
  }

  // --------------- Commit whichever action the duplicate-review confirm modal is showing ---------------
  async function handleDupConfirmSubmit() {
    if (!dupConfirm) return;
    setDupSubmitting(true);
    setDupError("");
    try {
      if (dupConfirm.mode === "merge") {
        const mergedProductIds = dupConfirm.group.products
          .map((p) => p._id)
          .filter((id) => id !== dupKeptId);
        const res = await fetch(`/api/products/duplicates/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId,
            keptProductId: dupKeptId,
            mergedProductIds,
            finalQuantity: dupFinalQty,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Merge failed");
      } else {
        const res = await fetch(`/api/products/duplicates/dismiss`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchId, productIds: dupConfirm.group.products.map((p) => p._id) }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to dismiss");
      }

      const finishedKey = dupConfirm.group.groupKey;
      setDuplicateGroups((prev) => prev.filter((g) => g.groupKey !== finishedKey));
      setDupConfirm(null);
    } catch (err) {
      setDupError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDupSubmitting(false);
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
      expiryDate: normalizeExpiryDate(result.expiryDate),
      retailPrice: result.retailPrice,
      wholesalePrice: result.wholesalePrice,
    }));
    setP2Results([]);
  }

  // --------------- Apply Excel2 result ---------------
  function applyExcel2(result: Excel2Result) {
    const normalizedCategory = result.category?.trim().toLowerCase();
    const validCategory =
      normalizedCategory === "medicine" ||
      normalizedCategory === "non-medicine" ||
      normalizedCategory === "supermarket"
        ? (normalizedCategory as ProductForm["category"])
        : undefined;
    setForm((f) => {
      // A human's already-present name (typed, AI-extracted, or Excel1-applied) is the
      // highest-trust value in this flow — an Excel2 price-list match should only ever
      // fill the name in when it's genuinely still blank, never clobber it.
      const nameIsBlank = !f.itemName.trim();
      return {
        ...f,
        itemName: nameIsBlank ? result.itemName : f.itemName,
        ...(nameIsBlank && validCategory ? { category: validCategory } : {}),
        retailPrice: result.retailPrice,
        wholesalePrice: result.wholesalePrice,
        distributorPrice: result.distributorPrice,
      };
    });
    setP3Results([]);
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

  // --------------- Open a Panel 4 Processed Item into Panel 2/3 for editing ---------------
  function editProcessedItem(item: ProcessedItem) {
    // Mutually exclusive with selectedSnap — don't let an active draft and an editing
    // product both be "selected" at once.
    setSelectedSnap(null);
    setEditingProduct(item);
    setForm({
      ...EMPTY_FORM,
      itemName: item.itemName,
      brand: item.brand,
      size: item.size,
      category: item.category,
      expiryDate: item.expiryDate ? item.expiryDate.slice(0, 10) : "",
      // Quantity editing isn't part of this flow (existing stock count isn't something
      // that gets flagged) — default to 1 just so the form has a valid value.
      quantity: 1,
      retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      distributorPrice: item.distributorPrice,
    });
    setP2Search("");
    setP3Search("");
    setP2Results([]);
    setP3Results([]);
    setCatalogMatches([]);
    setMergeTarget(null);
    setMergeError("");
    setSaveError("");
    setEditSaveError("");
    setAiScanError("");
    // Panel 2 lives above Panel 4 in the layout, so scroll it into view the same way
    // the "Continue to Price Matching" button jumps down to Panel 3.
    requestAnimationFrame(() => {
      panel2Ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    });
  }

  // --------------- Cancel edit mode without saving ---------------
  function cancelEdit() {
    setEditingProduct(null);
    setEditSaveError("");
    setForm({ ...EMPTY_FORM });
    setP2Search("");
    setP3Search("");
    setP2Results([]);
    setP3Results([]);
  }

  // --------------- Save an edit to an existing Product (Panel 4 edit mode) ---------------
  async function handleSaveEdit() {
    if (!editingProduct) return;
    setEditSaving(true);
    setEditSaveError("");
    try {
      const payload = {
        branchId,
        itemName: form.itemName,
        brand: form.brand,
        size: form.size || "Standard",
        category: form.category,
        expiryDate: form.expiryDate || null,
        retailPrice: form.retailPrice,
        wholesalePrice: form.wholesalePrice,
        distributorPrice: form.distributorPrice,
      };

      const res = await fetch(`/api/products/${editingProduct.productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error ?? "Save failed");
      }

      const { product } = await res.json();

      // Reflect the update in Panel 4 immediately — moves to Clean if now fully complete,
      // or stays in Flagged with updated reason badges — without waiting for a refetch.
      setProcessedItems((prev) =>
        prev.map((item) =>
          item.productId === editingProduct.productId
            ? {
                ...item,
                itemName: product.itemName,
                brand: product.brand,
                size: product.size,
                category: product.category,
                expiryDate: product.expiryDate ?? null,
                retailPrice: product.retailPrice,
                wholesalePrice: product.wholesalePrice,
                distributorPrice: product.distributorPrice,
                needsReviewReason: product.needsReviewReason ?? [],
              }
            : item
        )
      );

      setEditingProduct(null);
      setForm({ ...EMPTY_FORM });
      setP2Search("");
      setP3Search("");
      setP2Results([]);
      setP3Results([]);
    } catch (err) {
      setEditSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setEditSaving(false);
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

  // --------------- Skip snap (reversible — needs later attention, moved out of the main queue) ---------------
  async function handleSkip() {
    if (!selectedSnap) return;
    const snap = selectedSnap;
    try {
      const res = await fetch(`/api/products/ai-drafts/${snap._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      if (!res.ok) return;
      const skipped = { ...snap, status: "skipped" as const };
      setSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      setSkippedSnaps((prev) => [skipped, ...prev]);
      setSelectedSnap(null);
      setForm({ ...EMPTY_FORM });
      setP2Search("");
      setP3Search("");
      setP2Results([]);
      setP3Results([]);
      setCatalogMatches([]);
      setSaveError("");
      setMergeError("");
    } catch {
      // silent
    }
  }

  // --------------- Restore a skipped or dismissed snap back into the queue ---------------
  async function handleRestore(snap: AiDraft) {
    try {
      const res = await fetch(`/api/products/ai-drafts/${snap._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      if (!res.ok) return;
      const restored = { ...snap, status: "pending" as const };
      setSkippedSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      setDismissedSnaps((prev) => prev.filter((s) => s._id !== snap._id));
      setSnaps((prev) => [restored, ...prev]);
    } catch {
      // silent
    }
  }

  const pendingSnaps = [...snaps, ...skippedSnaps];
  const laneCounts = [0, 1, 2].map((lane) => pendingSnaps.filter((s) => laneOf(s._id) === lane).length);
  const laneFilteredSnaps = viewFilter === "all" ? snaps : snaps.filter((s) => laneOf(s._id) === viewFilter);
  const visibleSnaps = aiReadOnly ? laneFilteredSnaps.filter((s) => s.status === "extracted") : laneFilteredSnaps;
  const visibleSkipped = viewFilter === "all" ? skippedSnaps : skippedSnaps.filter((s) => laneOf(s._id) === viewFilter);
  const aiReadCount = laneFilteredSnaps.filter((s) => s.status === "extracted").length;
  // Branch-wide (not lane-filtered) — feeds the bulk-publish safety valve, a global
  // one-time action rather than per-operator lane work. Excludes anything already
  // published (productId set) so the banner's count — and the action itself — only ever
  // covers items that genuinely aren't live yet, not a re-publish of the whole queue.
  const totalAiReadCount = snaps.filter((s) => s.status === "extracted" && !s.productId).length;
  const publishedCount = snaps.filter((s) => s.status === "extracted" && !!s.productId).length;

  // One more filter layer on top of whichever list is already "final" for the current
  // queueView — composes with the lane/AI-read filters above rather than replacing them.
  const trimmedQueueSearch = queueSearch.trim().toLowerCase();
  const searchFilteredSnaps = trimmedQueueSearch
    ? visibleSnaps.filter((s) => matchesQueueSearch(s, trimmedQueueSearch))
    : visibleSnaps;
  const searchFilteredSkipped = trimmedQueueSearch
    ? visibleSkipped.filter((s) => matchesQueueSearch(s, trimmedQueueSearch))
    : visibleSkipped;
  const searchFilteredDismissed = trimmedQueueSearch
    ? dismissedSnaps.filter((s) => matchesQueueSearch(s, trimmedQueueSearch))
    : dismissedSnaps;

  const renderedSnaps = searchFilteredSnaps.slice(0, renderLimit);
  const hasMoreSnaps = searchFilteredSnaps.length > renderLimit;

  // Panel 4 lists — pharmacy/branch-wide, deliberately not lane-filtered (see fetchProcessed).
  const cleanProcessedItems = processedItems.filter((i) => !i.needsReviewReason || i.needsReviewReason.length === 0);
  const flaggedProcessedItems = processedItems.filter((i) => i.needsReviewReason && i.needsReviewReason.length > 0);
  const visibleFlaggedItems =
    flaggedReasonFilter === "all"
      ? flaggedProcessedItems
      : flaggedProcessedItems.filter((i) => i.needsReviewReason.includes(flaggedReasonFilter));
  const visibleProcessedItems = processedTab === "clean" ? cleanProcessedItems : visibleFlaggedItems;

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
              {queueView !== "active" && (
                <button
                  onClick={() => setQueueView("active")}
                  className="text-xs rounded-full px-2 py-0.5 font-medium bg-zinc-700 text-white"
                >
                  ← Back to queue
                </button>
              )}
              {visibleSkipped.length > 0 && (
                <button
                  onClick={() => setQueueView((v) => (v === "skipped" ? "active" : "skipped"))}
                  className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                    queueView === "skipped" ? "bg-purple-700 text-white" : "bg-purple-100 text-purple-700 hover:bg-purple-200"
                  }`}
                >
                  {`⏭️ Needs AI (${queueView === "skipped" ? searchFilteredSkipped.length : visibleSkipped.length})`}
                </button>
              )}
              {dismissedSnaps.length > 0 && (
                <button
                  onClick={() => setQueueView((v) => (v === "dismissed" ? "active" : "dismissed"))}
                  className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                    queueView === "dismissed" ? "bg-zinc-700 text-white" : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
                  }`}
                >
                  {`🗑 Dismissed (${queueView === "dismissed" ? searchFilteredDismissed.length : dismissedSnaps.length})`}
                </button>
              )}
              {queueView === "active" && aiReadCount > 0 && (
                <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                  🤖 {aiReadCount} AI-read
                </span>
              )}
              {queueView === "active" && publishedCount > 0 && (
                <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">
                  🟢 {publishedCount} live in POS
                </span>
              )}
              {queueView === "active" && (
                <span className="text-xs bg-zinc-200 text-zinc-600 rounded-full px-2 py-0.5 font-normal">
                  {visibleSnaps.length + visibleSkipped.length} pending
                </span>
              )}
            </div>
          </div>
          {queueView === "active" && totalAiReadCount > 0 && (
            <div className="px-3 pt-2 bg-red-50 border-b border-red-100">
              <button
                onClick={() => {
                  setBulkConfirmError("");
                  setShowBulkConfirmModal(true);
                }}
                className="w-full py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                📤 Publish All AI-Read Items to POS ({totalAiReadCount})
              </button>
              {bulkConfirmSuccessMsg && (
                <p className="text-xs text-green-700 font-medium py-1.5">{bulkConfirmSuccessMsg}</p>
              )}
            </div>
          )}
          {queueView === "active" && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-100 bg-white">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mr-1">Working:</span>
              <button
                onClick={() => chooseView("all")}
                className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                  viewFilter === "all" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                All ({pendingSnaps.length})
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
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => setAiReadOnly(true)}
                  className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                    aiReadOnly ? "bg-purple-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  🤖 AI-Read
                </button>
                <button
                  onClick={() => setAiReadOnly(false)}
                  className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                    !aiReadOnly ? "bg-purple-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  All
                </button>
              </span>
            </div>
          )}
          <div className="px-3 pt-2 pb-1 border-b border-zinc-100 bg-white">
            <input
              type="text"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Search this queue by name, brand, size, or qty…"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {queueView === "dismissed" ? (
              <>
                {searchFilteredDismissed.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center mt-8">
                    {dismissedSnaps.length === 0 ? "Nothing dismissed." : "No matches for your search."}
                  </div>
                )}
                {searchFilteredDismissed.map((snap) => (
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
            ) : queueView === "skipped" ? (
              <>
                {searchFilteredSkipped.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center mt-8">
                    {visibleSkipped.length === 0 ? "Nothing skipped in this view." : "No matches for your search."}
                  </div>
                )}
                {searchFilteredSkipped.map((snap) => (
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
                {searchFilteredSnaps.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center mt-8">
                    {snaps.length === 0
                      ? "No pending snaps. Waiting for new items…"
                      : visibleSnaps.length === 0
                      ? "Nothing in this view right now."
                      : "No matches for your search."}
                  </div>
                )}
                {renderedSnaps.map((snap, idx) => {
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
                          {snap.status === "extracted" && snap.extractedItemName && (
                            <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-medium w-fit mt-0.5">
                              🤖 AI read: {snap.extractedItemName}
                            </span>
                          )}
                          {snap.productId && (
                            <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium w-fit mt-0.5">
                              🟢 Already live in POS — this just edits it
                            </span>
                          )}
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
                {hasMoreSnaps && (
                  <button
                    onClick={() => setRenderLimit((n) => n + RENDER_BATCH)}
                    className="py-2 text-xs font-semibold rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                  >
                    Load {Math.min(RENDER_BATCH, searchFilteredSnaps.length - renderLimit)} more ({searchFilteredSnaps.length - renderLimit} left)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PANEL 2 — Match Name                                          */}
        {/* ============================================================ */}
        <div ref={panel2Ref} className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow">
          <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 font-semibold text-zinc-700">
            📋 Match from Stock List
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {!selectedSnap && !editingProduct ? (
              <div className="text-zinc-400 text-sm text-center mt-8">
                Select a snap from the queue to begin triaging
              </div>
            ) : (
              <>
                {editingProduct && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <span className="text-xs font-semibold text-blue-800">
                      ✏️ Editing catalog item: {editingProduct.itemName}
                    </span>
                    <button
                      onClick={cancelEdit}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-900 shrink-0"
                    >
                      ✕ Cancel edit
                    </button>
                  </div>
                )}

                {/* Images preview — tap to zoom in on the original full-res photo. Editing an
                    existing Product only ever has one image, so the Back slot is skipped. */}
                <div className="flex gap-3">
                  <ResilientThumb
                    src={editingProduct ? editingProduct.imageUrl : selectedSnap?.frontImageUrl ?? null}
                    alt="Front"
                    label="Front"
                    className="flex-1 h-36"
                    size={256}
                    priority
                    onClick={() => {
                      const url = editingProduct ? editingProduct.imageUrl : selectedSnap?.frontImageUrl;
                      if (url) setZoomImage(url);
                    }}
                  />
                  {!editingProduct && selectedSnap && (
                    <ResilientThumb
                      src={selectedSnap.backImageUrl}
                      alt="Back / Expiry"
                      label="Back"
                      className="flex-1 h-36"
                      size={256}
                      priority
                      onClick={() => selectedSnap.backImageUrl && setZoomImage(selectedSnap.backImageUrl)}
                    />
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search stock list by name…"
                    value={p2Search}
                    onChange={(e) => {
                      setP2Search(e.target.value);
                      setP3Search(e.target.value);
                    }}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {p2Loading && (
                    <span className="absolute right-3 top-2 text-xs text-zinc-400">searching…</span>
                  )}
                </div>

                {/* Skip — always available, not gated behind "no results found". Fast, low-friction,
                    and reversible via Restore, so no confirm dialog. Draft-specific, so hidden
                    in edit mode where there's no queue snap to skip. */}
                {selectedSnap && (
                  <button
                    onClick={handleSkip}
                    className="w-full py-2 text-xs font-semibold rounded-lg border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                  >
                    ⏭️ Skip for later
                  </button>
                )}

                {/* Already in catalog — likely the same item re-photographed off another shelf */}
                {catalogMatches.length > 0 && (
                  <div className="shrink-0 rounded-lg border-2 border-amber-300 bg-amber-50">
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
                  <div className="shrink-0 rounded-lg border border-zinc-200">
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

                {/* No match found — AI fallback, only shown once a search came up empty. Scans
                    the draft's own photo, so it's not applicable in edit mode. */}
                {!editingProduct && p2Search.trim() && !p2Loading && p2Results.length === 0 && (
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

                <button
                  onClick={() => panel3Ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" })}
                  className="w-full py-2.5 rounded-xl border border-blue-300 bg-blue-50 text-blue-700 font-semibold text-sm hover:bg-blue-100"
                >
                  Continue to Price Matching →
                </button>
              </>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PANEL 3 — Match Price                                         */}
        {/* ============================================================ */}
        <div ref={panel3Ref} className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow">
          <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 font-semibold text-zinc-700">
            💰 Match Prices
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {!selectedSnap && !editingProduct ? (
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
                  <div className="shrink-0 rounded-lg border border-zinc-200">
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

                {editSaveError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                    ⚠️ {editSaveError}
                  </div>
                )}

                {/* Confirm button — only item name is actually required now; anything else
                    missing (brand/size/expiry/price) gets flagged on the saved product
                    instead of blocking the save. In edit mode there's no draft-review step —
                    Panel 2/3 already show the real fields being changed — so this PATCHes
                    the existing Product directly instead of opening the confirm modal. */}
                <button
                  onClick={() => {
                    if (editingProduct) {
                      handleSaveEdit();
                    } else {
                      setSaveError("");
                      setShowModal(true);
                    }
                  }}
                  disabled={!form.itemName || editSaving}
                  className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed mt-auto"
                >
                  {editingProduct ? (editSaving ? "Saving…" : "✅ Confirm & Save") : "✅ Confirm & Save"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* PANEL 4 — Processed Items (review log)                        */}
      {/* Full-width, collapsible strip below the 3-panel grid. Pharmacy/branch-wide, not   */}
      {/* filtered by operator lane — an audit log across everyone's work, same as Dismissed. */}
      {/* ============================================================ */}
      <div className="mx-4 mb-4 rounded-xl border border-zinc-200 bg-white shadow overflow-hidden">
        <button
          onClick={() => setProcessedExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-zinc-700 hover:bg-zinc-100"
        >
          <span>📋 Processed Items ({processedItems.length})</span>
          <span className={`text-xs text-zinc-400 transition-transform ${processedExpanded ? "rotate-180" : ""}`}>
            ▼
          </span>
        </button>

        {processedExpanded && (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setProcessedTab("clean")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  processedTab === "clean" ? "bg-green-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                ✅ Clean ({cleanProcessedItems.length})
              </button>
              <button
                onClick={() => setProcessedTab("flagged")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  processedTab === "flagged" ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                🚩 Flagged ({flaggedProcessedItems.length})
              </button>
              <button
                onClick={() => setProcessedTab("duplicates")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  processedTab === "duplicates" ? "bg-purple-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                🧬 Possible Duplicates ({duplicateGroups.length})
              </button>
            </div>

            {processedTab === "flagged" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Reason:</span>
                {(["all", "missing_brand", "missing_size", "missing_expiry", "missing_price"] as const).map(
                  (reason) => (
                    <label key={reason} className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                      <input
                        type="radio"
                        name="flaggedReasonFilter"
                        checked={flaggedReasonFilter === reason}
                        onChange={() => setFlaggedReasonFilter(reason)}
                        className="accent-red-600"
                      />
                      {reason === "all" ? "All flagged" : REASON_LABELS[reason]}
                    </label>
                  )
                )}
              </div>
            )}

            {processedTab === "duplicates" ? (
              <div className="flex flex-col gap-3">
                {duplicatesLoading && (
                  <div className="text-zinc-400 text-sm text-center py-6">Scanning catalog for duplicates…</div>
                )}
                {duplicatesError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                    ⚠️ {duplicatesError}
                  </div>
                )}
                {!duplicatesLoading && !duplicatesError && duplicateGroups.length === 0 && (
                  <div className="text-zinc-400 text-sm text-center py-6">No possible duplicates found.</div>
                )}
                {duplicateGroups.map((group) => (
                  <div
                    key={group.groupKey}
                    className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          group.matchType === "exact" ? "bg-purple-700 text-white" : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {group.matchType === "exact" ? "Exact name match" : "Likely match"} · {group.products.length} copies
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openDupDismissConfirm(group)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                        >
                          Not a duplicate
                        </button>
                        <button
                          onClick={() => openDupMergeConfirm(group)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
                        >
                          Merge
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {group.products.map((p) => (
                        <div key={p._id} className="flex flex-col items-center gap-1 w-28">
                          <div className="flex gap-1">
                            {p.frontImageUrl || p.backImageUrl ? (
                              <>
                                <ResilientThumb
                                  src={p.frontImageUrl}
                                  alt={`${p.itemName} front`}
                                  label="Front"
                                  className="h-14 w-14"
                                  size={64}
                                />
                                <ResilientThumb
                                  src={p.backImageUrl}
                                  alt={`${p.itemName} back`}
                                  label="Back"
                                  className="h-14 w-14"
                                  size={64}
                                />
                              </>
                            ) : (
                              <ResilientThumb src={p.imageUrl} alt={p.itemName} className="h-14 w-14" size={64} />
                            )}
                          </div>
                          <div
                            className="text-[11px] font-medium text-zinc-800 text-center leading-tight truncate w-full"
                            title={p.itemName}
                          >
                            {p.itemName}
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate w-full text-center">
                            {p.brand} · {p.size}
                          </div>
                          <div className="text-[10px] text-zinc-600 font-semibold">Qty: {p.quantityInStock}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {visibleProcessedItems.length === 0 && (
                  <div className="col-span-full text-zinc-400 text-sm text-center py-6">
                    {processedTab === "clean" ? "No clean processed items yet." : "No flagged items match this filter."}
                  </div>
                )}
                {visibleProcessedItems.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => editProcessedItem(item)}
                    title="Reopen this item in Panel 2/3 to fix it"
                    className={`flex flex-col gap-1.5 rounded-lg border bg-white p-2 text-left hover:border-blue-300 hover:bg-blue-50 transition-colors ${
                      editingProduct?._id === item._id ? "border-blue-500 bg-blue-50 shadow-md" : "border-zinc-200"
                    }`}
                  >
                    <ResilientThumb
                      src={item.imageUrl}
                      alt={item.itemName}
                      className="h-16 w-16 mx-auto"
                      size={64}
                    />
                    <div className="text-xs font-medium text-zinc-800 leading-tight truncate" title={item.itemName}>
                      {item.itemName}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {item.brand} · {item.size}
                    </div>
                    {item.needsReviewReason.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.needsReviewReason.map((reason) => (
                          <span
                            key={reason}
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
                          >
                            {REASON_LABELS[reason] ?? reason}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Brand</label>
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
                disabled={saving || !form.itemName}
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
      {/* DUPLICATE REVIEW CONFIRM MODAL — merge N live-catalog copies into  */}
      {/* one, or dismiss a group as not-actually-duplicates. Nothing here   */}
      {/* is written until this explicit confirm step, same as the merge     */}
      {/* modal above.                                                       */}
      {/* ================================================================ */}
      {dupConfirm && (
        <div className="fixed inset-0 z-[66] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div
              className={`px-5 py-4 border-b flex items-center justify-between ${
                dupConfirm.mode === "merge" ? "bg-purple-50 border-purple-200" : "bg-zinc-50 border-zinc-200"
              }`}
            >
              <h2 className={`font-bold text-lg ${dupConfirm.mode === "merge" ? "text-purple-900" : "text-zinc-800"}`}>
                {dupConfirm.mode === "merge"
                  ? `⚠️ Merge ${dupConfirm.group.products.length} listings into one?`
                  : "Confirm: these are different products"}
              </h2>
              <button
                onClick={() => setDupConfirm(null)}
                className="text-zinc-400 hover:text-zinc-700 text-xl font-bold leading-none"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-5 flex flex-col gap-5">
              <p className="text-sm text-zinc-600">
                {dupConfirm.mode === "merge"
                  ? "Pick which listing to keep. The others will be deleted and their batch/expiry history moved onto the kept listing — this cannot be undone from here."
                  : "This marks the whole group as not duplicates so it stops showing up in this review list."}
              </p>

              <div className="flex flex-wrap gap-3">
                {dupConfirm.group.products.map((p) => (
                  <label
                    key={p._id}
                    onClick={() => dupConfirm.mode === "merge" && setDupKeptId(p._id)}
                    className={`flex flex-col items-center gap-1.5 w-32 rounded-lg border p-2 ${
                      dupConfirm.mode === "merge" ? "cursor-pointer" : "cursor-default"
                    } ${
                      dupConfirm.mode === "merge" && dupKeptId === p._id
                        ? "border-purple-500 bg-purple-50 shadow-md"
                        : "border-zinc-200"
                    }`}
                  >
                    {dupConfirm.mode === "merge" && (
                      <input
                        type="radio"
                        name="dupKeptId"
                        checked={dupKeptId === p._id}
                        onChange={() => setDupKeptId(p._id)}
                        className="accent-purple-600"
                      />
                    )}
                    <div className="flex gap-1">
                      {p.frontImageUrl || p.backImageUrl ? (
                        <>
                          <ResilientThumb
                            src={p.frontImageUrl}
                            alt={`${p.itemName} front`}
                            label="Front"
                            className="h-16 w-16"
                            size={128}
                          />
                          <ResilientThumb
                            src={p.backImageUrl}
                            alt={`${p.itemName} back`}
                            label="Back"
                            className="h-16 w-16"
                            size={128}
                          />
                        </>
                      ) : (
                        <ResilientThumb src={p.imageUrl} alt={p.itemName} className="h-16 w-16" size={128} />
                      )}
                    </div>
                    <div
                      className="text-[11px] font-medium text-zinc-800 text-center leading-tight truncate w-full"
                      title={p.itemName}
                    >
                      {p.itemName}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate w-full text-center">
                      {p.brand} · {p.size}
                    </div>
                    <div className="text-[10px] text-zinc-600 font-semibold">Qty: {p.quantityInStock}</div>
                    {dupConfirm.mode === "merge" && dupKeptId === p._id && (
                      <span className="text-[9px] font-bold text-purple-700 uppercase">Keep this one</span>
                    )}
                  </label>
                ))}
              </div>

              {dupConfirm.mode === "merge" && (
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Final Quantity In Stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={dupFinalQty}
                    onChange={(e) => setDupFinalQty(Math.max(0, Number(e.target.value)))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Defaults to the sum of all copies&apos; stock (
                    {dupConfirm.group.products.reduce((s, p) => s + p.quantityInStock, 0)}) — adjust if the real
                    count differs.
                  </p>
                </div>
              )}

              {dupError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                  ⚠️ {dupError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-200 flex gap-3">
              <button
                onClick={() => setDupConfirm(null)}
                disabled={dupSubmitting}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 font-semibold text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDupConfirmSubmit}
                disabled={dupSubmitting || (dupConfirm.mode === "merge" && !dupKeptId)}
                className={`flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  dupConfirm.mode === "merge" ? "bg-purple-600 hover:bg-purple-700" : "bg-zinc-700 hover:bg-zinc-800"
                }`}
              >
                {dupSubmitting
                  ? "Working…"
                  : dupConfirm.mode === "merge"
                  ? `✅ Merge into ${dupFinalQty} in stock`
                  : "✅ Confirm, not duplicates"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* BULK CONFIRM MODAL — emergency pre-open safety valve              */}
      {/* ================================================================ */}
      {showBulkConfirmModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-red-50 px-5 py-4 border-b border-red-200">
              <h2 className="font-bold text-red-900 text-lg">📤 Publish {totalAiReadCount} Items to POS</h2>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <p className="text-sm text-zinc-700">
                This will immediately create <strong>{totalAiReadCount}</strong> products in the live catalog
                from every AI-read item, using the quantity already counted. They&apos;ll <strong>stay in this
                queue</strong> too, so operators can keep fixing names/brands, matching real prices, and
                resolving duplicates — triaging one just updates the same live product, it won&apos;t create
                a second one.
              </p>
              <p className="text-sm text-zinc-700">
                <strong>Price will be missing on most or all of them</strong> until reviewed — checkout now
                refuses to sell anything still at ₦0, so nothing rings up for free by accident, but it does
                mean those items can&apos;t be sold until a real price is set.
              </p>
              <p className="text-sm text-zinc-600 font-medium">Continue?</p>
              {bulkConfirmError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                  ⚠️ {bulkConfirmError}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-zinc-200 flex gap-3">
              <button
                onClick={() => setShowBulkConfirmModal(false)}
                disabled={bulkConfirming}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 font-semibold text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkConfirm}
                disabled={bulkConfirming}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 disabled:opacity-40"
              >
                {bulkConfirming ? "Confirming…" : `🚨 Confirm ${totalAiReadCount} Items`}
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
