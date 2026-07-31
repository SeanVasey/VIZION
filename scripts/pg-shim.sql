-- The Supabase-shaped platform the migrations bind to, and nothing else.
--
-- `supabase db reset` gets this from the platform's own container image. This
-- file exists so the migrations can be replayed against a plain PostgreSQL
-- server when Docker is unavailable — CI containers, restricted sandboxes, a
-- laptop with the daemon stopped.
--
-- It is deliberately MINIMAL: only the objects the migrations actually
-- reference, so that adding something here is a visible admission that a
-- migration has taken a new dependency on the platform. As of the P2–P5
-- baseline that is auth.uid / auth.users, storage.objects / buckets /
-- foldername, the anon + authenticated roles, and pgcrypto in `extensions`.
--
-- It is NOT a Supabase emulator. Nothing here should be trusted to model
-- platform behaviour — only to let the DDL resolve.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Supabase installs pgcrypto into `extensions` and keeps that schema on the
-- database search_path, which is why `digest()` resolves unqualified in
-- 20260727093842_library_organization.sql.
create extension if not exists pgcrypto with schema extensions;
alter database postgres set search_path = "$user", public, extensions;

grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Only the columns the migrations read: handle_new_user() destructures the two
-- metadata blobs, everything else references auth.users(id) as a foreign key.
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- The platform helper, same shape: the `sub` claim from either the flattened
-- GUC or the whole claims blob. Every RLS policy in the schema calls this, so
-- `set local role authenticated` + `set local request.jwt.claims` is enough to
-- exercise them here exactly as they behave hosted.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb
);

-- Both carry RLS hosted; without it `create policy` succeeds but the policies
-- would be inert, which is the opposite of what the storage migrations assert.
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;
