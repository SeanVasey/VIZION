-- P3 — per-user model-usage ledger backing the rate limit + cost cap.
-- One row per enhance call; RLS owner-only from creation.

create table public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  target     public.model_target not null,
  mode       text not null,
  model_used text not null,
  token_in   integer not null default 0,
  token_out  integer not null default 0,
  cost_usd   numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

comment on table public.usage_events is
  'Per-user model usage ledger. Backs rate limiting (recent count) and the daily cost cap (sum of cost_usd).';

alter table public.usage_events enable row level security;

create policy "usage_select_own"
  on public.usage_events for select
  using (auth.uid() = user_id);

create policy "usage_insert_own"
  on public.usage_events for insert
  with check (auth.uid() = user_id);

-- Server-side aggregate for the cost cap + rate window, runs as the caller
-- (SECURITY INVOKER) so RLS still scopes the counts to the owner.
create or replace function public.usage_window(p_rate_seconds integer)
returns table (recent_count bigint, today_cost numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (
      where created_at >= now() - make_interval(secs => p_rate_seconds)
    ) as recent_count,
    coalesce(
      sum(cost_usd) filter (where created_at >= date_trunc('day', now())),
      0
    ) as today_cost
  from public.usage_events
  where user_id = auth.uid();
$$;
