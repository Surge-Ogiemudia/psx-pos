"use client";

import React, { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import DuplicateGroupCard from "./components/DuplicateGroupCard";
import ResilientThumb from "./components/ResilientThumb";
import {
  useBackgroundSync,
  FloatingSyncIndicator,
  buildMergeGroupSyncAction,
  buildSaveDraftSyncAction,
  buildApproveDraftSyncAction,
  buildUpdateExpirySyncAction,
} from "./lib/backgroundSync";

interface ResolveClientProps {
  branchId: string | null;
  onClose?: () => void;
}

// Ultra-resilient, persistent CacheStorage thumbnail for weak pharmacy networks
const FastThumb = ResilientThumb;

export default function ResolveClient({ branchId, onClose }: ResolveClientProps) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"duplicates" | "needsAttention" | "ready">("duplicates");
  const [stats, setStats] = useState<any>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<any[]>([]);
  const [needsAttention, setNeedsAttention] = useState<any[]>([]);
  const [readyToPublish, setReadyToPublish] = useState<any[]>([]);
  
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Background optimistic synchronization queue (0ms user wait time)
  const sync = useBackgroundSync({
    onError: (err) => setErrorMsg(err.message),
  });

  // Form states for items being edited inline
  const [editingDrafts, setEditingDrafts] = useState<Record<string, any>>({});
  const [editingGroups, setEditingGroups] = useState<Record<string, any>>({});

  // Ready to Publish sub-tabs, search and pagination
  const [readySubTab, setReadySubTab] = useState<"all" | "withExpiry" | "noExpiry">("all");
  const [readySearch, setReadySearch] = useState<string>("");
  const [readyLimit, setReadyLimit] = useState<number>(50);
  const [editingReadyDraft, setEditingReadyDraft] = useState<any | null>(null);

  // Needs Attention filter radios and pagination
  const [needsAttentionFilter, setNeedsAttentionFilter] = useState<string>("all");
  const [needsLimit, setNeedsLimit] = useState<number>(40);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/products/ai-drafts/resolve${branchId ? `?branchId=${branchId}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load resolve queue");

      setStats(json.stats);
      setDuplicateGroups(json.duplicateGroups || []);
      setNeedsAttention(json.needsAttention || []);
      setReadyToPublish(json.readyToPublish || []);

      // Pre-fill editing states for duplicates
      const groupForms: Record<string, any> = {};
      (json.duplicateGroups || []).forEach((g: any) => {
        const first = g.items[0] || {};
        const bestExpiry = g.items.find((it: any) => it.extractedExpiryDate)?.extractedExpiryDate;
        groupForms[g.groupKey] = {
          itemName: first.extractedItemName || "",
          brand: first.extractedBrand || "",
          size: first.extractedSize || "Standard",
          retailPrice: g.suggestedPrice || "",
          quantityInStock: g.totalQty,
          barcode: g.suggestedBarcode || "",
          category: first.category || "medicine",
          expiryDate: bestExpiry ? new Date(bestExpiry).toISOString().split('T')[0] : "",
        };
      });
      setEditingGroups(groupForms);

      // Pre-fill editing states for needsAttention
      const itemForms: Record<string, any> = {};
      (json.needsAttention || []).forEach((d: any) => {
        itemForms[d._id] = {
          extractedItemName: d.extractedItemName || "",
          extractedBrand: d.extractedBrand || "",
          extractedSize: d.extractedSize || "Standard",
          retailPrice: d.retailPrice || "",
          quantityInStock: d.quantityInStock || 0,
          extractedBarcode: d.extractedBarcode || "",
          category: d.category || "medicine",
          extractedExpiryDate: d.extractedExpiryDate ? new Date(d.extractedExpiryDate).toISOString().split('T')[0] : "",
        };
      });
      setEditingDrafts(itemForms);

      // Switch tab automatically if empty
      if (json.duplicateGroups?.length > 0) {
        setActiveTab("duplicates");
      } else if (json.needsAttention?.length > 0) {
        setActiveTab("needsAttention");
      } else {
        setActiveTab("ready");
      }

    } catch (err: any) {
      setErrorMsg(err.message || "Failed to fetch resolve queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [branchId]);

  const showSuccess = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  // 1. Merge Duplicate Group (Optimistic 0ms UI with background sync)
  const handleMergeGroup = async (groupKey: string) => {
    const group = duplicateGroups.find(g => g.groupKey === groupKey);
    const form = editingGroups[groupKey];
    if (!group || !form) return;

    if (!form.itemName?.trim()) {
      alert("Please ensure product has a valid name before merging.");
      return;
    }

    sync.enqueue(
      buildMergeGroupSyncAction({
        groupKey,
        group,
        form,
        setDuplicateGroups,
        setStats,
        showSuccess,
        setErrorMsg,
      })
    );
  };

  // 1b. Move Single Item Separated from Duplicate Group to Needs Attention (Optimistic 0ms UI)
  const handleApproveSingle = async (draftId: string, itemData: any) => {
    const targetGroup = duplicateGroups.find(g => g.items.some((it: any) => it._id === draftId));
    const targetItem = targetGroup?.items.find((it: any) => it._id === draftId);

    sync.enqueue({
      id: `single-${draftId}`,
      type: "approve_single_item",
      label: `Moved "${itemData.itemName}" to Needs Attention`,
      applyOptimistic: () => {
        // Instantly remove item from duplicate group in UI (0ms latency!)
        setDuplicateGroups(prev =>
          prev
            .map(g => {
              if (g.groupKey !== targetGroup?.groupKey) return g;
              const remaining = g.items.filter((it: any) => it._id !== draftId);
              return {
                ...g,
                items: remaining,
                count: remaining.length,
                totalQty: remaining.reduce((sum: number, it: any) => sum + (it.quantityInStock || 0), 0),
              };
            })
            .filter(g => g.items.length > 0)
        );
        if (setStats) {
          setStats((prev: any) =>
            prev
              ? {
                  ...prev,
                  duplicateDraftsCount: Math.max(0, (prev.duplicateDraftsCount || 1) - 1),
                }
              : prev
          );
        }
      },
      run: async () => {
        const res = await fetch("/api/products/ai-drafts/resolve/approve-single", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId,
            productData: itemData,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to save item");
        return json;
      },
      rollback: (err: Error) => {
        // Restore item back to group on network error
        if (targetGroup && targetItem) {
          setDuplicateGroups(prev => {
            const exists = prev.find(g => g.groupKey === targetGroup.groupKey);
            if (exists) {
              return prev.map(g =>
                g.groupKey === targetGroup.groupKey
                  ? { ...g, items: [...g.items, targetItem], count: g.items.length + 1 }
                  : g
              );
            }
            return [targetGroup, ...prev];
          });
        }
        setErrorMsg(`Failed to save "${itemData.itemName}": ${err.message}`);
      },
      onSuccess: (json: any) => {
        showSuccess(`✓ Moved "${json.draft?.extractedItemName || itemData.itemName}" to Needs Attention for MD price review!`);
      },
    });
  };

  // 2. Save Inline Edit for Needs Attention Item (Immediate DB sync with dynamic flag clearing)
  const handleSaveDraftEdit = async (draftId: string) => {
    const form = editingDrafts[draftId] || {};
    const draft = needsAttention.find((d) => d._id === draftId);
    if (!draft) return;

    const itemName = String(
      form.extractedItemName !== undefined ? form.extractedItemName : (draft.extractedItemName || "")
    ).trim();
    if (!itemName) {
      alert("Please provide a product name.");
      return;
    }

    const payload = {
      extractedItemName: itemName,
      extractedBrand: String(
        form.extractedBrand !== undefined ? form.extractedBrand : (draft.extractedBrand || "Unknown Brand")
      ).trim(),
      extractedSize: String(
        form.extractedSize !== undefined ? form.extractedSize : (draft.extractedSize || "Standard")
      ).trim(),
      extractedBarcode: String(
        form.extractedBarcode !== undefined ? form.extractedBarcode : (draft.extractedBarcode || "")
      ).trim(),
      retailPrice:
        form.retailPrice !== undefined && form.retailPrice !== ""
          ? Number(form.retailPrice)
          : (draft.retailPrice || 0),
      quantityInStock:
        form.quantityInStock !== undefined && form.quantityInStock !== ""
          ? Number(form.quantityInStock)
          : (draft.quantityInStock || 0),
      category: form.category || draft.category || "medicine",
      categoryConfirmed: form.categoryConfirmed !== undefined ? form.categoryConfirmed : (draft.categoryConfirmed || false),
      extractedExpiryDate:
        form.extractedExpiryDate !== undefined
          ? (form.extractedExpiryDate || null)
          : (draft.extractedExpiryDate || null),
    };

    try {
      setActionLoading(`save-${draftId}`);
      setErrorMsg(null);

      const res = await fetch(`/api/products/ai-drafts/resolve/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save draft edits");

      const updated = json.draft;
      const reasons = updated.needsReviewReason || [];
      const isFullyClean = reasons.length === 0 && Number(updated.retailPrice) > 0;

      if (isFullyClean) {
        // Fully resolved! Move cleanly to Ready to Publish
        setNeedsAttention((prev) => prev.filter((d) => d._id !== draftId));
        setReadyToPublish((prev) => [updated, ...prev]);
        if (setStats) {
          setStats((prev: any) =>
            prev
              ? {
                  ...prev,
                  needsAttentionCount: Math.max(0, (prev.needsAttentionCount || 1) - 1),
                  readyToPublishCount: (prev.readyToPublishCount || 0) + 1,
                }
              : prev
          );
        }
        showSuccess(`✓ "${updated.extractedItemName}" is complete and moved to Ready to Publish!`);
      } else {
        // Updated in Needs Attention: update draft attributes and newly recomputed flags in state
        setNeedsAttention((prev) =>
          prev.map((d) => (d._id === draftId ? { ...d, ...updated } : d))
        );
        setEditingDrafts((prev) => ({
          ...prev,
          [draftId]: {
            ...prev[draftId],
            ...updated,
            extractedExpiryDate: updated.extractedExpiryDate
              ? new Date(updated.extractedExpiryDate).toISOString().split("T")[0]
              : "",
          },
        }));
        showSuccess(`✓ Saved "${updated.extractedItemName}"! (Resolved flags updated)`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save item changes");
    } finally {
      setActionLoading(null);
    }
  };

  // 1-Click Confirmation to resolve category mismatches (e.g. confirming it IS Medicine)
  const handleConfirmCategory = async (
    draftId: string,
    confirmedCategory: "medicine" | "supermarket" | "non-medicine"
  ) => {
    const draft = needsAttention.find((d) => d._id === draftId);
    const form = editingDrafts[draftId] || {};
    if (!draft) return;

    const payload = {
      extractedItemName: String(
        form.extractedItemName !== undefined ? form.extractedItemName : (draft.extractedItemName || "")
      ).trim(),
      category: confirmedCategory,
      categoryConfirmed: true,
      extractedBrand: form.extractedBrand !== undefined ? form.extractedBrand : draft.extractedBrand,
      extractedSize: form.extractedSize !== undefined ? form.extractedSize : draft.extractedSize,
      retailPrice: form.retailPrice !== undefined && form.retailPrice !== "" ? Number(form.retailPrice) : draft.retailPrice,
      quantityInStock: form.quantityInStock !== undefined && form.quantityInStock !== "" ? Number(form.quantityInStock) : draft.quantityInStock,
      extractedBarcode: form.extractedBarcode !== undefined ? form.extractedBarcode : draft.extractedBarcode,
      extractedExpiryDate: form.extractedExpiryDate !== undefined ? form.extractedExpiryDate : draft.extractedExpiryDate,
    };

    try {
      setActionLoading(`cat-${draftId}`);
      const res = await fetch(`/api/products/ai-drafts/resolve/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to confirm category");

      const updated = json.draft;
      const reasons = updated.needsReviewReason || [];
      const isFullyClean = reasons.length === 0 && Number(updated.retailPrice) > 0;

      if (isFullyClean) {
        setNeedsAttention((prev) => prev.filter((d) => d._id !== draftId));
        setReadyToPublish((prev) => [updated, ...prev]);
        if (setStats) {
          setStats((prev: any) =>
            prev
              ? {
                  ...prev,
                  needsAttentionCount: Math.max(0, (prev.needsAttentionCount || 1) - 1),
                  readyToPublishCount: (prev.readyToPublishCount || 0) + 1,
                }
              : prev
          );
        }
        showSuccess(`✓ "${updated.extractedItemName}" confirmed and moved to Ready to Publish!`);
      } else {
        setNeedsAttention((prev) =>
          prev.map((d) => (d._id === draftId ? { ...d, ...updated } : d))
        );
        setEditingDrafts((prev) => ({
          ...prev,
          [draftId]: {
            ...prev[draftId],
            ...updated,
            category: confirmedCategory,
            categoryConfirmed: true,
          },
        }));
        showSuccess(
          `✓ Category confirmed as ${
            confirmedCategory === "medicine"
              ? "Medicine"
              : confirmedCategory === "supermarket"
              ? "Supermarket"
              : "General"
          }! Mismatch cleared.`
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to confirm category");
    } finally {
      setActionLoading(null);
    }
  };

  // Update Expiry Date directly from Ready to Publish table (Optimistic 0ms UI)
  const handleUpdateReadyExpiry = async (draftId: string, newDateStr: string) => {
    const current = readyToPublish.find(p => p._id === draftId);
    sync.enqueue(
      buildUpdateExpirySyncAction({
        draftId,
        previousExpiryDate: current?.extractedExpiryDate || null,
        newDateStr,
        setReadyToPublish,
        showSuccess,
        setErrorMsg,
      })
    );
  };

  // Save full edits made in Ready to Publish Quick-Edit modal
  const handleSaveReadyDraftModal = async () => {
    if (!editingReadyDraft) return;

    if (!editingReadyDraft.extractedItemName || !editingReadyDraft.retailPrice || Number(editingReadyDraft.retailPrice) <= 0) {
      alert("Please provide a valid product name and retail price > ₦0.");
      return;
    }

    try {
      setActionLoading(`modal-save-${editingReadyDraft._id}`);
      setErrorMsg(null);

      const res = await fetch(`/api/products/ai-drafts/resolve/${editingReadyDraft._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extractedItemName: editingReadyDraft.extractedItemName,
          extractedBrand: editingReadyDraft.extractedBrand,
          extractedSize: editingReadyDraft.extractedSize,
          extractedBarcode: editingReadyDraft.extractedBarcode,
          retailPrice: Number(editingReadyDraft.retailPrice),
          quantityInStock: Number(editingReadyDraft.quantityInStock),
          category: editingReadyDraft.category,
          extractedExpiryDate: editingReadyDraft.extractedExpiryDate || null,
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save edits");

      showSuccess(`Saved edits for "${editingReadyDraft.extractedItemName}"!`);
      setEditingReadyDraft(null);
      fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save product edits");
    } finally {
      setActionLoading(null);
    }
  };

  // 3. Publish All Clean Items to POS
  const handlePublishAllClean = async () => {
    if (readyToPublish.length === 0) return;
    const confirmMsg = `Publish all ${readyToPublish.length} clean products to the live POS catalog?`;
    if (!confirm(confirmMsg)) return;

    try {
      setActionLoading("publish-all");
      setErrorMsg(null);

      const res = await fetch("/api/products/ai-drafts/resolve/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishAllClean: true,
          branchId
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to publish");

      showSuccess(`🚀 Published ${json.publishedCount} products live to POS!`);
      fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to publish clean items");
    } finally {
      setActionLoading(null);
    }
  };

  // Needs Attention calculations & dynamic issue counts
  const filterCounts = useMemo(() => {
    const counts = {
      all: needsAttention.length,
      zeroPrice: 0,
      missingExpiry: 0,
      pastExpiry: 0,
      missingName: 0,
      categoryCheck: 0,
      other: 0,
    };

    needsAttention.forEach((draft) => {
      const reasons = draft.needsReviewReason || [];
      const isZeroPrice = !draft.retailPrice || draft.retailPrice <= 0 || reasons.includes("zero_price");
      if (isZeroPrice) counts.zeroPrice++;
      if (reasons.includes("missing_expiry")) counts.missingExpiry++;
      if (reasons.includes("past_expiry")) counts.pastExpiry++;
      if (reasons.includes("missing_name")) counts.missingName++;
      if (reasons.includes("looks_like_supermarket") || reasons.includes("looks_like_medicine")) counts.categoryCheck++;
      if (
        reasons.some((r: string) =>
          ["unlikely_low_price", "high_price_check", "high_qty_check", "unlikely_expiry_year"].includes(r)
        )
      ) {
        counts.other++;
      }
    });

    return counts;
  }, [needsAttention]);

  const filteredNeedsAttention = useMemo(() => {
    return needsAttention.filter((draft) => {
      const reasons = draft.needsReviewReason || [];
      const isZeroPrice = !draft.retailPrice || draft.retailPrice <= 0 || reasons.includes("zero_price");

      switch (needsAttentionFilter) {
        case "zeroPrice":
          return isZeroPrice;
        case "missingExpiry":
          return reasons.includes("missing_expiry");
        case "pastExpiry":
          return reasons.includes("past_expiry");
        case "missingName":
          return reasons.includes("missing_name");
        case "categoryCheck":
          return reasons.includes("looks_like_supermarket") || reasons.includes("looks_like_medicine");
        case "other":
          return reasons.some((r: string) =>
            ["unlikely_low_price", "high_price_check", "high_qty_check", "unlikely_expiry_year"].includes(r)
          );
        default:
          return true;
      }
    });
  }, [needsAttention, needsAttentionFilter]);

  const displayedNeedsAttention = useMemo(() => {
    return filteredNeedsAttention.slice(0, needsLimit);
  }, [filteredNeedsAttention, needsLimit]);

  // Ready To Publish calculations
  const readyWithExpiry = readyToPublish.filter(p => !!p.extractedExpiryDate);
  const readyNoExpiry = readyToPublish.filter(p => !p.extractedExpiryDate);

  const filteredReady = readyToPublish.filter(p => {
    if (readySubTab === "withExpiry" && !p.extractedExpiryDate) return false;
    if (readySubTab === "noExpiry" && p.extractedExpiryDate) return false;
    if (readySearch.trim()) {
      const q = readySearch.toLowerCase();
      const name = (p.extractedItemName || "").toLowerCase();
      const brand = (p.extractedBrand || "").toLowerCase();
      const barcode = (p.extractedBarcode || "").toLowerCase();
      if (!name.includes(q) && !brand.includes(q) && !barcode.includes(q)) return false;
    }
    return true;
  });

  const displayedReady = filteredReady.slice(0, readyLimit);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Zoom Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl w-full max-h-[90vh] flex items-center justify-center">
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute -top-12 right-0 text-white hover:text-zinc-300 transition-colors bg-black/50 rounded-full p-2"
            >
              ✕ Close
            </button>
            <img 
              src={selectedImage} 
              alt="Enlarged" 
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl" 
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Success Toast */}
      {successToast && (
        <div className="fixed top-6 right-6 z-50 bg-teal-600 text-white px-5 py-3 rounded-xl shadow-xl font-bold flex items-center gap-2 animate-in slide-in-from-top-2">
          <span>✅</span>
          <span>{successToast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-zinc-200 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">✨</span>
            <h1 className="text-2xl font-bold text-zinc-900">Resolve & Launch Studio</h1>
          </div>
          <p className="text-zinc-500 text-sm mt-1">
            Audit extracted drafts, merge duplicates from different shelves, and fix missing prices before publishing to the live POS catalog.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-semibold transition-colors"
          >
            🔄 Refresh
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-200 hover:bg-zinc-300 text-zinc-800 text-sm font-semibold"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-zinc-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Pending Extraction</div>
            <div className="text-2xl font-black text-amber-600 mt-1">{stats.pending}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">Still in camera queue</div>
          </div>
          <div className="bg-white border border-zinc-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Duplicates to Merge</div>
            <div className="text-2xl font-black text-indigo-600 mt-1">{stats.duplicateGroupsCount} <span className="text-sm font-normal text-zinc-500">({stats.duplicateDraftsCount} items)</span></div>
            <div className="text-[11px] text-zinc-400 mt-0.5">Found on multiple shelves</div>
          </div>
          <div className="bg-white border border-zinc-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Needs Attention</div>
            <div className="text-2xl font-black text-rose-600 mt-1">{stats.needsAttentionCount}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">₦0 price or missing name</div>
          </div>
          <div className="bg-white border border-zinc-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Ready to Publish</div>
            <div className="text-2xl font-black text-teal-600 mt-1">{stats.readyToPublishCount}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">Clean & ready for POS</div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 font-bold">✕</button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-zinc-200 mb-6 gap-2">
        <button
          onClick={() => setActiveTab("duplicates")}
          className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "duplicates"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          <span>🔄</span>
          <span>Merge Duplicates</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 font-bold">
            {duplicateGroups.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("needsAttention")}
          className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "needsAttention"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          <span>⚠️</span>
          <span>Needs Attention</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 text-rose-700 font-bold">
            {needsAttention.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("ready")}
          className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "ready"
              ? "border-teal-600 text-teal-600"
              : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          <span>🟢</span>
          <span>Ready to Publish</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-teal-50 text-teal-700 font-bold">
            {readyToPublish.length}
          </span>
        </button>
      </div>

      {/* Loading indicator */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16">
          <div className="animate-spin h-10 w-10 border-4 border-teal-500 border-t-transparent rounded-full mb-4"></div>
          <p className="text-zinc-500 font-medium">Loading audit data...</p>
        </div>
      ) : (
        <div>
          {/* TAB 1: DUPLICATES */}
          {activeTab === "duplicates" && (
            <div>
              {duplicateGroups.length === 0 ? (
                <div className="p-12 text-center bg-zinc-50 rounded-2xl border border-zinc-200">
                  <span className="text-4xl">🎉</span>
                  <h3 className="mt-3 font-bold text-zinc-800 text-lg">No duplicates found!</h3>
                  <p className="text-zinc-500 text-sm mt-1">All extracted items appear to be unique.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl text-indigo-900 text-sm flex items-center justify-between">
                    <div>
                      <strong>{duplicateGroups.length} duplicate groups detected.</strong> Merge duplicate snaps or split distinct items. Both actions move items directly to <em>Needs Attention</em> for the MD to review and set prices.
                    </div>
                  </div>

                  {duplicateGroups.map((group) => {
                    const form = editingGroups[group.groupKey] || {};
                    const isSaving = actionLoading === group.groupKey;

                    return (
                      <DuplicateGroupCard
                        key={group.groupKey}
                        group={group}
                        mergedForm={form}
                        onMergedFormChange={(updated) => {
                          setEditingGroups((prev) => ({
                            ...prev,
                            [group.groupKey]: {
                              ...(prev[group.groupKey] || {}),
                              ...updated,
                            },
                          }));
                        }}
                        onMergeGroup={handleMergeGroup}
                        onApproveSingle={handleApproveSingle}
                        onImageZoom={(url) => setSelectedImage(url)}
                        isMerging={isSaving}
                        isApprovingDraftId={
                          actionLoading?.startsWith("single-")
                            ? actionLoading.replace("single-", "")
                            : null
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: NEEDS ATTENTION */}
          {activeTab === "needsAttention" && (
            <div>
              {needsAttention.length === 0 ? (
                <div className="p-12 text-center bg-zinc-50 rounded-2xl border border-zinc-200">
                  <span className="text-4xl">🎉</span>
                  <h3 className="mt-3 font-bold text-zinc-800 text-lg">All items are clean!</h3>
                  <p className="text-zinc-500 text-sm mt-1">No items missing price or name.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Top Notification Banner */}
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-rose-900 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <strong>{needsAttention.length} items currently in Needs Attention.</strong> Filter by specific issue below to resolve them step-by-step.
                    </div>
                    <div className="text-xs text-rose-700 font-semibold">
                      Saving any attribute updates its flags immediately
                    </div>
                  </div>

                  {/* FILTER RADIOS BAR */}
                  <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xs">
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                      <span>Filter by Issue Category:</span>
                      <span className="text-[11px] font-normal normal-case text-zinc-400">
                        Select a filter to isolate drafts needing that specific fix
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: "all", label: "All Needs Attention", count: filterCounts.all, icon: "📋", badge: "bg-zinc-200 text-zinc-800" },
                        { id: "zeroPrice", label: "Missing Price (₦0)", count: filterCounts.zeroPrice, icon: "🚩", badge: "bg-rose-100 text-rose-800 border border-rose-200" },
                        { id: "missingExpiry", label: "Missing Expiry", count: filterCounts.missingExpiry, icon: "⏳", badge: "bg-amber-100 text-amber-800 border border-amber-200" },
                        { id: "pastExpiry", label: "Past Expiry", count: filterCounts.pastExpiry, icon: "🔴", badge: "bg-rose-100 text-rose-800 border border-rose-200" },
                        { id: "missingName", label: "Needs Name", count: filterCounts.missingName, icon: "🏷️", badge: "bg-amber-100 text-amber-800 border border-amber-200" },
                        { id: "categoryCheck", label: "Category Mismatch", count: filterCounts.categoryCheck, icon: "🛒", badge: "bg-blue-100 text-blue-800 border border-blue-200" },
                        { id: "other", label: "Qty / Price Outliers", count: filterCounts.other, icon: "⚠️", badge: "bg-purple-100 text-purple-800 border border-purple-200" },
                      ].map((opt) => {
                        const isSelected = needsAttentionFilter === opt.id;
                        return (
                          <label
                            key={opt.id}
                            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border select-none ${
                              isSelected
                                ? "bg-indigo-50 border-indigo-500 text-indigo-950 shadow-xs ring-1 ring-indigo-500/30"
                                : "bg-zinc-50/80 border-zinc-200 text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name="needsAttentionFilter"
                              value={opt.id}
                              checked={isSelected}
                              onChange={() => {
                                setNeedsAttentionFilter(opt.id);
                                setNeedsLimit(40);
                              }}
                              className="accent-indigo-600 h-3.5 w-3.5 cursor-pointer"
                            />
                            <span className="text-sm leading-none">{opt.icon}</span>
                            <span>{opt.label}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                                isSelected ? "bg-indigo-600 text-white" : opt.badge
                              }`}
                            >
                              {opt.count}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Empty state for filtered category */}
                  {filteredNeedsAttention.length === 0 ? (
                    <div className="p-12 text-center bg-zinc-50 rounded-2xl border border-zinc-200">
                      <span className="text-4xl">🎉</span>
                      <h3 className="mt-3 font-bold text-zinc-800 text-lg">No items in this category!</h3>
                      <p className="text-zinc-500 text-sm mt-1">
                        All issues for this filter are resolved. Select another filter radio above to continue reviewing.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {displayedNeedsAttention.map((draft) => {
                          const form = editingDrafts[draft._id] || {};
                          const isSaving = actionLoading === `save-${draft._id}`;
                          const reasons = draft.needsReviewReason || [];
                          const isZeroPrice = !draft.retailPrice || draft.retailPrice <= 0 || reasons.includes("zero_price");

                          return (
                            <div key={draft._id} className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                              <div>
                                <div className="flex gap-3 mb-4">
                                  <div className="shrink-0 flex gap-2">
                                    <FastThumb
                                      src={draft.frontImageUrl}
                                      alt="Front photo"
                                      label="Front"
                                      className="h-20 w-20"
                                      onClick={() => setSelectedImage(draft.frontImageUrl)}
                                    />
                                    <FastThumb
                                      src={draft.backImageUrl}
                                      alt="Back photo"
                                      label="Back"
                                      className="h-20 w-20"
                                      onClick={() => setSelectedImage(draft.backImageUrl)}
                                    />
                                  </div>

                                  <div className="flex-1">
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                      {isZeroPrice && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                                          🚩 ₦0 Price
                                        </span>
                                      )}
                                      {reasons.includes("unlikely_low_price") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                          ⚠️ Low Price: ₦{form.retailPrice ?? draft.retailPrice}
                                        </span>
                                      )}
                                      {reasons.includes("high_price_check") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                                          ⚠️ High Price: ₦{Number(form.retailPrice ?? draft.retailPrice).toLocaleString()}
                                        </span>
                                      )}
                                      {reasons.includes("high_qty_check") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                                          ⚠️ High Qty: {form.quantityInStock ?? draft.quantityInStock}
                                        </span>
                                      )}
                                      {reasons.includes("past_expiry") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                                          🔴 Past Expiry
                                        </span>
                                      )}
                                      {reasons.includes("missing_expiry") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                          ⏳ Missing Expiry
                                        </span>
                                      )}
                                      {reasons.includes("missing_name") && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                          🏷️ Needs Name
                                        </span>
                                      )}
                                      {reasons.includes("looks_like_medicine") && (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button 
                                            type="button"
                                            onClick={() => handleConfirmCategory(draft._id, "supermarket")}
                                            disabled={actionLoading === `cat-${draft._id}`}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                                            title="Confirm this item is definitely Supermarket and clear the medicine recommendation"
                                          >
                                            <span>✓</span>
                                            <span>{actionLoading === `cat-${draft._id}` ? "Saving..." : "Keep as Supermarket"}</span>
                                          </button>
                                          <button 
                                            type="button"
                                            onClick={() => handleConfirmCategory(draft._id, "medicine")}
                                            disabled={actionLoading === `cat-${draft._id}`}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 transition-colors flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                                            title="Switch category to Medicine"
                                          >
                                            <span>💊</span>
                                            <span>Switch to Medicine ↗</span>
                                          </button>
                                        </div>
                                      )}
                                      {reasons.includes("looks_like_supermarket") && (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button 
                                            type="button"
                                            onClick={() => handleConfirmCategory(draft._id, "medicine")}
                                            disabled={actionLoading === `cat-${draft._id}`}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                                            title="Confirm this item is definitely Medicine and clear the supermarket recommendation"
                                          >
                                            <span>✓</span>
                                            <span>{actionLoading === `cat-${draft._id}` ? "Saving..." : "Keep as Medicine"}</span>
                                          </button>
                                          <button 
                                            type="button"
                                            onClick={() => handleConfirmCategory(draft._id, "supermarket")}
                                            disabled={actionLoading === `cat-${draft._id}`}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 transition-colors flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                                            title="Switch category to Supermarket"
                                          >
                                            <span>🛒</span>
                                            <span>Switch to Supermarket ↗</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-xs text-zinc-400">Draft ID: {draft._id}</div>
                                    <div className="text-xs text-zinc-600 mt-1">Qty in snap: <strong>{draft.quantityInStock}</strong></div>
                                  </div>
                                </div>

                                {/* Editable Inputs */}
                                <div className="space-y-2.5">
                                  <div>
                                    <label className="block text-[11px] font-bold text-zinc-500 uppercase">Product Name</label>
                                    <input
                                      type="text"
                                      value={form.extractedItemName !== undefined ? form.extractedItemName : (draft.extractedItemName || "")}
                                      onChange={e => setEditingDrafts(prev => ({
                                        ...prev,
                                        [draft._id]: { ...prev[draft._id], extractedItemName: e.target.value }
                                      }))}
                                      placeholder="e.g. Bath Sponge / Paracetamol"
                                      className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:bg-white focus:border-teal-500"
                                    />
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Retail Price (₦)</label>
                                      <input
                                        type="number"
                                        value={form.retailPrice !== undefined ? form.retailPrice : (draft.retailPrice || "")}
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], retailPrice: e.target.value }
                                        }))}
                                        placeholder="0.00 (Optional for MD)"
                                        className={`w-full border rounded-lg px-3 py-2 text-sm font-bold outline-none focus:bg-white ${
                                          Number(form.retailPrice ?? draft.retailPrice) <= 0
                                            ? "bg-rose-50 border-rose-300 text-rose-700"
                                            : "bg-zinc-50 border-zinc-200 text-emerald-700 focus:border-teal-500"
                                        }`}
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Quantity</label>
                                      <input
                                        type="number"
                                        value={form.quantityInStock !== undefined ? form.quantityInStock : (draft.quantityInStock || 0)}
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], quantityInStock: e.target.value }
                                        }))}
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:bg-white focus:border-teal-500"
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Brand</label>
                                      <input
                                        type="text"
                                        value={form.extractedBrand !== undefined ? form.extractedBrand : (draft.extractedBrand || "")}
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], extractedBrand: e.target.value }
                                        }))}
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:bg-white focus:border-teal-500"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Size / Strength</label>
                                      <input
                                        type="text"
                                        value={form.extractedSize !== undefined ? form.extractedSize : (draft.extractedSize || "")}
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], extractedSize: e.target.value }
                                        }))}
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:bg-white focus:border-teal-500"
                                      />
                                    </div>
                                  </div>

                                  {/* Category Pills */}
                                  <div>
                                    <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Category</label>
                                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-100 rounded-lg">
                                      <button
                                        type="button"
                                        onClick={() => setEditingDrafts(p => ({ ...p, [draft._id]: { ...p[draft._id], category: "medicine", categoryConfirmed: true } }))}
                                        className={`py-1 text-[11px] font-bold rounded flex items-center justify-center gap-1 transition-all ${
                                          (form.category || draft.category) === "medicine" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                                        }`}
                                      >
                                        💊 Medicine
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingDrafts(p => ({ ...p, [draft._id]: { ...p[draft._id], category: "supermarket", categoryConfirmed: true } }))}
                                        className={`py-1 text-[11px] font-bold rounded flex items-center justify-center gap-1 transition-all ${
                                          (form.category || draft.category) === "supermarket" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                                        }`}
                                      >
                                        🛒 Supermarket
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingDrafts(p => ({ ...p, [draft._id]: { ...p[draft._id], category: "non-medicine", categoryConfirmed: true } }))}
                                        className={`py-1 text-[11px] font-bold rounded flex items-center justify-center gap-1 transition-all ${
                                          (form.category || draft.category) === "non-medicine" ? "bg-teal-600 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                                        }`}
                                      >
                                        📦 General
                                      </button>
                                    </div>
                                  </div>

                                  {/* Expiry Date & Barcode */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Expiry Date</label>
                                      <input
                                        type="date"
                                        value={
                                          form.extractedExpiryDate !== undefined
                                            ? (form.extractedExpiryDate || "")
                                            : draft.extractedExpiryDate
                                            ? new Date(draft.extractedExpiryDate).toISOString().split('T')[0]
                                            : ""
                                        }
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], extractedExpiryDate: e.target.value }
                                        }))}
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:bg-white focus:border-teal-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-bold text-zinc-500 uppercase">Barcode</label>
                                      <input
                                        type="text"
                                        value={form.extractedBarcode !== undefined ? form.extractedBarcode : (draft.extractedBarcode || "")}
                                        onChange={e => setEditingDrafts(prev => ({
                                          ...prev,
                                          [draft._id]: { ...prev[draft._id], extractedBarcode: e.target.value }
                                        }))}
                                        placeholder="Optional"
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:bg-white focus:border-teal-500"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Card Action Footer */}
                              <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                                <div className="text-[11px]">
                                  {reasons.length > 0 ? (
                                    <span className="text-amber-700 font-medium">
                                      ⚠️ {reasons.length} issue{reasons.length > 1 ? "s" : ""}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700 font-bold">
                                      ✓ Ready to publish
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleSaveDraftEdit(draft._id)}
                                  disabled={isSaving}
                                  className={`px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 flex items-center gap-1.5 ${
                                    Number(form.retailPrice ?? draft.retailPrice) > 0 && reasons.length <= 1
                                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                                  }`}
                                >
                                  {isSaving ? (
                                    <>
                                      <span className="animate-spin">⏳</span>
                                      <span>Saving...</span>
                                    </>
                                  ) : Number(form.retailPrice ?? draft.retailPrice) > 0 && reasons.length <= 1 ? (
                                    <>
                                      <span>✓</span>
                                      <span>Save & Mark Ready</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>💾</span>
                                      <span>Save Changes</span>
                                    </>
                                  )}
                                </button>
                              </div>

                            </div>
                          );
                        })}
                      </div>

                      {/* Pagination: Load More */}
                      {filteredNeedsAttention.length > displayedNeedsAttention.length && (
                        <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-200 text-center space-y-2">
                          <div className="text-xs text-zinc-500 font-medium">
                            Showing <strong>{displayedNeedsAttention.length}</strong> of <strong>{filteredNeedsAttention.length}</strong> items in this category
                          </div>
                          <div className="flex items-center justify-center gap-3">
                            <button
                              type="button"
                              onClick={() => setNeedsLimit(prev => prev + 40)}
                              className="px-5 py-2.5 bg-white hover:bg-zinc-100 border border-zinc-300 text-zinc-800 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer active:scale-95"
                            >
                              ↓ Load More Items (+40)
                            </button>
                            <button
                              type="button"
                              onClick={() => setNeedsLimit(filteredNeedsAttention.length)}
                              className="px-4 py-2.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95"
                            >
                              Show All ({filteredNeedsAttention.length})
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: READY TO PUBLISH */}
          {activeTab === "ready" && (
            <div>
              {readyToPublish.length === 0 ? (
                <div className="p-12 text-center bg-zinc-50 rounded-2xl border border-zinc-200">
                  <span className="text-4xl">⏳</span>
                  <h3 className="mt-3 font-bold text-zinc-800 text-lg">No clean items pending publish</h3>
                  <p className="text-zinc-500 text-sm mt-1">Review the Duplicates or Needs Attention tabs first.</p>
                </div>
              ) : (
                <div>
                  {/* Publish Banner */}
                  <div className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-bold">🚀 {readyToPublish.length} Products Ready for Live POS</h2>
                      <p className="text-teal-100 text-sm mt-1">
                        All these items have valid names, prices, and quantities. One click publishes them directly to your cash registers.
                      </p>
                    </div>
                    <button
                      onClick={handlePublishAllClean}
                      disabled={actionLoading === "publish-all"}
                      className="px-6 py-3 bg-white text-teal-800 hover:bg-teal-50 rounded-xl font-black text-sm shadow-md transition-all active:scale-95 disabled:opacity-50"
                    >
                      {actionLoading === "publish-all" ? "Publishing..." : `Publish All ${readyToPublish.length} Items Now`}
                    </button>
                  </div>

                  {/* Ready To Publish Sub-tabs & Search Controls */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
                    {/* Sub-tabs for Expiry Date filtering */}
                    <div className="flex items-center gap-1.5 bg-zinc-100 p-1.5 rounded-2xl border border-zinc-200 overflow-x-auto">
                      <button
                        onClick={() => setReadySubTab("all")}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                          readySubTab === "all"
                            ? "bg-white text-zinc-900 shadow-sm"
                            : "text-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        <span>All Products</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-200 text-zinc-700 font-bold">
                          {readyToPublish.length}
                        </span>
                      </button>
                      <button
                        onClick={() => setReadySubTab("withExpiry")}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                          readySubTab === "withExpiry"
                            ? "bg-white text-teal-800 shadow-sm"
                            : "text-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        <span>📅 Has Expiry Date</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-teal-100 text-teal-800 font-bold">
                          {readyWithExpiry.length}
                        </span>
                      </button>
                      <button
                        onClick={() => setReadySubTab("noExpiry")}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                          readySubTab === "noExpiry"
                            ? "bg-white text-amber-800 shadow-sm"
                            : "text-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        <span>⏳ No Expiry Date</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 font-bold">
                          {readyNoExpiry.length}
                        </span>
                      </button>
                    </div>

                    {/* Search & Limit Controls */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search name, brand, barcode..."
                        value={readySearch}
                        onChange={e => setReadySearch(e.target.value)}
                        className="bg-white border border-zinc-200 rounded-xl px-3 py-1.5 text-xs text-zinc-800 placeholder-zinc-400 outline-none focus:border-teal-500 w-full sm:w-56 shadow-sm"
                      />
                      <select
                        value={readyLimit}
                        onChange={e => setReadyLimit(Number(e.target.value))}
                        className="bg-white border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-zinc-700 outline-none focus:border-teal-500 shadow-sm"
                      >
                        <option value={50}>50 rows</option>
                        <option value={100}>100 rows</option>
                        <option value={250}>250 rows</option>
                        <option value={1000}>All rows</option>
                      </select>
                    </div>
                  </div>

                  {/* Products Table */}
                  <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                    {filteredReady.length === 0 ? (
                      <div className="p-8 text-center text-zinc-500 text-sm">
                        No products match your search or filter.
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                              <tr>
                                <th className="px-4 py-3 min-w-[130px]">Photos (Front & Back)</th>
                                <th className="px-4 py-3">Product Name</th>
                                <th className="px-4 py-3">Brand</th>
                                <th className="px-4 py-3">Size / Strength</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3">Qty</th>
                                <th className="px-4 py-3">Retail Price</th>
                                <th className="px-4 py-3 min-w-[170px]">📅 Expiry Date</th>
                                <th className="px-4 py-3 text-right min-w-[90px]">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {displayedReady.map((p) => (
                                <tr key={p._id} className="hover:bg-zinc-50/80 transition-colors">
                                  <td className="px-4 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <FastThumb
                                        src={p.frontImageUrl}
                                        alt={`${p.extractedItemName} Front`}
                                        label="Front"
                                        className="h-12 w-12"
                                        onClick={() => setSelectedImage(p.frontImageUrl)}
                                      />
                                      <FastThumb
                                        src={p.backImageUrl}
                                        alt={`${p.extractedItemName} Back`}
                                        label="Back"
                                        className="h-12 w-12"
                                        onClick={() => setSelectedImage(p.backImageUrl)}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 font-semibold text-zinc-900">{p.extractedItemName}</td>
                                  <td className="px-4 py-2 text-zinc-600">{p.extractedBrand || "—"}</td>
                                  <td className="px-4 py-2 text-zinc-600">{p.extractedSize || "—"}</td>
                                  <td className="px-4 py-2">
                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-100 text-zinc-700 capitalize">
                                      {p.category || "medicine"}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 font-bold text-zinc-900">{p.quantityInStock}</td>
                                  <td className="px-4 py-2 font-bold text-emerald-700">₦{p.retailPrice?.toLocaleString()}</td>
                                  <td className="px-4 py-2">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="date"
                                          defaultValue={p.extractedExpiryDate ? new Date(p.extractedExpiryDate).toISOString().split('T')[0] : ""}
                                          onBlur={(e) => {
                                            const val = e.target.value;
                                            const current = p.extractedExpiryDate ? new Date(p.extractedExpiryDate).toISOString().split('T')[0] : "";
                                            if (val !== current) {
                                              handleUpdateReadyExpiry(p._id, val);
                                            }
                                          }}
                                          className={`text-xs px-2 py-1 rounded-lg border outline-none transition-all ${
                                            p.extractedExpiryDate
                                              ? "border-teal-300 bg-teal-50/50 text-teal-900 font-medium focus:border-teal-500 focus:bg-white"
                                              : "border-zinc-200 bg-zinc-50 text-zinc-400 hover:border-zinc-300 focus:border-teal-500 focus:bg-white"
                                          }`}
                                        />
                                        {actionLoading === `expiry-${p._id}` && (
                                          <span className="text-[10px] text-teal-600 animate-spin">⏳</span>
                                        )}
                                      </div>
                                      {p.extractedExpiryDate && (
                                        <span className="text-[10px] font-bold text-teal-700">
                                          {new Date(p.extractedExpiryDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <button
                                      onClick={() => setEditingReadyDraft({
                                        ...p,
                                        retailPrice: p.retailPrice || "",
                                        quantityInStock: p.quantityInStock || 0,
                                        extractedItemName: p.extractedItemName || "",
                                        extractedBrand: p.extractedBrand || "",
                                        extractedSize: p.extractedSize || "Standard",
                                        category: p.category || "medicine",
                                        extractedBarcode: p.extractedBarcode || "",
                                        extractedExpiryDate: p.extractedExpiryDate ? new Date(p.extractedExpiryDate).toISOString().split('T')[0] : "",
                                      })}
                                      className="px-3 py-1.5 bg-zinc-100 hover:bg-teal-50 hover:text-teal-700 text-zinc-700 rounded-xl text-xs font-bold border border-zinc-200 transition-all inline-flex items-center gap-1 shadow-2xs hover:border-teal-300"
                                    >
                                      ✏️ Edit
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {filteredReady.length > readyLimit && (
                          <div className="p-4 text-center bg-zinc-50 border-t border-zinc-200 text-xs text-zinc-500 font-medium flex items-center justify-center gap-3">
                            <span>Showing first {readyLimit} of {filteredReady.length} items.</span>
                            <button
                              onClick={() => setReadyLimit(prev => prev + 100)}
                              className="px-3 py-1 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg font-bold text-zinc-700 shadow-sm"
                            >
                              Load 100 more
                            </button>
                            <button
                              onClick={() => setReadyLimit(filteredReady.length)}
                              className="px-3 py-1 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg font-bold text-teal-800 shadow-sm"
                            >
                              Show All ({filteredReady.length})
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* QUICK-EDIT MODAL FOR READY TO PUBLISH */}
      {editingReadyDraft && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setEditingReadyDraft(null)}
        >
          <div 
            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50/50">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-teal-100 text-teal-700 rounded-xl text-base">✏️</span>
                <div>
                  <h3 className="font-bold text-zinc-900 text-base">Edit Product Details</h3>
                  <p className="text-xs text-zinc-500">Update any details before sending to live POS catalog</p>
                </div>
              </div>
              <button
                onClick={() => setEditingReadyDraft(null)}
                className="w-8 h-8 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 flex items-center justify-center font-bold text-sm transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Photo Previews */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1.5">Camera Snaps (Front & Back)</label>
                <div className="flex items-center gap-3 bg-zinc-50 p-3 rounded-2xl border border-zinc-200">
                  <FastThumb
                    src={editingReadyDraft.frontImageUrl}
                    alt="Front View"
                    label="Front"
                    className="h-20 w-20 shadow-xs"
                    onClick={() => setSelectedImage(editingReadyDraft.frontImageUrl)}
                  />
                  <FastThumb
                    src={editingReadyDraft.backImageUrl}
                    alt="Back View"
                    label="Back"
                    className="h-20 w-20 shadow-xs"
                    onClick={() => setSelectedImage(editingReadyDraft.backImageUrl)}
                  />
                  <div className="text-xs text-zinc-500">
                    <p className="font-medium text-zinc-700">Click either photo to zoom.</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">Use the snaps to verify exact product naming, strength, and expiry date.</p>
                  </div>
                </div>
              </div>

              {/* Product Name */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Product Name *</label>
                <input
                  type="text"
                  value={editingReadyDraft.extractedItemName || ""}
                  onChange={e => setEditingReadyDraft({ ...editingReadyDraft, extractedItemName: e.target.value })}
                  placeholder="e.g. Paracetamol Tablets 500mg"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-zinc-900 outline-none focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </div>

              {/* Brand & Size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Brand / Manufacturer</label>
                  <input
                    type="text"
                    value={editingReadyDraft.extractedBrand || ""}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, extractedBrand: e.target.value })}
                    placeholder="e.g. Emzor / GSK"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Size / Strength / Pack</label>
                  <input
                    type="text"
                    value={editingReadyDraft.extractedSize || ""}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, extractedSize: e.target.value })}
                    placeholder="e.g. 500mg x 100 or 100ml"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
              </div>

              {/* Category Pills */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Category</label>
                <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setEditingReadyDraft({ ...editingReadyDraft, category: "medicine" })}
                    className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                      editingReadyDraft.category === "medicine" || !editingReadyDraft.category
                        ? "bg-teal-600 text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    💊 Medicine
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingReadyDraft({ ...editingReadyDraft, category: "supermarket" })}
                    className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                      editingReadyDraft.category === "supermarket"
                        ? "bg-teal-600 text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    🛒 Supermarket
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingReadyDraft({ ...editingReadyDraft, category: "non-medicine" })}
                    className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                      editingReadyDraft.category === "non-medicine"
                        ? "bg-teal-600 text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    📦 General
                  </button>
                </div>
              </div>

              {/* Price & Quantity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Retail Price (₦) *</label>
                  <input
                    type="number"
                    value={editingReadyDraft.retailPrice || ""}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, retailPrice: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2 text-sm font-black text-emerald-700 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Quantity in Stock</label>
                  <input
                    type="number"
                    value={editingReadyDraft.quantityInStock !== undefined ? editingReadyDraft.quantityInStock : 0}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, quantityInStock: e.target.value })}
                    placeholder="0"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2 text-sm font-bold text-zinc-900 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
              </div>

              {/* Expiry Date & Barcode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-zinc-500 uppercase">📅 Expiry Date</label>
                    {editingReadyDraft.extractedExpiryDate && (
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                        {new Date(editingReadyDraft.extractedExpiryDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                  <input
                    type="date"
                    value={editingReadyDraft.extractedExpiryDate || ""}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, extractedExpiryDate: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Barcode</label>
                  <input
                    type="text"
                    value={editingReadyDraft.extractedBarcode || ""}
                    onChange={e => setEditingReadyDraft({ ...editingReadyDraft, extractedBarcode: e.target.value })}
                    placeholder="e.g. 615123456789"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-zinc-800 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50">
              <button
                type="button"
                onClick={() => setEditingReadyDraft(null)}
                className="px-4 py-2 text-zinc-600 hover:text-zinc-800 font-bold text-xs rounded-xl hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveReadyDraftModal}
                disabled={
                  actionLoading === `modal-save-${editingReadyDraft._id}` ||
                  !editingReadyDraft.extractedItemName ||
                  !editingReadyDraft.retailPrice ||
                  Number(editingReadyDraft.retailPrice) <= 0
                }
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
              >
                {actionLoading === `modal-save-${editingReadyDraft._id}` ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <span>✓ Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE ZOOM MODAL */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setSelectedImage(null)}
        >
          <div 
            className="relative max-w-4xl max-h-[90vh] bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl p-2 border border-zinc-700 cursor-default" 
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 bg-black/70 hover:bg-black text-white rounded-full w-9 h-9 flex items-center justify-center font-bold text-lg z-10 transition-colors shadow-lg"
              title="Close zoom (Esc)"
            >
              ✕
            </button>
            <img
              src={selectedImage}
              alt="Enlarged photo view"
              className="max-h-[85vh] w-auto mx-auto object-contain rounded-xl"
            />
          </div>
        </div>
      )}

      {/* NON-BLOCKING FLOATING SYNC STATUS (0ms perceived latency) */}
      <FloatingSyncIndicator sync={sync} />

    </div>
  );
}
