"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";
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
    // The last enhancement result rides the same shared-device rule as the
    // draft. Its store skips hydration (SSR — see the store's header), so this
    // is the once-per-load rehydrate; wiping storage FIRST on an account
    // change means the previous user's result is unrecoverable by then, not
    // merely cleared after it was already read into memory.
    if (accountChanged) useEnhanceViewStore.persist.clearStorage();
    void useEnhanceViewStore.persist.rehydrate();
  }, [theme, defaultModel, userId]);

  return null;
}
