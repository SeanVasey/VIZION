import type { MediaKind } from "@/lib/media/types";

/**
 * The reserve → upload → ready pipeline (2026-07 UX audit, media integrity).
 *
 * Ordering is the point: the DB row is created FIRST (by the `media_reserve`
 * RPC, which enforces the 50 MB quota atomically server-side), the storage
 * object second. Every failure direction then lands safe:
 *   - reserve fails → nothing uploaded, nothing stored;
 *   - upload fails → the pending row is deleted (or, failing that, marked
 *     failed) — a VISIBLE, deletable record, never an invisible orphaned
 *     storage object;
 *   - the ready-flip fails → the row stays 'pending' and surfaces in the
 *     media manager as an incomplete upload.
 *
 * Pure orchestration over injected deps so the whole ladder unit-tests
 * without a browser or a live project.
 */

export interface MediaStoreDeps {
  /** Atomic quota reservation — resolves to the row id + storage path, or
   *  throws with the RPC's error message (`quota_exceeded`, `invalid_size`). */
  reserve(input: {
    kind: MediaKind;
    sizeBytes: number;
    originalName: string;
    mimeType: string;
    ext: string;
    role: string;
  }): Promise<{ id: string; storagePath: string }>;
  uploadObject(path: string, file: Blob, contentType: string): Promise<void>;
  /** Flip the row to 'ready' AND reconcile size_bytes against the uploaded
   *  object's real storage metadata (the media_commit RPC) — the declared
   *  size is client-supplied and the quota must charge what actually landed
   *  (MED-001). Throws when the object is missing server-side. */
  commit(id: string): Promise<void>;
  setStatus(id: string, status: "failed"): Promise<void>;
  deleteRow(id: string): Promise<void>;
  /** Resolves `{ notFound: true }` when the object is already gone. */
  removeObject(path: string): Promise<{ notFound?: boolean }>;
}

export interface StoreFileInput {
  blob: Blob;
  name: string;
  mimeType: string;
  sizeBytes: number;
  ext: string;
  kind: MediaKind;
  role: string;
}

export type StoreOutcome =
  | { ok: true; assetId: string; storagePath: string; softNote?: string }
  | { ok: false; reason: "quota" | "invalid" | "reserve" | "upload"; message: string };

export const QUOTA_MESSAGE =
  "Storage full — remove media in Settings → Data & privacy to continue.";

/** Classify a media_reserve rejection by the RPC's raise message. */
export function classifyReserveError(message: string): "quota" | "invalid" | "reserve" {
  if (message.includes("quota_exceeded")) return "quota";
  if (message.includes("invalid_size")) return "invalid";
  return "reserve";
}

export async function storeAttachment(
  deps: MediaStoreDeps,
  file: StoreFileInput,
  onStage?: (stage: "reserving" | "uploading") => void,
): Promise<StoreOutcome> {
  let reserved: { id: string; storagePath: string };
  try {
    onStage?.("reserving");
    reserved = await deps.reserve({
      kind: file.kind,
      sizeBytes: file.sizeBytes,
      originalName: file.name,
      mimeType: file.mimeType,
      ext: file.ext,
      role: file.role,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason = classifyReserveError(message);
    return {
      ok: false,
      reason,
      message:
        reason === "quota"
          ? QUOTA_MESSAGE
          : reason === "invalid"
            ? "That file is too large to store (50 MB limit)."
            : message,
    };
  }

  try {
    onStage?.("uploading");
    await deps.uploadObject(reserved.storagePath, file.blob, file.mimeType);
  } catch (e) {
    // The reservation must not keep charging quota for bytes that never
    // arrived — delete the row; if even that fails, mark it failed so it
    // stays visible (and removable) in the media manager.
    //
    // Best-effort object removal FIRST (MED-005): an upload that committed
    // server-side while the client saw an error would otherwise strand an
    // invisible object no list or quota row ever mentions again. "Already
    // gone" is the normal case and a cheap no-op.
    await deps.removeObject(reserved.storagePath).catch(() => {});
    try {
      await deps.deleteRow(reserved.id);
    } catch {
      await deps.setStatus(reserved.id, "failed").catch(() => {});
    }
    return {
      ok: false,
      reason: "upload",
      message: e instanceof Error ? e.message : "Upload failed.",
    };
  }

  try {
    await deps.commit(reserved.id);
  } catch {
    // Object + row both exist; the stale 'pending' only affects the manager's
    // status badge. Don't fail a successful upload over it.
    return {
      ok: true,
      assetId: reserved.id,
      storagePath: reserved.storagePath,
      softNote: "Stored, but its status couldn't be confirmed.",
    };
  }

  return { ok: true, assetId: reserved.id, storagePath: reserved.storagePath };
}

export type RemoveOutcome =
  | { ok: true }
  | { ok: false; stage: "object" | "row"; message: string };

/**
 * Delete a stored asset, converging instead of stranding: object first
 * ("already gone" counts as success), then the row. A row-delete failure
 * reports retryable state — on retry the object read comes back not-found
 * and only the row delete runs, so repeated attempts always converge.
 */
export async function removeAsset(
  deps: MediaStoreDeps,
  asset: { id: string; storagePath: string },
): Promise<RemoveOutcome> {
  try {
    await deps.removeObject(asset.storagePath);
  } catch (e) {
    return {
      ok: false,
      stage: "object",
      message: e instanceof Error ? e.message : "Couldn't remove the file.",
    };
  }
  try {
    await deps.deleteRow(asset.id);
  } catch (e) {
    return {
      ok: false,
      stage: "row",
      message:
        e instanceof Error
          ? `The file is gone but its record remains — retry to clear it. (${e.message})`
          : "The file is gone but its record remains — retry to clear it.",
    };
  }
  return { ok: true };
}
