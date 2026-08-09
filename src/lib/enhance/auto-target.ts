import {
  TARGET_MODELS,
  type AutoPreference,
  type ModeId,
  type TargetModelId,
} from "@/lib/constants";
import { isProviderConfigured } from "@/lib/providers/config";
import { TARGET_ROUTING, blendedPrice, type SpeedClass } from "@/lib/providers/manifest";

/**
 * Auto model routing — pick a target for the user when they'd rather not.
 *
 * A documented static policy, deliberately NOT a model call: routing must be
 * free, instant, and explainable. A router that costs a request to decide
 * which request to make is a worse deal than picking a model yourself.
 *
 * "auto" is a UI and wire concept ONLY. `model_target` is a Postgres enum on
 * `usage_events.target`, `prompts.target_model` and `profiles.default_model`,
 * so a literal "auto" could never be written to any of them. The route
 * resolves it to a real id before anything else looks at the target, and the
 * resolved id is what's stored and what `resolvedTarget` reports back.
 *
 * The policy, in reading order:
 *
 *  1. Classify the job into a TIER. Polish/Clarify/Condense are bounded by
 *     contract — they may not restructure — so they're `light`, until size
 *     (> LONG_INPUT_CHARS) or attached media makes holding the whole job in
 *     mind the hard part. Expand/Reformat/Adapt invent structure and are
 *     `heavy` no matter how little text came in. Same split as the original
 *     two-outcome table; the tier now picks a LADDER instead of one model.
 *  2. Read the precomputed ladder for (preference, tier) — built once at
 *     module load from `TARGET_ROUTING` strength/speed and live `TARGETS`
 *     prices. Ordering rules are documented on AUTO_LADDERS below.
 *  3. Walk the ladder top to bottom and take the first target whose provider
 *     key is configured — Auto can no longer resolve to a model that 503s.
 *     Ladders are TOTAL over the pool (below-floor targets are appended,
 *     never dropped), so if any provider is configured there is always an
 *     answer. If literally nothing is configured, return the ladder head and
 *     let the route's existing pre-stream 503 say so — exactly what a manual
 *     pick of that model would do.
 *
 * Unlike the previous table, a resolved target may carry no thinking ladder
 * (no TARGET_THINKING_LEVELS entry). Deliberate, and safe: under `auto` the
 * route drops an out-of-ladder thinkingLevel as advisory (PRV-001), and the
 * composer's refine path already shows no dial for ladder-less models.
 */

/**
 * Past this many characters a "simple" mode stops being simple: the risk is no
 * longer picking the right word, it's holding the whole thing in mind at once.
 * Media does the same thing for a different reason — an attachment means the
 * prompt is describing something the model has to reason about, not just tidy.
 */
export const LONG_INPUT_CHARS = 4_000;

type AutoTier = "light" | "heavy";

/** Why routing landed where it did — reported back as `resolvedReason` so the
 *  result meta can say more than "Auto → X". Priority when several apply:
 *  heavy-mode > media-context > long-input. */
export type AutoRouteReason =
  | "light-task"
  | "heavy-mode"
  | "long-input"
  | "media-context";

interface AutoRoute {
  target: TargetModelId;
  tier: AutoTier;
  reason: AutoRouteReason;
}

/** Modes that invent structure and are heavy at any size. Total over ModeId
 *  by construction — a seventh mode is a compile error here rather than a
 *  silent fall-through to some default. */
const HEAVY_ALWAYS: Record<ModeId, boolean> = {
  polish: false,
  clarify: false,
  condense: false,
  expand: true,
  reformat: true,
  target: true,
};

/** Minimum strength a target needs to lead a ladder, per (preference, tier).
 *  Below-floor targets still appear — appended after the floor-passers — so
 *  availability filtering can never empty a ladder. */
const STRENGTH_FLOOR: Record<AutoPreference, Record<AutoTier, number>> = {
  quality: { heavy: 9, light: 7 },
  balanced: { heavy: 8, light: 6 },
  budget: { heavy: 7, light: 5 },
};

/** Balanced never spends premium-tier money: targets with a blended price
 *  above this ceiling ($/1M, see blendedPrice) rank after the floor-passers.
 *  Quality has no ceiling — that preset is the explicit request for the top
 *  shelf — and budget's price-first ordering makes one redundant. */
const BALANCED_PRICE_CEILING = 20;

const SPEED_RANK: Record<SpeedClass, number> = {
  fast: 0,
  standard: 1,
  deliberate: 2,
};

/** Roster order is the final tie-break — the one arbitrary key, and the same
 *  one the picker displays, so ties resolve the way the UI reads. */
const ROSTER_INDEX: ReadonlyMap<TargetModelId, number> = new Map(
  TARGET_MODELS.map((m, i) => [m.id, i]),
);

/** Auto's candidate pool: the roster minus opted-out specialists. */
const POOL: readonly TargetModelId[] = TARGET_MODELS.map((m) => m.id).filter(
  (id) => !TARGET_ROUTING[id].autoExcluded,
);

