-- Owner-operated application settings (owner console, 2026-08).
--
-- One row of app-level switches the deployment owner can flip from Settings:
--   * open_access          — when false, only the owner can register for or
--                            use the app (the model routes and the authed
--                            shell enforce it server-side; the sign-in form
--                            stops creating new accounts).
--   * dev_accent_strength  — the library cards' developer-accent peak alpha
--                            (`--dev-peak`, dev-accents.css documents it as
--                            the one aesthetic knob: ~20% whisper … ~38%
--                            statement; light theme renders +2%).
--
-- Ownership is claimed, not seeded: hardcoding an email here would put a
-- personal address in the repo (the exact class of leak SECURITY.md is being
-- cleaned of). The server action gates claiming on the OWNER_EMAIL env var,
-- then `claim_app_ownership` records auth.uid() — first eligible claimer
-- wins, and every later write requires that same uid. Env decides WHO may
-- claim; the row records WHO DID; both must agree for a write to land.
--
-- RLS: enabled from creation (CLAUDE.md §6). The flags are app-level and
-- carry no PII, and the sign-in surface needs open_access before any session
-- exists, so SELECT is granted to anon + authenticated. All writes go through
-- the two SECURITY DEFINER functions below — no insert/update/delete policy
-- exists, so PostgREST table writes are default-denied.

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  owner_user_id uuid references auth.users (id) on delete set null,
  open_access boolean not null default true,
  dev_accent_strength smallint not null default 26
    check (dev_accent_strength between 0 and 60),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy app_settings_select_all on public.app_settings
  for select using (true);

revoke insert, update, delete on table public.app_settings from anon, authenticated;

insert into public.app_settings (id) values (1);

-- First eligible claimer becomes the owner; re-claiming as the same user is a
-- no-op success. The env-var eligibility check lives in the server action —
-- the database records the claim, it does not decide eligibility.
create or replace function public.claim_app_ownership()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update public.app_settings
     set owner_user_id = v_uid,
         updated_at = now()
   where id = 1
     and (owner_user_id is null or owner_user_id = v_uid);
  return found;
end;
$$;

-- Partial update: null leaves a field as-is. Only the recorded owner may
-- write; everyone else raises, which the action surfaces as a plain error.
create or replace function public.update_app_settings(
  p_open_access boolean default null,
  p_dev_accent_strength smallint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.app_settings
     where id = 1 and owner_user_id = auth.uid()
  ) then
    raise exception 'not_owner';
  end if;
  update public.app_settings
     set open_access = coalesce(p_open_access, open_access),
         dev_accent_strength = coalesce(p_dev_accent_strength, dev_accent_strength),
         updated_at = now()
   where id = 1;
end;
$$;

revoke execute on function public.claim_app_ownership() from anon, public;
revoke execute on function public.update_app_settings(boolean, smallint)
  from anon, public;
grant execute on function public.claim_app_ownership() to authenticated;
grant execute on function public.update_app_settings(boolean, smallint)
  to authenticated;
