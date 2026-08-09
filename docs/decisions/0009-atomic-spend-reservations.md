# 9. Atomic spend reservations — a concurrency guard, not a worst-case bound

Date: 2026-08-01
Status: accepted

> Retroactive record. Shipped in
> `supabase/migrations/20260730203605_atomic_spend_reservations.sql` and cited by
> CLAUDE.md §7 as the abuse control that actually exists. This ADR files the
> rationale the audit found undocumented (`DOC-008`), including the reverted first
> attempt (PR #62 → #63) so the mistake is on record.

## Context

Both model routes decided admission by reading a usage window and _then_ calling
a provider; the ledger row was written only when the call finished. The entire
provider call sits between the read and the write, so N concurrent requests all
read the same balance, all pass the daily cost cap, and all spend. The in-memory
burst guard in front of the routes is per serverless instance and cannot
converge across instances. This is the real abuse surface — not an "edge DDoS
posture", a claim CLAUDE.md §7/§9 explicitly retracted (audit `DOC-003`).

## Decision

**Take admission and a short-lived hold together, under one per-user lock, sized
as a concurrency guard.** In `supabase/migrations/20260730203605`:

- `public.usage_reservations` holds pending reservations. RLS is **on with no
  policies** (default-deny) _and_ `revoke all … from anon, authenticated`, so a
  future blanket `grant` cannot quietly open it. The `spend_*` SECURITY DEFINER
  functions are the only access path.
- `spend_reserve` takes a per-user advisory lock, sums pending holds plus settled
  spend, checks the cap, and inserts the hold — all in one transaction. A
  concurrent request sees the hold even though no ledger row exists yet.
- `spend_settle` converts a hold to a real ledger row (with the `estimated` flag
  when usage was a fallback estimate); `spend_release` drops it on failure.

**The reserve is sized from real spend, then clamped to a fraction of the cap.**
The reverted PR #62 reserved each request's theoretical worst case (full output
ceiling at list price) — 31× the largest request ever made — which at the
$2.00/day cap refused Fable 5 @ xhigh on an empty ledger, permanently. A
reservation is a concurrency guard: large enough that parallel requests cannot
collectively overshoot, small enough not to refuse legitimate traffic. The size
derives from the account's own p95 recent spend with headroom, then is **clamped
to a fraction of the cap** — the load-bearing line that makes it structurally
impossible for the reserve to approach the cap regardless of future list prices,
output ceilings, or roster changes.

## Consequences

- The daily cost cap is enforced atomically; concurrent requests can no longer
  race past it. This is the §6 guardrail "cost cap on every model route" made
  real under concurrency.
- The cap rejects on _real spend_, never on the reservation — the PR #62 failure
  cannot recur by construction (the clamp).
- Reservations are never client-writable; the functions are the sole path, and
  `pg-introspect` compares the `revoke … public` grants so an accidental
  `grant all` is caught as schema drift (`docs/runbooks/migrations.md`).
