"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import type { Theme, TargetModelId } from "@/lib/constants";

/**
 * Applies the user's saved preferences (theme + default model) to the local UI
 * store once per app load, so a fresh device reflects their account. Rendered by
 * the authenticated layout, which mounts once — subsequent in-app navigations
 * don't re-run it, so live local toggles aren't clobbered.
 */
export function ProfileHydrator({
  theme,
  defaultModel,
  userId,
}: {
  theme: Theme;
  defaultModel: TargetModelId;
  userId: string;
}) {
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const previous = useUIStore.getState().userId;
    // `localStorage` is scoped to the ORIGIN, not to a session, so on a shared
    // device the persisted `editorDraft` survives a sign-out and reappears in
    // the next account's composer. A different id here is the only signal that
    // happened. `previous === null` is a first load (or state from a build
    // before this existed) — adopt the account rather than destroying a draft
    // that probably belongs to it.
    const accountChanged = previous !== null && previous !== userId;
    useUIStore.setState({
      theme,
      targetModel: defaultModel,
      userId,
      ...(accountChanged ? { editorDraft: "" } : {}),
    });
  }, [theme, defaultModel, userId]);

  return null;
}
