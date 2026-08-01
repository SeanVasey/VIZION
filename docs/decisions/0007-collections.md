# 7. Collections — named folders for the prompt library

Date: 2026-08-01
Status: accepted

> Retroactive record. Shipped in the 0.3.0 cycle
> (`supabase/migrations/20260727141615_collections.sql`, `CHANGELOG.md`); this
> ADR files the rationale the audit found undocumented (`DOC-008`). It also
> supplies the governance trail the prior-art track flagged as missing
> (`PRI-015`: the feature landed against an earlier "not currently worth
> developing" note, by explicit owner decision).

## Context

The library grew past the point where a flat list served. Users needed a way to
group prompts (by project, by client, by model) without the weight of tags or a
hierarchy. A 2026-07 UX audit deferred folders; the owner later called them in.

## Decision

**One optional collection per prompt, via a nullable foreign key — additive, no
enum surgery, no destructive coupling.**

- `public.collections`: `id`, `user_id`, `name` (unique per owner, 1–60 chars),
  timestamps. It is the first table these in-repo migrations *create* (the P2–P5
  base schema was applied directly to the hosted project), so its owner-only RLS
  policies (`collections_{select,insert,update,delete}_own`) ship in the same
  file, per CLAUDE.md §6 (never a table without a policy).
- `prompts.collection_id` is **nullable** with `on delete set null`: deleting a
  collection *releases* its prompts, never deletes them. A prompt belongs to at
  most one collection.
- The existing owner policies on `prompts` already cover the new column; no
  policy change there.

## Consequences

- `collection_id` drives the library filter, the facet counts, and the
  Move-to-collection sheet.
- Because the migration is additive (no `ALTER TYPE`), there is no apply→deploy
  ordering hazard — it is safe to apply any time before the dependent client
  ships.
- Collection assignment must **not** count as prompt activity: a later migration
  scoped `prompts_set_updated_at` to exclude `collection_id` so moving a prompt
  between folders does not reorder the recency view (audit `LIB-009`).
