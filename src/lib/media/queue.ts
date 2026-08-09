import type {
  AttachmentRole,
  GenTargetId,
  MediaAttributes,
  MediaKind,
} from "@/lib/media/types";
import type { TargetModelId } from "@/lib/constants";

/**
 * Pure state helpers for the attachment tray's queue (unit-tested; the
 * component keeps only thin async glue). Files process sequentially — kinder
 * to the burst limiter, the daily cost cap, and a mobile radio than a
 * parallel fan-out.
 */

type MediaItemStatus =
  | "queued"
  | "reserving"
  | "uploading"
  | "analyzing"
  | "ready"
  | "error";

interface AnalysisUsage {
  tokenIn: number;
  tokenOut: number;
  costUsd: number;
  target: TargetModelId;
  /** Counts/cost are a provider-omitted-usage default, not a measurement. */
  estimated?: boolean;
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
  /** Why this attachment exists — never inferred to "generate". */
  role: AttachmentRole;
  /** True = analyze without keeping: no upload, no DB row, session-only. */
  ephemeral: boolean;
  /** The stored media_assets row (absent for ephemeral attachments). */
  assetId?: string;
  storagePath?: string;
  attrs?: MediaAttributes;
  description?: string;
  /** Faithful transcription (the extract role). */
  extractedText?: string;
  usage?: AnalysisUsage;
  /** The description/text has been inserted into the prompt draft. */
  inserted?: boolean;
  /** Target captured when the file was picked — the analysis request uses
   *  this, so progress labels must too (the live selection can change
   *  mid-queue). */
  analysisTarget?: TargetModelId;
  /** Which analysis intent produced the current attrs/text (role changes
   *  between intent families re-analyze). */
  analyzedIntent?: "reference" | "style" | "extract_text";
  /** Engine choice for the generate role (explicit, per attachment). */
  genTarget?: GenTargetId;
}

/** Immutable single-item patch. */
export function patchItem(
  items: MediaItem[],
  id: string,
  patch: Partial<MediaItem>,
): MediaItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

interface AdmittedFile<F> {
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
    case "reserving":
      return "Reserving storage…";
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
