import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { enhanceStream, type EnhanceOutput } from "@/lib/providers/adapter";
import {
  TARGETS,
  computeCost,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderNotConfiguredError } from "@/lib/providers/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { diffWords } from "@/lib/enhance/diff";
import {
  encodeSseEvent,
  STREAM_STEPS,
  type EnhanceStreamEvent,
  type StreamStep,
} from "@/lib/enhance/stream-events";

const MAX_INPUT_CHARS = 20_000;
const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

/** Streaming can outlive the default function window on long enhancements. */
export const maxDuration = 60;

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Enhance a prompt. Auth-required, with a per-user rate limit + daily cost cap
 * enforced server-side before any model call (guardrail: keys server-side,
 * rate limit + cost cap on every model route).
 *
 * Every gate failure (401/400/413/429/503-precheck) stays a plain JSON error
 * with a real HTTP status — the e2e auth contract is unchanged. A 200 carries
 * an SSE stream of EnhanceStreamEvents ending in `done` (or `error` for
 * failures after headers are sent).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err(401, "Sign in to enhance prompts.");

  // Cheap in-memory burst guard in front of the DB cost/rate window.
  if (!rateLimit(`enhance:${user.id}`, RATE_LIMIT_PER_MIN, 60_000).allowed) {
    return err(429, "You're going fast — wait a moment and try again.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }

  const { input, mode, target } = (body ?? {}) as {
    input?: unknown;
    mode?: unknown;
    target?: unknown;
  };

  if (typeof input !== "string" || input.trim() === "") {
    return err(400, "Provide a prompt to enhance.");
  }
  if (input.length > MAX_INPUT_CHARS) {
    return err(413, `Prompt is too long (max ${MAX_INPUT_CHARS} characters).`);
  }
  if (typeof mode !== "string" || !MODE_IDS.has(mode)) {
    return err(400, "Unknown enhancement mode.");
  }
  if (typeof target !== "string" || !TARGET_IDS.has(target)) {
    return err(400, "Unknown target model.");
  }

  // --- Rate limit + cost cap (RLS scopes the window to this user) ---
  const { data: windowRows, error: windowError } = await supabase.rpc("usage_window", {
    p_rate_seconds: 60,
  });
  if (windowError) {
    return err(500, "Couldn't check your usage limits. Try again.");
  }
  const win = windowRows?.[0] ?? { recent_count: 0, today_cost: 0 };
  if (Number(win.recent_count) >= RATE_LIMIT_PER_MIN) {
    return err(429, "You're going fast — wait a moment and try again.");
  }
  if (Number(win.today_cost) >= COST_CAP_USD_PER_DAY) {
    return err(429, "You've reached today's usage cap. It resets at midnight UTC.", {
      capReached: true,
    });
  }

  const typedTarget = target as TargetModelId;
  const typedMode = mode as ModeId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: EnhanceStreamEvent) =>
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      const sendStatus = (step: StreamStep) =>
        send({ type: "status", step, label: STREAM_STEPS[step] });

      // Whatever usage accrued MUST reach the ledger — even when the client
      // disconnects mid-stream (enqueue throws) or the provider errors. The
      // cost cap is only as good as this write.
      let usage: { tokenIn: number; tokenOut: number } | null = null;
      let result: EnhanceOutput | null = null;

      try {
        sendStatus("queued");
        sendStatus("connecting");
        let generating = false;

        for await (const event of enhanceStream({
          input,
          mode: typedMode,
          target: typedTarget,
        })) {
          if (event.type === "delta") {
            if (!generating) {
              generating = true;
              sendStatus("generating");
            }
            send({ type: "delta", text: event.text });
          } else if (event.type === "usage") {
            usage = { tokenIn: event.tokenIn, tokenOut: event.tokenOut };
            send({
              type: "usage",
              tokenIn: event.tokenIn,
              tokenOut: event.tokenOut,
              costUsd: computeCost(typedTarget, event.tokenIn, event.tokenOut),
            });
          } else {
            result = event.result;
            usage = { tokenIn: event.result.tokenIn, tokenOut: event.result.tokenOut };
          }
        }

        if (!result) throw new Error("The model stream ended without a result.");

        sendStatus("diffing");
        const todayCost = Number(win.today_cost) + result.costUsd;
        send({
          type: "done",
          result: {
            output: result.output,
            rationale: result.rationale,
            diff: diffWords(input, result.output),
            tokenIn: result.tokenIn,
            tokenOut: result.tokenOut,
            modelUsed: result.modelUsed,
            costUsd: result.costUsd,
            usage: { todayCost, capUsd: COST_CAP_USD_PER_DAY },
          },
        });
      } catch (e) {
        // Client may already be gone; a failed send is fine to swallow.
        try {
          if (e instanceof ProviderNotConfiguredError) {
            send({ type: "error", status: 503, error: e.message, notConfigured: true });
          } else {
            send({
              type: "error",
              status: 502,
              error: e instanceof Error ? e.message : "Enhancement failed.",
            });
          }
        } catch {
          /* disconnected */
        }
      } finally {
        if (usage && (usage.tokenIn > 0 || usage.tokenOut > 0)) {
          const costUsd =
            result?.costUsd ?? computeCost(typedTarget, usage.tokenIn, usage.tokenOut);
          await supabase.from("usage_events").insert({
            user_id: user.id,
            target: typedTarget,
            mode,
            model_used: result?.modelUsed ?? TARGETS[typedTarget].model,
            token_in: usage.tokenIn,
            token_out: usage.tokenOut,
            cost_usd: costUsd,
          });
        }
        try {
          controller.close();
        } catch {
          /* already closed/cancelled */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Defeat proxy buffering so deltas actually flow.
      "x-accel-buffering": "no",
    },
  });
}
