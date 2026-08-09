import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeErrorLogLine } from "@/lib/supabase/errors";
import {
  AUTO_PREFERENCES,
  MODES,
  TARGET_MODELS,
  TARGET_THINKING_LEVELS,
  type AutoPreference,
  type ModeId,
  type TargetModelId,
  type ThinkingLevel,
} from "@/lib/constants";
import { enhanceStream, type EnhanceOutput } from "@/lib/providers/adapter";
import { providerDeadline } from "@/lib/providers/idle-timeout";
import {
  TARGETS,
  computeCost,
  isProviderConfigured,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderNotConfiguredError } from "@/lib/providers/errors";
import {
  REFINE_KINDS,
  buildSystemPrompt,
  neutralizeTag,
  type EnhanceRefine,
  type RefineKind,
} from "@/lib/providers/formatters";
import { rateLimit } from "@/lib/security/rate-limit";
import { reserveSpend, settleSpend, releaseSpend } from "@/lib/security/spend";
import { getAppSettings, isOwnerUser } from "@/lib/owner/settings";
import { boundedDiffWords } from "@/lib/enhance/diff";
import { resolveAutoTarget } from "@/lib/enhance/auto-target";
import { isFormatId, type FormatId } from "@/lib/enhance/formats";
import { isLengthId, type LengthId } from "@/lib/enhance/lengths";
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

/**
 * Streaming can outlive the default function window on long enhancements.
 *
 * 300, not 60. At 60 the platform killed the function while the model was
 * still producing — and because the adapters' own deadline sat just under it
 * at 55s, a healthy generation was capped at roughly 2,000-4,000 output tokens
 * against the 16,000-64,000 `max_tokens` they request. The clock, not the token
 * ceiling, was the real limit, and the truncated run was still billed by the
 * finally-block below.
 *
 * The adapters now bound themselves on SILENCE (PROVIDER_IDLE_MS) with a total
 * backstop (285s, taken as ONE absolute wall at entry below) under this window,
 * from which every adapter and SDK timer is cut, so the
 * finally-block always runs and the spend hold is never stranded. Raising this
 * requires a Vercel plan whose Node-runtime limit allows it; the project is on
 * a Team account, where 300 is available.
 */
