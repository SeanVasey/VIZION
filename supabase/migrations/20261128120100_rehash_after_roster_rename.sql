-- Re-key the duplicate-detection hash after a roster rename.
--
-- `prompt_versions.content_hash` is sha256(input ∥ US ∥ output ∥ US ∥ mode ∥
-- US ∥ target) — the target's enum LABEL is part of the digest (ruling Q5,
-- 20260801200000). `ALTER TYPE ... RENAME VALUE` renames the label under
-- every stored row for free, but a hash computed from the OLD label is just
-- bytes: it does not follow. So after a rename, a save of content the user
-- already has computes a hash from the new label, finds no match, and files
-- a duplicate card — silently, because a missed dedupe is not an error.
--
-- That has been true since Q5 for every rename migration (20260808 and
-- 20260911 both left stale hashes behind); nobody noticed because nothing
-- fails. 20261128120000 renames fourteen labels including the default
-- target, which would have un-matched most of every library at once.
--
-- The fix is the Q5 backfill, run again: it keys on the parent prompt's
-- `target_model::text`, which now reads the NEW label, so every hash lands
-- where a fresh save of the same content will compute it. Idempotent, and it
-- repairs the two earlier renames' leftovers in the same pass. Only rows
-- whose hash actually changes are written.
--
-- MUST stay byte-matched with src/lib/library/hash.ts and with the original
-- expression in 20260801200000_library_media_correctness.sql.
--
-- A separate file from the rename on purpose: this is DML over existing rows
-- and belongs in its own transaction, after the enum change has committed.
-- RULE FOR THE NEXT RENAME: ship this statement again beside it.
-- (docs/runbooks/migrations.md.)

update public.prompt_versions v
   set content_hash = encode(
     digest(
       v.input_text || chr(31) || v.output_text || chr(31) || v.mode::text
         || chr(31) || p.target_model::text,
       'sha256'),
     'hex')
  from public.prompts p
 where p.id = v.prompt_id
   and v.content_hash is distinct from encode(
     digest(
       v.input_text || chr(31) || v.output_text || chr(31) || v.mode::text
         || chr(31) || p.target_model::text,
       'sha256'),
     'hex');
