"use client";

import { useRef, useState, useCallback } from "react";
import { compressImage } from "@/lib/compressImage";

interface Props {
  branchId: string;
}

type FlashState = "idle" | "success" | "error";

export default function MonakSnapClient({ branchId }: Props) {
  const frontInputRef = useRef<HTMLInputElement>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);

  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [expiryFile, setExpiryFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [expiryPreview, setExpiryPreview] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<FlashState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const handleFrontChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setFrontFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setFrontPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFrontPreview(null);
    }
  }, []);

  const handleExpiryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setExpiryFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setExpiryPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setExpiryPreview(null);
    }
  }, []);

  async function uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/products/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error ?? "Upload failed");
    }
    const data = await res.json();
    return data.url as string;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    if (!frontFile) {
      setErrorMsg("Please take the front photo first.");
      return;
    }
    if (!expiryFile) {
      setErrorMsg("Please take the expiry photo first.");
      return;
    }
    if (quantity < 1) {
      setErrorMsg("Quantity must be at least 1.");
      return;
    }

    setLoading(true);
    try {
      const [compressedFront, compressedExpiry] = await Promise.all([
        compressImage(frontFile),
        compressImage(expiryFile),
      ]);
      const [frontImageUrl, expiryImageUrl] = await Promise.all([
        uploadImage(compressedFront),
        uploadImage(compressedExpiry),
      ]);

      const res = await fetch("/api/monak-snaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImageUrl, expiryImageUrl, quantity, branchId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to add snap" }));
        throw new Error(err.error ?? "Failed to add snap");
      }

      // Reset form
      setFrontFile(null);
      setExpiryFile(null);
      setFrontPreview(null);
      setExpiryPreview(null);
      setQuantity(1);
      if (frontInputRef.current) frontInputRef.current.value = "";
      if (expiryInputRef.current) expiryInputRef.current.value = "";

      setFlash("success");
      setTimeout(() => setFlash("idle"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(msg);
      setFlash("error");
      setTimeout(() => setFlash("idle"), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-start px-4 py-6">
      {/* Flash banner */}
      {flash === "success" && (
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center bg-green-600 py-4 text-white text-lg font-bold shadow-lg animate-pulse">
          ✅ Added! Ready for next item
        </div>
      )}
      {flash === "error" && errorMsg && (
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center bg-red-600 py-4 text-white text-sm font-semibold shadow-lg px-4 text-center">
          ⚠️ {errorMsg}
        </div>
      )}

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">Monak Stock Snap</h1>
          <p className="text-zinc-400 text-sm mt-1">Photograph each item then add it to the queue</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Front photo */}
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
            <p className="text-zinc-300 font-semibold mb-3 text-sm uppercase tracking-wide">
              Front of Product
            </p>
            <input
              ref={frontInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFrontChange}
              className="hidden"
              id="front-input"
            />
            <label
              htmlFor="front-input"
              className="flex items-center justify-center w-full py-4 rounded-xl bg-zinc-800 text-white font-semibold text-base cursor-pointer active:bg-zinc-700 border border-zinc-700 gap-2"
            >
              📷 Take Front Photo
            </label>
            {frontPreview && (
              <div className="mt-3 rounded-xl overflow-hidden border border-zinc-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frontPreview}
                  alt="Front preview"
                  className="w-full object-contain max-h-48"
                />
              </div>
            )}
          </div>

          {/* Expiry photo */}
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
            <p className="text-zinc-300 font-semibold mb-3 text-sm uppercase tracking-wide">
              Expiry Date Label
            </p>
            <input
              ref={expiryInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleExpiryChange}
              className="hidden"
              id="expiry-input"
            />
            <label
              htmlFor="expiry-input"
              className="flex items-center justify-center w-full py-4 rounded-xl bg-zinc-800 text-white font-semibold text-base cursor-pointer active:bg-zinc-700 border border-zinc-700 gap-2"
            >
              📅 Take Expiry Photo
            </label>
            {expiryPreview && (
              <div className="mt-3 rounded-xl overflow-hidden border border-zinc-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={expiryPreview}
                  alt="Expiry preview"
                  className="w-full object-contain max-h-32"
                />
              </div>
            )}
          </div>

          {/* Quantity */}
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
            <label className="text-zinc-300 font-semibold text-sm uppercase tracking-wide block mb-3">
              Quantity
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-zinc-800 border border-zinc-700 text-white text-3xl font-bold text-center rounded-xl py-4 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Error message (non-flash) */}
          {flash === "idle" && errorMsg && (
            <p className="text-red-400 text-sm text-center px-2">{errorMsg}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-5 rounded-2xl bg-green-600 text-white text-xl font-bold active:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {loading ? "Uploading…" : "✅ Add to Queue"}
          </button>
        </form>
      </div>
    </div>
  );
}
