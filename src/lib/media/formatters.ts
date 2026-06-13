import type { GenTargetId, MediaAttributes } from "@/lib/media/types";

/**
 * Generation-syntax formatters (product-spec §4.2). Pure + deterministic: given
 * a base prompt + extracted attributes + a generation target, fold the reference
 * into a generation-ready prompt in the target engine's idiom. Unit-tested.
 */
export function buildGenerationPrompt(
  base: string,
  attrs: MediaAttributes,
  target: GenTargetId,
): string {
  switch (target) {
    case "midjourney":
      return midjourney(base, attrs);
    case "audio":
      return audioSpec(base, attrs);
    case "runway":
    case "sora":
    case "kling":
      return motion(base, attrs, target);
  }
}

/** Midjourney prompt syntax: `<desc> --ar … --v …`. */
function midjourney(base: string, a: MediaAttributes): string {
  const parts = [
    base.trim(),
    a.subject,
    a.composition,
    a.lighting ? `${a.lighting} lighting` : undefined,
    a.style ? `${a.style} style` : undefined,
    a.mood ? `${a.mood} mood` : undefined,
    a.palette?.length ? `palette ${a.palette.join(" ")}` : undefined,
  ].filter((p): p is string => Boolean(p && p.trim()));

  const prompt = parts.join(", ");
  const params = ["--ar 16:9", "--v 6"];
  return `${prompt} ${params.join(" ")}`.trim();
}

/** Motion phrasing for Runway / Sora / Kling. */
function motion(base: string, a: MediaAttributes, engine: string): string {
  const lines = [
    base.trim(),
    a.subject ? `Subject: ${a.subject}.` : undefined,
    a.composition ? `Camera & motion: ${a.composition}.` : undefined,
    a.lighting ? `Lighting: ${a.lighting}.` : undefined,
    a.style ? `Style: ${a.style}.` : undefined,
    a.mood ? `Mood: ${a.mood}.` : undefined,
    a.palette?.length ? `Palette: ${a.palette.join(", ")}.` : undefined,
  ].filter((l): l is string => Boolean(l && l.trim()));
  return `[${engine}] ${lines.join(" ")}`.trim();
}

/** Structured audio-generation spec. */
function audioSpec(base: string, a: MediaAttributes): string {
  const lines = [
    base.trim(),
    a.tempo ? `Tempo: ${a.tempo}.` : undefined,
    a.timbre ? `Timbre: ${a.timbre}.` : undefined,
    a.mood ? `Mood: ${a.mood}.` : undefined,
    a.durationSec ? `Duration: ~${Math.round(a.durationSec)}s.` : undefined,
  ].filter((l): l is string => Boolean(l && l.trim()));
  return lines.join(" ");
}

// --- Storage budget (Amber warning near quota) -------------------------------

/** Per-user local media budget; Amber warning fires at 80%. */
export const MEDIA_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB

export interface BudgetStatus {
  usedBytes: number;
  quotaBytes: number;
  pct: number;
  warn: boolean; // ≥ 80%
  over: boolean; // ≥ 100%
}

export function budgetStatus(
  usedBytes: number,
  quotaBytes: number = MEDIA_QUOTA_BYTES,
): BudgetStatus {
  const pct = quotaBytes > 0 ? usedBytes / quotaBytes : 1;
  return {
    usedBytes,
    quotaBytes,
    pct,
    warn: pct >= 0.8,
    over: pct >= 1,
  };
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
