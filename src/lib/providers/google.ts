import "server-only";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
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
      throw new ProviderError(
        "google",
        `Gemini request failed: ${data.error?.message ?? res.statusText}`,
        res.status,
      );
    }

    const reader = res.body.getReader();
    try {
      const decoder = new TextDecoder();
      let buf = "";
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
            let data: GeminiResponse;
            try {
              data = JSON.parse(line.slice(5).trim()) as GeminiResponse;
            } catch {
              continue;
            }
            const text = (data.candidates?.[0]?.content?.parts ?? [])
              .map((p) => p.text ?? "")
              .join("");
            if (text) yield { text };
            const finish = data.candidates?.[0]?.finishReason;
            if (finish) yield { stopReason: finish };
            if (data.usageMetadata) {
              yield {
                usage: {
                  tokenIn: data.usageMetadata.promptTokenCount ?? 0,
                  // Thinking tokens are billed as output — dropping them
                  // undercounts the daily cost cap for the thinking target.
                  tokenOut:
                    (data.usageMetadata.candidatesTokenCount ?? 0) +
                    (data.usageMetadata.thoughtsTokenCount ?? 0),
                },
              };
            }
          }
        }
      }
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
