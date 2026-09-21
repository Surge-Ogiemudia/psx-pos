// Phone cameras shoot 3000-4000px-wide, multi-megabyte photos — every one uploaded gets
// stored in Blob, then re-fetched repeatedly (AI extraction, thumbnails, re-triage), and
// each fetch is billed as data transfer. Shrinking at capture time cuts that cost at the
// source instead of just moving the same huge files somewhere else. 1600px/0.8 quality is
// comfortably above the 1080px the AI extraction pipeline already reads reliably from, so
// this doesn't touch extraction accuracy or legibility of small print (expiry dates, batch
// numbers) — it only trims resolution nothing actually needs.
export async function compressImage(file: File, maxWidth = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const targetWidth = Math.round(bitmap.width * scale);
    const targetHeight = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // never use a "compressed" result that's bigger

    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    // Any failure (unsupported format, decode error) just falls back to the original file
    // rather than blocking the upload — compression is an optimization, not a requirement.
    return file;
  }
}
