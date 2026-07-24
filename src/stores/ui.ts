"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  TARGET_MODELS,
  UI_STORE_KEY,
  type ModeId,
  type TargetModelId,
  type Theme,
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
  /** In-progress editor text, preserved across nav (product-spec §2.4). */
  editorDraft: string;

  setTheme: (theme: Theme) => void;
  setActiveMode: (mode: ModeId) => void;
  setTargetModel: (model: TargetModelId) => void;
  setEditorDraft: (draft: string) => void;
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
      editorDraft: "",

      setTheme: (theme) => set({ theme }),
      setActiveMode: (activeMode) => set({ activeMode }),
      setTargetModel: (targetModel) => set({ targetModel }),
      setEditorDraft: (editorDraft) => set({ editorDraft }),
    }),
    {
      name: UI_STORE_KEY,
      storage: createJSONStorage(() => debouncedLocalStorage()),
      // v1: the 2026-07 model-roster rename (gpt_5_5 → gpt_5_6_sol,
      // gemini_pro_3_1 → gemini_3_5_thinking). v2: opus_4_8 → opus_5. A stale
      // persisted ID would 400 on /api/enhance, so map legacy values and fall
      // back to the default.
      version: 2,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<UIState>;
        const legacy: Record<string, TargetModelId> = {
          gpt_5_5: "gpt_5_6_sol",
          gemini_pro_3_1: "gemini_3_5_thinking",
          opus_4_8: "opus_5",
        };
        const valid = new Set<string>(TARGET_MODELS.map((m) => m.id));
        const t = s.targetModel as string | undefined;
        return {
          ...s,
          targetModel:
            t && valid.has(t)
              ? (t as TargetModelId)
              : ((t && legacy[t]) ?? "opus_5"),
        };
      },
      // Draft is intentionally NOT persisted as the only copy — it is a
      // convenience cache; the editor also re-hydrates from the server in P2+.
      partialize: (state) => ({
        theme: state.theme,
        activeMode: state.activeMode,
        targetModel: state.targetModel,
        editorDraft: state.editorDraft,
      }),
    },
  ),
);
