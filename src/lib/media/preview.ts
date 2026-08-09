import { relativeTime } from "@/lib/library/util";
import { sanitizeName } from "@/lib/media/context";
import type { MediaKind } from "@/lib/media/types";

/**
 * Stored-media preview plumbing (2026-07 UX audit, follow-up).
 *
 * The `media` bucket is PRIVATE (docs/runbooks/media.md) — a stored file is
 * only viewable through a short-lived signed URL, never a public one. These
 * helpers are pure over an injected signer so the whole path unit-tests
 * without a browser or a live project.
 *
 * If we are going to charge the user's 50 MB quota for these bytes and show
 * them the meter, the list has to show what the bytes actually ARE: a real
 * thumbnail, a recognisable label, and a tap that opens the file.
 */

/** Signed-URL lifetime: long enough to browse Settings without re-signing,
 *  short enough that a copied URL stops working the same session. */
export const PREVIEW_URL_TTL_SECONDS = 3600;

/** The `media_assets` columns the manager and its preview sheet read. */
export interface StoredAsset {
  id: string;
  storage_path: string;
  kind: string;
  size_bytes: number | null;
  created_at: string;
  original_name: string | null;
  mime_type: string | null;
  status: string;
}

/**
 * Only a `ready` row is backed by an object in the bucket. `pending`/`failed`
 * rows are quota reservations whose upload never landed — they stay visible
 * (and deletable) for quota honesty, but there is nothing to open.
 */
export function isViewable(asset: Pick<StoredAsset, "status">): boolean {
  return asset.status === "ready";
}

/** Images are the only kind whose stored bytes are a thumbnail as-is. */
export function isThumbnailable(asset: Pick<StoredAsset, "kind" | "status">): boolean {
  return isViewable(asset) && asset.kind === "image";
}

const KIND_NOUN: Record<MediaKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/**
 * Row label: what the user actually attached. Rows stored before
 * `original_name` existed carry only a UUID storage path — show
 * "Image · 3 days ago" instead, because a UUID identifies nothing to a human
 * (and truncated, it identifies less than nothing).
 */
export function assetLabel(
  asset: Pick<StoredAsset, "kind" | "original_name" | "created_at">,
  now: number = Date.now(),
): string {
  const original = asset.original_name?.trim();
  if (original) return sanitizeName(original);
  const noun = KIND_NOUN[asset.kind as MediaKind] ?? "File";
  return `${noun} · ${relativeTime(asset.created_at, now)}`;
}

/** One entry of Supabase Storage's batch-sign response. */
interface SignedPath {
  path: string | null;
  signedUrl: string | null;
}

/** Batch signer — `supabase.storage.from("media").createSignedUrls`. */
type BatchSigner = (
  paths: string[],
  ttlSeconds: number,
) => Promise<SignedPath[] | null>;

/**
 * Sign thumbnails for the rows that have one, keyed by ASSET id (the manager
 * renders by row, not by path). One round trip for the whole list.
 *
 * Thumbnails are decoration over a list that must keep working: a signer that
 * fails, or that returns an error for some paths, degrades those rows to their
 * kind glyph rather than failing the manager.
 */
export async function signThumbnails(
  sign: BatchSigner,
  assets: readonly StoredAsset[],
  ttlSeconds: number = PREVIEW_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const wanted = assets.filter(isThumbnailable);
  if (wanted.length === 0) return urls;

  let results: SignedPath[] | null;
  try {
    results = await sign(
      wanted.map((a) => a.storage_path),
      ttlSeconds,
    );
  } catch {
    return urls;
  }
  if (!results) return urls;

  const byPath = new Map<string, string>();
  for (const result of results) {
    if (result.path && result.signedUrl) byPath.set(result.path, result.signedUrl);
  }
  for (const asset of wanted) {
    const url = byPath.get(asset.storage_path);
    if (url) urls.set(asset.id, url);
  }
  return urls;
}
