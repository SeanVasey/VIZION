# Runbook — enabling GitHub Actions (owner-only)

## Symptom (observed 2026-07-27)

`ci.yml` and `release.yml` are valid and registered as `active`, yet **zero
runs have ever been created for CI** — including on merges to `main`. The
settings-generated workflows (CodeQL, Dependabot updates) DO create runs, but
all 19 sit `queued` forever and never pick up a runner.

That combination is not a workflow-file problem (the YAML has correct
triggers, no path filters, no required secrets). It is a repository/account
level block, which only the repo owner can fix.

## Owner checklist, in order

1. **Actions policy** — GitHub → repo **Settings → Actions → General**:
   - "Actions permissions" must allow actions to run (e.g. *Allow all actions
     and reusable workflows*). If the repo lives in an organization, the org's
     own Settings → Actions policy overrides the repo's — check both.
2. **Billing / spending limit** — GitHub → account (or org) **Settings →
   Billing and plans → Spending limits**:
   - A private repo with exhausted included Actions minutes and a $0 spending
     limit (or a lapsed payment method) queues runs forever — exactly the
     observed symptom. Raise the limit or restore billing.
3. **Verify with a manual dispatch** — Actions tab → **CI** → *Run workflow*
   on `main` (the `workflow_dispatch` trigger exists for exactly this).
   A run that starts and executes steps proves the block is lifted; a run
   that sits `queued` means step 1 or 2 is still unresolved.
4. **After the first green run**, re-check the branch-protection story: with
   CI actually executing, `verify` can become a required status check on
   `main`.

## Deferred until Actions runs (documented, not done)

- Wiring `npm run check:db-enum -- --strict` into CI needs
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` as the repo's
  first **Actions secrets** (Settings → Secrets and variables → Actions) plus
  a workflow step. Add the secrets first; the step is a two-line change to
  `ci.yml`.
- `release.yml` needs nothing extra — it uses `github.token` only and fires
  on `package.json` version bumps once Actions can run at all.
