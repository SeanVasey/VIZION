"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampOffset,
  computeMaxOffset,
  renderCroppedBlob,
  type CropTransform,
} from "@/components/avatar-crop/crop-image";

/** Edge length (px) of the on-screen square viewport (responsive max-width). */
const VIEWPORT = 256;

export interface AvatarCropperProps {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
  busy?: boolean;
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
}: AvatarCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rendering, setRendering] = useState(false);

  // Live drag bookkeeping (pointer id + start positions) without re-renders.
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
  } | null>(null);

  // Load the File into an HTMLImageElement; revoke the object URL on cleanup.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
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
      };
    },
    [busy, rendering, offset.x, offset.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      const nextX = clampOffset(drag.ox + (e.clientX - drag.startX), maxX);
      const nextY = clampOffset(drag.oy + (e.clientY - drag.startY), maxY);
      setOffset({ x: nextX, y: nextY });
    },
    [maxX, maxY],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }, []);

  const onSave = useCallback(async () => {
    if (!image || busy || rendering) return;
    setRendering(true);
    try {
      const transform: CropTransform = { zoom, offsetX: offset.x, offsetY: offset.y };
      const blob = await renderCroppedBlob(image, VIEWPORT, transform);
      onCropped(blob);
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

  return (
    <div
      role="dialog"
      aria-label="Crop avatar"
      className="glass flex flex-col items-center gap-5 rounded-2xl p-5"
    >
      {/* Square viewport with a circular mask: dimmed corners + a ring. */}
      <div
        className="relative w-full max-w-[256px] touch-none select-none overflow-hidden rounded-2xl bg-onyx"
        style={{ aspectRatio: "1 / 1" }}
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
            Loading…
          </div>
        )}

        {/* Circular mask overlay: dims everything outside the crop circle and
            draws a subtle ring on the circle's edge.  Non-interactive. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-[color-mix(in_srgb,var(--chalk)_40%,transparent)]"
          style={{
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
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
          className="h-1 w-full cursor-pointer accent-laser disabled:opacity-50"
        />
        <span className="font-body text-xs text-silver" aria-hidden="true">
          +
        </span>
      </div>

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
          className="btn-laser flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-sm disabled:opacity-60"
        >
          {rendering ? "Saving…" : "Use photo"}
        </button>
      </div>
    </div>
  );
}
