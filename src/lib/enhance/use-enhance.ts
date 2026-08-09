"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  AutoPreference,
  ModeId,
  TargetModelId,
  ThinkingLevel,
} from "@/lib/constants";
import type { EnhanceRefine } from "@/lib/providers/formatters";
import type { FormatId } from "@/lib/enhance/formats";
import type { LengthId } from "@/lib/enhance/lengths";
import { parseSseStream, type EnhanceResult } from "@/lib/enhance/stream-events";

/** The final result shape (unchanged from the buffered route). */
export type EnhanceResponse = EnhanceResult;

export interface EnhanceRequest {
  input: string;
  mode: ModeId;
  /** Always a real roster id. Under Auto this is the FALLBACK — the server
   *  resolves the actual target and reports it back as `resolvedTarget`. */
  target: TargetModelId;
  /** Let the server pick the model. Never a target id in its own right:
   *  `model_target` is a Postgres enum, so "auto" has nowhere to be stored. */
  auto?: true;
  /** How Auto should weigh strength against price. Meaningful only beside
   *  `auto: true` — sent without it the server treats it as inert, the same
   *  legality-only stance as `format`/`length`. Absent under auto = balanced. */
  autoPreference?: AutoPreference;
  /** Reformat's explicit output shape. Inert in any other mode — the system
   *  prompt builder gates it, so the route validates legality only. */
  format?: FormatId;
  /** Condense/Expand depth. Same gating story as `format`. */
  length?: LengthId;
  /** Reasoning depth for targets that take one; omitted = provider default. */
  thinkingLevel?: ThinkingLevel;
  /** Refinement pass over an already-enhanced prompt (input = prior output). */
  refine?: EnhanceRefine;
  /** Reference-attachment context blocks (visual context for the text task). */
  mediaContext?: string[];
}

/** The one user-facing copy for a provider whose key isn't deployed. Both
 *  run surfaces (composer, library re-enhance) render it; hoisted after the
 *  two had drifted apart (audit VAR-17). */
export const NOT_CONFIGURED_MESSAGE =
  "This model isn't configured yet — add its API key on the server to enable it.";

class EnhanceError extends Error {
  constructor(
    message: string,
    public status: number,
    public notConfigured = false,
    public capReached = false,
  ) {
    super(message);
  }
}

/** Live progress of an in-flight enhance stream (transient per-run state —
 *  deliberately NOT in the persisted UI store). */
export interface EnhanceStreamState {
  active: boolean;
  /** Current processing step / thinking label. */
  step: string;
  /** Output text decoded so far. */
  partialOutput: string;
  /** Live counters, monotonic by construction: every writer takes the MAX of
   *  what it knows and what is already here, so a provider's early low-ball
   *  snapshot cannot pin the ticker and a late frame cannot walk it backwards. */
  tokenIn: number;
  tokenOut: number;
  costUsd: number;
  /** True once a usage frame arrived that was NOT a pre-generation snapshot —
   *  i.e. a real cumulative measurement. The char estimator stands down at
   *  that point, because chars-per-token varies with content and raising a
   *  measurement with a heuristic overstates the spend just as surely as the
   *  old freeze understated it.
   *
   *  The predecessor flag latched on ANY usage frame, including Anthropic's
   *  `message_start` placeholder (output_tokens: 1) — which is precisely what
   *  pinned the readout at "1213→1 tok" for whole runs. The fix was never to
   *  delete the gate; it was to stop a placeholder satisfying it. */
  usageMeasured: boolean;
}

const IDLE: EnhanceStreamState = {
  active: false,
  step: "",
  partialOutput: "",
  tokenIn: 0,
  tokenOut: 0,
  costUsd: 0,
  usageMeasured: false,
};

/**
 * Mutation for the enhance flow (server state lives here, FINAL_PLAN D3),
 * now consuming the /api/enhance SSE stream: `stream` exposes the live step,
 * partial output, and usage while the run is in flight; the mutation resolves
 * with the final EnhanceResponse from the `done` event. Pre-stream failures
 * (401/400/413/429) arrive as plain JSON with real HTTP statuses and become
 * EnhanceError exactly as before.
 */
