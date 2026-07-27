"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  LEGACY_TARGET_IDS,
  TARGET_MODELS,
  TARGET_THINKING_LEVELS,
  UI_STORE_KEY,
  type ModeId,
  type TargetModelId,
  type Theme,
  type ThinkingLevel,
} from "@/lib/constants";

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
  theme: Theme;
  activeMode: ModeId;
  targetModel: TargetModelId;
  /** Chosen reasoning depth PER TARGET (only for targets with a knob —
   *  TARGET_THINKING_LEVELS). No entry = "Auto" = provider default. */
  thinkingLevels: Partial<Record<TargetModelId, ThinkingLevel>>;
  /** In-progress editor text, preserved across nav (product-spec §2.4). */
  editorDraft: string;
  /** The media privacy notice has been acknowledged on this device. */
  mediaNoticeAcknowledged: boolean;
  /** Whether new attachments upload to storage (false = analyze without
   *  keeping — the ephemeral path never uploads). */
  mediaStoreByDefault: boolean;

  setTheme: (theme: Theme) => void;
  setActiveMode: (mode: ModeId) => void;
  setTargetModel: (model: TargetModelId) => void;
  /** `null` clears back to Auto. */
  setThinkingLevel: (target: TargetModelId, level: ThinkingLevel | null) => void;
  setEditorDraft: (draft: string) => void;
  setMediaNoticeAcknowledged: (v: boolean) => void;
  setMediaStoreByDefault: (v: boolean) => void;
}

/**
 * Lightweight UI/local state (FINAL_PLAN D4).  Persisted to localStorage purely
 * for convenience — none of this is authoritative; server state (P2+) wins.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      activeMode: "clarify",
      targetModel: "opus_5",
      thinkingLevels: {},
      editorDraft: "",
      mediaNoticeAcknowledged: false,
      mediaStoreByDefault: true,

      setTheme: (theme) => set({ theme }),
      setActiveMode: (activeMode) => set({ activeMode }),
      setTargetModel: (targetModel) => set({ targetModel }),
      setThinkingLevel: (target, level) =>
        set((s) => {
          const thinkingLevels = { ...s.thinkingLevels };
          if (level === null) delete thinkingLevels[target];
          else thinkingLevels[target] = level;
          return { thinkingLevels };
        }),
      setEditorDraft: (editorDraft) => set({ editorDraft }),
      setMediaNoticeAcknowledged: (mediaNoticeAcknowledged) =>
        set({ mediaNoticeAcknowledged }),
      setMediaStoreByDefault: (mediaStoreByDefault) => set({ mediaStoreByDefault }),
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
      // — pass-through defaults, no re-keying.
      version: 6,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<UIState>;
        const valid = new Set<string>(TARGET_MODELS.map((m) => m.id));
        const t = s.targetModel as string | undefined;

        // Re-key per-target levels across renames; drop entries whose target
        // or level no longer exists (a stale level would 400 on /api/enhance).
        const thinkingLevels: Partial<Record<TargetModelId, ThinkingLevel>> = {};
        for (const [key, level] of Object.entries(s.thinkingLevels ?? {})) {
          const id = valid.has(key) ? (key as TargetModelId) : LEGACY_TARGET_IDS[key];
          if (!id || typeof level !== "string") continue;
          if ((TARGET_THINKING_LEVELS[id] as readonly string[] | undefined)?.includes(level)) {
            thinkingLevels[id] = level as ThinkingLevel;
          }
        }

        return {
          ...s,
          targetModel:
            t && valid.has(t)
              ? (t as TargetModelId)
              : ((t && LEGACY_TARGET_IDS[t]) ?? "opus_5"),
          thinkingLevels,
          mediaNoticeAcknowledged: s.mediaNoticeAcknowledged ?? false,
          mediaStoreByDefault: s.mediaStoreByDefault ?? true,
        };
      },
      // Draft is intentionally NOT persisted as the only copy — it is a
      // convenience cache; the editor also re-hydrates from the server in P2+.
      partialize: (state) => ({
        theme: state.theme,
        activeMode: state.activeMode,
        targetModel: state.targetModel,
        thinkingLevels: state.thinkingLevels,
        editorDraft: state.editorDraft,
        mediaNoticeAcknowledged: state.mediaNoticeAcknowledged,
        mediaStoreByDefault: state.mediaStoreByDefault,
      }),
    },
  ),
);
