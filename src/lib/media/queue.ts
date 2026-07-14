import type { MediaAttributes, MediaKind } from "@/lib/media/types";
import type { TargetModelId } from "@/lib/constants";

/**
 * Pure state helpers for the multi-photo queue (unit-tested; the component
 * keeps only thin async glue). Files process sequentially — kinder to the
 * burst limiter, the daily cost cap, and a mobile radio than a parallel fan-out.
 */

export type MediaItemStatus = "queued" | "uploading" | "analyzing" | "ready" | "error";

export interface AnalysisUsage {
  tokenIn: number;
  tokenOut: number;
  costUsd: number;
  target: TargetModelId;
}

export interface MediaItem {
  /** Client-side id (the storage path is separate). */
  id: string;
  name: string;
  kind: MediaKind;
  sizeBytes: number;
  /** Object URL for the thumbnail (revoked by the component on unmount). */
  thumbUrl?: string;
  status: MediaItemStatus;
  error?: string;
  attrs?: MediaAttributes;
  description?: string;
  usage?: AnalysisUsage;
  /** The description has been inserted into the prompt draft. */
  inserted?: boolean;
}

/** Immutable single-item patch. */
export function patchItem(
  items: MediaItem[],
  id: string,
  patch: Partial<MediaItem>,
): MediaItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

export interface AdmittedFile<F> {
  file: F;
  kind: MediaKind;
}

/**
 * Decide which of the picked files may enter the queue: unsupported types are
 * rejected with a reason, and files that would push storage past the quota are
 * refused (accumulating size across THIS selection, on top of what's used).
 */
export function admitFiles<F extends { name: string; type: string; size: number }>(
  files: F[],
  kindForMime: (mime: string) => MediaKind | null,
  usedBytes: number,
  quotaBytes: number,
): { admitted: AdmittedFile<F>[]; rejected: { file: F; reason: string }[] } {
  const admitted: AdmittedFile<F>[] = [];
  const rejected: { file: F; reason: string }[] = [];
  let projected = usedBytes;

  for (const file of files) {
    const kind = kindForMime(file.type);
    if (!kind) {
      rejected.push({ file, reason: "Unsupported file type." });
      continue;
    }
    if (projected + file.size > quotaBytes) {
      rejected.push({ file, reason: "Storage full — remove media to continue." });
      continue;
    }
    projected += file.size;
    admitted.push({ file, kind });
  }
  return { admitted, rejected };
}

/** Step label for the per-item progress bar. */
export function itemStepLabel(item: MediaItem, modelLabel: string): string {
  switch (item.status) {
    case "queued":
      return "Waiting…";
    case "uploading":
      return "Uploading…";
    case "analyzing":
      return `Analyzing with ${modelLabel}…`;
    case "ready":
      return "Ready";
    case "error":
      return item.error ?? "Failed";
  }
}
