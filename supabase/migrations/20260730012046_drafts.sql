-- Account-backed drafts: an in-progress composer state saved to the server
-- rather than only to this device's localStorage (owner decision, 2026-07-30).
--
-- WHY A TABLE AND NOT A COLUMN. `editorDraft` already persists, but only in
-- localStorage — which CLAUDE.md §6 explicitly calls convenience-only, and
-- which iOS ITP evicts. A draft the user was told was "saved" must survive
-- eviction, a new device, and a reinstall, so it has to be server state.
--
-- WHY ITS OWN TABLE AND NOT `prompts.is_draft`. Every library read
-- (queryLibraryPage, queryLibraryFacets, the activity feed, the collection
-- facet counts) filters `prompts` on deleted_at/archived_at and nothing else.
-- A flag would leak drafts into all of them until each was audited, and any
-- future query would have to remember. A separate relation cannot leak by
-- omission — the failure mode is a missing feature, not a corrupted library.
--
-- Additive only, no enum surgery, so there is no deploy-order hazard in the
-- schema itself. The CLIENT does depend on this table: /library?view=drafts
-- and the FAB's save path query it, and both degrade to "no drafts" on
-- PGRST205 (undefined_table) rather than erroring, so applying this after the
-- client deploys costs a feature, not a page.
--
-- RLS ships in this file, owner-only, named drafts_<verb>_own after the
-- collections_/media_ convention (§6: never a table without a policy).
--
-- Composer state is captured whole, not just the body: resuming a draft into
-- whichever model happened to be selected later would silently change what the
-- user gets back. target_model/mode reuse the existing enums so a draft can
-- never name a target the composer cannot select. thinking_level is plain text
-- and NOT an enum — THINKING_LEVELS is a UI concern with no database enum
-- today, and inventing one here would put a second source of truth in the
-- schema; null means "Auto" exactly as an absent thinkingLevels entry does.

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The composer body. Bounded so a runaway paste cannot be persisted
  -- unboundedly; 100k characters is far past any real prompt.
  body text not null check (char_length(body) between 1 and 100000),
  -- Derived from the body at save time for the list row, so rendering the
  -- Drafts list never has to fetch full bodies.
  title text not null check (char_length(title) between 1 and 200),
  target_model public.model_target not null,
  mode public.enhance_mode not null,
  -- null = Auto (the provider default), matching an absent thinkingLevels key.
  thinking_level text check (
    thinking_level in ('minimal', 'low', 'medium', 'high', 'xhigh', 'max')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drafts enable row level security;

create policy drafts_select_own on public.drafts
  for select using (auth.uid() = user_id);
create policy drafts_insert_own on public.drafts
  for insert with check (auth.uid() = user_id);
create policy drafts_update_own on public.drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy drafts_delete_own on public.drafts
  for delete using (auth.uid() = user_id);

-- The Drafts view is "mine, newest first", keyset-paginated on
-- (updated_at, id) exactly as the library page is.
create index idx_drafts_owner_updated
  on public.drafts (user_id, updated_at desc, id desc);
