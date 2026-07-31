-- Address security advisors from the P2 schema.

-- 1. Pin search_path on the updated_at trigger function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. Public buckets serve objects via their public URL without a SELECT policy;
--    the broad SELECT policy only enabled client-side *listing* of all files.
--    Drop it so avatars remain viewable by URL but cannot be enumerated.
drop policy if exists "avatars_public_read" on storage.objects;

-- 3. handle_new_user is a trigger function (runs as table owner on INSERT); it
--    must not be callable as an RPC. Revoke EXECUTE from API roles.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
