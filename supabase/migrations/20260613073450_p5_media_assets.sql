-- P5 — MediaAsset (first-class, A5). RLS owner-only from creation.

create type public.media_kind as enum ('image', 'video', 'audio');

create table public.media_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  prompt_ver_id uuid references public.prompt_versions (id) on delete set null,
  storage_path  text not null,
  kind          public.media_kind not null,
  size_bytes    bigint not null default 0,
  extracted     jsonb,
  created_at    timestamptz not null default now()
);

create index media_assets_user_idx on public.media_assets (user_id, created_at desc);

comment on table public.media_assets is
  'Attached media references (A5). extracted jsonb holds detected attributes.';

alter table public.media_assets enable row level security;

create policy "media_select_own" on public.media_assets
  for select using (auth.uid() = user_id);
create policy "media_insert_own" on public.media_assets
  for insert with check (auth.uid() = user_id);
create policy "media_update_own" on public.media_assets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "media_delete_own" on public.media_assets
  for delete using (auth.uid() = user_id);

-- Private media bucket: writes + reads scoped to the owner (files under
-- "{user_id}/<name>"). Not public — served via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 26214400, -- 25 MB
  array[
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/mpeg','audio/wav','audio/ogg','audio/mp4'
  ]
)
on conflict (id) do nothing;

create policy "media_obj_select_own" on storage.objects
  for select using (
    bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "media_obj_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "media_obj_delete_own" on storage.objects
  for delete using (
    bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
  );
