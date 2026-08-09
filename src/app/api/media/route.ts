import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeErrorLogLine } from "@/lib/supabase/errors";
import {
  AUTO_PREFERENCES,
  TARGET_MODELS,
  type AutoPreference,
  type TargetModelId,
} from "@/lib/constants";
import { resolveAutoVisionTarget } from "@/lib/enhance/auto-target";
import {
  describeImage,
  isVisionConfigError,
  supportsVision,
  visionFallbackTarget,
} from "@/lib/providers/vision";
import {
  MEDIA_EXTRACT_SYSTEM,
  MEDIA_OCR_SYSTEM,
  MEDIA_STYLE_SYSTEM,
  parseDataUrl,
} from "@/lib/media/extract";
import {
  TARGETS,
  computeCost,
  isProviderConfigured,
  RATE_LIMIT_PER_MIN,
  COST_CAP_USD_PER_DAY,
} from "@/lib/providers/config";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { reserveSpend, settleSpend, releaseSpend } from "@/lib/security/spend";
import { getAppSettings, isOwnerUser } from "@/lib/owner/settings";

// Backstop for non-Vercel hosts: on Vercel the platform's 4.5 MB request-body
// cap rejects the JSON envelope first (effective decoded ceiling ~3.4 MB), so
// this in-route 413 binds only where no platform cap exists (MED-009).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB of base64-decoded image
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

/** Analysis intents (2026-07 attachment roles). `reference` and `describe`
 *  share the full attribute extraction; `style` reads only how it looks;
 *  `extract_text` transcribes. Default = reference (older clients send none). */
