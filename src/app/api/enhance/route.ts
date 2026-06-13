import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { enhance } from "@/lib/providers/adapter";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";
import { RATE_LIMIT_PER_MIN, COST_CAP_USD_PER_DAY } from "@/lib/providers/config";
import { rateLimit } from "@/lib/security/rate-limit";
import { diffWords } from "@/lib/enhance/diff";

const MAX_INPUT_CHARS = 20_000;
const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Enhance a prompt. Auth-required, with a per-user rate limit + daily cost cap
 * enforced server-side before any model call (guardrail: keys server-side,
 * rate limit + cost cap on every model route).
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

  // --- Enhance ---
  let result;
  try {
    result = await enhance({
      input,
      mode: mode as ModeId,
      target: target as TargetModelId,
    });
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      return err(503, e.message, { notConfigured: true });
    }
    if (e instanceof ProviderError) {
      return err(502, e.message);
    }
    return err(502, e instanceof Error ? e.message : "Enhancement failed.");
  }

  // Log usage (best-effort; never block the response on the ledger write).
  await supabase.from("usage_events").insert({
    user_id: user.id,
    target: target as TargetModelId,
    mode,
    model_used: result.modelUsed,
    token_in: result.tokenIn,
    token_out: result.tokenOut,
    cost_usd: result.costUsd,
  });

  const todayCost = Number(win.today_cost) + result.costUsd;

  return NextResponse.json({
    output: result.output,
    rationale: result.rationale,
    diff: diffWords(input, result.output),
    tokenIn: result.tokenIn,
    tokenOut: result.tokenOut,
    modelUsed: result.modelUsed,
    costUsd: result.costUsd,
    usage: { todayCost, capUsd: COST_CAP_USD_PER_DAY },
  });
}
