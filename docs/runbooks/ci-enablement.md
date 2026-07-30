# Runbook — enabling GitHub Actions (owner-only)

## Symptom (first seen 2026-07-27 · re-measured 2026-07-30)

There are **two different failures here**, and the earlier version of this
runbook conflated them. Separating them is what points at the cause:

1. **`ci.yml` and `release.yml` have never produced a run record at all.**
   Not queued — *absent*. Both are registered and `active` (CI is workflow id
   `295232069`), both are valid YAML on `main`, and `main` has taken repeated
   merges since they landed. A `push`-triggered workflow that creates no record
   was never dispatched, which is a different thing from one that was
   dispatched and is waiting for capacity.

2. **Every run record that does exist is stuck `queued` forever.** As of
   2026-07-30 the repository has 23 run records, oldest 2026-06-13, newest
   2026-07-28, and **all 23 are `queued` with a null conclusion**. Not one has
   ever executed. Every one belongs to a settings-generated workflow — CodeQL
   (4) and Dependabot version updates (19, across `dynamic` and the
   `npm_and_yarn in /.` update jobs). Those are created by GitHub itself, which
   is why they exist when ours do not.

Neither symptom is explainable by the workflow files: the triggers are plain
(`push` → `main`, `pull_request` → `main`, `workflow_dispatch`), there are no
path filters, no `if:` conditions, and no required secrets. Both are
repository/account-level, and only the repo owner can clear them.

The distinction matters for the order of the checklist: symptom 1 (no record
created) reads as an **Actions permissions** block, symptom 2 (records created,
never picked up) reads as **runner capacity or billing**. Fixing billing alone
would not make `ci.yml` start dispatching.

## Owner checklist, in order

1. **Actions policy — do this first; it is the one that explains symptom 1.**
   GitHub → repo **Settings → Actions → General**:
   - "Actions permissions" must allow actions to run (e.g. *Allow all actions
     and reusable workflows*). If Actions are disabled for the repository,
     push/PR events create no run records — exactly what we see — while
     GitHub's own security/dependency workflows still register theirs.
   - If the repo lives in an organization, the org's Settings → Actions policy
     overrides the repo's. Check both.
2. **Billing / spending limit — explains symptom 2.** GitHub → account (or
   org) **Settings → Billing and plans → Spending limits**:
   - A private repo with exhausted included Actions minutes and a $0 spending
     limit (or a lapsed payment method) queues runs forever. That is precisely
     the state of all 23 existing records. Raise the limit or restore billing.
3. **Verify with a manual dispatch** — Actions tab → **CI** → *Run workflow*
   on `main` (the `workflow_dispatch` trigger exists for exactly this).
   Read the outcome against the two symptoms:
   - *No run appears* → step 1 is still unresolved.
   - *A run appears and sits `queued`* → step 1 is fixed, step 2 is not.
   - *A run appears and executes steps* → both are clear; proceed to step 4.
4. **After the first green run**, re-check the branch-protection story: with
   CI actually executing, `verify` can become a required status check on
   `main`.

## How to re-measure

The evidence above is two API reads, both cheap to repeat:

- Run records and their statuses — `actions_list` / `list_workflow_runs` with
  no `resource_id` (all workflows). Look at `total_count`, and group by
  `(name, status, conclusion)`. The tell is whether any `CI` or `Release`
  record exists at all, separately from whether anything has ever left
  `queued`.
- Workflow registration — `list_workflows`. `state: active` for `ci.yml`
  confirms the file is parsed and registered, so an absent run record is not a
  syntax or discovery problem.

## Deferred until Actions runs (documented, not done)

- Wiring `npm run check:db-enum -- --strict` into CI needs
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` as the repo's
  first **Actions secrets** (Settings → Secrets and variables → Actions) plus
  a workflow step. Add the secrets first; the step is a two-line change to
  `ci.yml`.
- `release.yml` needs nothing extra — it uses `github.token` only and fires
  on `package.json` version bumps once Actions can run at all.

## What is carrying the gate meanwhile

Nothing in CI has ever run, so **every green claim to date comes from the
local gate** in CLAUDE.md §3 (`lint → typecheck → test → test:e2e → build`,
plus `npm run audit:check`) and from Vercel's per-PR preview build. That is
worth stating plainly: the branch-protection story is unenforced, and a commit
that skipped the local gate would not be caught by anything. Treat the local
gate as mandatory rather than as a convenience until step 3 above passes.
