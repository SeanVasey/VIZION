-- Cost-truth marking (INV-04 / audit INV-005): usage rows whose token counts
-- came from the ~4 chars/token fallback (or vision's absent-usage default)
-- are ledgered as ESTIMATES, never as measurements. The flag rides the same
-- spend_settle write; nothing else about admission or settlement changes.
--
-- Deploy order: apply BEFORE deploying the code that passes p_estimated — the
-- defaulted parameter keeps the previous 7-argument call shape working, so
-- old code + new function is safe, while new code + old function would fail
-- every settle with PGRST202 (no function with these parameters).

alter table public.usage_events
  add column estimated boolean not null default false;

-- Recreate spend_settle with the flag. The 7-arg version is dropped rather
-- than overloaded: PostgREST resolves RPCs by named parameters, and a pair of
-- overloads differing only by a defaulted trailing parameter is ambiguous.
drop function if exists public.spend_settle(
  uuid, model_target, text, text, integer, integer, numeric
);

create function public.spend_settle(
  p_reservation_id uuid,
  p_target model_target,
  p_mode text,
  p_model_used text,
  p_token_in integer,
  p_token_out integer,
  p_cost_usd numeric,
  p_estimated boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
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
    (user_id, target, mode, model_used, token_in, token_out, cost_usd, estimated)
  values
    (v_user, p_target, p_mode, p_model_used, p_token_in, p_token_out,
     p_cost_usd, p_estimated);
end $$;

-- Same execute posture as the function it replaces (a recreate loses grants):
-- authenticated only, per the SECURITY DEFINER rule in tasks/lessons.md.
revoke execute on function public.spend_settle(
  uuid, model_target, text, text, integer, integer, numeric, boolean
) from anon, public;
grant execute on function public.spend_settle(
  uuid, model_target, text, text, integer, integer, numeric, boolean
) to authenticated;
