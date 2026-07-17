"use client";

// Loaded lazily and cached at module scope so navigating between the kiosk and the staff
// directory's enrollment UI doesn't re-fetch the ~6.5MB of model weights each time.
let loadPromise: Promise<void> | null = null;

export async function loadFaceModels(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
    })();
  }
  return loadPromise;
}

/** Returns a 128-length descriptor for the clearest single face in the current video frame, or null if none found. */
export async function captureFaceDescriptor(video: HTMLVideoElement): Promise<number[] | null> {
  const faceapi = await import("@vladmandic/face-api");
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return Array.from(result.descriptor);
}
