"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "@/lib/compressImage";

// The "Product Image (optional)" picker for the POS add/edit item form. Same flow as the
// Catalog page: shrink the photo on the device, upload it to /api/products/upload, keep the
// returned URL on the form; the URL is saved with the item when the form is saved.
export default function ItemImageField({
  imageUrl,
  onChange,
  onBusyChange,
  onError,
  isOnline,
}: {
  imageUrl: string;
  onChange: (url: string) => void;
  onBusyChange?: (busy: boolean) => void; // lets the form hold its Save button while a photo is uploading
  onError: (message: string) => void;
  isOnline: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The form can be closed while a photo is still uploading. A late result must not land on
  // whatever item the form is reopened for next, so results are dropped once this unmounts.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same photo again still fires
    if (!file) return;
    if (!isOnline) {
      onError("You are offline — adding a photo needs a connection.");
      return;
    }
    setUploading(true);
    onBusyChange?.(true);
    onError("");
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const res = await fetch("/api/products/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Photo upload failed");
      if (aliveRef.current) onChange(data.url);
    } catch (err) {
      if (aliveRef.current) onError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      if (aliveRef.current) setUploading(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Photo (optional)</span>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50 text-xl text-zinc-300">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Item photo" className="h-full w-full object-cover" />
          ) : (
            "📷"
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : imageUrl ? "Change photo" : "Take / choose photo"}
          </button>
          {imageUrl && !uploading && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-xs font-medium text-red-500 hover:underline"
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
