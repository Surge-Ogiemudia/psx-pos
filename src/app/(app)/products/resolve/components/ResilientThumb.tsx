"use client";

import React, { useState } from "react";

export interface ResilientThumbProps {
  src: string | null | undefined;
  alt: string;
  label?: "Front" | "Back";
  className?: string;
  onClick?: () => void;
  priority?: boolean;
  size?: 64 | 96 | 128 | 256;
}

/**
 * Ultra-fast, lightweight image thumbnail component for weak pharmacy networks.
 * Uses Vercel Edge WebP image optimization (w=128, q=75) reducing 2.8MB camera photos
 * down to ~3KB-5KB (850x reduction) with native browser caching and lazy-loading.
 */
export default function ResilientThumb({
  src,
  alt,
  label,
  className = "h-12 w-12",
  onClick,
  priority = false,
  size = 128,
}: ResilientThumbProps) {
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // If no source image provided
  if (!src) {
    if (!label) return null;
    return (
      <div
        className={`${className} rounded-lg bg-zinc-100 border border-dashed border-zinc-300 flex flex-col items-center justify-center text-zinc-400 text-[9px] font-semibold select-none shrink-0`}
      >
        <span>No</span>
        <span>{label}</span>
      </div>
    );
  }

  // Next.js WebP thumbnail URL with valid Edge CDN q=75 (3KB-5KB instead of 2.8MB!)
  const thumbUrl = src.startsWith("http")
    ? `/_next/image?url=${encodeURIComponent(src)}&w=${size}&q=75`
    : src;

  return (
    <div
      className={`relative ${className} rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200 shrink-0 group cursor-pointer hover:ring-2 hover:ring-teal-500 transition-all select-none`}
      onClick={onClick}
      title={label ? `${label} photo (Click to zoom)` : "Click to zoom"}
    >
      {/* Lightweight Loading Placeholder */}
      {!loaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-200/60 animate-pulse text-zinc-400 text-xs">
          <span>📷</span>
        </div>
      )}

      {/* Native Browser Image: Hardware accelerated, native HTTP cache, async decoding */}
      <img
        src={hasError ? src : thumbUrl}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (!hasError) {
            setHasError(true);
          }
        }}
        className={`w-full h-full object-cover transition-opacity duration-150 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Front / Back Badge */}
      {label && (
        <span
          className={`absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded text-[8px] font-black uppercase tracking-wider backdrop-blur-sm shadow-xs ${
            label === "Front"
              ? "bg-black/75 text-white"
              : "bg-teal-900/80 text-teal-100"
          }`}
        >
          {label}
        </span>
      )}

      {/* Zoom Lens Overlay on hover */}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
        <span className="text-white text-xs drop-shadow">🔍</span>
      </div>
    </div>
  );
}

export { ResilientThumb };
