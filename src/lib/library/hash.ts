import { createHash } from "node:crypto";

/**
 * Duplicate-detection content hash: sha256 over input ∥ US ∥ output ∥ US ∥
 * mode (US = 0x1f, a separator that can't appear in either text via typing),
 * hex-encoded. MUST byte-match the SQL backfill in
 * supabase/migrations/20260727130000_library_organization.sql —
 * `encode(digest(input_text || chr(31) || output_text || chr(31) || mode::text,
 * 'sha256'), 'hex')` — pinned by a fixture test against a live DB digest.
 */
export function contentHash(input: string, output: string, mode: string): string {
  return createHash("sha256")
    .update(`${input}\u001f${output}\u001f${mode}`, "utf8")
    .digest("hex");
}
