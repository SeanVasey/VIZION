"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  UI_STORE_KEY,
  type ModeId,
  type TargetModelId,
  type Theme,
} from "@/lib/constants";

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
      targetModel: "opus_4_8",
      editorDraft: "",

      setTheme: (theme) => set({ theme }),
      setActiveMode: (activeMode) => set({ activeMode }),
      setTargetModel: (targetModel) => set({ targetModel }),
      setEditorDraft: (editorDraft) => set({ editorDraft }),
    }),
    {
      name: UI_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
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
