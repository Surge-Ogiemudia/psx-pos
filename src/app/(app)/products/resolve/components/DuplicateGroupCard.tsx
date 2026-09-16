"use client";

import React, { useState, useEffect } from "react";

export interface DuplicateItem {
  _id: string;
  branchId?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  quantityInStock?: number;
  retailPrice?: number;
  extractedItemName?: string;
  extractedBrand?: string;
  extractedSize?: string;
  extractedBarcode?: string;
  extractedExpiryDate?: string | Date | null;
  category?: "medicine" | "non-medicine" | "supermarket";
  [key: string]: any;
}

export interface DuplicateGroup {
  groupKey: string;
  count: number;
  totalQty: number;
  suggestedPrice: number;
  suggestedBarcode: string;
  items: DuplicateItem[];
}

export interface MergedFormData {
  itemName: string;
  brand: string;
  size: string;
  retailPrice: string | number;
  quantityInStock: string | number;
  barcode: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string;
}

export interface ItemFormData {
  itemName: string;
  brand: string;
  size: string;
  retailPrice: string | number;
  quantityInStock: string | number;
  barcode: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string;
}

export interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  mergedForm: MergedFormData;
  onMergedFormChange: (updated: Partial<MergedFormData>) => void;
  onMergeGroup: (groupKey: string) => Promise<void> | void;
  onApproveSingle: (draftId: string, itemData: ItemFormData) => Promise<void> | void;
  onImageZoom?: (imageUrl: string) => void;
  isMerging?: boolean;
  isApprovingDraftId?: string | null;
}
import ResilientThumb from "./ResilientThumb";

// Resilient thumbnail with CacheStorage persistent caching & viewport lazy loading
const CardThumb = ResilientThumb;


