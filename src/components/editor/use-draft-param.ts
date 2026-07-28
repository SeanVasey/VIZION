"use client";

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/stores/ui";
import { resolveDraftParam } from "@/lib/pwa/draft-param";

/**
 * Consume a `?draft=` prefill exactly once per page load.
 *
 * Applies straight into an empty composer. When the composer already holds
 * work it does NOT apply and does NOT discard — it returns the incoming text
 * so the composer can offer it as a persistent banner.
 *
 * The offer deliberately has no deadline and the parameter is deliberately
 * NOT stripped while one is outstanding. An earlier version put the offer in
 * a toast and stripped the URL immediately, which meant the shared prompt
 * existed nowhere after six seconds — not the URL, not history, not the
 * store — and a single unrelated toast could evict it sooner. Avoiding a
 * clobber of the old draft by silently destroying the new one is not a
 * trade; leaving the param in place makes the offer survive a reload, a
 * backgrounded PWA, and anything else that takes longer than a toast.
 *
 * One-shot within a page load via a ref, which survives StrictMode's
 * double-invoked effects. Reads `location` directly rather than
 * `useSearchParams`, which would opt the page into a Suspense boundary for a
 * value needed once on mount.
 */
export function useDraftParam(): {
  /** Incoming text awaiting a decision, or null. */
  pending: string | null;
  /** Take it — the caller is responsible for any undo affordance. */
  accept: () => void;
  /** Decline it, and clear the parameter for good. */
  dismiss: () => void;
} {
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const [pending, setPending] = useState<string | null>(null);
  const consumed = useRef(false);

  /** Drop `draft` from the address bar without touching anything else. */
  function stripParam() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("draft")) return;
    url.searchParams.delete("draft");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    if (consumed.current || typeof window === "undefined") return;
    consumed.current = true;

    const param = new URL(window.location.href).searchParams.get("draft");
    // Read the store directly rather than a render-captured value: the
    // persisted draft rehydrates synchronously at store creation, so this is
    // the real current draft at mount.
    const outcome = resolveDraftParam(param, useUIStore.getState().editorDraft);

    if (outcome.kind === "apply") {
      setEditorDraft(outcome.text);
      stripParam();
      return;
    }
    if (outcome.kind === "conflict") {
      // Hand it up; the param stays until the user decides.
      setPending(outcome.text);
      return;
    }
    // Nothing usable — clear it so a rejected value doesn't sit in the
    // address bar looking live.
    stripParam();
    // Mount-only: the prefill belongs to this navigation, not to later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pending,
    accept: () => {
      if (pending === null) return;
      setEditorDraft(pending);
      setPending(null);
      stripParam();
    },
    dismiss: () => {
      setPending(null);
      stripParam();
    },
  };
}