/**
 * Ladder ordering, per preference:
 *
 *   quality   — strength desc, then price asc, then roster order. The user
 *               asked for the best; price only breaks ties.
 *   balanced  — strength desc, then price asc (light tier: FAST speed class
 *               first — mechanical jobs reward latency), under the price
 *               ceiling above. Strong-but-sensible.
 *   budget    — price asc, then strength desc. Cheapest that clears the bar.
 *
 * Floor-passers first, everything else appended in the same order.
 */
function compareFor(preference: AutoPreference, tier: AutoTier) {
  return (a: TargetModelId, b: TargetModelId): number => {
    const ra = TARGET_ROUTING[a];
    const rb = TARGET_ROUTING[b];
    const price = blendedPrice(a) - blendedPrice(b);
    const strength = rb.strength - ra.strength;
    const speed = SPEED_RANK[ra.speed] - SPEED_RANK[rb.speed];
    const roster = (ROSTER_INDEX.get(a) ?? 0) - (ROSTER_INDEX.get(b) ?? 0);
    if (preference === "budget") {
      return price || strength || roster;
    }
    if (preference === "balanced" && tier === "light") {
      return speed || strength || price || roster;
    }
    return strength || price || roster;
  };
}

function buildLadder(
  preference: AutoPreference,
  tier: AutoTier,
): readonly TargetModelId[] {
  const floor = STRENGTH_FLOOR[preference][tier];
  const leads = (t: TargetModelId): boolean =>
    TARGET_ROUTING[t].strength >= floor &&
    (preference !== "balanced" || blendedPrice(t) <= BALANCED_PRICE_CEILING);
  const cmp = compareFor(preference, tier);
  return Object.freeze([
    ...POOL.filter(leads).sort(cmp),
    ...POOL.filter((t) => !leads(t)).sort(cmp),
  ]);
}

/** Every ladder, materialized once at module load — deterministic for the
 *  process lifetime, and exported so tests derive expectations from the same
 *  policy the route runs instead of hardcoding picks that rot when a price
 *  default moves. */
export const AUTO_LADDERS: Record<
  AutoPreference,
  Record<AutoTier, readonly TargetModelId[]>
> = {
  quality: {
    light: buildLadder("quality", "light"),
    heavy: buildLadder("quality", "heavy"),
  },
  balanced: {
    light: buildLadder("balanced", "light"),
    heavy: buildLadder("balanced", "heavy"),
  },
  budget: {
    light: buildLadder("budget", "light"),
    heavy: buildLadder("budget", "heavy"),
  },
};

function classify(
  mode: ModeId,
  inputChars: number,
  hasMedia: boolean,
): { tier: AutoTier; reason: AutoRouteReason } {
  if (HEAVY_ALWAYS[mode]) return { tier: "heavy", reason: "heavy-mode" };
  if (hasMedia) return { tier: "heavy", reason: "media-context" };
  if (inputChars > LONG_INPUT_CHARS) return { tier: "heavy", reason: "long-input" };
  return { tier: "light", reason: "light-task" };
}

/**
 * Resolve Auto to a real roster id: classify, read the ladder, first
 * configured target wins. `isConfigured` is injectable so tests pass a stub
 * instead of mocking env; the default is the same check the route's own 503
 * gate uses, so the two can never disagree about what "available" means.
 */
export function resolveAutoTarget(
  mode: ModeId,
  inputChars: number,
  hasMedia: boolean,
  preference: AutoPreference = "balanced",
  isConfigured: (t: TargetModelId) => boolean = isProviderConfigured,
): AutoRoute {
  const { tier, reason } = classify(mode, inputChars, hasMedia);
  const ladder = AUTO_LADDERS[preference][tier];
  // Ladders are total over a 15-model pool, so the final `?? "opus_5"` is
  // unreachable — it exists because the index type can't prove non-emptiness.
  const target = ladder.find(isConfigured) ?? ladder[0] ?? "opus_5";
  return { target, tier, reason };
}

/**
 * Auto for the media route: same ladders, tier fixed to `heavy` (an image
 * analysis IS the visual-context job), pool narrowed to vision-capable
 * targets. The caller supplies `isVisionCapable` (vision.ts `supportsVision`)
 * rather than this module importing vision.ts — that file pulls provider SDKs
 * this pure policy module has no business loading. The `"opus_5"` tail is a
 * defensive backstop for an empty capability set, matching the media route's
 * long-standing default.
 */
export function resolveAutoVisionTarget(
  preference: AutoPreference,
  isVisionCapable: (t: TargetModelId) => boolean,
  isConfigured: (t: TargetModelId) => boolean = isProviderConfigured,
): TargetModelId {
  const ladder = AUTO_LADDERS[preference].heavy.filter(isVisionCapable);
  return ladder.find(isConfigured) ?? ladder[0] ?? "opus_5";
}
