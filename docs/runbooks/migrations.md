# Runbook — database migrations

How schema changes in `supabase/migrations/` reach the hosted project, and how to
prove they did.

## Why this runbook exists

A committed migration is not an applied migration. On 2026-07-25,
`20260726000000_kimi_k3_minimax_m3_gpt_tiers.sql` was committed to `main` and
never applied, leaving the hosted `model_target` enum two migrations behind the
app's sixteen-model roster. Four targets — GPT-5.6 Luna, GPT-5.6 Terra, Kimi K3,
MiniMax M3 — failed **every** database write with Postgres `22P02`:

- **Save to library** surfaced the raw error, `invalid input value for enum
model_target: "gpt_5_6_terra"`, straight to the user.
- **The usage-ledger write failed silently** (logged, not surfaced), so spend on
  those four models never counted against the daily cost cap — a §6 guardrail
  hole, not just a UX bug.

Every CI gate stayed green throughout: lint, typecheck, tests, and build see the
migration _file_, never the hosted schema.

## Source of truth

`supabase/migrations/` holds every schema change from 2026-07 onward. The P2–P5
base schema (`p2_auth_profile_schema` … `p5_media_assets`) was applied directly
to the hosted project and exists only in its migration ledger — which is why
`tests/unit/model-target-enum.test.ts` declares a `BASELINE_LABELS` constant for
the pre-repo enum state.

## Applying a migration

1. **Write it** as `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case>.sql`, with a
   header comment stating what it does and — for anything with a tight
   apply→deploy window — the required ordering.
2. **Apply it to the hosted project** before merging the code that depends on it:

   ```bash
   supabase link --project-ref <ref>
   supabase migration up --linked
   ```

   `supabase migration list --linked` shows local-vs-remote state; anything
   listed locally but not remotely is unapplied drift.

3. **Regenerate the types from the live schema** — do not hand-edit them:

   ```bash
   supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
   ```

   Hand-editing this file is what let the drift hide: it declared all sixteen
   labels while the database had fourteen, so typecheck happily agreed with a
   roster the database would reject.

4. **Verify against the hosted project:**

   ```bash
   npm run check:db-enum -- --strict
   ```

5. **Run the gate** — `lint → typecheck → test → test:e2e → build`.

## Enum-specific rules

- **`ALTER TYPE … ADD VALUE` is the safe direction.** Old code never writes the
  new label, new code requires it — apply it before deploying, any time.
- **`ALTER TYPE … RENAME VALUE` has a tight window.** Old code writes the old
  label, which stops existing the instant the rename runs; new code writes the
  new label, which doesn't exist until it does. Keep apply→deploy short.
  Renaming relabels existing rows for free (enum values are stored by OID), so
  no backfill is needed.
- **Enum values cannot be dropped in Postgres.** An `ADD VALUE` is permanent —
  a typo'd label is forever. This is what makes step 4 worth running before the
  deploy rather than after.
- **A `RENAME VALUE` needs a `LEGACY_TARGET_IDS` entry** in
  `src/lib/constants.ts` plus a `version` bump in the `ui.ts` persist config, or
  a stale localStorage selection 400s on `/api/enhance`. The enum-contract test
  fails if the entry is missing.

## What the guardrails cover

| Check                                        | Catches                                                                                                              | Blind to                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `npm run typecheck`                          | roster ids that disagree with the generated types union                                                              | a hand-edited types file                    |
| `npm run test` (`model-target-enum.test.ts`) | a roster entry with no migration; generated types that disagree with the migrations; a rename with no legacy mapping | whether the hosted project applied anything |
| `npm run check:db-enum -- --strict`          | the hosted enum missing a roster label                                                                               | schema beyond `model_target`                |

The first two run in CI. The third needs credentials
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, or the anon key) and
so is a release-time step: without them it reports `SKIPPED` and exits 0, and
`--strict` makes the missing credentials fatal instead. It is read-only — it
probes PostgREST with an enum-typed filter and reads the status code.
