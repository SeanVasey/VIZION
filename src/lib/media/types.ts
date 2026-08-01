export type MediaKind = "image" | "video" | "audio";

/**
 * Exactly the `media` bucket's `allowed_mime_types` (MED-003) — the client
 * admits what the server will store, so nothing reserves quota and then dies
 * at the bucket with a raw storage error. Listing explicit types in the
 * file-input `accept` also makes iOS transcode HEIC to JPEG at the picker.
 * Change this list and the bucket migration together (pinned by a unit test).
 */
export const MEDIA_ALLOWED_MIME: Record<MediaKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"],
};

/** Flat accept-attribute value for the file input. */
export const MEDIA_ACCEPT = Object.values(MEDIA_ALLOWED_MIME).flat().join(",");

/** Attributes VIZ(IO)N "reads" from an attached reference (product-spec §4.2).
 *  Audio never reaches a model (only file metadata is read), so there are no
 *  semantic audio fields — the old `tempo`/`timbre` were dead schema nothing
 *  could ever populate (2026-07 UX audit, honest-capability fix). */
export interface MediaAttributes {
  subject?: string;
  composition?: string;
  palette?: string[];
  lighting?: string;
  style?: string;
  mood?: string;
  /** Prose visual description (2–4 sentences), paste-ready for a prompt. */
  description?: string;
  // metadata
  width?: number;
  height?: number;
  durationSec?: number;
  /** Where the attributes came from (the flagged extraction pipeline). */
  source: "proxy" | "ondevice";
}

/**
 * Attachment roles (2026-07 UX audit): every attachment declares WHY it's
 * attached. `reference` is the default — a screenshot attached as evidence
 * must never be inferred into a generation prompt; "generate" is an explicit
 * choice with an explicit engine picker.
 */
export type AttachmentRole = "reference" | "extract" | "describe" | "style" | "generate";

export const ROLE_META: Record<
  AttachmentRole,
  { label: string; blurb: string; kinds: readonly MediaKind[] }
> = {
  reference: {
    label: "Reference",
    blurb: "Gives the model visual context for your text prompt.",
    kinds: ["image", "video", "audio"],
  },
  extract: {
    label: "Extract text",
    blurb: "Transcribes legible text so you can insert it.",
    kinds: ["image", "video"],
  },
  describe: {
    label: "Describe",
    blurb: "Writes an editable description you can insert.",
    kinds: ["image", "video"],
  },
  style: {
    label: "Style reference",
    blurb: "Captures palette, lighting, and mood — not the subject.",
    kinds: ["image", "video"],
  },
  generate: {
    label: "Generate similar",
    blurb: "Builds a generation prompt for an engine you pick.",
    kinds: ["image", "video", "audio"],
  },
};

export const DEFAULT_ROLE: AttachmentRole = "reference";

/** Roles an attachment of this kind can take (audio never reaches a model —
 *  only reference/generate make sense there). */
export function rolesForKind(kind: MediaKind): AttachmentRole[] {
  return (Object.keys(ROLE_META) as AttachmentRole[]).filter((r) =>
    ROLE_META[r].kinds.includes(kind),
  );
}

/** Generation engines we can format for (product-spec §4.2). */
export const GEN_TARGETS = [
  { id: "midjourney", label: "Midjourney", kind: "image" },
  { id: "runway", label: "Runway", kind: "video" },
  { id: "sora", label: "Sora", kind: "video" },
  { id: "kling", label: "Kling", kind: "video" },
  { id: "audio", label: "Audio spec", kind: "audio" },
] as const;

export type GenTargetId = (typeof GEN_TARGETS)[number]["id"];

/** Default generation target for a given media kind. */
export const DEFAULT_GEN_TARGET: Record<MediaKind, GenTargetId> = {
  image: "midjourney",
  video: "runway",
  audio: "audio",
};
