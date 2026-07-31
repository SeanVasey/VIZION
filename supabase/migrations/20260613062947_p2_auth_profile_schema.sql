-- P2 — Auth & profile schema (RLS from creation).
-- profiles is 1:1 with auth.users; oauth_identities snapshots provider links.

create type public.theme as enum ('dark', 'light', 'system');
create type public.model_target as enum ('opus_4_8', 'gpt_5_5', 'gemini_pro_3_1');
create type public.auth_method as enum ('magic_link', 'github', 'google');
create type public.oauth_provider as enum ('github', 'google');

-- 1:1 profile for every auth user.
create table public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text,
  full_name     text,
  display_name  text unique,
  avatar_url    text,
  theme         public.theme not null default 'system',
  default_model public.model_target not null default 'opus_4_8',
  auth_method   public.auth_method,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Per-user profile, 1:1 with auth.users. RLS: owner only.';

-- OAuth identity snapshots (provider/name/email at link time).
create table public.oauth_identities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     public.oauth_provider not null,
  provider_uid text not null,
  raw_profile  jsonb,
  linked_at    timestamptz not null default now(),
  unique (provider, provider_uid)
);

create index oauth_identities_user_id_idx on public.oauth_identities (user_id);

-- updated_at maintenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile (and OAuth snapshot) when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := new.raw_app_meta_data ->> 'provider';
  v_auth_method public.auth_method;
begin
  v_auth_method := case
    when v_provider = 'github' then 'github'::public.auth_method
    when v_provider = 'google' then 'google'::public.auth_method
    else 'magic_link'::public.auth_method
  end;

  insert into public.profiles (user_id, email, full_name, avatar_url, auth_method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    v_auth_method
  )
  on conflict (user_id) do nothing;

  if v_provider in ('github', 'google') then
    insert into public.oauth_identities (user_id, provider, provider_uid, raw_profile)
    values (
      new.id,
      v_provider::public.oauth_provider,
      coalesce(
        new.raw_user_meta_data ->> 'provider_id',
        new.raw_user_meta_data ->> 'sub',
        new.id::text
      ),
      new.raw_user_meta_data
    )
    on conflict (provider, provider_uid) do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS: owner-only on every table, from creation ----------
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.oauth_identities enable row level security;

create policy "oauth_select_own"
  on public.oauth_identities for select
  using (auth.uid() = user_id);

create policy "oauth_insert_own"
  on public.oauth_identities for insert
  with check (auth.uid() = user_id);

create policy "oauth_update_own"
  on public.oauth_identities for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "oauth_delete_own"
  on public.oauth_identities for delete
  using (auth.uid() = user_id);
