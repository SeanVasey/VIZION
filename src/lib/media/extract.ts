import type { MediaAttributes } from "@/lib/media/types";

export const MEDIA_EXTRACT_SYSTEM = [
  "You are VIZ(IO)N's media analyst. Read the attached reference and describe what it actually contains.",
  "Return ONLY a JSON object with these fields:",
  '- "description" (required): a 2-4 sentence prose visual description of the image, written so it can be pasted straight into a generation prompt — concrete nouns, spatial layout, notable detail; no preamble like "This image shows".',
  "And these optional fields (omit any you can't determine):",
  '- "subject": the main subject (string)',
  '- "composition": framing / camera angle / layout (string)',
  '- "palette": dominant colors as an array of hex strings',
  '- "lighting": lighting character (string)',
  '- "style": visual or artistic style (string)',
  '- "mood": overall mood (string)',
  "Do not wrap the JSON in markdown. Do not add any other text.",
].join("\n");

/** Style-only analysis (the "Style reference" attachment role): capture how
 *  the reference looks, never what it depicts. */
export const MEDIA_STYLE_SYSTEM = [
  "You are VIZ(IO)N's media analyst. Read the attached reference and describe its visual STYLE only — never its subject matter.",
  "Return ONLY a JSON object with these fields (omit any you can't determine):",
  '- "description" (required): 1-3 sentences capturing the style — medium, rendering technique, era or movement, finish — written to steer a generation prompt; no subject nouns.',
  '- "palette": dominant colors as an array of hex strings',
  '- "lighting": lighting character (string)',
  '- "style": the style/medium in a few words (string)',
  '- "mood": overall mood (string)',
  "Do not describe what is depicted. Do not wrap the JSON in markdown. Do not add any other text.",
].join("\n");

/** Faithful transcription (the "Extract text" attachment role). */
export const MEDIA_OCR_SYSTEM = [
  "You are VIZ(IO)N's text extractor. Transcribe ALL legible text in the attached image faithfully.",
  'Return ONLY a JSON object: {"text": string} — the full transcription, preserving line breaks and reading order. Correct nothing; transcribe exactly what is written.',
  'If no text is legible, return {"text": ""}.',
  "Do not describe the image. Do not wrap the JSON in markdown. Do not add any other text.",
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
    description: str("description"),
    palette: palette && palette.length ? palette : undefined,
  };
}

/** Parse a transcription response (`{"text": string}`). Tolerant: anything
 *  that isn't that exact shape reads as "no legible text". */
export function parseMediaText(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "";
  }
  if (typeof data !== "object" || data === null) return "";
  const text = (data as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

/** Strip a data URL into its media type + base64 payload. */
export function parseDataUrl(
  dataUrl: string,
): { mediaType: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m || !m[1] || !m[2]) return null;
  return { mediaType: m[1], base64: m[2] };
}
