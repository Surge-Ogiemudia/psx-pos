"use client";

import { useEffect, useRef, useState } from "react";
import { loadFaceModels, captureFaceDescriptor } from "@/lib/faceApiClient";

interface FaceCaptureProps {
  onCapture: (descriptor: number[]) => void;
  captureLabel?: string;
  busy?: boolean;
}

export default function FaceCapture({ onCapture, captureLabel = "Scan face", busy = false }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadFaceModels();
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        if (!cancelled) setError("Couldn't access the camera. Check permissions and try again.");
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handleCapture() {
    if (!videoRef.current) return;
    setScanning(true);
    setError(null);
    try {
      const descriptor = await captureFaceDescriptor(videoRef.current);
      if (!descriptor) {
        setError("No face detected — center your face in frame and try again.");
        return;
      }
      onCapture(descriptor);
    } catch {
      setError("Face scan failed. Try again.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-xs overflow-hidden rounded-lg bg-zinc-900" style={{ aspectRatio: "4 / 3" }}>
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300">
            Starting camera…
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleCapture}
        disabled={!ready || scanning || busy}
        className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {scanning ? "Scanning…" : captureLabel}
      </button>
    </div>
  );
}
