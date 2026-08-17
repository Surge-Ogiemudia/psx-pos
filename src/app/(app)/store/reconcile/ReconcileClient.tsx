"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface SuggestedCandidate {
  productId: string;
  productName: string;
  score: number;
}

interface ReconciliationItem {
  _id: string;
  excelItemName: string;
  brand: string;
  size: string;
  category: string;
  totalQuantity: number;
  expiryDate: string | null;
  status: "pending" | "matched" | "created_as_new" | "ignored";
  matchedProductId: {
    _id: string;
    itemName: string;
    brand: string;
    size: string;
    bulkQuantityInStock?: number;
    retailPrice?: number;
  } | null;
  suggestedMatches: SuggestedCandidate[];
  matchedAt: string | null;
}

interface DBProduct {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  category?: string;
  bulkQuantityInStock?: number;
  retailPrice?: number;
}

interface Stats {
  pending: number;
  matched: number;
  created_as_new: number;
  ignored: number;
  total: number;
}

export default function ReconcileClient() {
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ pending: 0, matched: 0, created_as_new: 0, ignored: 0, total: 0 });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Selected item state for side-by-side workspace
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedDbProduct, setSelectedDbProduct] = useState<DBProduct | null>(null);

  // Manual catalog search state
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSearchResults, setCatalogSearchResults] = useState<DBProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Action status
  const [actionProcessing, setActionProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        search: searchQuery,
        page: page.toString(),
        limit: "50",
      });

      const res = await fetch(`/api/store/reconcile?${params}`);
      const data = await res.json();

      if (data.items) {
        setItems(data.items);
        setTotalPages(data.totalPages || 1);
        if (data.stats) setStats(data.stats);

        // Auto-select first item if none selected
        if (!selectedItemId && data.items.length > 0) {
          setSelectedItemId(data.items[0]._id);
        }
      }
    } catch (err) {
      console.error("Failed to load reconciliation items", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, page, selectedItemId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const selectedItem = items.find((i) => i._id === selectedItemId) || null;

  // When selected item changes, sync default selected target DB product
  useEffect(() => {
    if (selectedItem) {
      if (selectedItem.matchedProductId) {
        setSelectedDbProduct(selectedItem.matchedProductId);
      } else if (selectedItem.suggestedMatches && selectedItem.suggestedMatches.length > 0) {
        const top = selectedItem.suggestedMatches[0];
        setSelectedDbProduct({
          _id: top.productId,
          itemName: top.productName,
          brand: "",
          size: "",
          category: "",
        });
      } else {
        setSelectedDbProduct(null);
      }
    }
  }, [selectedItemId]);

  // Handle manual catalog search
  useEffect(() => {
    if (!catalogSearch || catalogSearch.trim().length < 2) {
      setCatalogSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setCatalogLoading(true);
      try {
        const res = await fetch(`/api/store/reconcile/products?query=${encodeURIComponent(catalogSearch)}`);
        const data = await res.json();
        if (data.products) setCatalogSearchResults(data.products);
      } catch (err) {
        console.error(err);
      } finally {
        setCatalogLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [catalogSearch]);

  async function handleMatch() {
    if (!selectedItem || !selectedDbProduct) return;
    setActionProcessing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/store/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "match",
          itemId: selectedItem._id,
          targetProductId: selectedDbProduct._id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to match item");

      setMessage({ type: "success", text: `Successfully matched '${selectedItem.excelItemName}' & set Bulk Stock to ${selectedItem.totalQuantity}!` });
      await fetchItems();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionProcessing(false);
    }
  }

  async function handleUnmatch() {
    if (!selectedItem) return;
    setActionProcessing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/store/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unmatch",
          itemId: selectedItem._id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unmatch item");

      setMessage({ type: "success", text: `Reverted match for '${selectedItem.excelItemName}'` });
      setSelectedDbProduct(null);
      await fetchItems();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionProcessing(false);
    }
  }

  async function handleCreateNew() {
    if (!selectedItem) return;
    setActionProcessing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/store/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_new",
          itemId: selectedItem._id,
          customProductData: {
            itemName: selectedItem.excelItemName,
            brand: selectedItem.brand,
            size: selectedItem.size,
            category: selectedItem.category,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create product");

      setMessage({ type: "success", text: `Created new catalog product for '${selectedItem.excelItemName}'!` });
      await fetchItems();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionProcessing(false);
    }
  }

  const reconciledCount = stats.matched + stats.created_as_new;
  const progressPercent = stats.total > 0 ? Math.round((reconciledCount / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans">
      {/* Header & Breadcrumb */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Link href="/store" className="hover:underline">Bulk Store</Link>
              <span>/</span>
              <span className="text-emerald-400 font-medium">Physical Stock Reconciliation</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Monak Bulk Store Reconciliation
              <span className="text-xs font-normal px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Live Interactive UI
              </span>
            </h1>
          </div>

          <Link
            href="/store"
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            ← Back to Bulk Store
          </Link>
        </div>

        {/* Progress Bar & Stats Cards */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs font-medium text-slate-300 mb-2">
            <span>Overall Reconciliation Progress</span>
            <span className="text-emerald-400 font-bold">{reconciledCount} / {stats.total} Reconciled ({progressPercent}%)</span>
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Total Excel Items</div>
              <div className="text-lg font-bold text-white">{stats.total}</div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Pending Review</div>
              <div className="text-lg font-bold text-amber-400">{stats.pending}</div>
            </div>
            <div className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-800/40">
              <div className="text-xs text-emerald-400 font-medium">Matched & Linked</div>
              <div className="text-lg font-bold text-emerald-400">{stats.matched}</div>
            </div>
            <div className="bg-blue-950/30 p-2.5 rounded-lg border border-blue-800/40">
              <div className="text-xs text-blue-400 font-medium">Created as New</div>
              <div className="text-lg font-bold text-blue-400">{stats.created_as_new}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Dual Column Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: List of Excel Items */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col h-[750px] shadow-xl">
          {/* Filters & Search */}
          <div className="mb-3 space-y-2">
            <input
              type="text"
              placeholder="Search Excel item name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />

            <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              {["all", "pending", "matched", "created_as_new"].map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setStatusFilter(st);
                    setPage(1);
                  }}
                  className={`flex-1 py-1 px-2 rounded-md font-medium capitalize transition ${
                    statusFilter === st
                      ? "bg-emerald-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {st.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {/* List Scroll Area */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {loading ? (
              <div className="text-center py-12 text-xs text-slate-500">Loading reconciliation items...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-xs text-slate-500">No items found matching criteria.</div>
            ) : (
              items.map((item) => {
                const isSelected = item._id === selectedItemId;
                const topScore = item.suggestedMatches?.[0]?.score || 0;

                return (
                  <div
                    key={item._id}
                    onClick={() => setSelectedItemId(item._id)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? "bg-emerald-950/40 border-emerald-500 shadow-md ring-1 ring-emerald-500"
                        : "bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-semibold text-xs text-slate-100 line-clamp-1">
                        {item.excelItemName}
                      </div>

                      {item.status === "matched" && (
                        <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Matched
                        </span>
                      )}
                      {item.status === "created_as_new" && (
                        <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          New Prod
                        </span>
                      )}
                      {item.status === "pending" && (
                        <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-400 border border-slate-700">
                          Pending
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 text-slate-300">
                          Qty: <strong className="text-white">{item.totalQuantity}</strong>
                        </span>
                        <span>{item.brand}</span>
                      </div>

                      {item.status === "pending" && topScore > 0 && (
                        <span className={`text-[10px] font-semibold ${topScore >= 75 ? "text-emerald-400" : topScore >= 55 ? "text-amber-400" : "text-slate-400"}`}>
                          Top Match: {topScore}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-2.5 py-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700 text-slate-200"
            >
              Prev
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 py-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700 text-slate-200"
            >
              Next
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Side-by-Side Matcher Workspace */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col h-[750px] shadow-xl overflow-y-auto">
          {!selectedItem ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
              Select an item from the left pane to begin matching.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Notification Banner */}
              {message && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                    message.type === "success"
                      ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300"
                      : "bg-rose-950/60 border-rose-500/50 text-rose-300"
                  }`}
                >
                  <span>{message.text}</span>
                  <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
                </div>
              )}

              {/* Side-by-Side Comparison Display */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Excel Item Box */}
                <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4 shadow-inner relative">
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded">
                    Excel Inventory Item
                  </div>

                  <h3 className="text-sm font-bold text-white mb-2 pr-16">{selectedItem.excelItemName}</h3>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between border-b border-slate-900 pb-1">
                      <span className="text-slate-400">Physical Qty Counted:</span>
                      <strong className="text-emerald-400 text-sm">{selectedItem.totalQuantity} units</strong>
                    </div>
                    <div className="flex justify-between border-b border-slate-900 pb-1">
                      <span className="text-slate-400">Enriched Brand:</span>
                      <span className="text-slate-200">{selectedItem.brand}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-900 pb-1">
                      <span className="text-slate-400">Enriched Size:</span>
                      <span className="text-slate-200">{selectedItem.size}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Category:</span>
                      <span className="text-slate-200">{selectedItem.category}</span>
                    </div>
                  </div>
                </div>

                {/* Target Catalog Product Box */}
                <div className={`bg-slate-950 border rounded-xl p-4 shadow-inner relative transition ${selectedDbProduct ? "border-blue-500/50" : "border-slate-800"}`}>
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold rounded">
                    Target DB Catalog Item
                  </div>

                  {selectedDbProduct ? (
                    <>
                      <h3 className="text-sm font-bold text-white mb-2 pr-16">{selectedDbProduct.itemName}</h3>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-400">Target DB Product ID:</span>
                          <span className="font-mono text-[10px] text-slate-400">{selectedDbProduct._id.substring(0, 10)}...</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-400">Brand:</span>
                          <span className="text-slate-200">{selectedDbProduct.brand || "—"}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-400">Size:</span>
                          <span className="text-slate-200">{selectedDbProduct.size || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Current Bulk Stock:</span>
                          <strong className="text-amber-400">{selectedDbProduct.bulkQuantityInStock ?? 0} units</strong>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-6 text-slate-500 text-xs">
                      No DB Product selected yet. Select a candidate below or search the catalog.
                    </div>
                  )}
                </div>
              </div>

              {/* ACTION BUTTONS BAR */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                {selectedItem.status === "pending" ? (
                  <>
                    <button
                      disabled={actionProcessing || !selectedDbProduct}
                      onClick={handleMatch}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition shadow-lg flex items-center justify-center gap-2"
                    >
                      {actionProcessing ? "Processing..." : "✓ Match & Overwrite Bulk Stock"}
                    </button>

                    <button
                      disabled={actionProcessing}
                      onClick={handleCreateNew}
                      className="py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition shadow-lg flex items-center justify-center gap-2"
                    >
                      + Create as New Product
                    </button>
                  </>
                ) : (
                  <div className="w-full flex items-center justify-between gap-4">
                    <div className="text-xs text-slate-300">
                      Status: <strong className="text-emerald-400 capitalize">{selectedItem.status.replace(/_/g, " ")}</strong>
                    </div>

                    <button
                      disabled={actionProcessing}
                      onClick={handleUnmatch}
                      className="py-2 px-4 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 font-bold text-xs rounded-lg transition"
                    >
                      ↺ Unmatch & Revert Bulk Stock
                    </button>
                  </div>
                )}
              </div>

              {/* CANDIDATE SUGGESTIONS LIST */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  System Suggested Candidate Matches (Sorted by Confidence)
                </h4>

                {!selectedItem.suggestedMatches || selectedItem.suggestedMatches.length === 0 ? (
                  <div className="text-xs text-slate-500 italic bg-slate-950 p-3 rounded-lg border border-slate-800">
                    No high-confidence suggestions found. Use the manual catalog search below.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedItem.suggestedMatches.map((cand) => {
                      const isCandidateSelected = selectedDbProduct?._id === cand.productId;
                      return (
                        <div
                          key={cand.productId}
                          onClick={() =>
                            setSelectedDbProduct({
                              _id: cand.productId,
                              itemName: cand.productName,
                              brand: "",
                              size: "",
                              category: "",
                            })
                          }
                          className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                            isCandidateSelected
                              ? "bg-blue-950/40 border-blue-500 ring-1 ring-blue-500"
                              : "bg-slate-950 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="text-xs font-medium text-slate-100">{cand.productName}</div>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                              cand.score >= 75
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : cand.score >= 55
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-slate-800 text-slate-400 border-slate-700"
                            }`}
                          >
                            Match Score: {cand.score}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* MANUAL CATALOG SEARCH */}
              <div className="pt-2 border-t border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Manual Catalog Search (Search All 1,727 DB Products)
                </h4>

                <input
                  type="text"
                  placeholder="Type product name or brand to search DB catalog..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-2"
                />

                {catalogLoading && <div className="text-xs text-slate-500">Searching catalog...</div>}

                {catalogSearchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {catalogSearchResults.map((prod) => (
                      <div
                        key={prod._id}
                        onClick={() => {
                          setSelectedDbProduct(prod);
                          setCatalogSearch("");
                          setCatalogSearchResults([]);
                        }}
                        className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-xs flex justify-between items-center cursor-pointer"
                      >
                        <span className="font-medium text-slate-200">{prod.itemName}</span>
                        <span className="text-[10px] text-slate-400">{prod.brand} ({prod.size})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