export function useEnhance() {
  const [stream, setStream] = useState<EnhanceStreamState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  // Deltas are batched through a rAF flush so mobile doesn't re-render per token.
  const pendingText = useRef("");
  const flushHandle = useRef<number | null>(null);

  const flushDeltas = useCallback(() => {
    flushHandle.current = null;
    const text = pendingText.current;
    if (!text) return;
    pendingText.current = "";
    setStream((s) => {
      const partialOutput = s.partialOutput + text;
      return {
        ...s,
        partialOutput,
        // Stands down once a real measurement lands: chars-per-token varies
        // with content, so raising a measured count with this heuristic would
        // overstate the spend. Until then it is the only thing moving.
        tokenOut: s.usageMeasured
          ? s.tokenOut
          : Math.max(s.tokenOut, Math.ceil(partialOutput.length / 4)),
      };
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushHandle.current !== null) return;
    flushHandle.current =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flushDeltas)
        : (setTimeout(flushDeltas, 50) as unknown as number);
  }, [flushDeltas]);

  useEffect(
    () => () => {
      // Unmount aborts any in-flight run and cancels a scheduled flush so the
      // batched callback can't setState on an unmounted component.
      abortRef.current?.abort();
      if (flushHandle.current !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(flushHandle.current);
        } else {
          clearTimeout(flushHandle.current);
        }
        flushHandle.current = null;
      }
    },
    [],
  );

  const mutation = useMutation<EnhanceResponse, EnhanceError, EnhanceRequest>({
    mutationFn: async (req) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      pendingText.current = "";
      setStream({ ...IDLE, active: true, step: "Queued" });

      try {
        const res = await fetch("/api/enhance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
          signal: ac.signal,
        });

        // Gate failures (auth, validation, rate/cost caps) are plain JSON
        // with real statuses — only a 200 carries the event stream.
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("event-stream")) {
          const data = await res.json().catch(() => ({}));
          throw new EnhanceError(
            data.error ?? "Enhancement failed.",
            res.status,
            Boolean(data.notConfigured),
            Boolean(data.capReached),
          );
        }
        if (!res.body) throw new EnhanceError("The response had no stream.", 502);

        let done: EnhanceResponse | null = null;
        for await (const event of parseSseStream(res.body)) {
          switch (event.type) {
            case "status":
              setStream((s) => ({ ...s, step: event.label }));
              break;
            case "thinking":
              setStream((s) => ({ ...s, step: event.text }));
              break;
            case "delta":
              pendingText.current += event.text;
              scheduleFlush();
              break;
            case "usage":
              // A mid-stream usage frame is a FLOOR, never a freeze.
              //
              // Anthropic reports `output_tokens` at `message_start` as a
              // header snapshot — literally 1-4 — and only sends the real
              // cumulative count in the terminal `message_delta`. Latching
              // that first frame as authoritative pinned the readout at
              // "1213→1 tok · $0.0037" for the whole visible run and disabled
              // the char-based estimator that would otherwise have tracked it,
              // so an expensive run never looked expensive while it ran.
              //
              // The route now floors tokenOut with what has demonstrably
              // streamed and prices the frame from that same number, so the
              // pair arrives self-consistent; the maxima here only guard
              // against out-of-order frames. Cost is never recomputed
              // client-side — the price table is server-side, and duplicating
              // it is exactly how the two figures drift apart.
              setStream((s) => {
                // A real measurement REPLACES; a snapshot may only raise.
                const measured = !event.snapshot;
                return {
                  ...s,
                  tokenIn: Math.max(event.tokenIn, s.tokenIn),
                  tokenOut: measured
                    ? event.tokenOut
                    : Math.max(event.tokenOut, s.tokenOut),
                  // A snapshot sends none; keep whatever we had (0 until a
                  // measurement lands, which the UI renders as no figure).
                  costUsd:
                    event.costUsd === undefined
                      ? s.costUsd
                      : measured
                        ? event.costUsd
                        : Math.max(event.costUsd, s.costUsd),
                  usageMeasured: s.usageMeasured || measured,
                };
              });
              break;
            case "done":
              done = event.result;
              break;
            case "error":
              throw new EnhanceError(
                event.error,
                event.status,
                event.notConfigured,
                event.capReached,
              );
          }
        }
        if (!done) throw new EnhanceError("The stream ended unexpectedly.", 502);
        return done;
      } catch (e) {
        // A deliberate cancel (RESET, new run, unmount) is not an error the
        // user should read — status 0 marks it for the UI to ignore.
        if (ac.signal.aborted && !(e instanceof EnhanceError)) {
          throw new EnhanceError("Cancelled.", 0);
        }
        throw e;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        // Drain any deltas still waiting on the rAF flush so the stream state
        // matches everything that arrived; a cancelled run discards them.
        if (ac.signal.aborted) pendingText.current = "";
        else flushDeltas();
        setStream((s) => ({ ...s, active: false }));
      }
    },
  });

  const mutationReset = mutation.reset;
  /** Reset also aborts an in-flight stream (RESET cancels a running run). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStream(IDLE);
    mutationReset();
  }, [mutationReset]);

  return { ...mutation, reset, stream };
}

export { EnhanceError };
