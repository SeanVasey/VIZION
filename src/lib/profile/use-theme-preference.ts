"use client";

import { useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { createClient } from "@/lib/supabase/client";
import type { Theme } from "@/lib/constants";

/**
 * Set the theme locally (immediate) and, for a signed-in user, persist it to
 * their profile so it follows them across devices. The DB write is best-effort
 * and never blocks the UI; RLS confines it to the owner row.
 */
export function useSetTheme() {
  const setThemeLocal = useUIStore((s) => s.setTheme);

  return useCallback(
    (theme: Theme) => {
      setThemeLocal(theme);
      const supabase = createClient();
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          void supabase.from("profiles").update({ theme }).eq("user_id", session.user.id);
        }
      });
    },
    [setThemeLocal],
  );
}
