"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { budgetStatus, formatBytes } from "@/lib/media/formatters";
import { removeAsset } from "@/lib/media/pipeline";
import {
  assetLabel,
  isThumbnailable,
  isViewable,
  signThumbnails,
  PREVIEW_URL_TTL_SECONDS,
  type StoredAsset,
} from "@/lib/media/preview";
import type { MediaKind } from "@/lib/media/types";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { MediaPreviewSheet } from "@/components/media/MediaPreviewSheet";
import { KindIcon } from "@/components/media/KindIcon";

/** What the preview sheet is showing — the row, plus its signed URL once minted. */
interface Preview {
  asset: StoredAsset;
  url?: string;
  error?: string;
}

/**
 * The stored-media manager (2026-07 UX audit): ALWAYS available — mounted
 * unconditionally in Settings → Data & privacy and surfaced in the composer
 * tray as the budget tightens — never hidden until 80% of quota. Shows the
 * ORIGINAL file name (legacy rows fall back to a human "Image · 3 days ago",
 * never a truncated UUID) and flags incomplete uploads (reservation rows
 * whose object never arrived).
 *
 * The bytes are shown, not just counted: image rows carry a real thumbnail
 * and every stored row opens its file in a preview sheet. The `media` bucket
 * is private, so both go through short-lived signed URLs — the list is signed
 * in ONE batch, and opening a row mints a fresh URL so a long-open Settings
 * page can't hand the sheet an expired one.
 */
export function MediaManager({ onChanged }: { onChanged?: () => void }) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<StoredAsset | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  /** Rows whose thumbnail URL failed to load — fall back to the kind glyph. */
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("media_assets")
      .select(
        "id, storage_path, kind, size_bytes, created_at, original_name, mime_type, status",
      )
      .order("created_at", { ascending: false });
    const rows = data ?? [];
    setAssets(rows);
    setLoaded(true);
    setBrokenThumbs(new Set());
    setThumbs(
      await signThumbnails(async (paths, ttl) => {
        const { data: signed } = await supabase.storage
          .from("media")
          .createSignedUrls(paths, ttl);
        return signed;
      }, rows),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const usedBytes = assets.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
  const budget = budgetStatus(usedBytes);

  /** Open a row: mint a FRESH signed URL (the batch above may have aged out). */
  async function openPreview(asset: StoredAsset) {
    setPreview({ asset });
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(asset.storage_path, PREVIEW_URL_TTL_SECONDS);
    setPreview((current) =>
      current?.asset.id !== asset.id
        ? current
        : data?.signedUrl
          ? { asset, url: data.signedUrl }
          : {
              asset,
              error: `Couldn't open this file — ${error?.message ?? "it may no longer be in storage"}.`,
            },
    );
  }

  async function remove(asset: StoredAsset) {
    setNotice(null);
    const supabase = createClient();
    const outcome = await removeAsset(
      {
        reserve: async () => {
          throw new Error("unused");
        },
        uploadObject: async () => {},
        commit: async () => {},
        setStatus: async () => {},
        deleteRow: async (id) => {
          const { error } = await supabase.from("media_assets").delete().eq("id", id);
          if (error) throw new Error(error.message);
        },
        removeObject: async (path) => {
          const { error } = await supabase.storage.from("media").remove([path]);
          if (error) {
            if (/not.?found/i.test(error.message)) return { notFound: true };
            throw new Error(error.message);
          }
          return {};
        },
      },
      { id: asset.id, storagePath: asset.storage_path },
    );
    if (!outcome.ok) {
      setNotice(outcome.message);
      return;
    }
    setPreview((current) => (current?.asset.id === asset.id ? null : current));
    await load();
    onChanged?.();
  }

  /** Thumbnail or kind glyph — the same 40px box either way, so the list
   *  doesn't reflow as signed URLs arrive. */
  function rowMedia(asset: StoredAsset) {
    const thumb = thumbs.get(asset.id);
    if (isThumbnailable(asset) && thumb && !brokenThumbs.has(asset.id)) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBrokenThumbs((prev) => new Set(prev).add(asset.id))}
          className="h-10 w-10 shrink-0 rounded-lg bg-surface object-cover"
        />
      );
    }
    return (
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-silver"
      >
        <KindIcon kind={(asset.kind as MediaKind) ?? "image"} />
      </span>
    );
  }

  /** Row body — identical markup whether or not the row can be opened, so a
   *  pending upload doesn't advertise a tap that would 404. */
  function rowBody(asset: StoredAsset) {
    return (
      <>
        {rowMedia(asset)}
        <span className="min-w-0 flex-1">
          <span className="font-body block truncate text-xs text-text">
            {assetLabel(asset)}
          </span>
          {asset.status !== "ready" && (
            <span className="font-body block text-[0.6875rem] text-amber-ink">
              Incomplete upload — safe to remove.
            </span>
          )}
        </span>
        <span className="font-body shrink-0 text-xs tabular-nums text-silver">
          {formatBytes(asset.size_bytes ?? 0)}
        </span>
      </>
    );
  }

  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-body text-xs uppercase tracking-wider text-silver">
          Stored media
        </p>
        <span
          className={`font-body text-xs tabular-nums ${budget.warn ? "text-amber-ink" : "text-silver"}`}
        >
          {formatBytes(usedBytes)} / {formatBytes(budget.quotaBytes)}
        </span>
      </div>
      {/* Byte meter — quota state is visible at ANY usage level. */}
      <div className="h-1.5 overflow-hidden rounded-full bg-hair" aria-hidden="true">
        <div
          className={`h-full rounded-full ${budget.warn ? "bg-amber" : "bg-laser"}`}
          style={{ width: `${Math.min(100, Math.round(budget.pct * 100))}%` }}
        />
      </div>

      {loaded && assets.length === 0 && (
        <p className="font-body text-xs text-silver">
          Nothing stored — attachments you keep will appear here.
        </p>
      )}

      {assets.length > 0 && (
        <ul className="flex flex-col divide-y divide-hair">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-center gap-1 py-2">
              {isViewable(asset) ? (
                <button
                  type="button"
                  onClick={() => void openPreview(asset)}
                  className="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-colors hover-hair"
                >
                  {rowBody(asset)}
                </button>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-3 px-1 py-0.5">
                  {rowBody(asset)}
                </span>
              )}
              <button
                type="button"
                onClick={() => setConfirmFor(asset)}
                aria-label={`Remove ${assetLabel(asset)}`}
                className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-silver transition-colors hover:text-flare"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p className="font-body text-xs text-flare" role="alert">
          {notice}
        </p>
      )}

      {preview && (
        <MediaPreviewSheet
          asset={preview.asset}
          url={preview.url}
          error={preview.error}
          onClose={() => setPreview(null)}
          onRemove={(asset) => {
            setPreview(null);
            setConfirmFor(asset);
          }}
        />
      )}

      <ConfirmSheet
        open={confirmFor !== null}
        onClose={() => setConfirmFor(null)}
        title="Remove this file?"
        body={
          confirmFor
            ? `"${assetLabel(confirmFor)}" (${formatBytes(confirmFor.size_bytes ?? 0)}) will be deleted from your storage. This can't be undone.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirmFor) void remove(confirmFor);
        }}
      />
    </div>
  );
}
