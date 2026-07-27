-- Library organization (2026-07 UX audit): favorites, archive, soft delete,
-- card previews, and duplicate detection.
--
-- Additive only — no enum surgery, so there is NO deploy-order hazard: safe
-- to apply any time before the dependent client deploys.
--
-- RLS: the existing owner policies on prompts (select/insert/update/delete)
-- and prompt_versions (select/insert only — immutability) cover the new
-- columns; content_hash is written at INSERT time by the app, and the
-- backfill below runs as the migration role.
--
-- What this enables:
--   * favorite / archived_at — Recent, Favorites, and Archived library views.
--   * deleted_at — soft delete with Undo (hard delete stays available for
--     archived prompts only).
--   * preview / current_mode — cards can show the current version's output
--     preview and mode without shipping version bodies to the list.
--   * content_hash on prompt_versions — exact-duplicate detection at save
--     ("Save as new version" instead of a second identical card). The hash
--     is sha256 over input ∥ US ∥ output ∥ US ∥ mode (US = 0x1f), hex —
--     the Node helper in src/lib/library/hash.ts must byte-match this.

create extension if not exists pgcrypto;

alter table public.prompts
  add column favorite boolean not null default false,
  add column archived_at timestamptz,
  add column deleted_at timestamptz,
  add column preview text,
  add column current_mode public.enhance_mode;

alter table public.prompt_versions
  add column content_hash text;

-- Backfill hashes for existing versions (same formula as the app's helper).
update public.prompt_versions
   set content_hash = encode(
     digest(input_text || chr(31) || output_text || chr(31) || mode::text, 'sha256'),
     'hex');

-- Backfill card previews + modes from each prompt's current version.
update public.prompts p
   set preview = left(v.output_text, 200),
       current_mode = v.mode
  from public.prompt_versions v
 where v.id = p.current_ver;

-- Keyset-pagination index for the library list's canonical ordering.
create index idx_prompts_user_updated
  on public.prompts (user_id, updated_at desc, id desc)
  where deleted_at is null;

-- Duplicate lookup by hash.
create index idx_prompt_versions_hash
  on public.prompt_versions (content_hash);
