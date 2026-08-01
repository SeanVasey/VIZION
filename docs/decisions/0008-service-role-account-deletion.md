# 8. Service-role account deletion — one credential, one consumer, fail-closed

Date: 2026-08-01
Status: accepted

> Retroactive record. The posture is stated in `SECURITY.md`; the implementation
> is `src/lib/supabase/admin.ts`. This ADR files the decision itself, which the
> audit found had no record (`DOC-008`).

## Context

Deleting a user account must remove rows the user cannot reach under RLS —
`auth.users`, storage objects, cross-table records whose policies scope to
`auth.uid()`. That requires the Supabase **service-role** key, which bypasses
Row-Level Security entirely. It is the highest-privilege credential the codebase
touches, and CLAUDE.md §6 makes model/provider keys server-only by contract; the
service-role key needs an even tighter rule because RLS — the guardrail every
other path relies on — does not apply to it.

## Decision

**Exactly one consumer, constructed per request only after the session is
verified, and fail-closed when unset.** In `src/lib/supabase/admin.ts`:

- `import "server-only"` makes any client-bundle import a build error.
- `createAdminClient()` is called **only** by the account-deletion route handler
  (`/auth/delete-account`). Importing it anywhere else requires a SECURITY.md
  update — the rule is written at the call site.
- It is constructed **per request**, never a module-level singleton, so the key
  is read only when a verified session has already asked for deletion. The only
  identifier the flow ever hands it is the session's own user id.
- It returns `null` when `SUPABASE_SERVICE_ROLE_KEY` is unset, so callers fail
  closed with a clear message instead of crashing mid-flow. The key ships to the
  deployment environment only when account deletion is enabled.
- The client is built with `persistSession: false, autoRefreshToken: false` — it
  is a one-shot administrative client, never a session.

## Consequences

- The blast radius of the most dangerous credential in the system is one file
  and one route, auditable at a glance, and enforced by `server-only` at build
  time.
- An environment without the key degrades gracefully (deletion disabled with a
  clear error) rather than exposing a half-working destructive flow.
- Any future need for service-role access is a deliberate, reviewable change to
  SECURITY.md and this record — not an ad-hoc import.
