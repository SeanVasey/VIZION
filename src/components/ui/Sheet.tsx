"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet — the app's one modal overlay primitive (library filters,
 * compare drawer, attachment details, privacy notice, confirmations).
 *
 * Portaled to <body>: .glass-chrome/.glass-nav are containing blocks for
 * position:fixed descendants (their layer promotion — see globals.css), so an
 * overlay rendered inside either bar would anchor to the bar, not the
 * viewport. The scrim wrapper is the fixed element; the panel itself is
 * in-flow within it (the AvatarCropper shape), which also keeps the panel's
 * backdrop-filter off a fixed box on iOS.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // SSR guard: document doesn't exist during server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Focus in on open, restore on close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? panelRef.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [open, initialFocusRef]);

  if (!mounted || !open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // Cycle focus within the panel (dialog focus trap).
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Scrim click only — clicks inside the panel bubble with a different target.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        // Slash-opacity can't apply to var() tokens — mix explicitly (theme-swapped).
        backgroundColor: "color-mix(in srgb, var(--void) 80%, transparent)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="glass sheet-in mx-auto flex max-h-[85dvh] w-full max-w-screen-sm flex-col rounded-t-2xl focus-visible:shadow-none"
      >
        <div className="shrink-0 px-4 pt-3">
          <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-hair" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <h2
              id={titleId}
              className="font-body text-sm font-semibold uppercase tracking-wider text-chalk"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-my-1 -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-silver transition-colors hover:text-chalk"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-hair px-4 py-3 pb-safe">{footer}</div>
        )}
        {/* Safe-area padding when there's no footer strip to carry it. */}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  );
}