export const maxDuration = 300;

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
  // FIRST STATEMENT, and it has to be. maxDuration starts counting when the
  // platform invokes this handler, not when the provider call begins — so
  // auth, the settings read, JSON parsing and reserveSpend below are all
  // already spending it. A deadline taken later (in the adapter, or even just
  // before the fetch) silently excludes that preflight, and a slow one plus a
  // full-length stream can still overrun the window and skip the finally block
  // that settles the spend hold. One wall, from the only moment that matches
  // what the platform is measuring. (Codex review, PR #91.)
  const deadline = providerDeadline();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err(401, "Sign in to enhance prompts.");

  // Cheap in-memory burst guard in front of the DB cost/rate window.
  if (!rateLimit(`enhance:${user.id}`, RATE_LIMIT_PER_MIN, 60_000).allowed) {
    return err(429, "You're going fast — wait a moment and try again.");
  }

  // Owner switch (app_settings.open_access): when closed, only the owner may
  // spend against the provider keys. Checked before any parsing or reserve.
  const appSettings = await getAppSettings(supabase);
  if (!appSettings.openAccess && !isOwnerUser(user, appSettings)) {
    return err(403, "The owner has closed access for other accounts.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }

  const {
    input,
    mode,
    target,
    auto,
    autoPreference,
    format,
    length,
    thinkingLevel,
    refine,
    mediaContext,
  } = (body ?? {}) as {
      input?: unknown;
      mode?: unknown;
      target?: unknown;
      auto?: unknown;
      autoPreference?: unknown;
      format?: unknown;
      length?: unknown;
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
  // Legality only, like format/length: a preference without `auto` is inert
  // rather than contradictory (a stale client can't produce a request that
  // argues with itself), but an invented value never routes anything.
  if (
    autoPreference !== undefined &&
    (typeof autoPreference !== "string" ||
      !(AUTO_PREFERENCES as readonly string[]).includes(autoPreference))
  ) {
    return err(400, "Unknown routing preference.");
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
  const autoRoute = auto
    ? resolveAutoTarget(
        typedMode,
        input.length,
        Array.isArray(mediaContext) && mediaContext.length > 0,
        (autoPreference as AutoPreference | undefined) ?? "balanced",
      )
    : null;
  const typedTarget: TargetModelId = autoRoute
    ? autoRoute.target
    : (target as TargetModelId);

  // Optional per-request reasoning depth — only the exact values the target's
  // provider accepts (TARGET_THINKING_LEVELS); anything else is a 400, so an
  // invented level can never reach a provider as a bad wire value.
  //
  // Under Auto the level was chosen against the PINNED model, not the one
  // routing resolves — Gemini's 'minimal' is valid UI state that no Anthropic
  // ladder accepts (PRV-001). The user asked for routing, not that dial, so
  // an out-of-ladder level is advisory there: dropped, never a 400.
  const allowedLevels = TARGET_THINKING_LEVELS[typedTarget];
  let typedThinkingLevel = thinkingLevel as ThinkingLevel | undefined;
  if (
    thinkingLevel !== undefined &&
    (typeof thinkingLevel !== "string" ||
      !allowedLevels ||
      !(allowedLevels as readonly string[]).includes(thinkingLevel))
  ) {
    if (auto && typeof thinkingLevel === "string") {
      typedThinkingLevel = undefined;
    } else {
      return err(400, "That thinking level isn't available for this model.");
    }
  }
  // Reformat's output shape. Validated for legality only — buildSystemPrompt
  // gates it by mode, so a format sent alongside any other mode is inert
  // rather than contradictory, and a stale client can't produce a prompt that
  // argues with itself.
  if (format !== undefined && !isFormatId(format)) {
    return err(400, "Unknown output format.");
  }
  // Condense/Expand depth — same story: legality only, mode-gated downstream.
  if (length !== undefined && !isLengthId(length)) {
    return err(400, "Unknown length setting.");
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
    // A block containing the literal closing tag would break out of the
    // fence below (SEC-007) — neutralize both tag forms before joining.
    const blocks = (mediaContext as string[])
      .map((b) => neutralizeTag(b.trim(), "attached-references"))
      .filter(Boolean);
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

  // --- Rate limit + cost cap + the hold, decided together under one lock ---
  // Reading a usage window and acting on it later is a race: the whole provider
  // call sits between the read and the ledger write, so every request that
  // started inside that gap saw the same balance and passed. `spend_reserve`
  // takes the decision and the hold in one transaction, so a concurrent request
  // sees this one even though its ledger row does not exist yet.
  const reservation = await reserveSpend(supabase);
  if ("error" in reservation) {
    if (reservation.error === "rate") {
      return err(429, "You're going fast — wait a moment and try again.");
    }
    if (reservation.error === "cap") {
      return err(429, "You've reached today's usage cap. It resets at midnight UTC.", {
        capReached: true,
      });
    }
    return err(500, "Couldn't check your usage limits. Try again.");
  }

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
          length: length as LengthId | undefined,
          deadline,
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
            // Floor a SNAPSHOT — and only a snapshot — with what has
            // demonstrably streamed, pricing the frame from that same number
            // so the two always agree.
            //
            // Anthropic reports output_tokens at message_start as a header
            // placeholder (literally 1-4) and sends the real cumulative count
            // only at the end, so the un-floored frame read "1213→1 tok ·
            // $0.0037" for an entire run — the counter frozen and the cost
            // understated by roughly the output/input ratio, which is how an
            // expensive run managed not to look expensive while it ran.
            //
            // The `snapshot` gate is load-bearing, not defensive. Flooring
            // unconditionally would be just as wrong in the other direction:
            // chars-per-token varies with content, so for a provider that
            // reports an accurate cumulative count mid-stream (Gemini sends
            // usageMetadata on every frame) `ceil(chars/4)` can exceed the
            // measurement — and the client's own Math.max would then hold that
            // inflated figure for the rest of the run. Replacing a measurement
            // with a heuristic and pricing it as exact is the same class of
            // error as the freeze this fixes. Only the adapter knows which
            // kind of report it is, so only the adapter says so.
            const shownOut = event.snapshot
              ? Math.max(event.tokenOut, Math.ceil(streamedChars / 4))
              : event.tokenOut;
            // A snapshot carries NO cost, and that is the honest answer.
            //
            // Anthropic's only snapshot arrives at message_start, before a
            // single delta — so `streamedChars` is 0, the floor above returns
            // the 1-4 placeholder unchanged, and any cost priced from it is
            // the understated "$0.0037" this whole change exists to kill. The
            // client then raises its token estimate as deltas land but cannot
            // reprice (the price table is server-side, deliberately), so a
            // cost sent here would sit frozen and wrong beside a climbing
            // token count — the two disagreeing, which is exactly what the
            // floor was meant to prevent.
            //
            // Omitting it means the ticker shows tokens moving and no dollar
            // figure until a real measurement lands. Less information, all of
            // it true; a wrong number is not a cheaper version of the right
            // one. (Codex review, PR #91.)
            send({
              type: "usage",
              tokenIn: event.tokenIn,
              tokenOut: shownOut,
              ...(event.snapshot
                ? { snapshot: true }
                : { costUsd: computeCost(typedTarget, event.tokenIn, shownOut) }),
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
        const todayCost = reservation.todayCost + result.costUsd;
        send({
          type: "done",
          result: {
            output: result.output,
            rationale: result.rationale,
            // Bounded (PRI-001): the unbounded O(n·m) LCS on a 20k-char input
            // against a 64k-token output is ~10^9 table cells — enough to OOM
            // the invocation and skip the finally-block settle. Over budget ⇒
            // null; the client renders plain text with a "too long" note.
            diff: boundedDiffWords(input, result.output),
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
            ...(result.questions ? { questions: result.questions } : {}),
            ...(result.salvaged ? { salvaged: true } : {}),
            ...(result.truncated ? { truncated: true } : {}),
            ...(result.usageEstimated ? { usageEstimated: true } : {}),
            // Routing provenance — only on an auto-routed run, so its presence
            // is the signal. The client shouldn't have to diff the result
            // against its own request to learn which model it actually got,
            // and the reason lets the meta say WHY in a word or two.
            ...(autoRoute
              ? { resolvedTarget: typedTarget, resolvedReason: autoRoute.reason }
              : {}),
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
        let ledgerEstimated = result?.usageEstimated ?? false;
        if (streamedChars > 0 && !result) {
          const estOut = Math.ceil(streamedChars / 4);
          // Match the adapter's own estimator (MOD-006): the provider was
          // sent the system prompt AND the fenced context, not the bare
          // input — estimating from `input` under-counts the cap by the
          // system prompt's ~500-750 tokens on every aborted run.
          const estIn = Math.ceil(
            (buildSystemPrompt({
              mode: typedMode,
              target: typedTarget,
              refine: typedRefine,
              format: format as FormatId | undefined,
              length: length as LengthId | undefined,
            }).length +
              providerInput.length) /
              4,
          );
          usage = usage
            ? { ...usage, tokenOut: Math.max(usage.tokenOut, estOut) }
            : { tokenIn: estIn, tokenOut: estOut };
          // The abort-path numbers are estimates by construction.
          ledgerEstimated = true;
        }
        if (usage && (usage.tokenIn > 0 || usage.tokenOut > 0)) {
          const costUsd =
            result?.costUsd ?? computeCost(typedTarget, usage.tokenIn, usage.tokenOut);
          // Settling records what the call really cost and drops this run's
          // hold in one step. Like `record_usage` before it, the write happens
          // inside a SECURITY DEFINER function that takes the owner from the
          // verified JWT — the client holds no INSERT grant on `usage_events`.
          const { error: ledgerError } = await settleSpend(supabase, reservation.id, {
            target: typedTarget,
            mode,
            modelUsed: result?.modelUsed ?? TARGETS[typedTarget].model,
            tokenIn: usage.tokenIn,
            tokenOut: usage.tokenOut,
            costUsd,
            estimated: ledgerEstimated,
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
        } else {
          // Nothing billable happened — a 503 from the provider, an abort before
          // the first delta. Drop the hold now instead of leaving it to the
          // five-minute sweep, so two cancelled runs in a row don't refuse the
          // third for a reason the user cannot see.
          const { error: releaseError } = await releaseSpend(supabase, reservation.id);
          if (releaseError) {
            console.error(
              writeErrorLogLine("enhance", "spend hold release", releaseError),
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
