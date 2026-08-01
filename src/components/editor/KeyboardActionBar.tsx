"use client";

import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useKeyboardInset } from "@/components/nav/use-keyboard-inset";

/**
 * The composer's ENHANCE action, kept reachable while the software keyboard is
 * open (2026-07 product review, P0). On iOS the keyboard covers the bottom of
 * the page without resizing the layout viewport, so the real rail — and the
 * primary action with it — sits behind the keyboard exactly when the user is
 * typing into the field above it.
 *
 * Two constraints shape this:
 * - PORTALED to <body>. The composer chassis is `overflow-hidden` (it would
 *   clip this), and the glass chrome bars are containing blocks for fixed
 *   descendants — the same rule that governs Sheet.
 * - `bottom: <inset>px`, never `bottom: 0`. A fixed element anchors to the
 *   LAYOUT viewport, which is the documented floating-chrome bug; the visual
 *   viewport inset is the correction.
 *
 * Renders nothing when no keyboard is detected (desktop, jsdom, server), so
 * the bottom nav — which hides under the same signal — never collides with it.
 */
// Memoized: nested in the composer with a now-stable `onEnhance` (useCallback).
// During a stream its display props (pending/tokens) hold steady, so the memo
// spares it the per-flush reconciliation (PERF-006).
export const KeyboardActionBar = memo(KeyboardActionBarImpl);

function KeyboardActionBarImpl({
  active,
  tokens,
  pending,
  disabled,
  onEnhance,
}: {
  /** Focus is somewhere inside the composer. */
  active: boolean;
  tokens: number;
  pending: boolean;
  disabled: boolean;
  onEnhance: () => void;
}) {
  const inset = useKeyboardInset();
  const [mounted, setMounted] = useState(false);
  // Portals need a DOM target: render nothing until the client has mounted.
  useEffect(() => setMounted(true), []);

  if (!mounted || !active || inset <= 0) return null;

  return createPortal(
    <div
      // glass-nav, not glass-chrome (DSN-001): this bar sits at the BOTTOM above
      // the keyboard, so it mirrors the nav (top-rounded, upward shadow) rather
      // than inheriting the top bar's bottom-rounded, downward-shadowed tier.
      className="glass-nav fixed inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-2"
      style={{ bottom: `${inset}px` }}
    >
      <span className="font-body shrink-0 text-xs tabular-nums text-silver">
        <span aria-hidden="true">⌁ </span>
        ≈{tokens} tokens
      </span>
      <button
        type="button"
        // Keep the keyboard (and this bar) alive through the tap: a blur would
        // collapse the viewport and unmount the button mid-click.
        onPointerDown={(e) => e.preventDefault()}
        onClick={onEnhance}
        disabled={disabled}
        className="btn-laser pill flex h-11 items-center gap-1.5 px-4 text-sm disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Enhancing…
          </>
        ) : (
          "► ENHANCE"
        )}
      </button>
    </div>,
    document.body,
  );
}
