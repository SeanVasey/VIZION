import { createHash } from "node:crypto";

/**
 * Duplicate-detection content hash: sha256 over input ∥ US ∥ output ∥ US ∥
 * mode ∥ US ∥ target (US = 0x1f, a separator that can't appear in either text
 * via typing), hex-encoded. Target joined the formula under ruling Q5
 * (LIB-010): the same content saved for a DIFFERENT destination model is a
 * distinct prompt, not a duplicate — without it, "Save as new version" filed
 * a Kimi K3 result under an Opus 5 card. MUST byte-match the SQL backfill in
 * supabase/migrations/20260801200000_library_media_correctness.sql —
 * `encode(digest(v.input_text || chr(31) || v.output_text || chr(31) ||
 * v.mode::text || chr(31) || p.target_model::text, 'sha256'), 'hex')` —
 * pinned by a fixture test against a live DB digest.
 */
export function contentHash(
  input: string,
  output: string,
  mode: string,
  target: string,
): string {
  return createHash("sha256")
    .update(`${input}\u001f${output}\u001f${mode}\u001f${target}`, "utf8")
    .digest("hex");
}
