-- Collections/Folders for the prompt library (2026-07 UX audit deferral,
-- now landing by owner decision).
--
-- Additive only — no enum surgery, so there is NO deploy-order hazard: safe
-- to apply any time before the dependent client deploys. prompts.collection_id
-- is nullable with on delete set null, so deleting a collection releases its
-- prompts — it never deletes them.
--
-- RLS: collections is the first table these in-repo migrations CREATE (the
-- P2–P5 base schema was applied directly to the hosted project), so its
-- owner-only policies ship in the same file (CLAUDE.md §6: never a table
-- without a policy), named collections_<verb>_own after the media_*_own
-- convention. prompts' existing owner policies cover the new column.
--
-- What this enables:
--   * collections — named, per-user folders (unique name per owner, 1–60
--     chars).
--   * prompts.collection_id — one collection per prompt; drives the library
--     filter, the facet counts, and the Move-to-collection sheet.

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.collections enable row level security;

create policy collections_select_own on public.collections
  for select using (auth.uid() = user_id);
create policy collections_insert_own on public.collections
  for insert with check (auth.uid() = user_id);
create policy collections_update_own on public.collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy collections_delete_own on public.collections
  for delete using (auth.uid() = user_id);

alter table public.prompts
  add column collection_id uuid references public.collections (id) on delete set null;

-- Collection facet counts + filtered lists scan by owner and collection.
create index idx_prompts_collection
  on public.prompts (collection_id)
  where collection_id is not null;
