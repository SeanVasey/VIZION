import "server-only";
import { PROVIDER_TIMEOUT_MS } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

interface GeminiResponse {
  candidates?: {
    /** `thought: true` marks reasoning parts — never enhancement output. */
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** Thinking-model reasoning tokens — billed as output. */
    thoughtsTokenCount?: number;
  };
  error?: { message?: string };
}

/**
 * SSE events end at a blank line, and Gemini's endpoint delimits with CRLF —
 * `\r\n\r\n` contains no adjacent `\n\n`, so a bare `indexOf("\n\n")` never
 * matches a real production frame and the whole stream silently assembles to
 * an empty string ("The model returned a non-JSON response." on every run).
 * Accept either convention.
 */
const FRAME_BREAK = /\r?\n\r?\n/;

/** Decode one SSE frame into stream chunks (shared by the read loop and the
 *  end-of-stream flush — a final frame may arrive without its blank line). */
function parseGeminiFrame(frame: string): ProviderStreamChunk[] {
  const chunks: ProviderStreamChunk[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let data: GeminiResponse;
    try {
      data = JSON.parse(line.slice(5).trim()) as GeminiResponse;
    } catch {
      continue;
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      // Reasoning parts stream interleaved with the answer when thinking is
      // on; concatenating them corrupts the JSON envelope.
      .filter((p) => p.thought !== true)
      .map((p) => p.text ?? "")
      .join("");
    if (text) chunks.push({ text });
    const finish = data.candidates?.[0]?.finishReason;
    if (finish) chunks.push({ stopReason: finish });
    if (data.usageMetadata) {
      chunks.push({
        usage: {
          tokenIn: data.usageMetadata.promptTokenCount ?? 0,
          // Thinking tokens are billed as output — dropping them
          // undercounts the daily cost cap for the thinking target.
          tokenOut:
            (data.usageMetadata.candidatesTokenCount ?? 0) +
            (data.usageMetadata.thoughtsTokenCount ?? 0),
        },
      });
    }
  }
  return chunks;
}

/**
 * Streaming Google (Gemini) call via the streamGenerateContent REST endpoint
 * (alt=sse): each SSE frame is a GenerateContentResponse whose parts carry
 * text deltas; usageMetadata rides the trailing frames. Server-side only; key
 * never reaches the client.
 *
 * `opts.thinkingLevel` is what distinguishes the Gemini "Thinking" target from
 * the "Flash" one — both send the same model string, because Gemini 3.x has no
 * separate thinking model ID. Only `thinkingLevel` is ever sent: it and the
 * Gemini-2.5-era `thinkingBudget` are mutually exclusive, and sending both is
 * an API error.
 */
export async function* streamGoogle(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("google");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:streamGenerateContent?alt=sse`;

  try {
    const res = await fetch(url, {
      method: "POST",
      // The raw fetch has no SDK to bound it — without this a hung Gemini
      // connection outlives maxDuration and strands the spend hold (PRV-002).
      // The signal covers the whole request including the body read; a
      // healthy stream past 55s was already doomed at the platform's 60.
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: {
          responseMimeType: "application/json",
          // Thought tokens count against this budget, so the high-reasoning
          // target needs headroom the fast one doesn't: a heavy reasoning pass
          // inside a tight cap truncates the JSON envelope mid-stream (turning
          // a previously-good enhancement into a parse failure). 3.6 Flash
          // allows 65,536 output tokens; this is a ceiling, not a target.
          maxOutputTokens: opts.thinkingLevel === "high" ? 64_000 : 32_000,
          ...(opts.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel } }
            : {}),
        },
      }),
    });

    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as GeminiResponse;
      const upstream = data.error?.message ?? res.statusText;
      // 401/403 are Google refusing the KEY'S PROJECT ("Your project has
      // been denied access. Please contact support." — Google's words about
      // Google's project), not this request or the model. Relayed bare it
      // reads as a VIZION capability gap and dead-ends at the wrong
      // support desk, so name the actual remediation (2026-08 incident;
      // docs/runbooks/providers.md § Gemini key/project refusals).
      const message =
        res.status === 401 || res.status === 403
          ? `Gemini request failed: ${upstream} — Google is refusing the server's API key/project, not this request. Replace GOOGLE_API_KEY with a key from a Google AI Studio project that has Gemini API access.`
          : `Gemini request failed: ${upstream}`;
      // warn survives the production console strip; without it the only copy
      // of the upstream status goes to the one client that hit it, and the
      // deployment logs say nothing (which is how the 2026-08 refusal went
      // undiagnosed).
      console.warn("[google] upstream error", res.status, upstream);
      throw new ProviderError("google", message, res.status);
    }

    const reader = res.body.getReader();
    try {
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (;;) {
          const brk = FRAME_BREAK.exec(buf);
          if (!brk) break;
          const frame = buf.slice(0, brk.index);
          buf = buf.slice(brk.index + brk[0].length);
          for (const chunk of parseGeminiFrame(frame)) yield chunk;
        }
      }
      // The stream can close on a frame with no trailing blank line.
      for (const chunk of parseGeminiFrame(buf)) yield chunk;
    } finally {
      // Runs on errors AND early generator return (consumer aborted) — cancel
      // actually closes the upstream connection, then the lock is released.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof ProviderError || error instanceof ProviderNotConfiguredError) {
      throw error;
    }
    throw new ProviderError(
      "google",
      error instanceof Error ? error.message : "Unknown Gemini error.",
    );
  }
}
