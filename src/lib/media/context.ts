import type { MediaAttributes } from "@/lib/media/types";
import type { MediaItem } from "@/lib/media/queue";

/**
 * Reference-role context (2026-07 UX audit): attachments whose role is
 * "reference" give the enhance model visual context for the TEXT task — they
 * never become a generation prompt. These pure builders produce the bounded
 * context blocks the composer sends alongside the enhance request.
 */

export const MAX_CONTEXT_ITEMS = 4;
const MAX_CONTEXT_CHARS = 1500;

/** Display-safe file name: control characters stripped, middle-ellipsized. */
export function sanitizeName(name: string, max = 40): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "untitled";
  if (clean.length <= max) return clean;
  const head = clean.slice(0, Math.ceil((max - 1) / 2));
  const tail = clean.slice(-Math.floor((max - 1) / 2));
  return `${head}…${tail}`;
}

/** Fallback summary when only on-device attributes exist (no model prose). */
function summarizeAttrs(attrs: MediaAttributes | undefined): string | null {
  if (!attrs) return null;
  const bits = [
    attrs.subject,
    attrs.style ? `${attrs.style} style` : undefined,
    attrs.mood ? `${attrs.mood} mood` : undefined,
    attrs.palette?.length ? `palette ${attrs.palette.slice(0, 4).join(" ")}` : undefined,
    attrs.width && attrs.height ? `${attrs.width}×${attrs.height}` : undefined,
    attrs.durationSec ? `~${Math.round(attrs.durationSec)}s` : undefined,
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : null;
}

/**
 * Context blocks for the enhance request: one line per READY reference-role
 * attachment that has something to say, capped at MAX_CONTEXT_ITEMS items of
 * MAX_CONTEXT_CHARS each.
 */
export function buildMediaContext(
  items: readonly Pick<
    MediaItem,
    "role" | "status" | "name" | "description" | "attrs"
  >[],
): string[] {
  const blocks: string[] = [];
  for (const item of items) {
    if (item.role !== "reference" || item.status !== "ready") continue;
    const body = item.description?.trim() || summarizeAttrs(item.attrs);
    if (!body) continue;
    blocks.push(
      `Visual reference (${sanitizeName(item.name, 60)}): ${body}`.slice(
        0,
        MAX_CONTEXT_CHARS,
      ),
    );
    if (blocks.length >= MAX_CONTEXT_ITEMS) break;
  }
  return blocks;
}

/** One-line style snippet (the "Style reference" role's insert action). */
export function buildStyleSnippet(attrs: MediaAttributes): string {
  const bits = [
    attrs.style ? `${attrs.style}` : undefined,
    attrs.lighting ? `${attrs.lighting} lighting` : undefined,
    attrs.mood ? `${attrs.mood} mood` : undefined,
    attrs.palette?.length ? `palette ${attrs.palette.slice(0, 6).join(" ")}` : undefined,
  ].filter(Boolean);
  const body = bits.length ? bits.join("; ") : attrs.description?.trim() ?? "";
  return body ? `Style reference: ${body}` : "";
}
