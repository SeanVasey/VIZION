import type { MediaAttributes, MediaKind } from "@/lib/media/types";

/**
 * On-device extraction (the "fast, private, limited" fallback per the locked
 * open question). The palette quantizer is pure + unit-tested; the canvas/Audio
 * reads are browser-only and SSR-guarded.
 */

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * Quantize RGBA pixel data to the most common colors. Channels are bucketed to
 * the nearest 32 to group near-identical shades. Fully transparent pixels are
 * skipped. Pure — operates on a flat RGBA array.
 */
export function quantizePalette(data: Uint8ClampedArray, maxColors = 5): string[] {
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 16) continue; // skip near-transparent
    const r = Math.round(data[i]! / 32) * 32;
    const g = Math.round(data[i + 1]! / 32) * 32;
    const b = Math.round(data[i + 2]! / 32) * 32;
    const key = `#${toHex(Math.min(255, r))}${toHex(Math.min(255, g))}${toHex(Math.min(255, b))}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
}

/** Map a MIME type to our media kind. */
export function kindForMime(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Best-effort client-side extraction. Images/video → palette + dimensions from a
 * downscaled canvas; audio → duration. Browser-only.
 */
export async function extractOnDevice(
  file: File,
  kind: MediaKind,
): Promise<MediaAttributes> {
  if (typeof document === "undefined") {
    return { source: "ondevice" };
  }
  if (kind === "audio") {
    const durationSec = await audioDuration(file).catch(() => undefined);
    return { source: "ondevice", durationSec };
  }

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const { width, height, data } = await rasterize(file, bitmapUrl, kind);
    return {
      source: "ondevice",
      width,
      height,
      palette: data ? quantizePalette(data) : undefined,
    };
  } catch {
    return { source: "ondevice" };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

async function rasterize(
  _file: File,
  url: string,
  kind: MediaKind,
): Promise<{ width: number; height: number; data: Uint8ClampedArray | null }> {
  const SAMPLE = 64;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (kind === "video") {
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!ctx) return { width, height, data: null };
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    ctx.drawImage(video, 0, 0, SAMPLE, SAMPLE);
    return { width, height, data: ctx.getImageData(0, 0, SAMPLE, SAMPLE).data };
  }

  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
  });
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!ctx) return { width, height, data: null };
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  return { width, height, data: ctx.getImageData(0, 0, SAMPLE, SAMPLE).data };
}

/**
 * Capture a downscaled JPEG data URL from an image or the first video frame —
 * the payload sent to the proxy extractor. Browser-only; returns null on failure
 * or for audio.
 */
export async function captureFrameDataUrl(
  file: File,
  kind: MediaKind,
  max = 1024,
): Promise<string | null> {
  if (typeof document === "undefined" || kind === "audio") return null;
  const url = URL.createObjectURL(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    let sw: number;
    let sh: number;
    let source: CanvasImageSource;
    if (kind === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("video load failed"));
      });
      sw = video.videoWidth;
      sh = video.videoHeight;
      source = video;
    } else {
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
      });
      sw = img.naturalWidth;
      sh = img.naturalHeight;
      source = img;
    }

    const scale = Math.min(1, max / Math.max(sw || max, sh || max));
    canvas.width = Math.max(1, Math.round((sw || max) * scale));
    canvas.height = Math.max(1, Math.round((sh || max) * scale));
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error("audio load failed"));
    audio.src = URL.createObjectURL(file);
  });
}
