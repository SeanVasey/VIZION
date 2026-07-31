-- P4 — Library & versioning. RLS owner-only on every table from creation.

create type public.enhance_mode as enum
  ('clarify', 'expand', 'condense', 'reformat', 'target');

create type public.activity_type as enum
  ('created', 'enhanced', 'saved', 'shared', 'restored', 'profile_updated');

-- A saved prompt "project".
create table public.prompts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  current_ver  uuid,  -- FK added after prompt_versions exists (circular ref)
  target_model public.model_target not null,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index prompts_user_updated_idx on public.prompts (user_id, updated_at desc);
create index prompts_tags_idx on public.prompts using gin (tags);

-- Immutable version snapshots.
create table public.prompt_versions (
  id         uuid primary key default gen_random_uuid(),
  prompt_id  uuid not null references public.prompts (id) on delete cascade,
  parent_ver uuid references public.prompt_versions (id),
  input_text text not null,
  output_text text not null,
  rationale  text,
  mode       public.enhance_mode not null,
  model_used text not null,
  token_in   integer not null default 0,
  token_out  integer not null default 0,
  created_at timestamptz not null default now()
);

create index prompt_versions_prompt_idx
  on public.prompt_versions (prompt_id, created_at);

alter table public.prompts
  add constraint prompts_current_ver_fkey
  foreign key (current_ver) references public.prompt_versions (id)
  on delete set null;

-- Profile activity feed.
create table public.activity_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  prompt_id  uuid references public.prompts (id) on delete set null,
  type       public.activity_type not null,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index activity_events_user_idx
  on public.activity_events (user_id, created_at desc);

-- updated_at maintenance on prompts (reuses the P2 trigger function).
create trigger prompts_set_updated_at
  before update on public.prompts
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.prompts enable row level security;
create policy "prompts_select_own" on public.prompts
  for select using (auth.uid() = user_id);
create policy "prompts_insert_own" on public.prompts
  for insert with check (auth.uid() = user_id);
create policy "prompts_update_own" on public.prompts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prompts_delete_own" on public.prompts
  for delete using (auth.uid() = user_id);

-- prompt_versions: ownership joins through the parent prompt; immutable
-- (no update/delete policies → RLS denies mutation, enforcing snapshots).
alter table public.prompt_versions enable row level security;
create policy "prompt_versions_select_own" on public.prompt_versions
  for select using (
    exists (
      select 1 from public.prompts p
      where p.id = prompt_id and p.user_id = auth.uid()
    )
  );
create policy "prompt_versions_insert_own" on public.prompt_versions
  for insert with check (
    exists (
      select 1 from public.prompts p
      where p.id = prompt_id and p.user_id = auth.uid()
    )
  );

alter table public.activity_events enable row level security;
create policy "activity_select_own" on public.activity_events
  for select using (auth.uid() = user_id);
create policy "activity_insert_own" on public.activity_events
  for insert with check (auth.uid() = user_id);
