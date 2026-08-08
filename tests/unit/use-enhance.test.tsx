import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEnhance } from "@/lib/enhance/use-enhance";
import { encodeSseEvent, type EnhanceStreamEvent } from "@/lib/enhance/stream-events";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function sseResponse(events: EnhanceStreamEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(encodeSseEvent(e)));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

const REQ = { input: "hello", mode: "clarify", target: "fable_5" } as const;

const DONE: EnhanceStreamEvent = {
  type: "done",
  result: {
    output: "Hello!",
    rationale: "Friendlier.",
    diff: [],
    tokenIn: 10,
    tokenOut: 5,
    modelUsed: "claude-fable-5",
    costUsd: 0.0003,
    usage: { todayCost: 0.01, capUsd: 2 },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useEnhance (streaming)", () => {
  it("streams deltas into stream state and resolves with the done result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        { type: "status", step: "connecting", label: "Reaching the model…" },
        { type: "delta", text: "Hel" },
        { type: "delta", text: "lo!" },
        { type: "usage", tokenIn: 10, tokenOut: 5, costUsd: 0.0003 },
        DONE,
      ]),
    );

    const { result } = renderHook(() => useEnhance(), { wrapper });
    act(() => result.current.mutate({ ...REQ }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.output).toBe("Hello!");
    // Stream state captured the run (deltas + authoritative usage).
    await waitFor(() => expect(result.current.stream.partialOutput).toBe("Hello!"));
    expect(result.current.stream.tokenIn).toBe(10);
    expect(result.current.stream.tokenOut).toBe(5);
    expect(result.current.stream.costUsd).toBeCloseTo(0.0003);
    expect(result.current.stream.active).toBe(false);
  });

  it("maps a JSON gate failure to EnhanceError with its real status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "You've reached today's usage cap.", capReached: true }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useEnhance(), { wrapper });
    act(() => result.current.mutate({ ...REQ }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(429);
    expect(result.current.error?.capReached).toBe(true);
  });

  it("maps an in-stream error event to EnhanceError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        { type: "status", step: "connecting", label: "Reaching the model…" },
        { type: "error", status: 503, error: "not configured", notConfigured: true },
      ]),
    );

    const { result } = renderHook(() => useEnhance(), { wrapper });
    act(() => result.current.mutate({ ...REQ }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(503);
    expect(result.current.error?.notConfigured).toBe(true);
  });

  it("retains streamed partial output when the run ends in an error event", async () => {
    // The recovery UX (Copy / Use as draft on the partial card) depends on
    // this invariant: an error must not wipe what already streamed in.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        { type: "delta", text: "par" },
        { type: "delta", text: "tial" },
        { type: "error", status: 502, error: "The model returned a non-JSON response." },
      ]),
    );

    const { result } = renderHook(() => useEnhance(), { wrapper });
    act(() => result.current.mutate({ ...REQ }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(502);
    await waitFor(() => expect(result.current.stream.partialOutput).toBe("partial"));
    expect(result.current.stream.active).toBe(false);
  });

  it("reset aborts the in-flight run and clears stream state", async () => {
    // A stream that never closes — the run must end via abort.
    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(
          encoder.encode(encodeSseEvent({ type: "delta", text: "partial " })),
        );
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          try {
            controllerRef?.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* already errored */
          }
          reject(new DOMException("aborted", "AbortError"));
        });
        resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      });
    });

    const { result } = renderHook(() => useEnhance(), { wrapper });
    act(() => result.current.mutate({ ...REQ }));
    await waitFor(() => expect(result.current.stream.active).toBe(true));

    act(() => result.current.reset());
    await waitFor(() => expect(result.current.stream.active).toBe(false));
    expect(result.current.stream.partialOutput).toBe("");
  });

  // The live usage readout has failed in BOTH directions, and the two fixes
  // pull against each other — so both are pinned here.
  describe("the live usage readout", () => {
    it("does not freeze on a provider's pre-generation snapshot", async () => {
      // Anthropic reports output_tokens at message_start as a 1-4 placeholder.
      // Treating it as authoritative pinned the display at "1213→1 tok ·
      // $0.0037" for entire runs, so an expensive run never looked expensive
      // while it was running. A snapshot may only RAISE the counter.
      const long = "x".repeat(4_000); // ~1000 tokens at the ~4 chars/token rule
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        sseResponse([
          { type: "usage", tokenIn: 1213, tokenOut: 1, costUsd: 0.0037, snapshot: true },
          { type: "delta", text: long },
          DONE,
        ]),
      );

      const { result } = renderHook(() => useEnhance(), { wrapper });
      act(() => result.current.mutate({ ...REQ }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.stream.tokenOut).toBeGreaterThan(100);
      expect(result.current.stream.usageMeasured).toBe(false);
    });

    it("does not inflate a REAL measurement with the char estimate", async () => {
      // The opposite error, and just as wrong: chars-per-token varies with
      // content, so for a provider that reports an accurate cumulative count
      // mid-stream (Gemini sends usageMetadata on every frame) the heuristic
      // can exceed the measurement. Swapping a measurement for a heuristic and
      // pricing it as exact overstates the spend. A measured frame REPLACES.
      const long = "y".repeat(4_000); // estimator would say ~1000
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        sseResponse([
          { type: "delta", text: long },
          { type: "usage", tokenIn: 900, tokenOut: 250, costUsd: 0.002 },
          { type: "delta", text: long },
          DONE,
        ]),
      );

      const { result } = renderHook(() => useEnhance(), { wrapper });
      act(() => result.current.mutate({ ...REQ }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // 250, not ~2000: the estimator stood down when the measurement landed.
      expect(result.current.stream.tokenOut).toBe(250);
      expect(result.current.stream.costUsd).toBe(0.002);
      expect(result.current.stream.usageMeasured).toBe(true);
    });
  });
});
