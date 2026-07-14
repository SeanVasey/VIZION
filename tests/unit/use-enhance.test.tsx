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
});
