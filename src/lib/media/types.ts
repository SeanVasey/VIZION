export type MediaKind = "image" | "video" | "audio";

/** Attributes VIZ(IO)N "reads" from an attached reference (product-spec §4.2). */
export interface MediaAttributes {
  subject?: string;
  composition?: string;
  palette?: string[];
  lighting?: string;
  style?: string;
  mood?: string;
  // audio
  tempo?: string;
  timbre?: string;
  // metadata
  width?: number;
  height?: number;
  durationSec?: number;
  /** Where the attributes came from (the flagged extraction pipeline). */
  source: "proxy" | "ondevice";
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
