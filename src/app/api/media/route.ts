import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TARGET_MODELS, type TargetModelId } from "@/lib/constants";
import {
  describeImage,
  isVisionConfigError,
  supportsVision,
  visionFallbackTarget,
} from "@/lib/providers/vision";
import { parseDataUrl } from "@/lib/media/extract";
import {
  TARGETS,
  computeCost,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";
import { rateLimit } from "@/lib/security/rate-limit";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB of base64-decoded image
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

/** Same window as the sibling model route: a slow vision call plus the
 *  cross-provider fallback retry can exceed the default serverless budget. */
export const maxDuration = 60;

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Map a vision failure to a response the client can act on. */
function visionError(e: unknown) {
  if (e instanceof ProviderNotConfiguredError) {
    return err(503, e.message, { notConfigured: true });
  }
  if (e instanceof ProviderError) {
    // A key the provider rejects reads like gibberish on its own — point at
    // the actual fix (the server key), since the image isn't the problem.
    const hint =
      e.status === 401 || e.status === 403
        ? ` The server's ${e.provider} API key was rejected — check its permissions.`
        : "";
    return err(502, `${e.message}${hint}`);
  }
  return err(502, e instanceof Error ? e.message : "Extraction failed.");
}

/**
 * Proxy media extraction (default path, flagged). Auth-required, with the same
 * per-user rate limit + daily cost cap as the enhance route (this is a model
 * route). Accepts an image data URL (video frames are sent as images); audio is
 * handled on-device by the client.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err(401, "Sign in to analyze media.");

  if (!rateLimit(`media:${user.id}`, RATE_LIMIT_PER_MIN, 60_000).allowed) {
    return err(429, "You're going fast — wait a moment and try again.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }
  const { dataUrl, target } = (body ?? {}) as { dataUrl?: unknown; target?: unknown };
  if (typeof dataUrl !== "string") return err(400, "Missing image data.");
  // Analysis runs on the user's selected target model; older clients that
  // send no target keep the original Opus behavior.
  if (target !== undefined && (typeof target !== "string" || !TARGET_IDS.has(target))) {
    return err(400, "Unknown target model.");
  }
  const typedTarget = (target as TargetModelId | undefined) ?? "opus_5";

  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !parsed.mediaType.startsWith("image/")) {
    return err(400, "Proxy extraction needs an image (or a captured video frame).");
  }
  // Rough decoded-size guard (base64 is ~4/3 the byte size).
  if (parsed.base64.length * 0.75 > MAX_IMAGE_BYTES) {
    return err(413, "Image is too large to analyze.");
  }

  // Rate limit + cost cap (RLS scopes the window to this user).
  const { data: windowRows, error: windowError } = await supabase.rpc("usage_window", {
    p_rate_seconds: 60,
  });
  if (windowError) return err(500, "Couldn't check your usage limits.");
  const win = windowRows?.[0] ?? { recent_count: 0, today_cost: 0 };
  if (Number(win.recent_count) >= RATE_LIMIT_PER_MIN) {
    return err(429, "You're going fast — wait a moment and try again.");
  }
  if (Number(win.today_cost) >= COST_CAP_USD_PER_DAY) {
    return err(429, "You've reached today's usage cap.", { capReached: true });
  }

  // Vision runs on the selected model. A text-only flagship (DeepSeek,
  // MiniMax, Qwen Max) can't take an image at all, so analysis is routed to
  // the first configured vision-capable provider up front. A config-shaped
  // failure (missing key, key without permission, unknown model string)
  // retries once on the first other configured provider — a bad key for one
  // provider shouldn't cost the user the whole feature. Anything else
  // surfaces as-is.
  let usedTarget = typedTarget;
  if (!supportsVision(typedTarget)) {
    const redirect = visionFallbackTarget(typedTarget);
    if (!redirect) {
      return err(503, "No vision-capable model is configured on the server.", {
        notConfigured: true,
      });
    }
    usedTarget = redirect;
  }
  let extracted;
  try {
    extracted = await describeImage(parsed.base64, parsed.mediaType, usedTarget);
  } catch (e) {
    const fallback = isVisionConfigError(e) ? visionFallbackTarget(usedTarget) : null;
    if (!fallback) return visionError(e);
    console.error(
      `[media] vision on ${usedTarget} failed (${e instanceof Error ? e.message : e}); retrying on ${fallback}`,
    );
    try {
      extracted = await describeImage(parsed.base64, parsed.mediaType, fallback);
      usedTarget = fallback;
    } catch (e2) {
      return visionError(e2);
    }
  }

  const cfg = TARGETS[usedTarget];
  const costUsd = computeCost(usedTarget, extracted.tokenIn, extracted.tokenOut);
  const { error: ledgerError } = await supabase.from("usage_events").insert({
    user_id: user.id,
    target: usedTarget,
    mode: "extract",
    model_used: cfg.model,
    token_in: extracted.tokenIn,
    token_out: extracted.tokenOut,
    cost_usd: costUsd,
  });
  // The cap is only as good as this write (console.error survives prod).
  if (ledgerError) {
    console.error("[media] usage ledger write failed:", ledgerError.message);
  }

  const { description, ...attrs } = extracted.attrs;
  return NextResponse.json({
    attributes: { ...attrs, source: "proxy" },
    description: description ?? null,
    modelUsed: cfg.model,
    ...(usedTarget !== typedTarget ? { fallbackFrom: typedTarget } : {}),
    usage: {
      target: usedTarget,
      tokenIn: extracted.tokenIn,
      tokenOut: extracted.tokenOut,
      costUsd,
      todayCost: Number(win.today_cost) + costUsd,
      capUsd: COST_CAP_USD_PER_DAY,
    },
  });
}
