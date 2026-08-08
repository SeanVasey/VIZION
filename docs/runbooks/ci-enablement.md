# Runbook — enabling GitHub Actions (owner-only)

## The cause, measured 2026-08-08

Asking the API to dispatch CI returns the answer directly:

```
POST /repos/SeanVasey/VIZION/actions/workflows/ci.yml/dispatches
→ 422  Actions has been disabled for this user.
```

**"for this user" — not for this repository, and not for an organization.**
The block is on the ACCOUNT, which is why the two symptoms below have one cause
rather than the two this runbook previously inferred. Any run GitHub itself
creates (CodeQL, Dependabot) is still *recorded*, because recording happens
account-side of the block; nothing can ever be *picked up*.

That correction matters for where to click. The old checklist opened with repo
Settings → Actions → General, which cannot resolve an account-level disable —
following it would have read as "the setting is already correct" and sent the
next attempt in a circle. Repo and org policy are still worth confirming, but
they are step 2 now, not step 1.

Re-measured the same day: **31 run records, every one `queued` with a null
conclusion**, oldest 2026-06-14, newest 2026-08-08 — and not one of them is
`CI` or `Release`. Both counts have grown since 2026-07-30 (23 → 31) purely
from GitHub's own workflows, which confirms the block is still live rather
than a stale observation.

## Symptom (first seen 2026-07-27 · re-measured 2026-07-30 and 2026-08-08)

There are **two visible failures here**, and the earlier version of this
runbook read them as two independent causes. The dispatch error above shows
they are one:

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

Both follow from one account-level disable: nothing of ours is ever dispatched,
and the records GitHub creates on its own behalf can never be picked up.

## Owner checklist, in order

Only the account owner can clear step 1, and no API token can do it — the
dispatch endpoint refuses before it reaches the repository.

1. **Account-level Actions — do this first; it is what the 422 names.**
   GitHub → **your account** Settings (not the repo's):
   - **Billing and plans → Spending limits.** The usual cause of an
     account-wide disable is exhausted included minutes against a $0 limit, or
     a payment method that failed. Restore billing / raise the limit.
   - **Billing and plans → Plans.** Confirm the account is in good standing;
     a lapsed or downgraded plan disables Actions account-wide.
   - If both look correct, the disable is an enforcement action rather than a
     billing state, and only **GitHub Support** can lift it. Quote the 422
     verbatim — "Actions has been disabled for this user" is the phrase that
     routes the ticket correctly.
2. **Repo (and org) Actions policy — confirm, do not assume.** GitHub → repo
   **Settings → Actions → General** → "Actions permissions" must allow runs
   (e.g. *Allow all actions and reusable workflows*). If the repo lives in an
   organization, the org policy overrides the repo's; check both. This is a
   real prerequisite, but it is **not** the current blocker — see the 422.
3. **Verify with a manual dispatch** — Actions tab → **CI** → *Run workflow*
   on `main` (the `workflow_dispatch` trigger exists for exactly this), or the
   API call at the top of this file. Read the outcome:
   - *422 "disabled for this user"* → step 1 is still unresolved.
   - *No run appears, no error* → step 2 is still unresolved.
   - *A run appears and sits `queued`* → dispatch works; runner capacity or
     billing is still short.
   - *A run appears and executes steps* → clear; proceed to step 4.
4. **After the first green run**, re-check the branch-protection story: with
   CI actually executing, `verify` can become a required status check on
   `main`.

## How to re-measure

Three checks, all cheap to repeat. Run the dispatch FIRST — it names the cause
outright, where the other two only describe the shape of the failure:

- Dispatch CI on `main` (`actions_run_trigger` → `run_workflow`, or the
  Actions tab). The error body is the diagnosis; see the top of this file.

Then the two reads:

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

Running it from a fresh container needs two provisioning steps before
`npm run test:e2e` means anything, and neither is implied by `npm ci`:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install webkit chromium
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install-deps webkit   # needs root
```

The second is the one that bites. Without the WebKitGTK system libraries every
`mobile-safari` test fails at `browserType.launch` with a missing-library
banner — 30 failures that look like a code regression and are not. `install-deps`
shells out to `apt`, so it needs root; under a sandboxed runner it must be
allowed to escalate or it fails silently-ish and the suite stays red.
