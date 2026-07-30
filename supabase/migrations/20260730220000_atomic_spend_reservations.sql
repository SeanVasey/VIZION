-- Atomic model-spend admission.
--
-- WHY
-- ---
-- Both model routes decide admission by reading a usage window and then calling
-- a provider; the ledger row is only written when the call finishes. Between the
-- read and the write sits the entire provider call, so N concurrent requests all
-- read the same balance, all pass the cap, and all spend. The in-memory burst
-- guard in front of it is per serverless instance and cannot converge.
--
-- A reservation closes that window: admission and the hold are taken together
-- under one per-user lock, so a concurrent request sees the hold even though no
-- ledger row exists yet.
--
-- WHY THE RESERVE IS SIZED HERE, NOT IN THE APP
-- ---------------------------------------------
-- The previous attempt at this (PR #62, reverted in #63) reserved each request's
-- theoretical WORST CASE — the target's full output ceiling at its list price.
-- That is 31x the largest request this project has ever actually made. Measured
-- against the shipped $2.00/day cap it meant:
--
--   Fable 5 @ xhigh/max -> reserve $3.20  -> exceeds the cap outright, so EVERY
--                                            request was refused on an empty
--                                            ledger, permanently.
--   Opus 5  @ auto      -> reserve $0.80  -> two enhancements per day.
--
-- The error was conceptual: a reservation is a concurrency guard, not a worst-
-- case bound. It only has to be large enough that parallel requests cannot
-- collectively overshoot, and small enough not to refuse legitimate traffic.
-- Sized as a worst case, the cap starts rejecting on the RESERVATION instead of
-- on real spend.
--
-- So the size is derived from what this account actually spends — p95 of its own
-- recent events with headroom — and then CLAMPED to a fraction of the cap. The
-- clamp is the load-bearing line: it makes it structurally impossible for the
-- reserve to approach the cap, whatever happens later to list prices, output
-- ceilings, or the model roster. The failure above cannot recur by construction.

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_usd numeric(10, 6) not null check (reserved_usd > 0),
  status text not null default 'pending'
    check (status in ('pending', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

comment on table public.usage_reservations is
  'Short-lived holds taken before a model call so concurrent requests cannot '
  'race past the daily cost cap. Never client-writable: the spend_* functions '
  'are the only access path.';

-- RLS on with NO policies: default-deny. Belt and braces with the revoke below,
-- so a future `grant all on all tables` cannot quietly open this up.
alter table public.usage_reservations enable row level security;
revoke all on table public.usage_reservations from anon, authenticated;

-- The pending-sum and sweep both filter on (user_id, status='pending').
create index usage_reservations_owner_pending
  on public.usage_reservations (user_id, created_at)
  where status = 'pending';

/**
 * Admit one model call, or raise. Returns the reservation to settle/release,
 * today's committed spend (for the client's cap readout), and the amount held.
 *
 * `p_cap` and `p_rate_limit` come from server env, so they are parameters. A
 * client calling this directly with invented limits only affects its own
 * admission — the ledger row written by spend_settle is what actually counts,
 * and a bogus reservation reduces that account's own headroom.
 */
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
  -- Cold-start hold for an account with no history yet.
  c_floor constant numeric := 0.01;
  -- Headroom over p95, so an ordinary request is comfortably inside its hold.
  c_headroom constant numeric := 3;
  -- The reserve may never exceed this share of the daily cap. See header.
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

  -- Serialize this account's admissions for the rest of the transaction. Two
  -- parallel requests cannot both read the same balance and both pass.
  perform pg_advisory_xact_lock(hashtext('model_spend:' || v_user::text));

  -- Reclaim holds whose run never reported back — a crashed process, a function
  -- killed at its duration limit, a client that vanished mid-stream. Without
  -- this a lost run would eat headroom until midnight.
  update public.usage_reservations
     set status = 'released', settled_at = now()
   where user_id = v_user
     and status = 'pending'
     and created_at < now() - interval '5 minutes';

  -- Committed spend today. Same UTC day boundary as usage_window().
  select coalesce(sum(cost_usd), 0) into v_today
    from public.usage_events
   where user_id = v_user
     and created_at >= date_trunc('day', now());

  -- NOTE: this reference is unqualified and therefore AMBIGUOUS against this
  -- function's `reserved_usd` OUT parameter. Fixed in
  -- 20260730230000_fix_spend_reserve_ambiguity.sql — left as written here
  -- because the migration was already applied and history is append-only.
  select coalesce(sum(reserved_usd), 0) into v_pending
    from public.usage_reservations
   where user_id = v_user and status = 'pending';

  -- A pending hold has no ledger row yet, and a settled one is no longer
  -- pending, so a request is counted exactly once across these two.
  select count(*) into v_recent
    from public.usage_events
   where user_id = v_user
     and created_at >= now() - make_interval(secs => p_rate_seconds);
  v_recent := v_recent + (
    select count(*)
      from public.usage_reservations
     where user_id = v_user
       and status = 'pending'
       and created_at >= now() - make_interval(secs => p_rate_seconds)
  );

  if v_recent >= p_rate_limit then raise exception 'rate_limited'; end if;

  -- Admission is still decided on spend that has actually happened (plus holds
  -- in flight) — NOT on committed + pending + this request's hold. The latter is
  -- what refused the first request of the day in the reverted attempt.
  if v_today + v_pending >= p_cap then raise exception 'cap_reached'; end if;

  select percentile_cont(0.95) within group (order by cost_usd)
    into v_p95
    from (
      select cost_usd
        from public.usage_events
       where user_id = v_user
       order by created_at desc
       limit 200
    ) recent;

  -- greatest() first so a new account still holds something meaningful;
  -- least() LAST so the cap share always wins, including when the cap is
  -- configured so low that the share falls under the floor.
  v_reserve := least(
    greatest(coalesce(v_p95, 0) * c_headroom, c_floor),
    p_cap / c_cap_share
  );

  insert into public.usage_reservations (user_id, reserved_usd)
    values (v_user, v_reserve)
    returning id into v_id;

  return query select v_id, v_today, v_reserve;
end $$;

/**
 * Record what a call actually cost and drop its hold.
 *
 * The ledger insert is NOT conditional on the hold still being pending. If the
 * five-minute sweep already released it (a slow provider, a long stream), the
 * money was still spent, and a spend that is not recorded is a spend the cap
 * cannot see. The reverted attempt raised `reservation_not_pending` here and
 * wrote nothing — that turns a slow request into free spend.
 */
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
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_token_in < 0 or p_token_out < 0 or p_cost_usd < 0 then
    raise exception 'invalid_usage';
  end if;

  update public.usage_reservations
     set status = 'settled', settled_at = now()
   where id = p_reservation_id
     and user_id = v_user
     and status = 'pending';

  insert into public.usage_events
    (user_id, target, mode, model_used, token_in, token_out, cost_usd)
  values
    (v_user, p_target, p_mode, p_model_used, p_token_in, p_token_out, p_cost_usd);
end $$;

/** Drop a hold for a call that produced no billable usage. */
create or replace function public.spend_release(p_reservation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.usage_reservations
     set status = 'released', settled_at = now()
   where id = p_reservation_id
     and user_id = auth.uid()
     and status = 'pending';
$$;

revoke execute on function public.spend_reserve(numeric, integer, integer)
  from anon, public;
revoke execute on function public.spend_settle(
  uuid, public.model_target, text, text, integer, integer, numeric
) from anon, public;
revoke execute on function public.spend_release(uuid) from anon, public;

grant execute on function public.spend_reserve(numeric, integer, integer)
  to authenticated;
grant execute on function public.spend_settle(
  uuid, public.model_target, text, text, integer, integer, numeric
) to authenticated;
grant execute on function public.spend_release(uuid) to authenticated;

-- NOTE: public.record_usage() is deliberately left in place. It is the ledger
-- writer the currently-deployed build calls, and dropping it in the same
-- migration would break every write until the new release is live — the exact
-- apply-before-deploy trap 20260730210000 documents. It stays as a constrained
-- second writer (same DEFINER shape, same non-negative validation) and can be
-- dropped in a later cleanup once no deployed build references it.
