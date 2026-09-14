"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

interface ResolveClientProps {
  branchId: string | null;
  onClose?: () => void;
}

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

  // Form states for items being edited inline
  const [editingDrafts, setEditingDrafts] = useState<Record<string, any>>({});
  const [editingGroups, setEditingGroups] = useState<Record<string, any>>({});

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
        const first = g.items[0];
        groupForms[g.groupKey] = {
          itemName: first.extractedItemName || "",
          brand: first.extractedBrand || "",
          size: first.extractedSize || "Standard",
          retailPrice: g.suggestedPrice || "",
          quantityInStock: g.totalQty,
          barcode: g.suggestedBarcode || "",
          category: first.category || "medicine",
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

  // 1. Merge Duplicate Group
  const handleMergeGroup = async (groupKey: string) => {
    const group = duplicateGroups.find(g => g.groupKey === groupKey);
    const form = editingGroups[groupKey];
    if (!group || !form) return;

    if (!form.itemName || !form.retailPrice || Number(form.retailPrice) <= 0) {
      alert("Please ensure product has a valid name and price > ₦0.");
      return;
    }

    try {
      setActionLoading(groupKey);
      setErrorMsg(null);

      const res = await fetch("/api/products/ai-drafts/resolve/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: group.items.map((i: any) => i._id),
          productData: form
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to merge");

      showSuccess(`Merged ${group.items.length} items into "${json.product.itemName}"!`);
      fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to merge");
    } finally {
      setActionLoading(null);
    }
  };

  // 2. Save Inline Edit for Needs Attention Item
  const handleSaveDraftEdit = async (draftId: string) => {
    const form = editingDrafts[draftId];
    if (!form) return;

    if (!form.extractedItemName || !form.retailPrice || Number(form.retailPrice) <= 0) {
      alert("Please provide a name and a retail price greater than ₦0.");
      return;
    }

    try {
      setActionLoading(draftId);
      setErrorMsg(null);

      const res = await fetch(`/api/products/ai-drafts/resolve/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save edit");

      showSuccess(`Updated "${json.draft.extractedItemName}"!`);
      fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save draft");
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
                      <strong>{duplicateGroups.length} duplicate groups detected.</strong> Review the combined quantity and click <em>Merge & Approve</em> to create 1 clean product in your POS.
                    </div>
                  </div>

                  {duplicateGroups.map((group) => {
                    const form = editingGroups[group.groupKey] || {};
                    const isSaving = actionLoading === group.groupKey;

                    return (
                      <div key={group.groupKey} className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800 text-xs font-bold uppercase tracking-wider">
                              {group.count} Snaps Matched
                            </span>
                            <span className="text-sm font-bold text-zinc-700">
                              Combined Total: {group.totalQty} Units
                            </span>
                          </div>
                          <button
                            onClick={() => handleMergeGroup(group.groupKey)}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow transition-colors disabled:opacity-50"
                          >
                            {isSaving ? "Merging..." : "⚡ Merge & Approve"}
                          </button>
                        </div>

                        {/* Snapped Photos Grid */}
                        <div className="mb-4">
                          <div className="text-xs font-semibold text-zinc-500 mb-2">Original Snaps:</div>
                          <div className="flex gap-4 overflow-x-auto pb-2">
                            {group.items.map((item: any, idx: number) => (
                              <div key={item._id} className="shrink-0 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl p-2 pr-4">
                                <img
                                  src={item.frontImageUrl}
                                  alt="Front snap"
                                  onClick={() => setSelectedImage(item.frontImageUrl)}
                                  className="h-16 w-16 object-cover rounded-lg cursor-pointer hover:opacity-90 border border-zinc-200"
                                />
                                {item.backImageUrl && (
                                  <img
                                    src={item.backImageUrl}
                                    alt="Back snap"
                                    onClick={() => setSelectedImage(item.backImageUrl)}
                                    className="h-16 w-16 object-cover rounded-lg cursor-pointer hover:opacity-90 border border-zinc-200"
                                  />
                                )}
                                <div className="text-xs">
                                  <div className="font-bold text-zinc-800">Snap #{idx + 1}</div>
                                  <div className="text-zinc-500">Qty: {item.quantityInStock}</div>
                                  <div className="text-zinc-500">Price: ₦{item.retailPrice || 0}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Target Merged Fields */}
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Final Product Name</label>
                            <input
                              type="text"
                              value={form.itemName || ""}
                              onChange={e => setEditingGroups(prev => ({
                                ...prev,
                                [group.groupKey]: { ...prev[group.groupKey], itemName: e.target.value }
                              }))}
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Brand</label>
                            <input
                              type="text"
                              value={form.brand || ""}
                              onChange={e => setEditingGroups(prev => ({
                                ...prev,
                                [group.groupKey]: { ...prev[group.groupKey], brand: e.target.value }
                              }))}
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Size / Strength</label>
                            <input
                              type="text"
                              value={form.size || ""}
                              onChange={e => setEditingGroups(prev => ({
                                ...prev,
                                [group.groupKey]: { ...prev[group.groupKey], size: e.target.value }
                              }))}
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Retail Price (₦)</label>
                            <input
                              type="number"
                              value={form.retailPrice || ""}
                              onChange={e => setEditingGroups(prev => ({
                                ...prev,
                                [group.groupKey]: { ...prev[group.groupKey], retailPrice: e.target.value }
                              }))}
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-bold text-emerald-700 outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">Total Stock</label>
                            <input
                              type="number"
                              value={form.quantityInStock || 0}
                              onChange={e => setEditingGroups(prev => ({
                                ...prev,
                                [group.groupKey]: { ...prev[group.groupKey], quantityInStock: e.target.value }
                              }))}
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>

                      </div>
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
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-rose-900 text-sm">
                    <strong>{needsAttention.length} items need your quick review.</strong> Fill in any ₦0 prices or missing names (e.g. sponges) and tap <em>Save & Ready</em>.
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {needsAttention.map((draft) => {
                      const form = editingDrafts[draft._id] || {};
                      const isSaving = actionLoading === draft._id;
                      const reasons = draft.needsReviewReason || [];
                      const isZeroPrice = !draft.retailPrice || draft.retailPrice <= 0;

                      return (
                        <div key={draft._id} className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                          <div>
                            <div className="flex gap-3 mb-4">
                              <div className="shrink-0 flex gap-1">
                                <img
                                  src={draft.frontImageUrl}
                                  alt="Front"
                                  onClick={() => setSelectedImage(draft.frontImageUrl)}
                                  className="h-20 w-20 object-cover rounded-xl border border-zinc-200 cursor-pointer hover:opacity-90"
                                />
                                {draft.backImageUrl && (
                                  <img
                                    src={draft.backImageUrl}
                                    alt="Back"
                                    onClick={() => setSelectedImage(draft.backImageUrl)}
                                    className="h-20 w-20 object-cover rounded-xl border border-zinc-200 cursor-pointer hover:opacity-90"
                                  />
                                )}
                              </div>

                              <div className="flex-1">
                                <div className="flex flex-wrap gap-1 mb-1.5">
                                  {isZeroPrice && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                                      🚩 Price is ₦0
                                    </span>
                                  )}
                                  {reasons.includes("missing_name") && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                      🏷️ Needs Name
                                    </span>
                                  )}
                                  {reasons.includes("outlier_price") && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                                      ⚠️ Check Price
                                    </span>
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
                                  value={form.extractedItemName || ""}
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
                                  <label className="block text-[11px] font-bold text-zinc-500 uppercase">Retail Price (₦) *</label>
                                  <input
                                    type="number"
                                    value={form.retailPrice || ""}
                                    onChange={e => setEditingDrafts(prev => ({
                                      ...prev,
                                      [draft._id]: { ...prev[draft._id], retailPrice: e.target.value }
                                    }))}
                                    placeholder="Enter price"
                                    className={`w-full border rounded-lg px-3 py-2 text-sm font-bold outline-none focus:bg-white ${
                                      !form.retailPrice || Number(form.retailPrice) <= 0
                                        ? "bg-rose-50 border-rose-300 text-rose-700"
                                        : "bg-zinc-50 border-zinc-200 text-emerald-700 focus:border-teal-500"
                                    }`}
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-bold text-zinc-500 uppercase">Quantity</label>
                                  <input
                                    type="number"
                                    value={form.quantityInStock || 0}
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
                                    value={form.extractedBrand || ""}
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
                                    value={form.extractedSize || ""}
                                    onChange={e => setEditingDrafts(prev => ({
                                      ...prev,
                                      [draft._id]: { ...prev[draft._id], extractedSize: e.target.value }
                                    }))}
                                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:bg-white focus:border-teal-500"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-zinc-100 flex justify-end">
                            <button
                              onClick={() => handleSaveDraftEdit(draft._id)}
                              disabled={isSaving || !form.retailPrice || Number(form.retailPrice) <= 0}
                              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow transition-all disabled:opacity-40"
                            >
                              {isSaving ? "Saving..." : "✓ Save & Mark Ready"}
                            </button>
                          </div>

                        </div>
                      );
                    })}
                  </div>
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

                  {/* Products Table */}
                  <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Photo</th>
                          <th className="px-4 py-3">Product Name</th>
                          <th className="px-4 py-3">Brand</th>
                          <th className="px-4 py-3">Size / Strength</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Retail Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {readyToPublish.slice(0, 50).map((p) => (
                          <tr key={p._id} className="hover:bg-zinc-50/80 transition-colors">
                            <td className="px-4 py-2">
                              <img
                                src={p.frontImageUrl}
                                alt={p.extractedItemName}
                                onClick={() => setSelectedImage(p.frontImageUrl)}
                                className="h-10 w-10 object-cover rounded-lg border border-zinc-200 cursor-pointer hover:opacity-80"
                              />
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
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {readyToPublish.length > 50 && (
                      <div className="p-4 text-center bg-zinc-50 border-t border-zinc-200 text-xs text-zinc-500 font-medium">
                        Showing first 50 of {readyToPublish.length} clean items. Tap <em>Publish All Now</em> above to launch all of them.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
