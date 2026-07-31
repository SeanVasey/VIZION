-- Fix: `spend_reserve` raised 42702 on every call.
--
-- The function's RETURNS TABLE declares an OUT parameter named `reserved_usd`,
-- and its body summed the pending holds with an unqualified `sum(reserved_usd)`
-- over `usage_reservations` — a table whose column is also `reserved_usd`. In
-- plpgsql the OUT parameter is in scope inside the body, so the reference
-- resolves to neither: `column reference "reserved_usd" is ambiguous`.
--
-- It compiles. `create function` does not resolve identifiers in the body, so
-- the migration applied cleanly and the defect only appeared when the function
-- was actually CALLED — which is why it was caught by probing the function
-- rather than by the migration succeeding.
--
-- The table is aliased here rather than renaming the OUT parameter, because the
-- parameter name is the JSON key the route reads off the RPC result.

create or replace function public.spend_reserve(
  p_cap numeric,
  p_rate_limit integer,
  p_rate_seconds integer
) returns table (reservation_id uuid, today_cost numeric, reserved_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_floor constant numeric := 0.01;
  c_headroom constant numeric := 3;
  c_cap_share constant numeric := 10;
  v_user uuid := auth.uid();
  v_today numeric;
  v_pending numeric;
  v_recent integer;
  v_p95 numeric;
  v_reserve numeric;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_cap <= 0 or p_rate_limit <= 0 or p_rate_seconds <= 0 then
    raise exception 'invalid_limit';
  end if;

  perform pg_advisory_xact_lock(hashtext('model_spend:' || v_user::text));

  update public.usage_reservations ur
     set status = 'released', settled_at = now()
   where ur.user_id = v_user
     and ur.status = 'pending'
     and ur.created_at < now() - interval '5 minutes';

  select coalesce(sum(ue.cost_usd), 0) into v_today
    from public.usage_events ue
   where ue.user_id = v_user
     and ue.created_at >= date_trunc('day', now());

  -- Aliased: bare `reserved_usd` would bind to this function's OUT parameter.
  select coalesce(sum(ur.reserved_usd), 0) into v_pending
    from public.usage_reservations ur
   where ur.user_id = v_user and ur.status = 'pending';

  select count(*) into v_recent
    from public.usage_events ue
   where ue.user_id = v_user
     and ue.created_at >= now() - make_interval(secs => p_rate_seconds);
  v_recent := v_recent + (
    select count(*)
      from public.usage_reservations ur
     where ur.user_id = v_user
       and ur.status = 'pending'
       and ur.created_at >= now() - make_interval(secs => p_rate_seconds)
  );

  if v_recent >= p_rate_limit then raise exception 'rate_limited'; end if;
  if v_today + v_pending >= p_cap then raise exception 'cap_reached'; end if;

  select percentile_cont(0.95) within group (order by recent.cost_usd)
    into v_p95
    from (
      select ue.cost_usd
        from public.usage_events ue
       where ue.user_id = v_user
       order by ue.created_at desc
       limit 200
    ) recent;

  -- greatest() first so a new account still holds something meaningful;
  -- least() LAST so the cap share always wins.
  v_reserve := least(
    greatest(coalesce(v_p95, 0) * c_headroom, c_floor),
    p_cap / c_cap_share
  );

  insert into public.usage_reservations (user_id, reserved_usd)
    values (v_user, v_reserve)
    returning id into v_id;

  return query select v_id, v_today, v_reserve;
end $$;

revoke execute on function public.spend_reserve(numeric, integer, integer)
  from anon, public;
grant execute on function public.spend_reserve(numeric, integer, integer)
  to authenticated;
