import type { DiffSegment } from "@/lib/enhance/diff";
import type { TargetModelId } from "@/lib/constants";

/**
 * The SSE wire contract between /api/enhance and the streaming client.
 * Shared by the route (encode) and the hook (parse) so the two can't drift.
 *
 * Transport note: events ride the fetch POST response body framed as
 * `data: {json}\n\n` — never EventSource (GET-only). Pre-stream failures
 * (401/400/413/429) stay plain JSON with real HTTP statuses; only failures
 * after headers are sent become an `error` event.
 */

/** Coarse processing ladder, emitted for every provider. */
export const STREAM_STEPS = {
  queued: "Queued",
  connecting: "Reaching the model…",
  generating: "Generating…",
  parsing: "Checking the result…",
  diffing: "Building the diff…",
} as const;
export type StreamStep = keyof typeof STREAM_STEPS;

/** The final enhance result (same shape the buffered route returned). The
 *  optional fields ride the same envelope additively — absent from older
 *  responses, tolerated by older clients. */
export interface EnhanceResult {
  output: string;
  rationale: string;
  diff: DiffSegment[];
  tokenIn: number;
  tokenOut: number;
  modelUsed: string;
  costUsd: number;
  usage: { todayCost: number; capUsd: number };
  /** Assumptions the model made to fill gaps in the request. */
  assumptions?: string[];
  /** One sentence on changes made specifically for the target engine. */
  targetNotes?: string;
  /** Short semantic name for the prompt — seeds the library title. */
  title?: string;
  /** The output was recovered from a malformed envelope tail — complete,
   *  but the model's explanation was lost (rationale is empty). */
  salvaged?: boolean;
  /** Which model Auto picked. Present ONLY on an auto-routed run, so its
   *  presence is itself the signal — the client never has to compare the
   *  result against what it asked for to know routing happened. */
  resolvedTarget?: TargetModelId;
}

export type EnhanceStreamEvent =
  | { type: "status"; step: StreamStep; label: string }
  /** Provider-surfaced thinking/progress text; overrides the step label. */
  | { type: "thinking"; text: string }
  /** Decoded characters of the output field, in order. */
  | { type: "delta"; text: string }
  /** Cumulative token counts + running cost (authoritative when emitted). */
  | { type: "usage"; tokenIn: number; tokenOut: number; costUsd: number }
  | { type: "done"; result: EnhanceResult }
  | {
      type: "error";
      status: number;
      error: string;
      notConfigured?: boolean;
      capReached?: boolean;
    };

/** One SSE frame for an event. */
export function encodeSseEvent(event: EnhanceStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an SSE-framed body into events. Handles frames split across network
 * chunks and multiple frames per chunk. Unknown/garbled frames are skipped
 * (the `done`/`error` contract is what callers act on).
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EnhanceStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            yield JSON.parse(line.slice(5).trim()) as EnhanceStreamEvent;
          } catch {
            /* skip a garbled frame */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
