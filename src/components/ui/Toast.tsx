"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface ToastOptions {
  text: string;
  /** Optional action (e.g. Undo). Runs, then dismisses the toast. */
  action?: { label: string; onAction: () => void };
  tone?: "default" | "error";
  durationMs?: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const DEFAULT_DURATION_MS = 6000;

/**
 * One transient toast at a time (newest wins — queueing stale confirmations
 * helps nobody). Portaled to <body> and anchored above the bottom nav via the
 * shared --bottom-nav-h token, so clearance tracks the nav by construction.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);
  /** When the armed dismissal would fire — lets a suspension compute the
   *  remainder without asking the timer. */
  const deadlineRef = useRef(0);
  /** Non-null while the countdown is SUSPENDED under a live hold-gesture:
   *  the milliseconds still owed, re-armed when the gesture releases. The
   *  hold-slider freezes the world (`data-hold-gesture`) and pauses this
   *  card's `.sheet-in` entrance with it — a toast arriving mid-gesture
   *  waits invisibly at its first frame. The clock must wait WITH it
   *  (twenty-first pass): pre-fix the dismissal timer kept counting, so a
   *  long hold expired an error or Undo toast that was never once visible,
   *  and any hold shaved the action's window. The sr-only announcement is
   *  immediate either way; only the visual card and its countdown defer. */
  const suspendedMsRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * Dismiss the toast — but only if it is still the one showing.
   *
   * The id guard matters because an action may queue a FOLLOW-UP toast (the
   * "Draft replaced · Undo" that answers a "Replace draft?" offer). The action
   * runs before the dismiss, so an unguarded dismiss would wipe the
   * replacement the action had just posted, and the Undo would never be
   * offered. Passing no id means "dismiss whatever is showing" (the close
   * affordance).
   */
  const dismiss = useCallback((id?: number) => {
    if (id !== undefined && id !== idRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    suspendedMsRef.current = null;
    setCurrent(null);
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      suspendedMsRef.current = null;
      idRef.current += 1;
      const id = idRef.current;
      setCurrent({ ...opts, id });
      const ms = opts.durationMs ?? DEFAULT_DURATION_MS;
      // Born under a live gesture: start suspended with the full window
      // (see suspendedMsRef) — the observer below arms it on release.
      if (document.documentElement.hasAttribute("data-hold-gesture")) {
        suspendedMsRef.current = ms;
      } else {
        deadlineRef.current = Date.now() + ms;
        timerRef.current = setTimeout(() => dismiss(id), ms);
      }
    },
    [dismiss],
  );

  // Suspend/resume the countdown with the hold-gesture's world-freeze. An
  // attribute observer, deliberately: the toast must not import gesture
  // internals, and the attribute IS the freeze's public contract (the CSS
  // pause rules key off the same thing).
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (root.hasAttribute("data-hold-gesture")) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          suspendedMsRef.current = Math.max(0, deadlineRef.current - Date.now());
        }
      } else if (suspendedMsRef.current !== null) {
        const ms = suspendedMsRef.current;
        suspendedMsRef.current = null;
        const id = idRef.current;
        deadlineRef.current = Date.now() + ms;
        timerRef.current = setTimeout(() => dismiss(id), ms);
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-hold-gesture"] });
    return () => observer.disconnect();
  }, [dismiss]);

  // Clear any pending timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Permanently-mounted live regions (A11Y-004): a role="status" node
          inserted already carrying its text is not reliably announced — the
          repo's own FieldStatus rule, now applied to the toasts that carry
          the ONLY feedback for delete/Undo and copy failures. Text lands
          here as a mutation; the visual card below is aria-hidden so the
          message is never announced twice. Two regions because tone=error
          must be assertive while confirmations stay polite. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {current && current.tone !== "error"
          ? `${current.text}${current.action ? ` — ${current.action.label} available` : ""}`
          : ""}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {current && current.tone === "error" ? current.text : ""}
      </div>
      {mounted &&
        current &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-4 z-[80] flex justify-center"
            style={{
              bottom:
                "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + var(--float-gap))",
            }}
          >
            {/* No live-region ROLE here (the sr-only regions above announce)
                and no aria-hidden either — the action button must stay in
                the accessibility tree or Undo would be sighted-only. */}
            <div className="glass sheet-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl py-2 pl-4 pr-2">
              <p
                className={`font-body min-w-0 grow text-sm ${
                  current.tone === "error" ? "text-flare" : "text-text"
                }`}
              >
                {current.text}
              </p>
              {current.action && (
                <button
                  type="button"
                  onClick={() => {
                    const shownId = current.id;
                    current.action?.onAction();
                    // Scoped to the toast that was clicked: if the action
                    // posted a follow-up, that one survives.
                    dismiss(shownId);
                  }}
                  className="font-body flex min-h-[44px] shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-accent transition-colors hover:text-chalk"
                >
                  {current.action.label}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
