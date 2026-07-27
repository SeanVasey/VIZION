"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { tap } from "@/lib/haptics";

/** How long a control shows its "Copied ✓" state. */
const COPIED_MS = 1500;

/**
 * The one clipboard-write path. Five surfaces had hand-rolled copies of this
 * (each with its own `copied` flag and timeout), and two of them swallowed
 * failures silently — leaving the user believing they had copied something
 * they hadn't. Surfacing beats silence, everywhere.
 *
 * Returns `copied` for the button label and `copy()` which resolves to whether
 * the write actually landed.
 */
export function useCopy(): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A control unmounted mid-flash (a sheet closing) must not set state later.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        tap();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
        return true;
      } catch {
        toast({
          tone: "error",
          text: "Couldn't copy — your browser blocked clipboard access. Select the text and copy manually.",
        });
        return false;
      }
    },
    [toast],
  );

  return { copied, copy };
}
