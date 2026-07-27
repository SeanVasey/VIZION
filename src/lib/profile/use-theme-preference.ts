"use client";

import { useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { updateProfileAction, type ActionResult } from "@/lib/profile/actions";
import type { Theme } from "@/lib/constants";

/**
 * Set the theme locally (immediate, optimistic — theme is also a device
 * preference) and persist it through THE settings write path
 * (`updateProfileAction`), not a raw fire-and-forget client write (2026-07
 * UX audit: one persistence model). `onResult` lets the Settings screen show
 * per-control status; the header toggle passes nothing and stays quiet — a
 * failed sync keeps the local value, same net behavior as before but honest
 * when a caller wants to know.
 */
export function useSetTheme(onResult?: (res: ActionResult) => void) {
  const setThemeLocal = useUIStore((s) => s.setTheme);

  return useCallback(
    (theme: Theme) => {
      setThemeLocal(theme);
      updateProfileAction({ theme })
        .then((res) => onResult?.(res))
        .catch(() =>
          onResult?.({ ok: false, error: "Saved on this device — couldn't sync." }),
        );
    },
    [setThemeLocal, onResult],
  );
}
