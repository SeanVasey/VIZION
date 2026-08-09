"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  clampOffset,
  computeMaxOffset,
  renderCroppedBlob,
  type CropTransform,
} from "@/components/avatar-crop/crop-image";

/** Edge length (px) of the on-screen square viewport (responsive max-width). */
const VIEWPORT = 256;

/** Arrow-key pan distance, in the same viewport px the drag math uses. */
const PAN_STEP = 8;

/** Pointer travel below this reads as a tap rather than a drag. */
const TAP_SLOP = 4;

interface AvatarCropperProps {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
  busy?: boolean;
  /**
   * Where focus goes when the dialog closes (WCAG 2.4.3).
   *
   * The host opens this by clicking a `display:none` file input, so
   * `document.activeElement` at mount is `<body>` — capturing it here and
   * restoring on unmount would drop a keyboard user at the top of the page.
   * The host names the control the user actually pressed instead.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Lightweight, dependency-free avatar cropper (product-spec §3.3 / §5.2).
 *
 * The image is laid out to *cover* a square viewport, pannable by pointer drag
 * and zoomable by slider, under a circular mask.  Saving renders the visible
 * square region to a PNG via {@link renderCroppedBlob}; the circular look is a
 * display-only concern.  The caller uploads the returned blob (e.g. to Supabase
 * Storage) in `onCropped`.
 */
export function AvatarCropper({
  file,
  onCancel,
  onCropped,
  busy = false,
  returnFocusRef,
}: AvatarCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hintId = useId();

  // Move focus into the dialog once on open so keyboard/SR users land inside
  // (the host closes on Escape and on a backdrop click), and hand it back to
  // the trigger on close. A render-time ref callback would re-fire per render
  // and steal focus from the zoom slider.
  useEffect(() => {
    // Resolved on the way IN, not in the cleanup: the host's trigger is
    // mounted long before this dialog, so the ref is already populated, and
    // reading it here keeps the cleanup free of a ref it doesn't own.
    const returnTo =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    rootRef.current?.focus();
    return () => {
      if (!returnTo || returnTo === document.body || !returnTo.isConnected) return;
      returnTo.focus();
      if (document.activeElement === returnTo) return;

      // The "Use photo" path sets `avatarBusy` and clears the file in one
      // batch, so by the time this runs the trigger is already `disabled` for
      // the upload — and `focus()` on a disabled control is ignored, which
      // would strand focus on <body> for the length of a network round trip.
      // Wait for the control to come back rather than dropping the user.
      const observer = new MutationObserver(() => {
        // Only if focus is still nowhere. If the user has clicked or tabbed
        // somewhere in the meantime, taking it back would be the worse bug.
        if (document.activeElement !== document.body) return stop();
        returnTo.focus();
        if (document.activeElement === returnTo) stop();
      });
      const timer = setTimeout(stop, 10_000);
      function stop() {
        observer.disconnect();
        clearTimeout(timer);
      }
      observer.observe(returnTo, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    };
  }, [returnFocusRef]);

  // Live drag bookkeeping (pointer id + start positions) without re-renders.
  // `moved` separates a drag from a tap — see endDrag.
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  // Load the File into an HTMLImageElement; revoke the object URL on cleanup.
  // A file that fails to decode must not strand the modal on "Loading…" —
  // surface it and leave Cancel as the way out.
  useEffect(() => {
    setError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError("Couldn't read that image — try a different file.");
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Per-axis pan limits given the current zoom (0 when the image is too small).
  const maxX = image
    ? computeMaxOffset(image.naturalWidth, image.naturalHeight, zoom, VIEWPORT)
    : 0;
  const maxY = image
    ? computeMaxOffset(image.naturalHeight, image.naturalWidth, zoom, VIEWPORT)
    : 0;

  // Re-clamp the offset whenever the limits change (e.g. after a zoom change).
  useEffect(() => {
    setOffset((o) => ({ x: clampOffset(o.x, maxX), y: clampOffset(o.y, maxY) }));
  }, [maxX, maxY]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (busy || rendering) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        ox: offset.x,
        oy: offset.y,
        moved: false,
      };
    },
    [busy, rendering, offset.x, offset.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) drag.moved = true;
      setOffset({
        x: clampOffset(drag.ox + dx, maxX),
        y: clampOffset(drag.oy + dy, maxY),
      });
    },
    [maxX, maxY],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      dragRef.current = null;
      // A press that never travelled is a TAP, and a tap centres the point it
      // landed on. That is the single-pointer, no-dragging path WCAG 2.5.7
      // asks for: panning was reachable only by holding and moving, which
      // rules out anyone who can tap but cannot sustain a drag. Drag still
      // works exactly as before — this only fires when it didn't happen.
      if (drag.moved || e.type !== "pointerup") return;
      const rect = e.currentTarget.getBoundingClientRect();
      setOffset({
        x: clampOffset(drag.ox + (rect.left + rect.width / 2 - e.clientX), maxX),
        y: clampOffset(drag.oy + (rect.top + rect.height / 2 - e.clientY), maxY),
      });
    },
    [maxX, maxY],
  );

