"use client";

import { useEffect } from "react";
import {
  flushOutbox,
  idbStore,
  type OutboxHandler,
  type OutboxOutcome,
} from "@/lib/pwa/outbox";
import { savePromptAction } from "@/lib/library/actions";
import { MODES, TARGET_MODELS } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";

const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

/**
 * Runtime shape guard for a persisted save-prompt payload (Q10 / TYP-002).
 * IndexedDB hands back whatever an OLD build wrote — casting it into
 * `savePromptAction`'s input let a payload with no `input` throw inside the
 * handler on every foreground event forever. A payload that fails this check
 * can never succeed on any flush: it parks as poison instead of retrying.
 */
function isSavePromptPayload(p: unknown): boolean {
  if (typeof p !== "object" || p === null) return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.input === "string" &&
    typeof r.output === "string" &&
    typeof r.mode === "string" &&
    MODE_IDS.has(r.mode) &&
    typeof r.target === "string" &&
    TARGET_IDS.has(r.target) &&
    typeof r.modelUsed === "string" &&
    typeof r.tokenIn === "number" &&
    typeof r.tokenOut === "number"
  );
}

/** Replays queued offline mutations. Add a handler per outbox `kind`. */
const handlers: Record<string, OutboxHandler> = {
  "save-prompt": async (payload): Promise<OutboxOutcome> => {
    if (!isSavePromptPayload(payload)) return "poison";
    const res = await savePromptAction(payload as Parameters<typeof savePromptAction>[0]);
    // `duplicate` counts as drained. It means this exact content is already in
    // the library — the end state the replay was trying to reach. Returning
    // ok alone left such an item in the store forever: every `online` and
    // every `visibilitychange` retried it, and it could never succeed, because
    // the duplicate check is what was rejecting it.
    if (res.ok || res.duplicate) return "done";
    // A structured rejection: the server answered and said no (validation, an
    // expired session, a write error). Bounded retries absorb a transient DB
    // wobble; the attempts cap parks a payload the server will never accept.
    return "failed";
  },
};

/**
 * Flushes the offline outbox when the app regains connectivity or returns to
 * the foreground (iOS has no reliable Background Sync). Rendered once by the
 * authenticated layout.
 */
export function OutboxFlusher({ userId }: { userId: string }) {
  const { toast } = useToast();

  useEffect(() => {
    // Re-entrancy guard: `online` and `visibilitychange` often fire together
    // (returning to a foregrounded tab that just reconnected) and two
    // concurrent flushes over the same items would duplicate saves —
    // savePromptAction is not idempotent.
    let flushing = false;

    const run = () =>
      flushOutbox(userId, handlers, idbStore)
        .then((result) => {
          if (result.parked > 0) {
            // Surface the broken promise ONCE per parking, not per flush:
            // "Queued — syncs when online" has stopped being true for these.
            toast({
              tone: "error",
              text:
                result.parked === 1
                  ? "A queued save couldn't sync and was set aside — it stays on this device."
                  : `${result.parked} queued saves couldn't sync and were set aside — they stay on this device.`,
            });
          }
        })
        .catch(() => {});

    const flush = () => {
      if (flushing) return;
      if (typeof navigator === "undefined" || !navigator.onLine) return;
      flushing = true;
      // Cross-TAB mutual exclusion (LIB-004): the per-tab `flushing` flag
      // cannot see a second open tab, and the IndexedDB store is
      // origin-shared — two tabs both receiving `online` used to replay the
      // same item concurrently and mint two identical cards. Web Locks holds
      // one flush per origin; `ifAvailable` skips instead of queueing (the
      // other tab is already doing the work). Browsers without the API keep
      // the per-tab guard plus the server-side hash re-check.
      const locks = (
        navigator as Navigator & {
          locks?: {
            request: (
              name: string,
              opts: { ifAvailable: boolean },
              cb: (lock: unknown) => Promise<void>,
            ) => Promise<void>;
          };
        }
      ).locks;
      const job = locks
        ? locks.request("vizion-outbox-flush", { ifAvailable: true }, async (lock) => {
            if (lock) await run();
          })
        : run();
      void Promise.resolve(job)
        .catch(() => {})
        .finally(() => {
          flushing = false;
        });
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
  }, [userId, toast]);

  return null;
}
