"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ModeId, TargetModelId } from "@/lib/constants";
import { parseSseStream, type EnhanceResult } from "@/lib/enhance/stream-events";

/** The final result shape (unchanged from the buffered route). */
export type EnhanceResponse = EnhanceResult;

export interface EnhanceRequest {
  input: string;
  mode: ModeId;
  target: TargetModelId;
}

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
  tokenIn: number;
  tokenOut: number;
  /** True once an authoritative provider usage snapshot arrived (before
   *  that, tokenOut is a ~4 chars/token estimate and cost is unknown). */
  usageAuthoritative: boolean;
  costUsd: number;
}

const IDLE: EnhanceStreamState = {
  active: false,
  step: "",
  partialOutput: "",
  tokenIn: 0,
  tokenOut: 0,
  usageAuthoritative: false,
  costUsd: 0,
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
        tokenOut: s.usageAuthoritative
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
              setStream((s) => ({
                ...s,
                tokenIn: event.tokenIn,
                tokenOut: event.tokenOut,
                costUsd: event.costUsd,
                usageAuthoritative: true,
              }));
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