  // Keyboard pan (WCAG 2.1.1). Arrows move the image the way an equivalent
  // drag would, so the two input paths agree. preventDefault stops the page
  // behind the scrim scrolling instead.
  const onViewportKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (busy || rendering) return;
      const step: [number, number] | null =
        e.key === "ArrowLeft"
          ? [-PAN_STEP, 0]
          : e.key === "ArrowRight"
            ? [PAN_STEP, 0]
            : e.key === "ArrowUp"
              ? [0, -PAN_STEP]
              : e.key === "ArrowDown"
                ? [0, PAN_STEP]
                : null;
      if (!step) return;
      e.preventDefault();
      setOffset((o) => ({
        x: clampOffset(o.x + step[0], maxX),
        y: clampOffset(o.y + step[1], maxY),
      }));
    },
    [busy, rendering, maxX, maxY],
  );

  const onSave = useCallback(async () => {
    if (!image || busy || rendering) return;
    setRendering(true);
    try {
      const transform: CropTransform = { zoom, offsetX: offset.x, offsetY: offset.y };
      const blob = await renderCroppedBlob(image, VIEWPORT, transform);
      onCropped(blob);
    } catch {
      setError("Couldn't crop that image — try again or pick another file.");
    } finally {
      setRendering(false);
    }
  }, [image, busy, rendering, zoom, offset.x, offset.y, onCropped]);

  const disabled = busy || rendering || !image;

  // Cover-scale layout for the on-screen preview (mirrors the render math).
  const previewStyle = image
    ? (() => {
        const minNatural = Math.min(image.naturalWidth, image.naturalHeight);
        const coverScale = (VIEWPORT / minNatural) * zoom;
        return {
          width: image.naturalWidth * coverScale,
          height: image.naturalHeight * coverScale,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        };
      })()
    : undefined;

  // Focus trap. `aria-modal` tells assistive tech the rest of the page is not
  // there; without this, Tab past "Use photo" walked straight into the settings
  // form behind the scrim and kept going, so the two disagreed. Escape and the
  // backdrop click stay with the host, which owns the busy state.
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const root = rootRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    // The root is a leading boundary as well as `first`. It holds focus on
    // open — `tabIndex={-1}`, so it is deliberately not in `focusables` — and
    // a Shift+Tab from there is a step backwards out of a dialog whose
    // `aria-modal` has just told assistive tech there is nothing behind it.
    const atStart = document.activeElement === first || document.activeElement === root;
    if (e.shiftKey && atStart) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop avatar"
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={onDialogKeyDown}
      className="glass flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl p-5 focus:outline-none"
    >
      <p id={hintId} className="sr-only">
        Drag to pan, tap a point to center it, or use the arrow keys.
      </p>
      {/* Square viewport with a circular mask: dimmed corners + a ring. */}
      <div
        role="group"
        aria-label="Crop area"
        aria-describedby={hintId}
        tabIndex={0}
        className="relative w-full max-w-[256px] touch-none select-none overflow-hidden rounded-2xl bg-onyx"
        style={{ aspectRatio: "1 / 1" }}
        onKeyDown={onViewportKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {image && previewStyle ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
            style={previewStyle}
          />
        ) : (
          <div className="font-body absolute inset-0 grid place-items-center text-xs text-silver">
            {error ? "Preview unavailable" : "Loading…"}
          </div>
        )}

        {/* Circular mask overlay: dims everything outside the crop circle and
            draws a subtle ring on the circle's edge.  Non-interactive. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-[color-mix(in_srgb,var(--chalk)_40%,transparent)]"
          style={{
            // Tokenized (DSN-020): the viewfinder dim reads the scrim system.
            boxShadow: "0 0 0 9999px var(--scrim-heavy)",
          }}
        />
      </div>

      {/* Zoom slider. */}
      <div className="flex w-full max-w-[256px] items-center gap-3">
        <span className="font-body text-xs text-silver" aria-hidden="true">
          −
        </span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          disabled={disabled}
          onChange={(e) => setZoom(Number(e.target.value))}
          // 44pt hit box for a thumb-drag control; the negative margins keep
          // the row's visual height at ~16px (the native track/thumb draw
          // centered), and the 14px bleed stays inside the column's 20px gaps
          // so it never overlaps the crop viewport or the buttons.
          className="-my-3.5 h-11 w-full cursor-pointer accent-laser disabled:opacity-50"
        />
        <span className="font-body text-xs text-silver" aria-hidden="true">
          +
        </span>
      </div>

      {error && (
        <p className="font-body w-full max-w-[256px] text-center text-sm text-flare" role="alert">
          {error}
        </p>
      )}

      {/* Actions. */}
      <div className="flex w-full max-w-[256px] gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy || rendering}
          className="glass font-body flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-sm text-chalk disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="btn-laser flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-sm"
        >
          {rendering ? "Saving…" : "Use photo"}
        </button>
      </div>
    </div>
  );
}
