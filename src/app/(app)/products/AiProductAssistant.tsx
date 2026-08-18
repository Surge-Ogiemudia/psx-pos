"use client";

import React, { useState, useRef, useEffect } from "react";

interface AiProductAssistantProps {
  onClose: () => void;
  onSave: (productForm: any) => Promise<void>;
}

type Step = "scan_front" | "scan_missing" | "core_details" | "optional_details" | "review" | "success";

export default function AiProductAssistant({ onClose, onSave }: AiProductAssistantProps) {
  const [step, setStep] = useState<Step>("scan_front");
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<any>({
    itemName: "",
    brand: "",
    size: "",
    expiryDate: "",
    barcode: "",
    unitHierarchy: [{ unitName: "Piece", conversionRatio: 1 }],
    quantityInStock: 0,
    retailPrice: 0,
    costPrice: 0,
    wholesalePrice: 0,
    distributorPrice: 0,
    category: "supermarket",
    imageUrl: ""
  });

  const [missing, setMissing] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const startProgress = () => {
    setProgress(0);
    progressInterval.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return 95;
        const inc = prev < 50 ? 8 : prev < 80 ? 3 : 1;
        return prev + inc;
      });
    }, 200);
  };

  const stopProgress = () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
  };

  const handleUploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/products/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.url;
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setErrorMsg(null);
    startProgress();
    try {
      const uploadedUrl = await handleUploadImage(file);
      
      if (step === "scan_front") {
        setForm((prev: any) => ({ ...prev, imageUrl: uploadedUrl }));
        const res = await fetch("/api/products/ai-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: uploadedUrl })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        
        const extracted = json.data;
        setForm((prev: any) => ({
          ...prev,
          itemName: extracted.itemName || prev.itemName,
          brand: extracted.brand || prev.brand,
          size: extracted.size || prev.size,
          expiryDate: extracted.expiryDate || prev.expiryDate,
          barcode: extracted.barcode || prev.barcode,
        }));

        if (extracted.missingFields && extracted.missingFields.length > 0) {
          const needed = extracted.missingFields.filter((f: string) => ["itemName", "brand", "size", "expiryDate", "barcode"].includes(f));
          if (needed.length > 0) {
            setMissing(needed);
            setStep("scan_missing");
            setLoading(false);
            return;
          }
        }
        
        setStep("core_details");
      } else if (step === "scan_missing") {
        const res = await fetch("/api/products/ai-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: uploadedUrl })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        
        const extracted = json.data;
        setForm((prev: any) => ({
          ...prev,
          itemName: extracted.itemName || prev.itemName,
          brand: extracted.brand || prev.brand,
          size: extracted.size || prev.size,
          expiryDate: extracted.expiryDate || prev.expiryDate,
          barcode: extracted.barcode || prev.barcode,
        }));

        setStep("core_details");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process image.");
    } finally {
      stopProgress();
      setTimeout(() => setLoading(false), 300);
    }
  };

  const handleUnitChange = (index: number, field: string, value: any) => {
    setForm((prev: any) => {
      const newUnits = [...prev.unitHierarchy];
      newUnits[index] = { ...newUnits[index], [field]: value };
      return { ...prev, unitHierarchy: newUnits };
    });
  };

  const handleAddUnit = () => {
    setForm((prev: any) => ({
      ...prev,
      unitHierarchy: [...prev.unitHierarchy, { unitName: "", conversionRatio: 1 }]
    }));
  };

  const handleRemoveUnit = (index: number) => {
    setForm((prev: any) => {
      const newUnits = [...prev.unitHierarchy];
      newUnits.splice(index, 1);
      return { ...prev, unitHierarchy: newUnits };
    });
  };

  const handleSave = async () => {
    setLoading(true);
    setErrorMsg(null);
    startProgress();
    try {
      await onSave(form);
      setStep("success");
      setTimeout(() => {
        onClose();
      }, 2000); // close after 2s of success msg
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save product");
    } finally {
      stopProgress();
      setTimeout(() => setLoading(false), 300);
    }
  };

  if (step === "review" || step === "success") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row relative">
          
          {step === "success" && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <h2 className="text-2xl font-bold text-zinc-900">{form.itemName || "Product"} Saved!</h2>
              <p className="text-zinc-500 mt-2">Returning to catalog...</p>
            </div>
          )}

          <div className="bg-zinc-50 p-6 md:w-1/3 border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col items-center justify-center">
            {form.imageUrl ? (
              <img src={form.imageUrl} alt="Product" className="rounded-xl shadow-md max-h-64 object-cover" />
            ) : (
              <div className="h-32 w-32 rounded-xl bg-zinc-200 flex items-center justify-center text-zinc-400">No Image</div>
            )}
            <h3 className="mt-4 font-bold text-lg text-center text-zinc-900">{form.itemName || "Unnamed"}</h3>
            <p className="text-sm text-zinc-500 text-center">{form.brand} • {form.size}</p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-xl font-bold text-zinc-900 mb-4">Final Review</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Category</label>
                  <div className="text-sm font-medium text-zinc-900">{form.category}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Expiry Date</label>
                  <div className="text-sm font-medium text-zinc-900">{form.expiryDate || "-"}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Stock (Base Units)</label>
                  <div className="text-sm font-medium text-zinc-900">{form.quantityInStock}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Retail Price</label>
                  <div className="text-sm font-medium text-zinc-900">₦{form.retailPrice}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Cost Price</label>
                  <div className="text-sm font-medium text-zinc-900">₦{form.costPrice}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Wholesale Price</label>
                  <div className="text-sm font-medium text-zinc-900">₦{form.wholesalePrice || "-"}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Distributor Price</label>
                  <div className="text-sm font-medium text-zinc-900">₦{form.distributorPrice || "-"}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Batch Number</label>
                  <div className="text-sm font-medium text-zinc-900">{form.batchNumber || "-"}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500">Barcode</label>
                  <div className="text-sm font-medium text-zinc-900">{form.barcode || "-"}</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1">Unit Hierarchy</label>
                <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-3 flex flex-wrap gap-2 text-sm">
                  {form.unitHierarchy.map((u: any, i: number) => (
                    <span key={i} className="bg-white border rounded px-2 py-1">
                      {u.conversionRatio}x {u.unitName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            
            {errorMsg && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
                {errorMsg}
              </div>
            )}
            
            <div className="mt-8 flex justify-end gap-3">
              <button onClick={() => setStep("optional_details")} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100" disabled={loading}>Back</button>
              
              <button 
                onClick={handleSave} 
                disabled={loading}
                className="relative overflow-hidden rounded-lg bg-teal-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-teal-700 disabled:opacity-90"
              >
                {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? `Saving... ${progress}%` : "Confirm & Save"}
                </span>
              </button>

            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-zinc-200 flex flex-col my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <h2 className="font-bold text-zinc-900">AI Setup Wizard</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 p-1">✕</button>
        </div>

        {/* Wizard Content */}
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
              {errorMsg}
            </div>
          )}

          {step === "scan_front" && (
            <div className="text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Scan Front Packaging</h3>
              <p className="text-zinc-500 mb-6 text-sm px-4">
                Let's get started. Please take a clear picture of the front of the product showing the Name, Brand, and Size.
              </p>
              <label className={`relative inline-flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-teal-600 py-3.5 text-sm font-bold text-white shadow hover:bg-teal-700 transition-colors ${loading ? "pointer-events-none opacity-90" : ""}`}>
                {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? `Analyzing image... ${progress}%` : "📷 Open Camera"}
                </span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageCapture} disabled={loading} />
              </label>
              
              <div className="mt-4">
                 <button onClick={() => setStep("core_details")} className="text-xs text-zinc-400 hover:text-zinc-600 underline">Skip scanning and enter manually</button>
              </div>
            </div>
          )}

          {step === "scan_missing" && (
            <div className="text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Missing Information</h3>
              <p className="text-zinc-500 mb-6 text-sm px-4">
                We couldn't clearly see the following details: <strong className="text-zinc-800">{missing.join(", ")}</strong>. Please scan the side or back of the packaging to capture them.
              </p>
              <label className={`relative inline-flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-teal-600 py-3.5 text-sm font-bold text-white shadow hover:bg-teal-700 transition-colors ${loading ? "pointer-events-none opacity-90" : ""}`}>
                {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? `Analyzing image... ${progress}%` : "📷 Scan Again"}
                </span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageCapture} disabled={loading} />
              </label>
              
              <div className="mt-4">
                 <button onClick={() => setStep("core_details")} className="text-xs text-zinc-400 hover:text-zinc-600 underline">Skip to manual entry</button>
              </div>
            </div>
          )}

          {step === "core_details" && (
            <div className="animate-in fade-in slide-in-from-right-2 duration-300">
              <h3 className="text-xl font-bold text-zinc-900 mb-4">Core Details</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Item Name (AI Extracted)</label>
                  <input type="text" value={form.itemName} onChange={e => setForm({...form, itemName: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Brand</label>
                    <input type="text" value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Size/Strength</label>
                    <input type="text" value={form.size} onChange={e => setForm({...form, size: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="supermarket">Supermarket</option>
                    <option value="pharmacy">Pharmacy</option>
                    <option value="electronics">Electronics</option>
                    <option value="fashion">Fashion</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1 flex justify-between items-center">
                    <span>Unit Hierarchy</span>
                    <button onClick={handleAddUnit} className="text-teal-600 hover:text-teal-700">+ Add Unit</button>
                  </label>
                  <div className="space-y-2">
                    {form.unitHierarchy.map((unit: any, idx: number) => (
                      <div key={idx} className="flex gap-2 items-center bg-zinc-50 p-2 rounded border border-zinc-200">
                        <div className="flex-1">
                          <input type="text" placeholder="Unit Name (e.g. Sachet)" value={unit.unitName} onChange={(e) => handleUnitChange(idx, "unitName", e.target.value)} className="w-full rounded border px-2 py-1 text-sm mb-1" />
                          <input type="number" placeholder="Ratio (e.g. 1)" value={unit.conversionRatio} onChange={(e) => handleUnitChange(idx, "conversionRatio", Number(e.target.value))} className="w-full rounded border px-2 py-1 text-sm" />
                        </div>
                        {form.unitHierarchy.length > 1 && (
                          <button onClick={() => handleRemoveUnit(idx)} className="text-red-500 hover:text-red-700 p-2">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Stock Qty (Base Units)</label>
                    <input type="number" value={form.quantityInStock} onChange={e => setForm({...form, quantityInStock: Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Retail Price</label>
                    <input type="number" value={form.retailPrice} onChange={e => setForm({...form, retailPrice: Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <button 
                  onClick={() => setStep("optional_details")} 
                  className="w-full rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow hover:bg-teal-700 transition-colors"
                >
                  Continue to Optional Details
                </button>
              </div>
            </div>
          )}

          {step === "optional_details" && (
            <div className="animate-in fade-in slide-in-from-right-2 duration-300">
              <h3 className="text-xl font-bold text-zinc-900 mb-4">Optional Details</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Cost Price (Defaults to 0)</label>
                  <input type="number" value={form.costPrice} onChange={e => setForm({...form, costPrice: Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Wholesale Price</label>
                    <input type="number" value={form.wholesalePrice || ""} onChange={e => setForm({...form, wholesalePrice: Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Distributor Price</label>
                    <input type="number" value={form.distributorPrice || ""} onChange={e => setForm({...form, distributorPrice: Number(e.target.value)})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Expiry Date</label>
                    <input type="text" value={form.expiryDate || ""} onChange={e => setForm({...form, expiryDate: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Batch Number</label>
                    <input type="text" value={form.batchNumber || ""} onChange={e => setForm({...form, batchNumber: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Barcode</label>
                  <input type="text" value={form.barcode || ""} onChange={e => setForm({...form, barcode: e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>

              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  onClick={() => setStep("core_details")} 
                  className="rounded-xl border border-zinc-200 py-3 px-4 text-sm font-bold text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Back
                </button>
                <button 
                  onClick={() => setStep("review")} 
                  className="flex-1 rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow hover:bg-teal-700 transition-colors"
                >
                  Review & Save
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