const INTENTS = {
  reference: { system: MEDIA_EXTRACT_SYSTEM, expect: "attributes" },
  describe: { system: MEDIA_EXTRACT_SYSTEM, expect: "attributes" },
  style: { system: MEDIA_STYLE_SYSTEM, expect: "attributes" },
  extract_text: { system: MEDIA_OCR_SYSTEM, expect: "text" },
} as const;
type Intent = keyof typeof INTENTS;

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

  // Owner switch (app_settings.open_access): when closed, only the owner may
  // spend against the provider keys. Same rule as the enhance route.
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
  const { dataUrl, target, intent, auto, autoPreference } = (body ?? {}) as {
    dataUrl?: unknown;
    target?: unknown;
    intent?: unknown;
    auto?: unknown;
    autoPreference?: unknown;
  };
  if (typeof dataUrl !== "string") return err(400, "Missing image data.");
  // Analysis runs on the user's selected target model; older clients that
  // send no target keep the original Opus behavior.
  if (target !== undefined && (typeof target !== "string" || !TARGET_IDS.has(target))) {
    return err(400, "Unknown target model.");
  }
  const typedTarget = (target as TargetModelId | undefined) ?? "opus_5";
  // Auto rides BESIDE the target fallback, exactly like the enhance route —
  // a bare "no target" can't signal it, because older clients already send
  // nothing and must keep the Opus default. Same legality-only stance on the
  // preference: invented values 400, presence without `auto` is inert.
  if (auto !== undefined && typeof auto !== "boolean") {
    return err(400, "Unknown routing mode.");
  }
  if (
    autoPreference !== undefined &&
    (typeof autoPreference !== "string" ||
      !(AUTO_PREFERENCES as readonly string[]).includes(autoPreference))
  ) {
    return err(400, "Unknown routing preference.");
  }
  // Object.hasOwn, not `in`: the prototype chain would accept "toString"
  // and silently run the default analysis while echoing the bogus intent.
  if (
    intent !== undefined &&
    (typeof intent !== "string" || !Object.hasOwn(INTENTS, intent))
  ) {
    return err(400, "Unknown analysis intent.");
  }
  const typedIntent = (intent as Intent | undefined) ?? "reference";
  const intentSpec = INTENTS[typedIntent];

  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !parsed.mediaType.startsWith("image/")) {
    return err(400, "Proxy extraction needs an image (or a captured video frame).");
  }
  // Rough decoded-size guard (base64 is ~4/3 the byte size).
  if (parsed.base64.length * 0.75 > MAX_IMAGE_BYTES) {
    return err(413, "Image is too large to analyze.");
  }

  // Vision runs on the selected model — or, under auto, on the routing
  // ladder's best configured vision target. A text-only flagship (DeepSeek,
  // GLM) can't take an image at all, so a manual pick of one is routed to
  // the first configured vision-capable provider up front. A config-shaped
  // failure (missing key, key without permission, unknown model string)
  // retries once on the first other configured provider — a bad key for one
  // provider shouldn't cost the user the whole feature. Anything else
  // surfaces as-is.
  //
  // Resolved BEFORE the reservation so the "no vision model configured" 503
  // returns without ever taking a hold it would then have to release.
  let usedTarget = typedTarget;
  if (auto) {
    // Same ladders as the enhance route, pool narrowed to vision-capable
    // targets and pinned to the heavy tier — analyzing an image IS the
    // visual-context job. First configured wins; nothing configured is the
    // same up-front 503 as the redirect path below.
    usedTarget = resolveAutoVisionTarget(
      (autoPreference as AutoPreference | undefined) ?? "balanced",
      supportsVision,
    );
    if (!isProviderConfigured(usedTarget)) {
      return err(503, "No vision-capable model is configured on the server.", {
        notConfigured: true,
      });
    }
  } else if (!supportsVision(typedTarget)) {
    const redirect = visionFallbackTarget(typedTarget);
    if (!redirect) {
      return err(503, "No vision-capable model is configured on the server.", {
        notConfigured: true,
      });
    }
    usedTarget = redirect;
  }
  // What this request was AIMED at after routing. Under auto that is the
  // resolved pick — routing is a choice, not a fallback, so `fallbackFrom`
  // must not claim otherwise. Without auto it stays the user's own target,
  // which keeps the text-only redirect above reporting as the fallback the
  // client re-labels from.
  const aimedTarget = auto ? usedTarget : typedTarget;

  // Rate limit + cost cap + the hold, decided together under one lock — the
  // same race the sibling model route had. One hold covers this request
  // including its single cross-provider retry.
  const reservation = await reserveSpend(supabase);
  if ("error" in reservation) {
    if (reservation.error === "rate") {
      return err(429, "You're going fast — wait a moment and try again.");
    }
    if (reservation.error === "cap") {
      return err(429, "You've reached today's usage cap.", { capReached: true });
    }
    return err(500, "Couldn't check your usage limits.");
  }

  const visionOpts = { system: intentSpec.system, expect: intentSpec.expect };
  let extracted;
  // Usage a FAILED leg reported before erroring (MED-004): the provider
  // billed it whether or not we got a result, so it must reach the ledger —
  // "failed calls are free" is how a flaky provider spends invisibly.
  // Cost is computed at the leg's own target rates; nothing is invented.
  let failedLegCost = 0;
  let failedLegUsage = { tokenIn: 0, tokenOut: 0 };
  const recordFailedLeg = (e: unknown, target: TargetModelId) => {
    if (e instanceof ProviderError && e.usage) {
      failedLegUsage = {
        tokenIn: failedLegUsage.tokenIn + e.usage.tokenIn,
        tokenOut: failedLegUsage.tokenOut + e.usage.tokenOut,
      };
      failedLegCost += computeCost(target, e.usage.tokenIn, e.usage.tokenOut);
    }
  };
  try {
    try {
      extracted = await describeImage(
        parsed.base64,
        parsed.mediaType,
        usedTarget,
        visionOpts,
      );
    } catch (e) {
      const fallback = isVisionConfigError(e) ? visionFallbackTarget(usedTarget) : null;
      if (!fallback) throw e;
      recordFailedLeg(e, usedTarget);
      console.error(
        `[media] vision on ${usedTarget} failed (${e instanceof Error ? e.message : e}); retrying on ${fallback}`,
      );
      // Attribute the fallback leg to the FALLBACK's rates and model — set the
      // active target BEFORE the await, so a fallback that reports usage and
      // then throws is priced and ledgered by the outer catch at `fallback`,
      // not left pointing at the original target (Codex review, PR #75).
      usedTarget = fallback;
      extracted = await describeImage(
        parsed.base64,
        parsed.mediaType,
        fallback,
        visionOpts,
      );
    }
  } catch (e) {
    // Every failure path out of the provider calls funnels here, so the hold
    // cannot be stranded by an early return added later. A failure that
    // REPORTED usage settles it (the money is spent); a free failure — the
    // common case: 401/403/404 answered before any model ran — releases.
    recordFailedLeg(e, usedTarget);
    if (failedLegUsage.tokenIn > 0 || failedLegUsage.tokenOut > 0) {
      const { error: ledgerError } = await settleSpend(supabase, reservation.id, {
        target: usedTarget,
        mode: "extract",
        modelUsed: TARGETS[usedTarget].model,
        tokenIn: failedLegUsage.tokenIn,
        tokenOut: failedLegUsage.tokenOut,
        costUsd: failedLegCost,
      });
      if (ledgerError) {
        console.error(writeErrorLogLine("media", "usage ledger write", ledgerError));
      }
    } else {
      const { error: releaseError } = await releaseSpend(supabase, reservation.id);
      if (releaseError) {
        console.error(writeErrorLogLine("media", "spend hold release", releaseError));
      }
    }
    return visionError(e);
  }

  const cfg = TARGETS[usedTarget];
  // The settled figure covers BOTH legs when the first failed after billing:
  // token counts sum (attributed to the answering target's row — the ledger
  // is per-request), and each leg's cost is priced at its own target's rates.
  const costUsd =
    computeCost(usedTarget, extracted.tokenIn, extracted.tokenOut) + failedLegCost;
  // Settling records the real cost and drops this run's hold in one step,
  // inside a SECURITY DEFINER function that takes the owner from the verified
  // JWT — the client holds no INSERT grant on `usage_events`.
  const { error: ledgerError } = await settleSpend(supabase, reservation.id, {
    target: usedTarget,
    mode: "extract",
    modelUsed: cfg.model,
    tokenIn: extracted.tokenIn + failedLegUsage.tokenIn,
    tokenOut: extracted.tokenOut + failedLegUsage.tokenOut,
    costUsd,
    estimated: extracted.usageEstimated ?? false,
  });
  // The cap is only as good as this write (console.error survives prod).
  if (ledgerError) {
    console.error(writeErrorLogLine("media", "usage ledger write", ledgerError));
  }

  const usage = {
    target: usedTarget,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    costUsd,
    todayCost: reservation.todayCost + costUsd,
    capUsd: COST_CAP_USD_PER_DAY,
    // "$0.0000" from an absent usage block is a default, not a measurement —
    // the client renders the approximation marker off this flag (INV-04).
    ...(extracted.usageEstimated ? { estimated: true } : {}),
  };

  // Transcription intent: the payload is the text, not attributes.
  if (typedIntent === "extract_text") {
    return NextResponse.json({
      intent: typedIntent,
      text: extracted.text ?? "",
      modelUsed: cfg.model,
      ...(usedTarget !== aimedTarget ? { fallbackFrom: aimedTarget } : {}),
      usage,
    });
  }

  const { description, ...attrs } = extracted.attrs;
  return NextResponse.json({
    intent: typedIntent,
    attributes: { ...attrs, source: "proxy" },
    description: description ?? null,
    modelUsed: cfg.model,
    ...(usedTarget !== aimedTarget ? { fallbackFrom: aimedTarget } : {}),
    usage,
  });
}
