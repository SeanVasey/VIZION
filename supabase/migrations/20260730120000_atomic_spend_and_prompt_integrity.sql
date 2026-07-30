-- Atomic model-spend admission and prompt relationship integrity.

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_usd numeric(10,6) not null check (reserved_usd > 0),
  status text not null default 'pending' check (status in ('pending', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

alter table public.usage_reservations enable row level security;
revoke all on table public.usage_reservations from anon, authenticated, public;

create index usage_reservations_owner_pending
  on public.usage_reservations (user_id, created_at)
  where status = 'pending';

create or replace function public.spend_reserve(
  p_max_cost numeric,
  p_cap numeric,
  p_rate_limit integer,
  p_rate_seconds integer
) returns table (reservation_id uuid, today_cost numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today numeric;
  v_pending numeric;
  v_recent integer;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_max_cost <= 0 or p_cap <= 0 or p_rate_limit <= 0 or p_rate_seconds <= 0 then
    raise exception 'invalid_limit';
  end if;

  perform pg_advisory_xact_lock(hashtext('model_spend:' || v_user::text));
  update public.usage_reservations
     set status = 'released', settled_at = now()
   where user_id = v_user and status = 'pending'
     and created_at < now() - interval '5 minutes';

  select coalesce(sum(cost_usd), 0) into v_today
    from public.usage_events
   where user_id = v_user
     and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  select coalesce(sum(reserved_usd), 0) into v_pending
    from public.usage_reservations where user_id = v_user and status = 'pending';
  select count(*) into v_recent from public.usage_events
   where user_id = v_user and created_at >= now() - make_interval(secs => p_rate_seconds);
  v_recent := v_recent + (
    select count(*) from public.usage_reservations
     where user_id = v_user and status = 'pending'
       and created_at >= now() - make_interval(secs => p_rate_seconds)
  );

  if v_recent >= p_rate_limit then raise exception 'rate_limited'; end if;
  if v_today + v_pending + p_max_cost > p_cap then raise exception 'cap_reached'; end if;

  insert into public.usage_reservations(user_id, reserved_usd)
    values (v_user, p_max_cost) returning id into v_id;
  return query select v_id, v_today;
end $$;

create or replace function public.spend_settle(
  p_reservation_id uuid,
  p_target public.model_target,
  p_mode text,
  p_model_used text,
  p_token_in integer,
  p_token_out integer,
  p_cost_usd numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_cost_usd < 0 or p_token_in < 0 or p_token_out < 0 then raise exception 'invalid_usage'; end if;

  update public.usage_reservations set status = 'settled', settled_at = now()
   where id = p_reservation_id and user_id = v_user and status = 'pending';
  if not found then raise exception 'reservation_not_pending'; end if;

  insert into public.usage_events
    (user_id, target, mode, model_used, token_in, token_out, cost_usd)
  values
    (v_user, p_target, p_mode, p_model_used, p_token_in, p_token_out, p_cost_usd);
end $$;

create or replace function public.spend_release(p_reservation_id uuid) returns void
language sql
security definer
set search_path = public
as $$
  update public.usage_reservations set status = 'released', settled_at = now()
   where id = p_reservation_id and user_id = auth.uid() and status = 'pending';
$$;

revoke execute on function public.spend_reserve from anon, public;
revoke execute on function public.spend_settle from anon, public;
revoke execute on function public.spend_release from anon, public;
grant execute on function public.spend_reserve to authenticated;
grant execute on function public.spend_settle to authenticated;
grant execute on function public.spend_release to authenticated;

-- Prevent current_ver from ever crossing prompt boundaries, including direct
-- PostgREST writes that bypass the server action.
create or replace function public.enforce_prompt_current_version() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.current_ver is not null and not exists (
    select 1 from public.prompt_versions
     where id = new.current_ver and prompt_id = new.id
  ) then raise exception 'version_not_owned_by_prompt'; end if;
  return new;
end $$;

create trigger prompts_current_version_belongs_to_prompt
before insert or update of current_ver on public.prompts
for each row execute function public.enforce_prompt_current_version();

-- The library's parent/version/pointer/activity writes are one logical save.
-- SECURITY INVOKER preserves the caller's existing owner RLS policies.
create or replace function public.library_save_prompt(
  p_title text, p_target public.model_target, p_tags text[],
  p_input text, p_output text, p_rationale text,
  p_mode public.enhance_mode, p_model_used text,
  p_token_in integer, p_token_out integer, p_content_hash text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_prompt uuid; v_version uuid;
begin
  insert into public.prompts(user_id, title, target_model, tags)
    values(auth.uid(), p_title, p_target, p_tags) returning id into v_prompt;
  insert into public.prompt_versions
    (prompt_id, input_text, output_text, rationale, mode, model_used, token_in, token_out, content_hash)
    values(v_prompt, p_input, p_output, p_rationale, p_mode, p_model_used, p_token_in, p_token_out, p_content_hash)
    returning id into v_version;
  update public.prompts set current_ver = v_version, preview = left(p_output, 200), current_mode = p_mode
    where id = v_prompt;
  insert into public.activity_events(user_id, prompt_id, type, meta) values
    (auth.uid(), v_prompt, 'created', jsonb_build_object('title', p_title)),
    (auth.uid(), v_prompt, 'saved', '{}'::jsonb);
  return v_prompt;
end $$;

create or replace function public.library_add_version(
  p_prompt_id uuid, p_input text, p_output text, p_rationale text,
  p_mode public.enhance_mode, p_model_used text,
  p_token_in integer, p_token_out integer, p_content_hash text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_parent uuid; v_version uuid;
begin
  select current_ver into v_parent from public.prompts where id = p_prompt_id for update;
  if not found then raise exception 'prompt_not_found'; end if;
  insert into public.prompt_versions
    (prompt_id, parent_ver, input_text, output_text, rationale, mode, model_used, token_in, token_out, content_hash)
    values(p_prompt_id, v_parent, p_input, p_output, p_rationale, p_mode, p_model_used, p_token_in, p_token_out, p_content_hash)
    returning id into v_version;
  update public.prompts set current_ver = v_version, preview = left(p_output, 200), current_mode = p_mode
    where id = p_prompt_id;
  insert into public.activity_events(user_id, prompt_id, type, meta) values
    (auth.uid(), p_prompt_id, 'enhanced', '{}'::jsonb),
    (auth.uid(), p_prompt_id, 'saved', '{}'::jsonb);
  return v_version;
end $$;

revoke execute on function public.library_save_prompt from anon, public;
revoke execute on function public.library_add_version from anon, public;
grant execute on function public.library_save_prompt to authenticated;
grant execute on function public.library_add_version to authenticated;
