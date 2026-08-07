"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  ENHANCE_VIEW_STORE_KEY,
  MODES,
  TARGET_MODELS,
  type ModeId,
  type TargetModelId,
} from "@/lib/constants";
import type { EnhanceResult } from "@/lib/enhance/stream-events";
import { FORMATS, type FormatId } from "@/lib/enhance/formats";
import { LENGTHS, type LengthId } from "@/lib/enhance/lengths";

/**
 * The rendered result + the snapshot of what was actually SUBMITTED — input
 * AND mode AND target. The result tree reads these, not the live store
 * values: flipping the mode grid or target select after a run must not
 * relabel the save payload, the exports, or the developer chip (R8).
 */
export interface EnhanceView {
  submitted: {
    input: string;
    mode: ModeId;
    target: TargetModelId;
    /** The run's knob snapshot (Q4 ruling): refines re-send these so an
     *  explicitly chosen shape/depth survives the pass instead of silently
     *  regaining the "whichever fits" latitude. */
    format?: FormatId;
    length?: LengthId;
  };
  result: EnhanceResult;
  /** True once a refinement pass replaced the result — the diff's input
   *  side is then the previous result, not the author's original. */
  refined?: boolean;
}

interface EnhanceViewState {
  view: EnhanceView | null;
  setView: (view: EnhanceView | null) => void;
}

/** Same try/catch discipline as the UI store's adapter — `localStorage` is
 *  absent on the server and can throw in private mode; the persisted result is
 *  a convenience cache, so failure is always silence, never a crash. No
 *  debounce: unlike the per-keystroke draft, a view writes once per run. */
const safeLocalStorage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota / private mode — local cache is convenience only */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const VALID_TARGETS = new Set<string>(TARGET_MODELS.map((m) => m.id));
const VALID_MODES = new Set<string>(MODES.map((m) => m.id));

/**
 * Shape-check a persisted view before letting it back into the app.
 *
 * Validated on EVERY rehydrate (via `merge`) rather than a versioned
 * `migrate`, because the dominant hazard is not our own schema changing — it
 * is the model roster renaming underneath a stored result (the UI store's
 * v0→v5 history). A stale `submitted.target`/`resolvedTarget` would 400 the
 * next refine, so unlike the UI store (whose preferences are worth re-keying)
 * a stale result is simply dropped: it is a convenience cache of one run, not
 * a preference. Unknown EXTRA fields pass through untouched — additive
 * `EnhanceResult` fields must survive a round-trip.
 */
function isPersistableView(v: unknown): v is EnhanceView {
  if (typeof v !== "object" || v === null) return false;
  const { submitted, result } = v as { submitted?: unknown; result?: unknown };
  if (typeof submitted !== "object" || submitted === null) return false;
  if (typeof result !== "object" || result === null) return false;
  const s = submitted as Record<string, unknown>;
  const r = result as Record<string, unknown>;
  return (
    typeof s.input === "string" &&
    typeof s.mode === "string" &&
    VALID_MODES.has(s.mode) &&
    typeof s.target === "string" &&
    VALID_TARGETS.has(s.target) &&
    (s.format === undefined ||
      (typeof s.format === "string" &&
        (FORMATS as readonly string[]).includes(s.format))) &&
    (s.length === undefined ||
      (typeof s.length === "string" &&
        (LENGTHS as readonly string[]).includes(s.length))) &&
    typeof r.output === "string" &&
    typeof r.rationale === "string" &&
    (r.diff === null || Array.isArray(r.diff)) &&
    typeof r.tokenIn === "number" &&
    typeof r.tokenOut === "number" &&
    typeof r.modelUsed === "string" &&
    typeof r.costUsd === "number" &&
    typeof r.usage === "object" &&
    r.usage !== null &&
    (r.resolvedTarget === undefined ||
      (typeof r.resolvedTarget === "string" && VALID_TARGETS.has(r.resolvedTarget)))
  );
}

/**
 * The composer's last finished enhancement, lifted OUT of component state.
 *
 * As component state it died with the route: navigating to Library or Profile
 * and back unmounted the enhance page and silently destroyed a result the
 * user had already paid tokens for (the draft survived — it lives in the UI
 * store — which made the loss read as a bug, not a rule). Persisted like the
 * draft so it also survives a reload and an iOS PWA relaunch. Server state is
 * still the source of truth for anything SAVED; this is the one artifact that
 * exists nowhere else until the user saves or copies it.
 *
 * `skipHydration`: the composer conditionally mounts the whole result tree
 * from `view`, so hydrating at module init would make the first client render
 * diverge structurally from the server HTML. ProfileHydrator rehydrates once
 * per app load, after the account check — so on a shared device another
 * account's result is wiped before it can ever render.
 */
export const useEnhanceViewStore = create<EnhanceViewState>()(
  persist(
    (set) => ({
      view: null,
      setView: (view) => set({ view }),
    }),
    {
      name: ENHANCE_VIEW_STORE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      merge: (persisted, current) => {
        const view = (persisted as { view?: unknown } | undefined)?.view;
        return { ...current, view: isPersistableView(view) ? view : null };
      },
    },
  ),
);
