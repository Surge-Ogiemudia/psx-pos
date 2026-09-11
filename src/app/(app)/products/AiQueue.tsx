"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

interface AiQueueProps {
  branchId: string | null;
}

export default function AiQueue({ branchId }: AiQueueProps) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchDrafts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/products/ai-drafts${branchId ? `?branchId=${branchId}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDrafts(json.drafts);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
    // Auto-refresh every 10 seconds to see new items from mobile
    const interval = setInterval(fetchDrafts, 10000);
    return () => clearInterval(interval);
  }, [branchId]);

  const handleProcessAll = async () => {
    const pending = drafts.filter(d => d.status === "pending" || d.status === "error");
    if (pending.length === 0) return;

    setProcessing(true);
    setProgress(0);
    setErrorMsg(null);

    let processedCount = 0;

    for (const draft of pending) {
      try {
        // Optimistically mark as processing in UI
        setDrafts(prev => prev.map(d => d._id === draft._id ? { ...d, status: "processing" } : d));
        
        const res = await fetch(`/api/products/ai-drafts/${draft._id}/process`, {
          method: "POST"
        });
        
        const json = await res.json();
        
        if (res.ok) {
          setDrafts(prev => prev.map(d => d._id === draft._id ? { ...d, status: "completed", productId: json.product._id } : d));
        } else {
          setDrafts(prev => prev.map(d => d._id === draft._id ? { ...d, status: "error", errorMsg: json.error } : d));
        }
      } catch (err: any) {
        setDrafts(prev => prev.map(d => d._id === draft._id ? { ...d, status: "error", errorMsg: err.message } : d));
      }
      
      processedCount++;
      setProgress(Math.round((processedCount / pending.length) * 100));
      
      // Small delay between requests to not overwhelm Gemini API limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    setProcessing(false);
  };

  const pendingCount = drafts.filter(d => d.status === "pending" || d.status === "error").length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">AI Processing Queue</h1>
          <p className="text-zinc-500 mt-1">
            Leave this page open on a computer to automatically process items snapped from mobile devices.
          </p>
        </div>
        
        <button
          onClick={handleProcessAll}
          disabled={processing || pendingCount === 0}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {processing ? (
            <>
              <svg className="h-4 w-4 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Processing {progress}%
            </>
          ) : (
            <>
              <span className="text-lg">🤖</span>
              Process {pendingCount} Pending Items
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-red-600 border border-red-100">
          {errorMsg}
        </div>
      )}

      {loading && drafts.length === 0 ? (
        <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full"></div></div>
      ) : drafts.length === 0 ? (
        <div className="text-center p-12 bg-zinc-50 rounded-2xl border border-zinc-200">
          <span className="text-4xl">📸</span>
          <h3 className="mt-4 font-bold text-zinc-900 text-lg">Queue is empty</h3>
          <p className="text-zinc-500 mt-1">Use the mobile app to snap products and they will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drafts.map((draft) => (
            <div key={draft._id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm flex gap-4">
              <div className="relative h-24 w-24 rounded-lg overflow-hidden bg-zinc-100 shrink-0">
                <img src={draft.frontImageUrl} alt="Product" className="object-cover w-full h-full" />
                {draft.status === "completed" && (
                  <div className="absolute inset-0 bg-teal-500/20 flex items-center justify-center backdrop-blur-[1px]">
                    <div className="bg-white rounded-full p-1 shadow">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider
                    ${draft.status === "pending" ? "bg-amber-100 text-amber-700" : 
                      draft.status === "processing" ? "bg-blue-100 text-blue-700 animate-pulse" :
                      draft.status === "error" ? "bg-red-100 text-red-700" :
                      "bg-teal-100 text-teal-700"}`}
                  >
                    {draft.status}
                  </span>
                </div>
                <div className="text-sm font-semibold text-zinc-900">Qty: {draft.quantityInStock}</div>
                {draft.retailPrice && <div className="text-sm text-zinc-500">Price: ₦{draft.retailPrice}</div>}
                
                {draft.errorMsg && (
                  <div className="mt-2 text-xs text-red-600 line-clamp-2">
                    {draft.errorMsg}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
