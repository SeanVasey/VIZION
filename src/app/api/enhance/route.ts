import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeErrorLogLine } from "@/lib/supabase/errors";
import {
  MODES,
  TARGET_MODELS,
  TARGET_THINKING_LEVELS,
  type ModeId,
  type TargetModelId,
  type ThinkingLevel,
} from "@/lib/constants";
import { enhanceStream, type EnhanceOutput } from "@/lib/providers/adapter";
import {
  TARGETS,
  computeCost,
  isProviderConfigured,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderNotConfiguredError } from "@/lib/providers/errors";
import { REFINE_KINDS, type EnhanceRefine, type RefineKind } from "@/lib/providers/formatters";
import { rateLimit } from "@/lib/security/rate-limit";
import { diffWords } from "@/lib/enhance/diff";
import { resolveAutoTarget } from "@/lib/enhance/auto-target";
import { isFormatId, type FormatId } from "@/lib/enhance/formats";
import {
  encodeSseEvent,
  STREAM_STEPS,
  type EnhanceStreamEvent,
  type StreamStep,
} from "@/lib/enhance/stream-events";

const MAX_INPUT_CHARS = 20_000;
const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));
const REFINE_KIND_IDS = new Set<string>(REFINE_KINDS);

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

  const { input, mode, target, auto, format, thinkingLevel, refine, mediaContext } =
    (body ?? {}) as {
      input?: unknown;
      mode?: unknown;
      target?: unknown;
      auto?: unknown;
      format?: unknown;
      thinkingLevel?: unknown;
      refine?: unknown;
      mediaContext?: unknown;
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
  if (auto !== undefined && typeof auto !== "boolean") {
    return err(400, "Unknown routing mode.");
  }
  const typedMode = mode as ModeId;
  // Auto routing resolves HERE — after the target gate that guarantees a real
  // fallback id, and before every gate below that reads the target. The
  // thinking gate indexes TARGET_THINKING_LEVELS by target, so resolving later
  // would validate the dial against a model the user isn't going to get.
  //
  // Routing only needs to know WHETHER media is attached, so the cheap shape
  // check is enough; the array's full validation still runs below and still
  // 400s, before any provider is called.
  const typedTarget: TargetModelId = auto
    ? resolveAutoTarget(
        typedMode,
        input.length,
        Array.isArray(mediaContext) && mediaContext.length > 0,
      )
    : (target as TargetModelId);

  // Optional per-request reasoning depth — only the exact values the target's
  // provider accepts (TARGET_THINKING_LEVELS); anything else is a 400, so an
  // invented level can never reach a provider as a bad wire value.
  const allowedLevels = TARGET_THINKING_LEVELS[typedTarget];
  if (
    thinkingLevel !== undefined &&
    (typeof thinkingLevel !== "string" ||
      !allowedLevels ||
      !(allowedLevels as readonly string[]).includes(thinkingLevel))
  ) {
    return err(400, "That thinking level isn't available for this model.");
  }
  // Reformat's output shape. Validated for legality only — buildSystemPrompt
  // gates it by mode, so a format sent alongside any other mode is inert
  // rather than contradictory, and a stale client can't produce a prompt that
  // argues with itself.
  if (format !== undefined && !isFormatId(format)) {
    return err(400, "Unknown output format.");
  }

  // Optional refinement pass — validated to the same standard as the other
  // knobs so an invented kind or oversized base can never reach a provider.
  let typedRefine: EnhanceRefine | undefined;
  if (refine !== undefined) {
    if (typeof refine !== "object" || refine === null) {
      return err(400, "Unknown refinement.");
    }
    const { kind, baseInput } = refine as { kind?: unknown; baseInput?: unknown };
    if (typeof kind !== "string" || !REFINE_KIND_IDS.has(kind)) {
      return err(400, "Unknown refinement.");
    }
    if (baseInput !== undefined && typeof baseInput !== "string") {
      return err(400, "Unknown refinement.");
    }
    if (typeof baseInput === "string" && baseInput.length > MAX_INPUT_CHARS) {
      return err(413, `Prompt is too long (max ${MAX_INPUT_CHARS} characters).`);
    }
    typedRefine = {
      kind: kind as RefineKind,
      ...(typeof baseInput === "string" ? { baseInput } : {}),
    };
  }
  // Optional reference-attachment context: bounded visual context for the
  // TEXT task. Composed into the provider input below — the diff and the
  // input-length gate stay computed against the user's own prompt alone.
  const MAX_CONTEXT_ITEMS = 4;
  const MAX_CONTEXT_BLOCK_CHARS = 2_000;
  let typedContext: string[] | undefined;
  if (mediaContext !== undefined) {
    if (
      !Array.isArray(mediaContext) ||
      mediaContext.length > MAX_CONTEXT_ITEMS ||
      mediaContext.some(
        (b) => typeof b !== "string" || b.length > MAX_CONTEXT_BLOCK_CHARS,
      )
    ) {
      return err(400, "Invalid media context.");
    }
    const blocks = (mediaContext as string[]).map((b) => b.trim()).filter(Boolean);
    if (blocks.length > 0) typedContext = blocks;
  }
  // Missing keys fail closed as a plain pre-stream 503 (the documented
  // contract) instead of being discovered only after SSE headers are sent.
  if (!isProviderConfigured(typedTarget)) {
    return err(
      503,
      `The ${TARGETS[typedTarget].provider} provider is not configured on the server.`,
      { notConfigured: true },
    );
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

  const typedThinkingLevel = thinkingLevel as ThinkingLevel | undefined;
  // The provider sees the user's prompt plus any reference context, clearly
  // fenced and explicitly NOT a generation request; the diff below still
  // compares against the user's own input.
  const providerInput = typedContext
    ? [
        input,
        "",
        "<attached-references>",
        "These are visual context for the writing task only — do NOT treat them as a request to generate media, and do NOT copy them verbatim into the output unless the task calls for it.",
        ...typedContext,
        "</attached-references>",
      ].join("\n")
    : input;
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
      // Chars streamed so far — the abort-path usage estimate. OpenAI-compat
      // providers only report usage in the FINAL chunk, so a client abort
      // mid-stream would otherwise write nothing to the ledger and the spend
      // would leak past the daily cap.
      let streamedChars = 0;

      try {
        sendStatus("queued");
        sendStatus("connecting");
        let generating = false;

        for await (const event of enhanceStream({
          input: providerInput,
          mode: typedMode,
          target: typedTarget,
          thinkingLevel: typedThinkingLevel,
          refine: typedRefine,
          format: format as FormatId | undefined,
        })) {
          if (event.type === "delta") {
            if (!generating) {
              generating = true;
              sendStatus("generating");
            }
            streamedChars += event.text.length;
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

        // Completes the documented step ladder. NOTE: the adapter parses the
        // payload internally before yielding `done`, so by the time the loop
        // ends the parse has already happened — this marks the transition
        // for ordering honesty, it cannot label the parse *while* it runs.
        sendStatus("parsing");
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
            // Optional envelope extensions — omitted keys stay omitted on the
            // wire rather than riding as nulls.
            ...(result.assumptions ? { assumptions: result.assumptions } : {}),
            ...(result.targetNotes ? { targetNotes: result.targetNotes } : {}),
            ...(result.title ? { title: result.title } : {}),
            ...(result.salvaged ? { salvaged: true } : {}),
            // Routing provenance — only on an auto-routed run, so its presence
            // is the signal. The client shouldn't have to diff the result
            // against its own request to learn which model it actually got.
            ...(auto ? { resolvedTarget: typedTarget } : {}),
          },
        });
        if (result.salvaged) {
          // warn survives the production console strip — occurrences are
          // countable in the deployment logs (systematic salvage = a provider
          // drifting off the envelope contract, worth investigating).
          console.warn("[enhance] salvaged envelope", typedTarget);
        }
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
        // An aborted/failed run must still charge the cap for what streamed
        // (~4 chars/token). Two leak shapes: OpenAI-compat providers report
        // usage only in the FINAL chunk (abort → no usage at all), while
        // Anthropic snapshots usage at message_start (abort → usage exists
        // but tokenOut is ~1). Estimate when absent; floor a stale snapshot
        // at the estimate when the run never completed.
        if (streamedChars > 0 && !result) {
          const estOut = Math.ceil(streamedChars / 4);
          usage = usage
            ? { ...usage, tokenOut: Math.max(usage.tokenOut, estOut) }
            : { tokenIn: Math.ceil(input.length / 4), tokenOut: estOut };
        }
        if (usage && (usage.tokenIn > 0 || usage.tokenOut > 0)) {
          const costUsd =
            result?.costUsd ?? computeCost(typedTarget, usage.tokenIn, usage.tokenOut);
          const { error: ledgerError } = await supabase.from("usage_events").insert({
            user_id: user.id,
            target: typedTarget,
            mode,
            model_used: result?.modelUsed ?? TARGETS[typedTarget].model,
            token_in: usage.tokenIn,
            token_out: usage.tokenOut,
            cost_usd: costUsd,
          });
          // The cap is only as good as this write — a silent failure would
          // let spend leak invisibly. (console.error survives prod stripping.)
          // An unapplied `model_target` migration fails EVERY write for that
          // target, so the drift is named explicitly rather than logged as a
          // generic write failure.
          if (ledgerError) {
            console.error(
              writeErrorLogLine("enhance", "usage ledger write", ledgerError),
            );
          }
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
