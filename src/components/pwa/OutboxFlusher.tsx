"use client";

import { useEffect } from "react";
import { flushOutbox, idbStore, type OutboxHandler } from "@/lib/pwa/outbox";
import { savePromptAction } from "@/lib/library/actions";

/** Replays queued offline mutations. Add a handler per outbox `kind`. */
const handlers: Record<string, OutboxHandler> = {
  "save-prompt": async (payload) => {
    const res = await savePromptAction(payload as Parameters<typeof savePromptAction>[0]);
    // `duplicate` counts as drained. It means this exact content is already in
    // the library — the end state the replay was trying to reach. Returning
    // `res.ok` alone left such an item in the store forever: every `online` and
    // every `visibilitychange` retried it, and it could never succeed, because
    // the duplicate check is what was rejecting it.
    return res.ok || Boolean(res.duplicate);
  },
};

/**
 * Flushes the offline outbox when the app regains connectivity or returns to
 * the foreground (iOS has no reliable Background Sync). Rendered once by the
 * authenticated layout.
 */
export function OutboxFlusher({ userId }: { userId: string }) {
  useEffect(() => {
    // Re-entrancy guard: `online` and `visibilitychange` often fire together
    // (returning to a foregrounded tab that just reconnected) and two
    // concurrent flushes over the same items would duplicate saves —
    // savePromptAction is not idempotent.
    let flushing = false;
    const flush = () => {
      if (flushing) return;
      if (typeof navigator !== "undefined" && navigator.onLine) {
        flushing = true;
        // Never let an IndexedDB failure surface as an unhandled rejection.
        void flushOutbox(userId, handlers, idbStore)
          .catch(() => {})
          .finally(() => {
            flushing = false;
          });
      }
    };
    flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return null;
}
