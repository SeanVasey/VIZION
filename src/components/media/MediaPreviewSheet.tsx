"use client";

import { Sheet } from "@/components/ui/Sheet";
import { formatBytes } from "@/lib/media/formatters";
import { relativeTime } from "@/lib/library/util";
import { assetLabel, type StoredAsset } from "@/lib/media/preview";
import type { MediaKind } from "@/lib/media/types";

/**
 * The stored file itself (2026-07 UX audit, follow-up): tapping a row in the
 * media manager opens the actual bytes — the image, the video, the audio —
 * not another line of metadata about them. Presentational only: the manager
 * owns Supabase access and hands the freshly signed URL down, which keeps
 * this component testable and keeps signing in one place.
 */
export function MediaPreviewSheet({
  asset,
  url,
  error,
  onClose,
  onRemove,
}: {
  asset: StoredAsset;
  /** Freshly signed URL; absent while it is still being minted. */
  url?: string;
  error?: string;
  onClose: () => void;
  onRemove: (asset: StoredAsset) => void;
}) {
  const label = assetLabel(asset);
  const kind = asset.kind as MediaKind;

  return (
    <Sheet
      open
      onClose={onClose}
      title={label}
      footer={
        <div className="flex gap-2">
          <a
            href={url ?? "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={url ? undefined : true}
            onClick={(e) => {
              if (!url) e.preventDefault();
            }}
            className={`btn-laser font-body flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-sm ${
              url ? "" : "pointer-events-none opacity-50"
            }`}
          >
            Open original
          </a>
          <button
            type="button"
            onClick={() => onRemove(asset)}
            className="btn-destructive font-body flex min-h-[44px] shrink-0 items-center justify-center rounded-xl px-4 text-sm"
          >
            Remove
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p className="font-body text-sm text-flare" role="alert">
            {error}
          </p>
        ) : !url ? (
          <div
            role="status"
            className="flex h-40 items-center justify-center rounded-xl bg-surface"
          >
            <span className="font-body text-xs text-silver">Opening…</span>
          </div>
        ) : kind === "video" ? (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[60dvh] w-full rounded-xl bg-surface"
          />
        ) : kind === "audio" ? (
          <audio src={url} controls preload="metadata" className="w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            className="max-h-[60dvh] w-full rounded-xl bg-surface object-contain"
          />
        )}

        <dl className="font-body grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-silver">
          {(
            [
              ["kind", asset.mime_type ?? kind],
              ["size", formatBytes(asset.size_bytes ?? 0)],
              ["added", relativeTime(asset.created_at)],
              ["status", asset.status === "ready" ? null : asset.status],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                {/* No opacity: --silver is already the muted role, and 70% of
                    it is 3.33:1 on the light glass. The <dt>/<dd> colour split
                    is what separates key from value. */}
                <dt className="text-silver">{k}</dt>
                <dd className="break-words text-chalk">{v}</dd>
              </div>
            ))}
        </dl>

        <p className="font-body text-xs leading-relaxed text-silver">
          Stored privately in your account and counted against your 50 MB budget. The link
          above is signed and expires.
        </p>
      </div>
    </Sheet>
  );
}
