"use client";

import React, { useState, useEffect } from "react";
import { compressImage } from "@/lib/compressImage";

interface AiFastEntryProps {
  onClose: () => void;
  branchId: string | null;
}

export default function AiFastEntry({ onClose, branchId }: AiFastEntryProps) {
  const [saving, setSaving] = useState(false);
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  
  const [category, setCategory] = useState<"medicine" | "supermarket" | "non-medicine">("medicine");

  useEffect(() => {
    const saved = localStorage.getItem("psx_fast_entry_category");
    if (saved === "medicine" || saved === "supermarket" || saved === "non-medicine") {
      setCategory(saved);
    }
  }, []);

  const handleSelectCategory = (cat: "medicine" | "supermarket" | "non-medicine") => {
    setCategory(cat);
    localStorage.setItem("psx_fast_entry_category", cat);
  };
  
  const [form, setForm] = useState({
    frontImageUrl: "",
    backImageUrl: "",
    quantityInStock: "",
    retailPrice: ""
  });
  
  const [previews, setPreviews] = useState({
    front: "",
    back: ""
  });
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/products/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.url;
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>, side: "front" | "back") => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Immediately show local preview
    const objectUrl = URL.createObjectURL(file);
    setPreviews(prev => ({ ...prev, [side]: objectUrl }));

    // Upload in background
    setErrorMsg(null);
    if (side === "front") setUploadingFront(true);
    else setUploadingBack(true);

    try {
      const compressed = await compressImage(file);
      const uploadedUrl = await handleUploadImage(compressed);
      setForm(prev => ({ ...prev, [side === "front" ? "frontImageUrl" : "backImageUrl"]: uploadedUrl }));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to upload image.");
      // Clear preview if it failed
      setPreviews(prev => ({ ...prev, [side]: "" }));
    } finally {
      if (side === "front") setUploadingFront(false);
      else setUploadingBack(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.frontImageUrl) {
      setErrorMsg("Front image is still uploading or missing.");
      return;
    }
    if (!form.quantityInStock) {
      setErrorMsg("Quantity is required.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      const payload = {
        branchId,
        frontImageUrl: form.frontImageUrl,
        backImageUrl: form.backImageUrl || null,
        quantityInStock: Number(form.quantityInStock),
        retailPrice: form.retailPrice ? Number(form.retailPrice) : null,
        category,
      };

      const res = await fetch("/api/products/ai-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      // Flash success and reset form instantly
      setSuccessToast(true);
      setForm({
        frontImageUrl: "",
        backImageUrl: "",
        quantityInStock: "",
        retailPrice: ""
      });
      setPreviews({
        front: "",
        back: ""
      });
      
      setTimeout(() => setSuccessToast(false), 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const isUploading = uploadingFront || uploadingBack;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-zinc-200 flex flex-col my-auto relative">
        
        {successToast && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-teal-600 text-white animate-in fade-in duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mb-4"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <h2 className="text-2xl font-bold">Saved!</h2>
            <p className="opacity-80">Queued for AI Processing</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h2 className="font-bold text-zinc-900">Fast Stock Entry</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 p-1">✕</button>
        </div>

        <div className="p-6">
          {errorMsg && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            
            {/* Category Selector (Sticky) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-600">Category (Saved for Next Snaps)</label>
                <span className="text-[11px] font-medium text-teal-600 capitalize">Active: {category}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => handleSelectCategory("medicine")}
                  className={`py-2 px-1 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    category === "medicine"
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  <span>💊</span> Medicine
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectCategory("supermarket")}
                  className={`py-2 px-1 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    category === "supermarket"
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  <span>🛒</span> Supermarket
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectCategory("non-medicine")}
                  className={`py-2 px-1 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    category === "non-medicine"
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  <span>📦</span> General
                </button>
              </div>
            </div>
            
            {/* Photos Section */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-2">1. Front Photo *</label>
                {previews.front ? (
                  <div className="relative rounded-xl border-2 border-teal-500 overflow-hidden aspect-square group">
                    <img src={previews.front} alt="Front" className="w-full h-full object-cover" />
                    {uploadingFront && (
                      <div className="absolute inset-0 bg-white/60 flex items-center justify-center backdrop-blur-[2px]">
                        <div className="animate-spin h-6 w-6 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                      </div>
                    )}
                    {!uploadingFront && (
                      <button type="button" onClick={() => { setForm(p => ({...p, frontImageUrl: ""})); setPreviews(p => ({...p, front: ""})); }} className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center font-semibold text-sm">Retake</button>
                    )}
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 hover:bg-zinc-100 transition-colors aspect-square cursor-pointer ${saving ? "opacity-50 pointer-events-none" : ""}`}>
                    <span className="text-2xl mb-1">📷</span>
                    <span className="text-xs font-medium text-zinc-500">Tap to Snap</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleImageCapture(e, "front")} disabled={saving} />
                  </label>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-2">2. Back / Details / Expiry</label>
                {previews.back ? (
                  <div className="relative rounded-xl border-2 border-teal-500 overflow-hidden aspect-square group">
                    <img src={previews.back} alt="Back" className="w-full h-full object-cover" />
                    {uploadingBack && (
                      <div className="absolute inset-0 bg-white/60 flex items-center justify-center backdrop-blur-[2px]">
                        <div className="animate-spin h-6 w-6 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                      </div>
                    )}
                    {!uploadingBack && (
                      <button type="button" onClick={() => { setForm(p => ({...p, backImageUrl: ""})); setPreviews(p => ({...p, back: ""})); }} className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center font-semibold text-sm">Retake</button>
                    )}
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 hover:bg-zinc-100 transition-colors aspect-square cursor-pointer text-center p-2 ${saving ? "opacity-50 pointer-events-none" : ""}`}>
                    <span className="text-2xl mb-1">📷</span>
                    <span className="text-xs font-medium text-zinc-500">Back / Details</span>
                    <span className="text-[10px] text-zinc-400 mt-0.5">Optional</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleImageCapture(e, "back")} disabled={saving} />
                  </label>
                )}
              </div>
            </div>

            {/* Manual Entry */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">3. Quantity *</label>
                <input 
                  type="number" 
                  value={form.quantityInStock} 
                  onChange={e => setForm(p => ({...p, quantityInStock: e.target.value}))} 
                  required
                  disabled={saving}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-lg font-bold outline-none focus:border-teal-500 focus:bg-white transition-colors" 
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">4. Retail Price</label>
                <input 
                  type="number" 
                  value={form.retailPrice} 
                  onChange={e => setForm(p => ({...p, retailPrice: e.target.value}))} 
                  disabled={saving}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-lg font-bold outline-none focus:border-teal-500 focus:bg-white transition-colors" 
                  placeholder="Optional"
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={saving || isUploading || !form.frontImageUrl || !form.quantityInStock}
              className="w-full rounded-xl bg-teal-600 py-4 text-lg font-bold text-white shadow-lg hover:bg-teal-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98]"
            >
              {saving ? "Saving..." : isUploading ? "Wait for Upload..." : "Save & Queue"}
            </button>
            
          </form>
        </div>
      </div>
    </div>
  );
}