export default function DuplicateGroupCard({
  group,
  mergedForm,
  onMergedFormChange,
  onMergeGroup,
  onApproveSingle,
  onImageZoom,
  isMerging = false,
  isApprovingDraftId = null,
}: DuplicateGroupCardProps) {
  const [viewMode, setViewMode] = useState<"merged" | "split">("merged");
  const [individualForms, setIndividualForms] = useState<Record<string, ItemFormData>>({});
  const [approvedItems, setApprovedItems] = useState<Record<string, boolean>>({});

  // Initialize individual item forms from draft items
  useEffect(() => {
    const initialForms: Record<string, ItemFormData> = {};
    group.items.forEach((item) => {
      let expStr = "";
      if (item.extractedExpiryDate) {
        try {
          expStr = new Date(item.extractedExpiryDate).toISOString().split("T")[0];
        } catch {}
      }

      initialForms[item._id] = {
        itemName: item.extractedItemName || "",
        brand: item.extractedBrand || "",
        size: item.extractedSize || "Standard",
        retailPrice: item.retailPrice || "",
        quantityInStock: item.quantityInStock !== undefined ? item.quantityInStock : 0,
        barcode: item.extractedBarcode || "",
        category: item.category || "medicine",
        expiryDate: expStr,
      };
    });
    setIndividualForms(initialForms);
  }, [group.items]);

  const handleItemFieldChange = (
    draftId: string,
    field: keyof ItemFormData,
    value: any
  ) => {
    setIndividualForms((prev) => ({
      ...prev,
      [draftId]: {
        ...(prev[draftId] || {
          itemName: "",
          brand: "",
          size: "Standard",
          retailPrice: "",
          quantityInStock: 0,
          barcode: "",
          category: "medicine",
          expiryDate: "",
        }),
        [field]: value,
      },
    }));
  };

  const handleApproveItem = async (item: DuplicateItem) => {
    const form = individualForms[item._id];
    if (!form) return;

    if (!form.itemName || !form.itemName.trim()) {
      alert("Please ensure product name is set.");
      return;
    }

    try {
      await onApproveSingle(item._id, form);
      setApprovedItems((prev) => ({ ...prev, [item._id]: true }));
    } catch (err) {
      console.error("Error saving item:", err);
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs transition-all hover:shadow-sm">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse"></span>
            {group.count} Snaps Matched
          </span>
          <span className="text-sm font-bold text-zinc-700">
            Combined Total: {group.totalQty} Units
          </span>
          {viewMode === "split" && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 font-bold border border-amber-200">
              🔀 Separated View
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {viewMode === "merged" ? (
            <>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs active:scale-[0.98]"
                title="These are distinct products (e.g. 500mg vs 1g) - edit each and move to Needs Attention for MD price entry"
              >
                <span>🔀</span>
                <span>Separate Items (Not Duplicates)</span>
              </button>

              <button
                type="button"
                onClick={() => onMergeGroup(group.groupKey)}
                disabled={isMerging}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                title="Merges these duplicate snaps into 1 draft and sends it to Needs Attention for the MD to review and set prices"
              >
                <span>⚡</span>
                <span>{isMerging ? "Moving to Needs Attention..." : "Merge & Move to Needs Attention"}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setViewMode("merged")}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-200 rounded-xl text-xs font-bold transition-colors cursor-pointer active:scale-[0.98]"
            >
              <span>⬅</span>
              <span>Back to Merged View</span>
            </button>
          )}
        </div>
      </div>

      {/* ================= MODE 1: MERGED VIEW ================= */}
      {viewMode === "merged" && (
        <div>
          {/* Snapped Photos Row */}
          <div className="mb-4">
            <div className="text-xs font-semibold text-zinc-500 mb-2 flex items-center justify-between">
              <span>Original Snaps ({group.items.length}):</span>
              <span className="text-[11px] text-zinc-400">Click any photo to zoom</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {group.items.map((item, idx) => (
                <div
                  key={item._id}
                  className="shrink-0 flex items-center gap-2.5 bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 pr-3.5"
                >
                  <div className="flex items-center gap-1.5">
                    <CardThumb
                      src={item.frontImageUrl}
                      alt={`Snap #${idx + 1} Front`}
                      label="Front"
                      className="h-14 w-14"
                      onClick={() => onImageZoom && item.frontImageUrl && onImageZoom(item.frontImageUrl)}
                    />
                    <CardThumb
                      src={item.backImageUrl}
                      alt={`Snap #${idx + 1} Back`}
                      label="Back"
                      className="h-14 w-14"
                      onClick={() => onImageZoom && item.backImageUrl && onImageZoom(item.backImageUrl)}
                    />
                  </div>
                  <div className="text-xs space-y-0.5">
                    <div className="font-bold text-zinc-800">Snap #{idx + 1}</div>
                    <div className="text-zinc-500 font-medium">Qty: {item.quantityInStock || 0}</div>
                    <div className="text-emerald-700 font-semibold">₦{Number(item.retailPrice || 0).toLocaleString()}</div>
                    {item.extractedSize && (
                      <div className="text-[10px] text-zinc-400 font-mono">{item.extractedSize}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Target Merged Form */}
          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <span>📝 Combined Product Details</span>
              <span className="text-[11px] normal-case font-normal text-zinc-500">
                (Will consolidate {group.items.length} snaps and send to Needs Attention with {group.totalQty} total stock for MD price entry)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Final Product Name
                </label>
                <input
                  type="text"
                  value={mergedForm?.itemName || ""}
                  onChange={(e) => onMergedFormChange({ itemName: e.target.value })}
                  placeholder="e.g. Panadol Extra Tablets"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Brand
                </label>
                <input
                  type="text"
                  value={mergedForm?.brand || ""}
                  onChange={(e) => onMergedFormChange({ brand: e.target.value })}
                  placeholder="e.g. GSK"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Size / Strength
                </label>
                <input
                  type="text"
                  value={mergedForm?.size || ""}
                  onChange={(e) => onMergedFormChange({ size: e.target.value })}
                  placeholder="e.g. 500mg"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Retail Price (₦)
                </label>
                <input
                  type="number"
                  value={mergedForm?.retailPrice ?? ""}
                  onChange={(e) => onMergedFormChange({ retailPrice: e.target.value })}
                  placeholder="0.00"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-bold text-emerald-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Total Stock
                </label>
                <input
                  type="number"
                  value={mergedForm?.quantityInStock ?? 0}
                  onChange={(e) => onMergedFormChange({ quantityInStock: e.target.value })}
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Category
                </label>
                <select
                  value={mergedForm?.category || "medicine"}
                  onChange={(e) =>
                    onMergedFormChange({
                      category: e.target.value as "medicine" | "non-medicine" | "supermarket",
                    })
                  }
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500"
                >
                  <option value="medicine">💊 Medicine</option>
                  <option value="supermarket">🛒 Supermarket</option>
                  <option value="non-medicine">📦 General</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={mergedForm?.expiryDate || ""}
                  onChange={(e) => onMergedFormChange({ expiryDate: e.target.value })}
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                  Barcode / UPC
                </label>
                <input
                  type="text"
                  value={mergedForm?.barcode || ""}
                  onChange={(e) => onMergedFormChange({ barcode: e.target.value })}
                  placeholder="Optional barcode"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODE 2: SPLIT / SEPARATE ITEMS VIEW ================= */}
      {viewMode === "split" && (
        <div className="space-y-4">
          {/* Explanation Banner */}
          <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
            <span className="text-base leading-none">ℹ️</span>
            <div>
              <strong className="font-bold">Separated Items Mode:</strong> These snaps are treated
              as distinct products rather than duplicates. Adjust each item's name, dosage, or
              barcode, and click <strong>Save & Move to Needs Attention</strong> so the items are
              separated immediately and routed to the <em>Needs Attention</em> tab for the MD to review and set prices.
            </div>
          </div>

          {/* Individual Item Cards */}
          <div className="space-y-3">
            {group.items.map((item, idx) => {
              const form = individualForms[item._id] || {
                itemName: item.extractedItemName || "",
                brand: item.extractedBrand || "",
                size: item.extractedSize || "Standard",
                retailPrice: item.retailPrice || "",
                quantityInStock: item.quantityInStock || 0,
                barcode: item.extractedBarcode || "",
                category: item.category || "medicine",
                expiryDate: "",
              };

              const isApproving = isApprovingDraftId === item._id;
              const isApproved = approvedItems[item._id];

              return (
                <div
                  key={item._id}
                  className={`border rounded-xl p-4 transition-all ${
                    isApproved
                      ? "bg-emerald-50/60 border-emerald-300"
                      : "bg-zinc-50/60 border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Snap Thumbnails & Tag */}
                    <div className="shrink-0 flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <CardThumb
                          src={item.frontImageUrl}
                          alt={`Item #${idx + 1} Front`}
                          label="Front"
                          className="h-16 w-16"
                          onClick={() => onImageZoom && item.frontImageUrl && onImageZoom(item.frontImageUrl)}
                        />
                        <CardThumb
                          src={item.backImageUrl}
                          alt={`Item #${idx + 1} Back`}
                          label="Back"
                          className="h-16 w-16"
                          onClick={() => onImageZoom && item.backImageUrl && onImageZoom(item.backImageUrl)}
                        />
                      </div>
                      <div className="text-xs">
                        <span className="inline-block px-2 py-0.5 rounded bg-zinc-200 text-zinc-700 font-bold text-[10px]">
                          Item #{idx + 1}
                        </span>
                        <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                          ID: {item._id.slice(-6)}
                        </div>
                      </div>
                    </div>

                    {/* Editable Fields Grid */}
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                      {/* Product Name */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Product Name
                        </label>
                        <input
                          type="text"
                          disabled={isApproved || isApproving}
                          value={form.itemName}
                          onChange={(e) => handleItemFieldChange(item._id, "itemName", e.target.value)}
                          placeholder="Product Name"
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Brand */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Brand
                        </label>
                        <input
                          type="text"
                          disabled={isApproved || isApproving}
                          value={form.brand}
                          onChange={(e) => handleItemFieldChange(item._id, "brand", e.target.value)}
                          placeholder="Brand"
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Size / Strength */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Size / Strength
                        </label>
                        <input
                          type="text"
                          disabled={isApproved || isApproving}
                          value={form.size}
                          onChange={(e) => handleItemFieldChange(item._id, "size", e.target.value)}
                          placeholder="e.g. 500mg"
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Retail Price (₦) */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Retail Price (₦)
                        </label>
                        <input
                          type="number"
                          disabled={isApproved || isApproving}
                          value={form.retailPrice}
                          onChange={(e) => handleItemFieldChange(item._id, "retailPrice", e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-bold text-emerald-700 outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Quantity */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Quantity
                        </label>
                        <input
                          type="number"
                          disabled={isApproved || isApproving}
                          value={form.quantityInStock}
                          onChange={(e) => handleItemFieldChange(item._id, "quantityInStock", e.target.value)}
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Category */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Category
                        </label>
                        <select
                          disabled={isApproved || isApproving}
                          value={form.category}
                          onChange={(e) =>
                            handleItemFieldChange(
                              item._id,
                              "category",
                              e.target.value as "medicine" | "non-medicine" | "supermarket"
                            )
                          }
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                        >
                          <option value="medicine">💊 Medicine</option>
                          <option value="supermarket">🛒 Supermarket</option>
                          <option value="non-medicine">📦 General</option>
                        </select>
                      </div>

                      {/* Expiry Date */}
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Expiry Date
                        </label>
                        <input
                          type="date"
                          disabled={isApproved || isApproving}
                          value={form.expiryDate}
                          onChange={(e) => handleItemFieldChange(item._id, "expiryDate", e.target.value)}
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-teal-500"
                        />
                      </div>

                      {/* Barcode */}
                      <div className="sm:col-span-2 md:col-span-2">
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-0.5">
                          Barcode
                        </label>
                        <input
                          type="text"
                          disabled={isApproved || isApproving}
                          value={form.barcode}
                          onChange={(e) => handleItemFieldChange(item._id, "barcode", e.target.value)}
                          placeholder="Barcode"
                          className="w-full bg-white border border-zinc-300 disabled:bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>

                    {/* Single Move Action Button */}
                    <div className="shrink-0 flex items-center lg:flex-col justify-end gap-2 pt-2 lg:pt-0">
                      {isApproved ? (
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold">
                          <span>✓</span>
                          <span>Moved to Needs Attention</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleApproveItem(item)}
                          disabled={isApproving}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                        >
                          <span>✓</span>
                          <span>{isApproving ? "Moving..." : "Save & Move to Needs Attention"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
