"use client";

import React, { useState, useEffect, useRef } from "react";

export interface ResilientThumbProps {
  src: string | null | undefined;
  alt: string;
  label?: "Front" | "Back";
  className?: string;
  onClick?: () => void;
  priority?: boolean;
}

const CACHE_NAME = "psx-thumbnails-v1";

// In-memory cache of object URLs for 0ms sync re-renders in the active session
const memoryCache = new Map<string, string>();
// In-flight fetch promises to prevent duplicate network requests across simultaneous components
const inFlightRequests = new Map<string, Promise<string>>();

/**
 * Fetch and persistently cache thumbnail in browser CacheStorage API.
 * Returns a local blob URL for instant 0ms/0-byte future rendering.
 */
async function getCachedThumbnailUrl(thumbUrl: string, originalSrc: string): Promise<string> {
  // 1. Check fast in-memory cache first
  if (memoryCache.has(thumbUrl)) {
    return memoryCache.get(thumbUrl)!;
  }

  // 2. Reuse in-flight request if another thumb is requesting the exact same URL
  if (inFlightRequests.has(thumbUrl)) {
    return inFlightRequests.get(thumbUrl)!;
  }

  const fetchPromise = (async () => {
    try {
      // 3. Check browser persistent CacheStorage
      if (typeof window !== "undefined" && "caches" in window) {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(thumbUrl);

        if (cachedResponse && cachedResponse.ok) {
          const blob = await cachedResponse.blob();
          const objectUrl = URL.createObjectURL(blob);
          memoryCache.set(thumbUrl, objectUrl);
          return objectUrl;
        }

        // 4. Not cached: fetch ultra-low bandwidth thumbnail from Next.js optimizer
        const response = await fetch(thumbUrl, { mode: "cors" });
        if (response.ok) {
          // Clone and silently persist into CacheStorage
          try {
            await cache.put(thumbUrl, response.clone());
          } catch {
            // Storage quota full or restricted; silently ignore
          }
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          memoryCache.set(thumbUrl, objectUrl);
          return objectUrl;
        }
      }
    } catch {
      // Fallback gracefully if CacheStorage or fetch is blocked
    }

    // Graceful fallback to thumbUrl or originalSrc
    return thumbUrl;
  })();

  inFlightRequests.set(thumbUrl, fetchPromise);
  try {
    const result = await fetchPromise;
    return result;
  } finally {
    inFlightRequests.delete(thumbUrl);
  }
}

export default function ResilientThumb({
  src,
  alt,
  label,
  className = "h-12 w-12",
  onClick,
  priority = false,
}: ResilientThumbProps) {
  const [inView, setInView] = useState(priority);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ultra-low bandwidth thumbnail: 96px width at q=45 (~2KB - 4KB each)
  const thumbUrl = src
    ? `/_next/image?url=${encodeURIComponent(src)}&w=96&q=45`
    : null;

  // Viewport IntersectionObserver: 150px rootMargin
  useEffect(() => {
    if (priority || inView || !containerRef.current) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" }
    );

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [priority, inView]);

  // Load image from persistent CacheStorage once in viewport
  useEffect(() => {
    if (!inView || !thumbUrl || !src) return;

    let isMounted = true;

    // Check synchronous memory cache
    if (memoryCache.has(thumbUrl)) {
      setResolvedSrc(memoryCache.get(thumbUrl)!);
      return;
    }

    getCachedThumbnailUrl(thumbUrl, src)
      .then((url) => {
        if (isMounted) {
          setResolvedSrc(url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setResolvedSrc(thumbUrl);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [inView, thumbUrl, src]);

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

  const uniqueId = React.useId();
  const shimmerId = `shimmer-${uniqueId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div
      ref={containerRef}
      className={`relative ${className} rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200 shrink-0 group cursor-pointer hover:ring-2 hover:ring-teal-500 transition-all select-none`}
      onClick={onClick}
      title={label ? `${label} photo (Click to zoom)` : "Click to zoom"}
    >
      {/* Micro SVG Camera Shimmer Placeholder (Zero layout shift) */}
      {(!loaded || !resolvedSrc) && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 overflow-hidden">
          <svg
            className="w-full h-full text-zinc-300"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="48" height="48" fill="#F4F4F5" />
            <path
              d="M18 16L19.5 14H28.5L30 16H34C35.1 16 36 16.9 36 18V30C36 31.1 35.1 32 34 32H14C12.9 32 12 31.1 12 30V18C12 16.9 12.9 16 14 16H18ZM24 29C26.76 29 29 26.76 29 24C29 21.24 26.76 19 24 19C21.24 19 19 21.24 19 24C19 26.76 21.24 29 24 29ZM24 27C22.34 27 21 25.66 21 24C21 22.34 22.34 21 24 21C25.66 21 27 22.34 27 24C27 25.66 25.66 27 24 27Z"
              fill="currentColor"
            />
            <defs>
              <linearGradient id={shimmerId} x1="-100%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="transparent" stopOpacity="0" />
                <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.4" />
                <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                <animate
                  attributeName="x1"
                  from="-100%"
                  to="100%"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="x2"
                  from="0%"
                  to="200%"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </linearGradient>
            </defs>
            <rect width="48" height="48" fill={`url(#${shimmerId})`} />
          </svg>
        </div>
      )}

      {/* Render Image (from CacheStorage blob or fallback) */}
      {resolvedSrc && (
        <img
          src={hasError ? src : resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (!hasError) {
              setHasError(true);
            }
          }}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

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

      {/* Zoom Lens Overlay */}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
        <span className="text-white text-xs drop-shadow">🔍</span>
      </div>
    </div>
  );
}

export { ResilientThumb };
