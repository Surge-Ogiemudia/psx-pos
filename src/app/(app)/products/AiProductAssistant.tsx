"use client";

import React, { useState, useRef, useEffect } from "react";

interface AiProductAssistantProps {
  onClose: () => void;
  onSave: (productForm: any) => Promise<void>;
}

type Step = "scan_front" | "scan_missing" | "hierarchy" | "quantity" | "price" | "review";

export default function AiProductAssistant({ onClose, onSave }: AiProductAssistantProps) {
  const [step, setStep] = useState<Step>("scan_front");
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");

  const [form, setForm] = useState<any>({
    itemName: "",
    brand: "",
    size: "",
    expiryDate: "",
    barcode: "",
    unitHierarchy: [],
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
        
        setStep("hierarchy");
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

        setStep("hierarchy");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process image.");
    } finally {
      stopProgress();
      setTimeout(() => setLoading(false), 300);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input.trim();
    setInput("");
    setLoading(true);
    setErrorMsg(null);
    startProgress();

    try {
      if (step === "hierarchy") {
        const res = await fetch("/api/products/ai-parse-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "hierarchy", text: userText })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        setForm((prev: any) => ({ ...prev, unitHierarchy: json.data }));
        setStep("quantity");
      } else if (step === "quantity") {
        const res = await fetch("/api/products/ai-parse-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "quantity", text: userText, context: { hierarchy: form.unitHierarchy } })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        setForm((prev: any) => ({ ...prev, quantityInStock: json.data.totalBaseUnits || 0 }));
        setStep("price");
      } else if (step === "price") {
        const res = await fetch("/api/products/ai-parse-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "price", text: userText })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        setForm((prev: any) => ({ 
          ...prev, 
          retailPrice: json.data.retailPrice || prev.retailPrice,
          wholesalePrice: json.data.wholesalePrice || prev.wholesalePrice,
          costPrice: json.data.costPrice || prev.costPrice,
          distributorPrice: json.data.distributorPrice || prev.distributorPrice,
        }));
        
        setStep("review");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse text.");
    } finally {
      stopProgress();
      setTimeout(() => setLoading(false), 300);
    }
  };

  if (step === "review") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row">
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
            <h2 className="text-xl font-bold text-zinc-900 mb-4">Review Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Item Name</label>
                <input type="text" value={form.itemName} onChange={e => setForm({...form, itemName: e.target.value})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Brand</label>
                <input type="text" value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Size</label>
                <input type="text" value={form.size} onChange={e => setForm({...form, size: e.target.value})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Barcode</label>
                <input type="text" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Retail Price</label>
                <input type="number" value={form.retailPrice} onChange={e => setForm({...form, retailPrice: Number(e.target.value)})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600">Stock (Base Units)</label>
                <input type="number" value={form.quantityInStock} onChange={e => setForm({...form, quantityInStock: Number(e.target.value)})} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
            </div>
            
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">Cancel</button>
              <button onClick={() => onSave(form)} className="rounded-lg bg-teal-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-teal-700">Save Product</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-zinc-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <h2 className="font-bold text-zinc-900">AI Setup Wizard</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 p-1">✕</button>
        </div>

        {/* Wizard Content */}
        <div className="p-6">
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
            </div>
          )}

          {step === "hierarchy" && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Packaging Hierarchy</h3>
              <p className="text-zinc-500 mb-6 text-sm">
                How is this product packaged for sale? For example: "10 rows in a pack" or "Just single pieces".
              </p>
              <form onSubmit={handleTextSubmit}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="e.g. 10 rows in a carton"
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-teal-500 focus:bg-white transition-colors mb-4"
                  autoFocus
                />
                <button 
                  type="submit" 
                  disabled={loading || !input.trim()}
                  className="relative w-full overflow-hidden rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow hover:bg-teal-700 disabled:opacity-90 transition-colors"
                >
                  {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                  <span className="relative z-10">
                    {loading ? `Processing... ${progress}%` : "Continue"}
                  </span>
                </button>
              </form>
            </div>
          )}

          {step === "quantity" && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Current Stock</h3>
              <p className="text-zinc-500 mb-6 text-sm">
                What is the current quantity you have in stock? For example: "5 cartons and 2 extra rows".
              </p>
              <form onSubmit={handleTextSubmit}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="e.g. 5 cartons and 3 extra pieces"
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-teal-500 focus:bg-white transition-colors mb-4"
                  autoFocus
                />
                <button 
                  type="submit" 
                  disabled={loading || !input.trim()}
                  className="relative w-full overflow-hidden rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow hover:bg-teal-700 disabled:opacity-90 transition-colors"
                >
                  {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                  <span className="relative z-10">
                    {loading ? `Processing... ${progress}%` : "Continue"}
                  </span>
                </button>
              </form>
            </div>
          )}

          {step === "price" && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Pricing</h3>
              <p className="text-zinc-500 mb-6 text-sm">
                What is the retail price? You can also mention cost or wholesale prices if you want.
              </p>
              <form onSubmit={handleTextSubmit}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="e.g. Retail is 500, cost is 400"
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-teal-500 focus:bg-white transition-colors mb-4"
                  autoFocus
                />
                <button 
                  type="submit" 
                  disabled={loading || !input.trim()}
                  className="relative w-full overflow-hidden rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow hover:bg-teal-700 disabled:opacity-90 transition-colors"
                >
                  {loading && <div className="absolute inset-y-0 left-0 bg-teal-800 transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />}
                  <span className="relative z-10">
                    {loading ? `Processing... ${progress}%` : "Continue"}
                  </span>
                </button>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
