import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractImageAttributes } from "@/lib/providers/anthropic";
import { parseDataUrl } from "@/lib/media/extract";
import {
  TARGETS,
  computeCost,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB of base64-decoded image

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }
  const { dataUrl } = (body ?? {}) as { dataUrl?: unknown };
  if (typeof dataUrl !== "string") return err(400, "Missing image data.");

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

  const cfg = TARGETS.opus_4_8;
  let extracted;
  try {
    extracted = await extractImageAttributes(parsed.base64, parsed.mediaType, cfg.model);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      return err(503, e.message, { notConfigured: true });
    }
    if (e instanceof ProviderError) return err(502, e.message);
    return err(502, e instanceof Error ? e.message : "Extraction failed.");
  }

  const costUsd = computeCost("opus_4_8", extracted.tokenIn, extracted.tokenOut);
  await supabase.from("usage_events").insert({
    user_id: user.id,
    target: "opus_4_8",
    mode: "extract",
    model_used: cfg.model,
    token_in: extracted.tokenIn,
    token_out: extracted.tokenOut,
    cost_usd: costUsd,
  });

  return NextResponse.json({ attributes: { ...extracted.attrs, source: "proxy" } });
}
