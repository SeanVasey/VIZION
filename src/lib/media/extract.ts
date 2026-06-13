import type { MediaAttributes } from "@/lib/media/types";

export const MEDIA_EXTRACT_SYSTEM = [
  "You are VIZ(IO)N's media analyst. Read the attached reference and describe what it actually contains.",
  "Return ONLY a JSON object with these optional fields (omit any you can't determine):",
  '- "subject": the main subject (string)',
  '- "composition": framing / camera angle / layout (string)',
  '- "palette": dominant colors as an array of hex strings',
  '- "lighting": lighting character (string)',
  '- "style": visual or artistic style (string)',
  '- "mood": overall mood (string)',
  "Do not wrap the JSON in markdown. Do not add any other text.",
].join("\n");

/** Parse + sanitize a model's media-attribute JSON. Pure + unit-tested. */
export function parseMediaAttributes(raw: string): Partial<MediaAttributes> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null) return {};
  const d = data as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof d[k] === "string" && (d[k] as string).trim() !== ""
      ? (d[k] as string).trim()
      : undefined;
  const palette = Array.isArray(d.palette)
    ? d.palette.filter((x): x is string => typeof x === "string").slice(0, 8)
    : undefined;

  return {
    subject: str("subject"),
    composition: str("composition"),
    lighting: str("lighting"),
    style: str("style"),
    mood: str("mood"),
    tempo: str("tempo"),
    timbre: str("timbre"),
    palette: palette && palette.length ? palette : undefined,
  };
}

/** Strip a data URL into its media type + base64 payload. */
export function parseDataUrl(
  dataUrl: string,
): { mediaType: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m || !m[1] || !m[2]) return null;
  return { mediaType: m[1], base64: m[2] };
}
