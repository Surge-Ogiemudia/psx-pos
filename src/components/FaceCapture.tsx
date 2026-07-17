"use client";

import { useEffect, useRef, useState } from "react";
import { loadFaceModels, captureFaceDescriptor } from "@/lib/faceApiClient";

interface FaceCaptureProps {
  onCapture: (descriptor: number[]) => void;
  captureLabel?: string;
  busy?: boolean;
}

type CameraState = "idle" | "starting" | "ready" | "error";

export default function FaceCapture({ onCapture, captureLabel = "Scan face", busy = false }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // getUserMedia only shows the browser's permission prompt (or succeeds after an earlier grant)
  // when called from a direct user gesture — auto-starting it on mount means a denial or a
  // dismissed prompt leaves no way to retry. Kicking it off from a button tap fixes that.
  async function enableCamera() {
    setCameraState("starting");
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("ready");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Camera access was blocked. Allow camera access for this site in your browser settings, then try again.");
      } else if (name === "NotFoundError") {
        setError("No camera found on this device.");
      } else if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser doesn't support camera access here (needs HTTPS on most browsers).");
      } else {
        setError("Couldn't access the camera. Check permissions and try again.");
      }
      setCameraState("error");
    }
  }

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
        {cameraState !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-zinc-300">
            {cameraState === "starting" ? "Starting camera…" : "Camera is off"}
          </div>
        )}
      </div>

      {error && <p className="max-w-xs text-center text-sm text-red-600">{error}</p>}

      {cameraState === "ready" ? (
        <button
          onClick={handleCapture}
          disabled={scanning || busy}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : captureLabel}
        </button>
      ) : (
        <button
          onClick={enableCamera}
          disabled={cameraState === "starting"}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {cameraState === "starting" ? "Requesting access…" : cameraState === "error" ? "Try again" : "Enable camera"}
        </button>
      )}
    </div>
  );
}
