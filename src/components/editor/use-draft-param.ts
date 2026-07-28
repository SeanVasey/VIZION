"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import { useToast } from "@/components/ui/Toast";
import { resolveDraftParam } from "@/lib/pwa/draft-param";

/**
 * Consume a `?draft=` prefill exactly once per page load.
 *
 * One-shot by two separate mechanisms, because either alone would leak:
 *  - a ref guards against React's double-invoked effects in dev StrictMode and
 *    against any re-render, and
 *  - the param is stripped from the URL with `replaceState`, so a reload — or
 *    the browser restoring the tab — doesn't re-apply a prompt the user has
 *    since edited or cleared.
 *
 * Reads `location` directly rather than `useSearchParams`, which would opt the
 * whole page into a Suspense boundary for a value only needed once on mount.
 */
export function useDraftParam() {
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const { toast } = useToast();
  const consumed = useRef(false);
  // The draft is read once at mount; a later keystroke must not re-trigger.
  const draftRef = useRef(editorDraft);
  draftRef.current = editorDraft;

  useEffect(() => {
    if (consumed.current || typeof window === "undefined") return;
    consumed.current = true;

    const url = new URL(window.location.href);
    const outcome = resolveDraftParam(url.searchParams.get("draft"), draftRef.current);
    if (url.searchParams.has("draft")) {
      // Strip it whatever the outcome — including when it was rejected, so a
      // too-long or empty param doesn't sit in the address bar looking live.
      url.searchParams.delete("draft");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    if (outcome.kind === "apply") {
      setEditorDraft(outcome.text);
      return;
    }
    if (outcome.kind === "conflict") {
      // Offer, don't take. The composer already holds something the user
      // typed; a link should never be able to overwrite it silently.
      const incoming = outcome.text;
      const previous = draftRef.current;
      toast({
        text: "A prompt was shared to VIZ(IO)N",
        action: {
          label: "Replace draft",
          onAction: () => {
            setEditorDraft(incoming);
            toast({
              text: "Draft replaced",
              action: {
                label: "Undo",
                onAction: () => setEditorDraft(previous),
              },
            });
          },
        },
      });
    }
    // Mount-only: the prefill belongs to this navigation, not to later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
