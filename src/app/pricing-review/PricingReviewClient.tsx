"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import Image from "next/image";

interface DraftItem {
  _id: string;
  frontImageUrl: string;
  backImageUrl?: string | null;
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  extractedBarcode?: string | null;
  extractedExpiryDate?: string | null;
  category?: string;
  quantityInStock?: number;
  retailPrice?: number | null;
  priceConfirmed?: boolean;
  needsReviewReason?: string[];
  status?: string;
}

interface PricingReviewClientProps {
  initialKey?: string;
}

export default function PricingReviewClient({ initialKey }: PricingReviewClientProps) {
  const [accessKey, setAccessKey] = useState<string>(() => {
    if (initialKey) return initialKey;
    if (typeof window !== "undefined") {
      const urlKey = new URLSearchParams(window.location.search).get("key");
      if (urlKey) return urlKey;
      return localStorage.getItem("psx_pricing_key") || "";
    }
    return "";
  });

  const [keyInput, setKeyInput] = useState<string>("");
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [priceInput, setPriceInput] = useState<string>("");
  const [activePhotoView, setActivePhotoView] = useState<"front" | "back">("front");
  const [isZoomOpen, setIsZoomOpen] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>("");

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionSavedCount, setSessionSavedCount] = useState<number>(0);

  // Quick edit item fields
  const [isEditingInfo, setIsEditingInfo] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editBrand, setEditBrand] = useState<string>("");
  const [editSize, setEditSize] = useState<string>("");

  const priceInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  // 1. Initial Load & Fetch
  useEffect(() => {
    fetchDrafts(accessKey);
  }, []);

  async function fetchDrafts(keyToUse: string) {
    setIsLoading(true);
    setIsAuthChecking(true);
    setAuthError(null);
    setErrorMessage(null);

    try {
      const url = keyToUse
        ? `/api/products/pricing-review?key=${encodeURIComponent(keyToUse)}`
        : `/api/products/pricing-review`;

      const res = await fetch(url);

      if (res.status === 401) {
        setAuthError("Please enter your MD access key to review APCare prices.");
        setIsAuthChecking(false);
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to load queue (status ${res.status})`);
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.drafts)) {
        setDrafts(data.drafts);
        if (keyToUse && typeof window !== "undefined") {
          localStorage.setItem("psx_pricing_key", keyToUse);
        }
      } else {
        throw new Error(data.error || "Could not retrieve drafts");
      }
    } catch (err: any) {
      console.error("Error fetching drafts:", err);
      setErrorMessage(err.message || "Failed to load pricing review queue.");
    } finally {
      setIsLoading(false);
      setIsAuthChecking(false);
    }
  }

  // Current draft reference
  const currentDraft: DraftItem | undefined = drafts[currentIndex];

  // Sync state when currentIndex changes
  useEffect(() => {
    if (!currentDraft) return;

    setActivePhotoView("front");
    setIsEditingInfo(false);
    setEditName(currentDraft.extractedItemName || "");
    setEditBrand(currentDraft.extractedBrand || "");
    setEditSize(currentDraft.extractedSize || "");

    const existingPrice = currentDraft.retailPrice && currentDraft.retailPrice > 0 ? String(currentDraft.retailPrice) : "";
    setPriceInput(existingPrice);

    // Auto-focus price input with select all
    const timer = setTimeout(() => {
      if (priceInputRef.current) {
        priceInputRef.current.focus();
        priceInputRef.current.select();
      }
    }, 120);

    // Pre-cache next 3 image thumbnails in browser background
    const upcoming = drafts.slice(currentIndex + 1, currentIndex + 4);
    upcoming.forEach((item) => {
      if (item.frontImageUrl) {
        const img = new window.Image();
        img.src = `/_next/image?url=${encodeURIComponent(item.frontImageUrl)}&w=384&q=75`;
      }
    });

    return () => clearTimeout(timer);
  }, [currentIndex, drafts.length]);

  // Handle Save & Next
  async function handleSaveAndNext() {
    if (!currentDraft) return;

    const numericPrice = parseFloat(priceInput.replace(/,/g, "").trim());
    if (isNaN(numericPrice) || numericPrice <= 0) {
      setErrorMessage("Please enter a valid price greater than 0 before saving.");
      if (priceInputRef.current) priceInputRef.current.focus();
      return;
    }

    setSaveStatus("saving");
    setErrorMessage(null);

    const draftId = currentDraft._id;
    const payload: any = {
      retailPrice: numericPrice,
    };

    if (isEditingInfo) {
      payload.extractedItemName = editName;
      payload.extractedBrand = editBrand;
      payload.extractedSize = editSize;
    }

    // Optimistic advance: mark draft as confirmed locally & increment session count
    startTransition(() => {
      setDrafts((prev) =>
        prev.map((d) =>
          d._id === draftId
            ? {
                ...d,
                retailPrice: numericPrice,
                priceConfirmed: true,
                extractedItemName: payload.extractedItemName ?? d.extractedItemName,
                extractedBrand: payload.extractedBrand ?? d.extractedBrand,
                extractedSize: payload.extractedSize ?? d.extractedSize,
              }
            : d
        )
      );
      setSessionSavedCount((c) => c + 1);
      setSaveStatus("saved");

      // Advance to next unpriced item if possible, or next index
      if (currentIndex < drafts.length) {
        setCurrentIndex((i) => i + 1);
      }
    });

    // Fire API request in background
    try {
      const url = accessKey
        ? `/api/products/pricing-review/${draftId}?key=${encodeURIComponent(accessKey)}`
        : `/api/products/pricing-review/${draftId}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }
    } catch (err: any) {
      console.error("Save error:", err);
      setSaveStatus("error");
      setErrorMessage(`Failed to sync ₦${numericPrice.toLocaleString()} for "${currentDraft.extractedItemName}". Retrying on next connection.`);
    }
  }

  // Handle Skip
  function handleSkip() {
    setErrorMessage(null);
    if (currentIndex < drafts.length) {
      setCurrentIndex((i) => i + 1);
    }
  }

  // Handle Previous
  function handlePrevious() {
    setErrorMessage(null);
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }

  // Quick price preset buttons
  function applyPreset(price: number) {
    setPriceInput(String(price));
    if (priceInputRef.current) priceInputRef.current.focus();
  }

  function addAmount(delta: number) {
    const current = parseFloat(priceInput.replace(/,/g, "")) || 0;
    const nextVal = Math.max(0, current + delta);
    setPriceInput(String(nextVal));
    if (priceInputRef.current) priceInputRef.current.focus();
  }

  // Auth unlock handler
  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!keyInput.trim()) return;
    const cleanKey = keyInput.trim();
    setAccessKey(cleanKey);
    fetchDrafts(cleanKey);
  }

  // Category styling helper
  function getCategoryBadge(cat?: string) {
    switch (cat) {
      case "medicine":
        return {
          label: "Medicine",
          bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
          icon: "💊",
        };
      case "supermarket":
        return {
          label: "Supermarket",
          bg: "bg-amber-50 text-amber-700 border-amber-200",
          icon: "🛒",
        };
      default:
        return {
          label: "Non-Medicine",
          bg: "bg-sky-50 text-sky-700 border-sky-200",
          icon: "🧴",
        };
    }
  }

  // 1. PIN / Key Prompt screen if unauthorized
  if (authError && !isAuthChecking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-8 text-zinc-100">
        <div className="w-full max-w-sm rounded-3xl bg-zinc-900 p-7 shadow-2xl border border-zinc-800">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-2xl text-emerald-400">
            🔐
          </div>
          <h1 className="text-center text-xl font-extrabold text-zinc-50">APCare MD Pricing</h1>
          <p className="mt-1 text-center text-xs text-zinc-400">
            Enter your WhatsApp access key or MD PIN to review and set live prices.
          </p>

          <form onSubmit={handleUnlock} className="mt-6 space-y-4">
            <div>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Access Key / PIN"
                autoFocus
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-3.5 text-center text-sm font-semibold tracking-wider text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 active:scale-95 transition-all hover:bg-emerald-500"
            >
              Unlock Pricing Wizard →
            </button>
          </form>

          <div className="mt-6 border-t border-zinc-800/80 pt-4 text-center text-[11px] text-zinc-500">
            APCare Pharmacy & Stores • Multi-Tenant Isolation Enforced
          </div>
        </div>
      </div>
    );
  }

  // 2. Loading State
  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-white">
        <div className="relative mb-6">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500"></div>
          <div className="absolute inset-0 flex items-center justify-center text-xl">💊</div>
        </div>
        <h2 className="text-lg font-bold text-zinc-100">Fetching APCare Drafts</h2>
        <p className="mt-1.5 text-xs text-zinc-400">Preparing high-speed mobile pricing queue...</p>
      </div>
    );
  }

  // 3. Completed State: When queue is empty or finished
  if (!currentDraft || drafts.length === 0 || currentIndex >= drafts.length) {
    const unpricedRemaining = drafts.filter((d) => !d.priceConfirmed && (!d.retailPrice || d.retailPrice <= 0)).length;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
        <div className="w-full max-w-md rounded-3xl bg-zinc-900 p-8 text-center shadow-2xl border border-zinc-800">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/20 text-4xl animate-bounce">
            🎉
          </div>
          <h1 className="text-2xl font-black text-white">All Caught Up!</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {sessionSavedCount > 0
              ? `Outstanding job! You priced ${sessionSavedCount} products this session.`
              : "No unpriced items remaining in the queue."}
          </p>

          <div className="my-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-800/60 p-4 border border-zinc-700/50">
              <div className="text-2xl font-extrabold text-emerald-400">{sessionSavedCount}</div>
              <div className="text-xs text-zinc-400 mt-1">Priced Today</div>
            </div>
            <div className="rounded-2xl bg-zinc-800/60 p-4 border border-zinc-700/50">
              <div className="text-2xl font-extrabold text-zinc-200">{unpricedRemaining}</div>
              <div className="text-xs text-zinc-400 mt-1">Remaining Unpriced</div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                setCurrentIndex(0);
                fetchDrafts(accessKey);
              }}
              className="w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 active:scale-95 transition-all hover:bg-emerald-500"
            >
              🔄 Refresh / Review Again
            </button>
            <a
              href="/"
              className="block w-full rounded-2xl bg-zinc-800 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Return to POS Main
            </a>
          </div>

          <p className="mt-6 text-[11px] text-zinc-500">APCare Pharmacy Main Branch • Live POS Catalog</p>
        </div>
      </div>
    );
  }

  // Active Image URL (Front vs Back)
  const activeImage =
    activePhotoView === "back" && currentDraft.backImageUrl
      ? currentDraft.backImageUrl
      : currentDraft.frontImageUrl;

  // Optimized Edge Thumbnail
  const edgeThumbUrl = `/_next/image?url=${encodeURIComponent(activeImage)}&w=384&q=75`;

  const categoryInfo = getCategoryBadge(currentDraft.category);
  const totalItems = drafts.length;
  const progressPercent = Math.min(100, Math.round(((currentIndex + 1) / totalItems) * 100));

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 selection:bg-emerald-500 selection:text-white pb-32">
      {/* 1. Ultra-Smooth Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1.5 bg-zinc-900">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 2. Compact Mobile Header */}
      <header className="sticky top-1.5 z-40 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-xs font-bold text-emerald-400 border border-emerald-500/30">
            AP
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-emerald-400">APCare Pharmacy</div>
            <div className="text-[11px] font-medium text-zinc-400">MD Pricing Wizard</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1 text-xs font-bold text-zinc-300">
            {currentIndex + 1} <span className="text-zinc-500">/ {totalItems}</span>
          </div>

          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800"
            title="Browse All Items"
            aria-label="Browse queue"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Error / Offline Toast */}
      {errorMessage && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-red-950/90 border border-red-800/80 px-3.5 py-2.5 text-xs text-red-200">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="ml-2 font-bold text-red-400">
            ✕
          </button>
        </div>
      )}

      {/* 3. Main Single Item Card (Mobile Card Layout) */}
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-3">
        {/* Photo Container */}
        <div className="relative overflow-hidden rounded-3xl bg-zinc-900 border border-zinc-800 shadow-xl">
          {/* Top Floating Controls on Photo */}
          <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
            {/* Category & Stock Badges */}
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border backdrop-blur-md shadow-sm ${categoryInfo.bg}`}>
                <span>{categoryInfo.icon}</span> {categoryInfo.label}
              </span>
              <span className="inline-flex items-center rounded-full bg-zinc-950/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 backdrop-blur-md border border-zinc-700/60 shadow-sm">
                📦 {currentDraft.quantityInStock ?? 1} in stock
              </span>
            </div>

            {/* Front / Back Toggle if back photo is present */}
            {currentDraft.backImageUrl && (
              <div className="pointer-events-auto flex items-center rounded-full bg-zinc-950/80 p-0.5 backdrop-blur-md border border-zinc-700/60 shadow-sm">
                <button
                  type="button"
                  onClick={() => setActivePhotoView("front")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all ${
                    activePhotoView === "front" ? "bg-emerald-500 text-white shadow-sm" : "text-zinc-400"
                  }`}
                >
                  Front
                </button>
                <button
                  type="button"
                  onClick={() => setActivePhotoView("back")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all ${
                    activePhotoView === "back" ? "bg-emerald-500 text-white shadow-sm" : "text-zinc-400"
                  }`}
                >
                  Back
                </button>
              </div>
            )}
          </div>

          {/* Product Image Display */}
          <div
            onClick={() => setIsZoomOpen(true)}
            className="group relative flex h-64 sm:h-72 w-full cursor-zoom-in items-center justify-center bg-zinc-950/50 p-2"
          >
            <img
              src={edgeThumbUrl}
              alt={currentDraft.extractedItemName || "Product photo"}
              className="max-h-full max-w-full rounded-2xl object-contain transition-transform duration-200 group-hover:scale-105"
              onError={(e) => {
                // Fallback to direct raw image if edge-resizer has temporary issue
                const target = e.currentTarget;
                if (target.src !== activeImage) {
                  target.src = activeImage;
                }
              }}
            />

            {/* Tap to Zoom Prompt */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-zinc-950/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 backdrop-blur-md border border-zinc-800 shadow-md">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              Tap to zoom
            </div>
          </div>

          {/* Product Info Bar */}
          <div className="border-t border-zinc-800 bg-zinc-900/90 p-4">
            {!isEditingInfo ? (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg sm:text-xl font-black text-white leading-snug">
                    {currentDraft.extractedItemName || "Unnamed Product"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsEditingInfo(true)}
                    className="shrink-0 text-xs font-semibold text-zinc-400 hover:text-emerald-400 p-1"
                    title="Edit Name/Size"
                  >
                    ✏️ Edit
                  </button>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-400">
                  {currentDraft.extractedBrand && (
                    <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-300">
                      {currentDraft.extractedBrand}
                    </span>
                  )}
                  {currentDraft.extractedSize && (
                    <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-300">
                      {currentDraft.extractedSize}
                    </span>
                  )}
                  {currentDraft.extractedBarcode && (
                    <span className="text-[11px] text-zinc-500 font-mono">
                      #{currentDraft.extractedBarcode}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400">Editing Product Details</span>
                  <button
                    type="button"
                    onClick={() => setIsEditingInfo(false)}
                    className="text-xs font-semibold text-zinc-400"
                  >
                    Done
                  </button>
                </div>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Item Name"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={editBrand}
                    onChange={(e) => setEditBrand(e.target.value)}
                    placeholder="Brand"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={editSize}
                    onChange={(e) => setEditSize(e.target.value)}
                    placeholder="Size (e.g. 50ml, 100mg)"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4. Large Retail Price Entry Box */}
        <div className="mt-4 rounded-3xl bg-zinc-900 border border-zinc-800 p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <label htmlFor="retailPriceInput" className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Retail Price (₦)
            </label>
            {currentDraft.priceConfirmed && (
              <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                ✓ Confirmed
              </span>
            )}
          </div>

          <div className="relative mt-2 flex items-center rounded-2xl bg-zinc-950 px-4 py-3 border-2 border-emerald-500/40 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/20 transition-all">
            <span className="text-3xl font-black text-emerald-500 select-none mr-2">₦</span>
            <input
              id="retailPriceInput"
              ref={priceInputRef}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*"
              value={priceInput}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setPriceInput(val);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSaveAndNext();
                }
              }}
              placeholder="0.00"
              className="w-full bg-transparent text-3xl sm:text-4xl font-black tracking-tight text-white placeholder-zinc-600 focus:outline-none"
            />
            {priceInput && (
              <button
                type="button"
                onClick={() => {
                  setPriceInput("");
                  priceInputRef.current?.focus();
                }}
                className="rounded-full p-1 text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Increment Chips for Mobile Ease */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addAmount(500)}
              className="rounded-xl bg-zinc-800/80 px-2.5 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700 active:scale-95 transition-all border border-zinc-700/50"
            >
              +₦500
            </button>
            <button
              type="button"
              onClick={() => addAmount(1000)}
              className="rounded-xl bg-zinc-800/80 px-2.5 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700 active:scale-95 transition-all border border-zinc-700/50"
            >
              +₦1,000
            </button>
            <button
              type="button"
              onClick={() => addAmount(2000)}
              className="rounded-xl bg-zinc-800/80 px-2.5 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700 active:scale-95 transition-all border border-zinc-700/50"
            >
              +₦2,000
            </button>
            <button
              type="button"
              onClick={() => addAmount(5000)}
              className="rounded-xl bg-zinc-800/80 px-2.5 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700 active:scale-95 transition-all border border-zinc-700/50"
            >
              +₦5,000
            </button>
          </div>
        </div>
      </main>

      {/* 5. Fixed Mobile Bottom Action Bar (Ergonomic Thumb Placement) */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 p-3 sm:p-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-md items-center gap-2.5">
          {/* Previous Button */}
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="flex h-14 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all border border-zinc-800"
          >
            ← Prev
          </button>

          {/* Skip Button */}
          <button
            type="button"
            onClick={handleSkip}
            className="flex h-14 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 active:scale-95 transition-all border border-zinc-800"
          >
            Skip →
          </button>

          {/* Primary Save & Next Button */}
          <button
            type="button"
            onClick={handleSaveAndNext}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/30 active:scale-95 transition-all hover:bg-emerald-500"
          >
            {saveStatus === "saving" ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <span>Save & Next</span>
                <span className="text-base">→</span>
              </>
            )}
          </button>
        </div>
      </footer>

      {/* 6. Fullscreen Tap-to-Zoom Lightbox Modal */}
      {isZoomOpen && (
        <div
          onClick={() => setIsZoomOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl animate-fadeIn cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setIsZoomOpen(false)}
            className="absolute top-5 right-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white font-bold text-lg hover:bg-zinc-700"
          >
            ✕
          </button>
          <img
            src={activeImage}
            alt="Full resolution inspection"
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-xl shadow-2xl"
          />
        </div>
      )}

      {/* 7. Queue Navigation Slide-Over Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="flex h-full w-full max-w-sm flex-col bg-zinc-900 shadow-2xl border-l border-zinc-800">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 p-4">
              <div>
                <h3 className="font-bold text-white text-sm">Drafts Queue</h3>
                <p className="text-[11px] text-zinc-400">
                  {drafts.length} total • {sessionSavedCount} priced this session
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="rounded-full p-2 text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Search Filter in Drawer */}
            <div className="p-3 border-b border-zinc-800">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search by name or brand..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Item List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {drafts
                .map((draft, idx) => ({ draft, idx }))
                .filter(({ draft }) => {
                  if (!searchFilter.trim()) return true;
                  const query = searchFilter.toLowerCase();
                  return (
                    (draft.extractedItemName || "").toLowerCase().includes(query) ||
                    (draft.extractedBrand || "").toLowerCase().includes(query)
                  );
                })
                .map(({ draft, idx }) => {
                  const isCurrent = idx === currentIndex;
                  const isPriced = draft.priceConfirmed || (draft.retailPrice && draft.retailPrice > 0);

                  return (
                    <button
                      key={draft._id}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(idx);
                        setIsDrawerOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all ${
                        isCurrent
                          ? "bg-emerald-600/20 border border-emerald-500/50"
                          : "hover:bg-zinc-800/60 border border-transparent"
                      }`}
                    >
                      <img
                        src={`/_next/image?url=${encodeURIComponent(draft.frontImageUrl)}&w=96&q=70`}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg object-contain bg-zinc-950 p-0.5"
                        onError={(e) => {
                          e.currentTarget.src = draft.frontImageUrl;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {draft.extractedItemName || "Unnamed"}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {draft.extractedBrand || draft.extractedSize || "Standard"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {isPriced ? (
                          <span className="text-xs font-bold text-emerald-400">
                            ₦{Number(draft.retailPrice).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-amber-400">
                            Unpriced
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
