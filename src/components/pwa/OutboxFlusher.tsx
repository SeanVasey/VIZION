"use client";

import { useEffect } from "react";
import { flushOutbox, idbStore, type OutboxHandler } from "@/lib/pwa/outbox";
import { savePromptAction } from "@/lib/library/actions";

/** Replays queued offline mutations. Add a handler per outbox `kind`. */
const handlers: Record<string, OutboxHandler> = {
  "save-prompt": async (payload) => {
    const res = await savePromptAction(payload as Parameters<typeof savePromptAction>[0]);
    return res.ok;
  },
};

/**
 * Flushes the offline outbox when the app regains connectivity or returns to
 * the foreground (iOS has no reliable Background Sync). Rendered once by the
 * authenticated layout.
 */
export function OutboxFlusher() {
  useEffect(() => {
    const flush = () => {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        void flushOutbox(handlers, idbStore);
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
  }, []);

  return null;
}
