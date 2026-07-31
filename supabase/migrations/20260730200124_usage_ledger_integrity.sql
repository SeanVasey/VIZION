-- Usage-ledger integrity: make the daily cost cap unforgeable.
--
-- WHY
-- ---
-- `usage_window()` derives `today_cost` as a plain `sum(cost_usd)` over
-- `public.usage_events`, and both model routes admit a request only while that
-- sum is under `COST_CAP_USD_PER_DAY`. Until now the row feeding that sum was
-- writable directly by the account it constrains:
--
--   * `authenticated` held INSERT on the table,
--   * policy `usage_insert_own` accepts any row whose `user_id = auth.uid()`,
--   * and NO check constraint bounded `cost_usd`.
--
-- So a signed-in client holding the public anon key could insert a single row
-- with a negative `cost_usd`, drive `today_cost` permanently below the cap, and
-- spend without limit on the server's provider keys. Audited 2026-07-30: 109
-- rows, zero negatives — the hole was open, not exploited.
--
-- WHAT
-- ----
-- 1. A CHECK constraint, so a negative amount cannot exist at any privilege
--    level — including through the SECURITY DEFINER path below.
-- 2. `record_usage()`, a SECURITY DEFINER writer that derives `user_id` from
--    the verified JWT and re-validates the amounts, so the routes stop needing
--    a direct table grant at all.
--
-- ORDERING
-- --------
-- This migration is deploy-safe in either direction: it only ADDS a constraint
-- the application already satisfies and ADDS a function. The matching REVOKE of
-- the direct table grants is deliberately held back in
-- `20260730210000_usage_ledger_revoke.sql`, which must not be applied until the
-- release that calls `record_usage()` is live — see that file's header.

-- 1. Amounts are never negative. The ledger is append-only to users already
--    (no UPDATE/DELETE policy exists), so this is the remaining degree of
--    freedom a client had over its own spend total.
alter table public.usage_events
  add constraint usage_events_nonneg_amounts
  check (cost_usd >= 0 and token_in >= 0 and token_out >= 0);

-- 2. The route's ledger write, as a function rather than a table grant.
--    SECURITY DEFINER so the direct INSERT privilege can be withdrawn; the
--    owner is never taken from an argument, so there is nothing for a caller to
--    vary except the amounts, which are re-checked here and again by the
--    constraint above.
--
--    EXPECTED ADVISOR WARNING — do not "fix" it.
--    Supabase's linter raises `authenticated_security_definer_function_executable`
--    (0029) for this function: a SECURITY DEFINER function callable by signed-in
--    users. That is the entire point. Switching it to SECURITY INVOKER, or
--    revoking EXECUTE from `authenticated`, puts the routes back on a direct
--    table INSERT — which is the grant this change exists to withdraw, and the
--    grant that made the daily cap forgeable in the first place.
--
--    What a caller can actually do with it: append a row to their OWN ledger
--    (the owner is `auth.uid()`, not an argument) with non-negative amounts.
--    That can only raise their own spend total and lock themselves out of their
--    own cap — it cannot touch another account and cannot lower any total. The
--    one residual it shares with the grant it replaces is that an authenticated
--    client can call it in a loop to add rows; that is unchanged by this
--    migration, and is the natural place to add a bound once the direct grant
--    is gone (see 20260730210000).
create or replace function public.record_usage(
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
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_token_in < 0 or p_token_out < 0 or p_cost_usd < 0 then
    raise exception 'invalid_usage';
  end if;

  insert into public.usage_events
    (user_id, target, mode, model_used, token_in, token_out, cost_usd)
  values
    (v_user, p_target, p_mode, p_model_used, p_token_in, p_token_out, p_cost_usd);
end $$;

revoke execute on function public.record_usage(
  public.model_target, text, text, integer, integer, numeric
) from anon, public;

grant execute on function public.record_usage(
  public.model_target, text, text, integer, integer, numeric
) to authenticated;

comment on function public.record_usage is
  'Append a usage-ledger row for the calling user. SECURITY DEFINER so the '
  'direct INSERT grant on usage_events can be withdrawn: the owner comes from '
  'the verified JWT, never from an argument.';
