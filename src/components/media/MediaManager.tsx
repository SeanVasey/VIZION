"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { budgetStatus, formatBytes } from "@/lib/media/formatters";
import { removeAsset } from "@/lib/media/pipeline";
import { sanitizeName } from "@/lib/media/context";
import type { MediaKind } from "@/lib/media/types";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";

interface StoredAsset {
  id: string;
  storage_path: string;
  kind: string;
  size_bytes: number | null;
  created_at: string;
  original_name: string | null;
  status: string;
}

const KIND_GLYPH: Record<MediaKind, string> = {
  image: "🖼",
  video: "🎞",
  audio: "🎧",
};

/**
 * The stored-media manager (2026-07 UX audit): ALWAYS available — mounted
 * unconditionally in Settings → Data & privacy and surfaced in the composer
 * tray as the budget tightens — never hidden until 80% of quota. Shows the
 * ORIGINAL file name (legacy rows fall back to the storage path tail) and
 * flags incomplete uploads (reservation rows whose object never arrived).
 */
export function MediaManager({ onChanged }: { onChanged?: () => void }) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<StoredAsset | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("media_assets")
      .select("id, storage_path, kind, size_bytes, created_at, original_name, status")
      .order("created_at", { ascending: false });
    setAssets(data ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const usedBytes = assets.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
  const budget = budgetStatus(usedBytes);

  async function remove(asset: StoredAsset) {
    setNotice(null);
    const supabase = createClient();
    const outcome = await removeAsset(
      {
        reserve: async () => {
          throw new Error("unused");
        },
        uploadObject: async () => {},
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
    await load();
    onChanged?.();
  }

  function displayName(asset: StoredAsset): string {
    return sanitizeName(asset.original_name ?? asset.storage_path.split("/").pop() ?? "file");
  }

  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-body text-xs uppercase tracking-wider text-silver">
          Stored media
        </p>
        <span
          className={`font-body text-xs tabular-nums ${budget.warn ? "text-amber" : "text-silver"}`}
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
            <li key={asset.id} className="flex items-center gap-3 py-2">
              <span aria-hidden="true" className="text-base">
                {KIND_GLYPH[(asset.kind as MediaKind) ?? "image"] ?? "🖼"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-body truncate text-xs text-text">
                  {displayName(asset)}
                </p>
                {asset.status !== "ready" && (
                  <p className="font-body text-[0.6875rem] text-amber">
                    Incomplete upload — safe to remove.
                  </p>
                )}
              </div>
              <span className="font-body shrink-0 text-xs tabular-nums text-silver">
                {formatBytes(asset.size_bytes ?? 0)}
              </span>
              <button
                type="button"
                onClick={() => setConfirmFor(asset)}
                aria-label={`Remove ${displayName(asset)}`}
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

      <ConfirmSheet
        open={confirmFor !== null}
        onClose={() => setConfirmFor(null)}
        title="Remove this file?"
        body={
          confirmFor
            ? `"${displayName(confirmFor)}" (${formatBytes(confirmFor.size_bytes ?? 0)}) will be deleted from your storage. This can't be undone.`
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
