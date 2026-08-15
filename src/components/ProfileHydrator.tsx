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
 *
 * The Settings choice is AUTHORITATIVE for what a load starts on (owner
 * decision, 2026-08-15): a stored default model populates with Auto off; a
 * cleared default (`null`) starts the load on Auto. Both branches deliberately
 * override the device's persisted `autoTarget` — that is what makes the
 * setting mean "what the app opens on" rather than "a fallback the device may
 * ignore". Mid-session the composer's own toggles still rule; this runs once.
 * Under `null` the persisted `targetModel` is left alone: it is Auto's
 * fallback id, and turning Auto off mid-session must return the user to their
 * own last pick (the store's contract), not to anything stored here.
 */
export function ProfileHydrator({
  theme,
  defaultModel,
  userId,
}: {
  theme: Theme;
  /** `null` = no stored default — the load starts on Auto. */
  defaultModel: TargetModelId | null;
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
      userId,
      ...(defaultModel === null
        ? { autoTarget: true }
        : { targetModel: defaultModel, autoTarget: false }),
      ...(accountChanged ? { editorDraft: "" } : {}),
    });
    // The last enhancement result rides the same shared-device rule as the
    // draft. Its store skips hydration (SSR — see the store's header), so this
    // is the once-per-load rehydrate; wiping storage FIRST on an account
    // change means the previous user's result is unrecoverable by then, not
    // merely cleared after it was already read into memory.
    if (accountChanged) useEnhanceViewStore.persist.clearStorage();
    void useEnhanceViewStore.persist.rehydrate();
    // Belt over the wipe's braces (a Codex catch on PR #85): the one-time
    // clearStorage can't stop a previous account's STILL-OPEN tab from
    // re-writing its view afterwards — any revert toggle re-persists it. The
    // envelope therefore carries its owner, and a mismatch is dropped here,
    // where the authoritative id lives. Null adopts (pre-stamp state), the
    // UI store's own rule.
    const viewStore = useEnhanceViewStore.getState();
    if (viewStore.userId !== null && viewStore.userId !== userId) {
      viewStore.setView(null);
    }
  }, [theme, defaultModel, userId]);

  return null;
}
