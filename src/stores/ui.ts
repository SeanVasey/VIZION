"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  LEGACY_TARGET_IDS,
  TARGET_MODELS,
  THINKING_LADDER,
  UI_STORE_KEY,
  normalizeThinkingLevel,
  type AutoPreference,
  type ModeId,
  type TargetModelId,
  type Theme,
  type ThinkingLadderLevel,
  type ThinkingLevel,
} from "@/lib/constants";
import type { FormatId } from "@/lib/enhance/formats";
import type { LengthId } from "@/lib/enhance/lengths";

/**
 * A localStorage adapter that debounces writes. The editor draft persists on
 * every keystroke; synchronous `localStorage.setItem` per keystroke causes
 * input jank on mobile, so we coalesce writes and flush on hide/pagehide so a
 * backgrounded tab never loses the latest value.
 */
function debouncedLocalStorage(delay = 400): StateStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { key: string; value: string } | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      try {
        localStorage.setItem(pending.key, pending.value);
      } catch {
        /* quota / private mode — local cache is convenience only */
      }
      pending = null;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      pending = { key, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

interface UIState {
  /**
   * The account this persisted state belongs to, set by `ProfileHydrator`.
   *
   * Two jobs. It scopes the offline outbox, which is keyed to the ORIGIN in
   * IndexedDB and would otherwise replay one account's queued draft into
   * whoever signs in next. And because it is persisted, a mismatch on hydrate
   * is how a shared device notices that the account changed and drops the
   * previous user's `editorDraft` — `localStorage` is origin-scoped too.
   *
   * Null before the first hydrate (and for state written by an earlier build).
   */
  userId: string | null;
  theme: Theme;
  activeMode: ModeId;
  targetModel: TargetModelId;
  /** The ONE chosen reasoning depth, for every model (ADR-0018). Null =
   *  "Auto" = the route resolves a task-shaped default. Was a per-target
   *  record until 2026-09; switching models then silently changed the
   *  effort under the same dial, which is the mismatch the single value
   *  removes. */
  thinkingLevel: ThinkingLadderLevel | null;
  /** In-progress editor text, preserved across nav (product-spec §2.4). */
  editorDraft: string;
  /** The media privacy notice has been acknowledged on this device. */
  mediaNoticeAcknowledged: boolean;
  /** Whether new attachments upload to storage (false = analyze without
   *  keeping — the ephemeral path never uploads). */
  mediaStoreByDefault: boolean;
  /** Suppress the ambient effects (NEBULA+ blooms, particle field, shimmer)
   *  on this device — a performance/comfort knob independent of reduced-motion. */
  reducedEffects: boolean;
  /** Let the server pick the model per run. `targetModel` stays whatever the
   *  user last chose and rides along as the fallback — turning Auto off must
   *  return them to their own pick, not to a default. Once per LOAD,
   *  ProfileHydrator overrides this from the account's stored default: a
   *  concrete `profiles.default_model` starts the load with Auto off, a
   *  cleared one (null) starts it on Auto (owner decision, 2026-08-15 —
   *  Settings is authoritative for what the app opens on). */
  autoTarget: boolean;
  /** How Auto weighs strength against price (quality / balanced / budget).
   *  Device-local like reducedEffects — a tuning knob, not identity — and
   *  meaningful only while `autoTarget` is on; it rides the request beside
   *  `auto: true` and the server owns what each preset means. */
  autoPreference: AutoPreference;
  /** The composer's dial how-to line has been read or used (ADR-0014). Set
   *  by the "Got it" button OR by the first dial commit — a hint that has
   *  been proven unnecessary retires itself. Device-local: it is a hint, not
   *  identity, and showing it once more on a second device costs nothing. */
  dialTipSeen: boolean;
  /** Reformat's chosen output shape. `null` = "whichever fits", the behaviour
   *  before the rail existed. */
  reformatFormat: FormatId | null;
  /** How far Condense / Expand should go. Keyed by mode like thinkingLevels
   *  is keyed by target: the two modes' dials mean opposite things, so they
   *  must not share one stored value. */
  lengthByMode: Partial<Record<ModeId, LengthId>>;

  setTheme: (theme: Theme) => void;
  setActiveMode: (mode: ModeId) => void;
  setTargetModel: (model: TargetModelId) => void;
  /** `null` clears back to Auto. */
  setThinkingLevel: (level: ThinkingLadderLevel | null) => void;
  setEditorDraft: (draft: string) => void;
  setMediaNoticeAcknowledged: (v: boolean) => void;
  setMediaStoreByDefault: (v: boolean) => void;
  setReducedEffects: (v: boolean) => void;
  setAutoTarget: (v: boolean) => void;
  setAutoPreference: (v: AutoPreference) => void;
  setDialTipSeen: (v: boolean) => void;
  setReformatFormat: (v: FormatId | null) => void;
  /** `null` clears back to the mode's own default. */
  setLengthForMode: (mode: ModeId, length: LengthId | null) => void;
}

/**
 * Lightweight UI/local state (FINAL_PLAN D4).  Persisted to localStorage purely
 * for convenience — none of this is authoritative; server state (P2+) wins.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      userId: null,
      theme: "system",
      activeMode: "clarify",
      targetModel: "opus_5",
      thinkingLevel: null,
      editorDraft: "",
      mediaNoticeAcknowledged: false,
      mediaStoreByDefault: true,
      reducedEffects: false,
      autoTarget: false,
      autoPreference: "balanced",
      dialTipSeen: false,
      reformatFormat: null,
      lengthByMode: {},

      setTheme: (theme) => set({ theme }),
      setActiveMode: (activeMode) => set({ activeMode }),
      setTargetModel: (targetModel) => set({ targetModel }),
      setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
      setEditorDraft: (editorDraft) => set({ editorDraft }),
      setMediaNoticeAcknowledged: (mediaNoticeAcknowledged) =>
        set({ mediaNoticeAcknowledged }),
      setMediaStoreByDefault: (mediaStoreByDefault) => set({ mediaStoreByDefault }),
      setReducedEffects: (reducedEffects) => set({ reducedEffects }),
      setAutoTarget: (autoTarget) => set({ autoTarget }),
      setAutoPreference: (autoPreference) => set({ autoPreference }),
      setDialTipSeen: (dialTipSeen) => set({ dialTipSeen }),
      setReformatFormat: (reformatFormat) => set({ reformatFormat }),
      setLengthForMode: (mode, length) =>
        set((s) => {
          const lengthByMode = { ...s.lengthByMode };
          if (length === null) delete lengthByMode[mode];
          else lengthByMode[mode] = length;
          return { lengthByMode };
        }),
    }),
    {
      name: UI_STORE_KEY,
      storage: createJSONStorage(() => debouncedLocalStorage()),
      // v1: the 2026-07 model-roster rename (gpt_5_5 → gpt_5_6_sol,
      // gemini_pro_3_1 → gemini_3_5_thinking). v2: opus_4_8 → opus_5.
      // v3: llama_4_maverick → muse_spark_1_1. v4: kimi_k2_6 → kimi_k3,
      // minimax_m2_7 → minimax_m3. v5: gemini_3_5_thinking →
      // gemini_3_6_flash + per-target thinkingLevels. A stale persisted ID
      // would 400 on /api/enhance, so map legacy values and fall back to the
      // default; stale thinking selections are re-keyed or dropped the same way.
      // v6: media privacy prefs (mediaNoticeAcknowledged, mediaStoreByDefault)
      // — pass-through defaults, no re-keying. v7: the per-target
      // `thinkingLevels` record collapses to ONE `thinkingLevel` (ADR-0018);
      // the pinned target's own entry carries over, folded onto the ladder,
      // and the 2026-09 roster renames (fable_5 → fable_5_1 …) re-key the
      // target through LEGACY_TARGET_IDS like every rename before them.
      version: 7,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<UIState> & {
          thinkingLevels?: Record<string, unknown>;
        };
        const valid = new Set<string>(TARGET_MODELS.map((m) => m.id));
        const t = s.targetModel as string | undefined;
        const targetModel: TargetModelId =
          t && valid.has(t)
            ? (t as TargetModelId)
            : ((t ? LEGACY_TARGET_IDS[t] : undefined) ?? "opus_5");

        // The single level: a v7 value passes through (re-validated against
        // the ladder); a pre-v7 record contributes the entry for the target
        // the store lands on, keyed by either its current or its renamed id.
        // Anything else — another target's dial, a stale value — is dropped:
        // null is Auto, which is the safe default.
        let level: unknown = s.thinkingLevel;
        if (level === undefined && s.thinkingLevels) {
          for (const [key, value] of Object.entries(s.thinkingLevels)) {
            const id = valid.has(key) ? key : LEGACY_TARGET_IDS[key];
            if (id === targetModel) level = value;
          }
        }
        const ladder = THINKING_LADDER as readonly string[];
        const wire = new Set<string>([
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ]);
        const thinkingLevel =
          typeof level === "string" && wire.has(level)
            ? normalizeThinkingLevel(level as ThinkingLevel)
            : null;

        const { thinkingLevels: _dropped, ...rest } = s;
        void _dropped;
        return {
          ...rest,
          targetModel,
          thinkingLevel:
            thinkingLevel && ladder.includes(thinkingLevel) ? thinkingLevel : null,
          mediaNoticeAcknowledged: s.mediaNoticeAcknowledged ?? false,
          mediaStoreByDefault: s.mediaStoreByDefault ?? true,
        };
      },
      // Draft is intentionally NOT persisted as the only copy — it is a
      // convenience cache; the editor also re-hydrates from the server in P2+.
      partialize: (state) => ({
        // Persisted so the NEXT load can tell whether the account changed on
        // this device. Absent key -> initial null under the shallow merge, so
        // no version bump: a first load after this ships simply adopts the
        // signed-in account without clearing anything.
        userId: state.userId,
        theme: state.theme,
        activeMode: state.activeMode,
        targetModel: state.targetModel,
        thinkingLevel: state.thinkingLevel,
        editorDraft: state.editorDraft,
        mediaNoticeAcknowledged: state.mediaNoticeAcknowledged,
        mediaStoreByDefault: state.mediaStoreByDefault,
        // reducedEffects rides the shallow merge: a persisted state without
        // the key falls back to the initial `false` — no version bump needed.
        reducedEffects: state.reducedEffects,
        // autoTarget follows the reducedEffects precedent: a persisted state
        // without the key falls back to the initial `false`, so no version
        // bump. Off by default — routing is opt-in, never a surprise.
        autoTarget: state.autoTarget,
        // Same shallow-merge story: absent key -> initial "balanced". A stale
        // persisted value is harmless — the server validates the wire value
        // and treats anything unknown as a 400, never a silent reroute.
        autoPreference: state.autoPreference,
        // Same shallow-merge story again: absent key -> initial `false`, so a
        // user upgrading into ADR-0014 is shown the new dials' how-to line
        // exactly once. No version bump — that is the whole point of landing
        // it as a pass-through default.
        dialTipSeen: state.dialTipSeen,
        // Same shallow-merge story as autoTarget: absent key -> initial null.
        reformatFormat: state.reformatFormat,
        // Absent key -> initial {} under the shallow merge, same as above.
        lengthByMode: state.lengthByMode,
      }),
    },
  ),
);
