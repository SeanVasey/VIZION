-- Media roles, provenance, and atomic quota reservation (2026-07 UX audit).
--
-- Additive only — no enum surgery, so there is NO deploy-order hazard: safe to
-- apply any time before the dependent client deploys.
--
-- RLS: media_assets already carries owner-only select/insert/update/delete
-- policies (media_*_own, verified 2026-07-27); the new columns are covered by
-- them, and media_reserve is SECURITY INVOKER so its insert runs under the
-- caller's RLS.
--
-- What this enables:
--   * original_name / mime_type — preserve what the user actually attached
--     (today only a UUID + extension survives to the storage manager).
--   * role — the attachment's explicit purpose (reference is the default;
--     "generate" is never inferred from a file's mere presence).
--   * status — reserve → upload → ready. Failures leave a VISIBLE, deletable
--     'pending'/'failed' row that still counts against quota, never an
--     invisible orphaned storage object.
--   * media_reserve() — the atomic, server-side quota gate. The browser must
--     reserve before uploading; concurrent reservations serialize on a
--     per-user transaction-scoped advisory lock (safe under Supavisor
--     transaction pooling), closing the read-then-write race the old
--     client-only 50 MB check had.

alter table public.media_assets
  add column original_name text,
  add column mime_type text,
  add column role text
    check (role in ('reference', 'extract', 'describe', 'style', 'generate')),
  add column status text not null default 'ready'
    check (status in ('pending', 'ready', 'failed'));

comment on column public.media_assets.status is
  'pending = quota reserved, object not yet uploaded; ready = object present; failed = upload failed, row kept for quota honesty until removed.';

create or replace function public.media_reserve(
  p_kind public.media_kind,
  p_size_bytes bigint,
  p_original_name text,
  p_mime_type text,
  p_ext text,
  p_role text default 'reference'
) returns table (id uuid, storage_path text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quota constant bigint := 52428800; -- 50 MB — the single server-side truth
  v_used bigint;
  v_ext text;
  v_path text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_quota then
    raise exception 'invalid_size';
  end if;

  -- Serialize this user's reservations for the rest of the transaction so two
  -- parallel uploads can't both read the same "used" total and overshoot.
  perform pg_advisory_xact_lock(hashtext('media_quota:' || auth.uid()::text));

  select coalesce(sum(size_bytes), 0) into v_used
    from public.media_assets
   where user_id = auth.uid();
  if v_used + p_size_bytes > v_quota then
    raise exception 'quota_exceeded';
  end if;

  v_ext := lower(regexp_replace(coalesce(p_ext, ''), '[^a-zA-Z0-9]', '', 'g'));
  if v_ext = '' then v_ext := 'bin'; end if;
  v_path := auth.uid()::text || '/' || gen_random_uuid()::text || '.' || v_ext;

  return query
    insert into public.media_assets
      (user_id, storage_path, kind, size_bytes, original_name, mime_type, role, status)
    values
      (auth.uid(), v_path, p_kind, p_size_bytes,
       nullif(left(p_original_name, 160), ''), left(p_mime_type, 100),
       p_role, 'pending')
    returning media_assets.id, media_assets.storage_path;
end $$;

revoke execute on function public.media_reserve from anon, public;
grant execute on function public.media_reserve to authenticated;
