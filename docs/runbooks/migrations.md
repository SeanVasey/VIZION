# Runbook — database migrations

How schema changes in `supabase/migrations/` reach the hosted project, and how to
prove they did.

## Why this runbook exists

A committed migration is not an applied migration. On 2026-07-25,
`20260725133703_kimi_k3_minimax_m3_gpt_tiers.sql` was committed to `main` and
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

`supabase/migrations/` holds **every** schema change, including the P2–P5 base
schema (`p2_auth_profile_schema` … `p5_media_assets`). That was not true until
2026-07-31: those seven were applied directly to the hosted project and existed
only in its migration ledger, so the database could not be rebuilt from the
repository and nothing said so. They were recovered verbatim from
`supabase_migrations.schema_migrations.statements` — which preserves the SQL as
applied — and each file is byte-identical to what the ledger holds.

**Filenames are the ledger's versions, not hand-picked timestamps.** The CLI
matches the leading 14 digits against `supabase_migrations.schema_migrations`;
a file whose version is not in the ledger is not "skipped", it is applied. Every
one of the sixteen 2026-07 migrations carried a hand-rounded timestamp that
matched nothing remote, so a `supabase db push` from this repo would have tried
to re-run all sixteen against production — `create table public.collections`
included. They now carry the versions the ledger recorded. `tests/unit/migrations.test.ts`
keeps the naming parseable and the ordering stable.

**Stale cross-references inside applied migrations (audit `INV-008`).** Three
comment breadcrumbs cite companion migrations by the hand-rounded timestamps the
files carried _before_ they were renamed to their ledger versions. The SQL is
unaffected — only the comments point at filenames that never shipped. Applied
migrations are append-only, so the correction lives here, not in the files:

| file (comment)                                                    | timestamp cited  | actual file                                      |
| ----------------------------------------------------------------- | ---------------- | ------------------------------------------------ |
| `20260730203605_atomic_spend_reservations.sql:123`                | `20260730230000` | `20260730203737_fix_spend_reserve_ambiguity.sql` |
| `20260730200124_usage_ledger_integrity.sql:32,63` · `…203605:248` | `20260730210000` | `20260730202138_usage_ledger_revoke.sql`         |

The apply _order_ those comments describe is correct; only the filenames they
name are stale. `tests/unit/migrations.test.ts` pins the real ordering.

## Proving the directory can still build the database

```bash
npm run db:verify
```

Replays every migration, in filename order, against a throwaway PostgreSQL
cluster, then prints a per-category fingerprint of the resulting `public`
schema. Exits 2 (a skip, not a failure) when no server binaries are present.

Prefer `supabase db reset` where Docker is available — it uses the platform's
own image. `db:verify` is the fallback for environments without a daemon: it
supplies the handful of platform objects the migrations bind to from
`scripts/pg-shim.sql`. Anything the shim has to grow is a new dependency on
Supabase internals and worth a second look.

**To compare against production**, run `scripts/pg-introspect.sql` on the hosted
project (SQL editor, or the Supabase MCP `execute_sql`) and diff the two tables.
Equal counts and equal digests in all eleven rows means the repo reproduces the
live schema.

The fingerprint covers `public` **and** the parts of `storage` the baseline
creates: the seven policies on `storage.objects` that scope avatar and media
uploads to their owner, the RLS flags on both storage tables, and the two
bucket rows (whether `media` is private, what mime types either accepts). It
also counts `PUBLIC` among the EXECUTE grantees — `aclexplode` reports PUBLIC
as grantee OID 0, which has no `pg_roles` row, so it is easy to drop by
accident, and `revoke execute … from … public` on the SECURITY DEFINER routines
is exactly the control worth comparing. The rest of `storage` is out of scope on
purpose: `pg-shim.sql` builds a minimal `storage.objects`, so comparing its
columns would be noise.

Three facts are recorded that no definition text carries, each of which would
otherwise let a materially different schema compare equal:

| fact                     | what the obvious comparison misses                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_policies.permissive` | RESTRICTIVE composes with `AND`, not `OR`. Flip one of the two `storage.objects` INSERT policies and every upload is denied — with both predicates, and every other field of the policy, unchanged. |
| `pg_trigger.tgenabled`   | `pg_get_triggerdef` reconstructs the same `CREATE TRIGGER` whether or not it fires. A disabled `enforce_prompt_current_version` lets `prompts.current_ver` point at another prompt's version.       |
| function owner           | On a SECURITY DEFINER routine the owner _is_ the privilege set the body runs with.                                                                                                                  |

Table ownership is compared for `public` only — a table's owner bypasses its own
RLS unless `FORCE` is set. The storage tables are excluded: they belong to
`supabase_storage_admin` hosted and to the local superuser under the shim, so
comparing them would differ on every run and mean nothing.

One benign difference to expect: `--` comments inside a function body count
toward the `function` digest, and the apply path that wrote the hosted schema
strips them. If `function` is the only category that differs, re-compare with
comments removed before calling it drift:

```sql
select proname, md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' order by 1;
```

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
  the enum-typed COLUMNS need no backfill.
- **A `RENAME VALUE` ships the content-hash re-key beside it — every time.**
  "No backfill" is true of the columns and false of anything DERIVED from the
  label. `prompt_versions.content_hash` is
  `sha256(input ∥ US ∥ output ∥ US ∥ mode ∥ US ∥ target)` (ruling Q5,
  `20260801200000_library_media_correctness.sql`): the target's enum **label**
  is inside the digest. A rename changes the label under every stored row, but
  a hash computed from the old label is just bytes and does not follow. After
  the rename, saving content the user already has computes a hash from the new
  label, finds no match, and files a **duplicate card — silently**, because a
  missed dedupe is not an error and no gate can see it. The fix is the Q5
  backfill run again, as its own migration immediately after the rename
  (`20261128120100_rehash_after_roster_rename.sql` is the template): it keys
  on the parent prompt's `target_model::text`, which now reads the new label,
  writes only rows whose hash actually changes, and is idempotent. Keep it a
  separate file — it is DML over existing rows and belongs in its own
  transaction, after the enum change has committed — and keep its expression
  byte-matched with `src/lib/library/hash.ts` and the original in
  `20260801200000`. This was missed on **both** earlier post-Q5 renames
  (`20260808` and `20260911` left stale hashes behind; nothing failed, so
  nobody noticed); the 2026-11-28 re-key repairs those leftovers in the same
  pass.
- **Enum values cannot be dropped in Postgres.** An `ADD VALUE` is permanent —
  a typo'd label is forever. This is what makes step 4 worth running before the
  deploy rather than after.
- **A `RENAME VALUE` needs a `LEGACY_TARGET_IDS` entry** in
  `src/lib/constants.ts` plus a `version` bump in the `ui.ts` persist config, or
  a stale localStorage selection 400s on `/api/enhance`. The enum-contract test
  fails if the entry is missing, and `tests/unit/ui-store.test.ts` ties the
  persist version to the size of the legacy map so the bump cannot be forgotten.
  The same map is what the SERVER folds a retired id forward with
  (`resolveTargetId`, used by `/api/enhance`, `/api/media` and the library and
  draft save actions): a rename and a deploy are not atomic for a client, so a
  tab left open across the deploy, or a save queued in the offline outbox, still
  presents last roster's id. With the entry it is resolved to the live id;
  without it, it is a 400.

## The 2026-11-28 roster pair — NOT yet applied to the hosted project

Two migrations ship with the twenty-one-model roster, and **neither has been
applied to the hosted project** as of 2026-11-28. Deploy the code before they
are and the hosted `model_target` enum is behind the app's roster: every write
for a renamed or new target fails with `22P02` — the 2026-07-25 incident above,
at eighteen labels instead of four, and this time including the default target.

| file                                            | what it does                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261128120000_frontier_roster_2026_11.sql`    | 14 × `RENAME VALUE` (the renamed slots) + 4 × `ADD VALUE IF NOT EXISTS` (`haiku_5_5`, `gemini_4_carbon`, `gemini_4_neon`, `muse_wonder_1_0`)       |
| `20261128120100_rehash_after_roster_rename.sql` | re-runs the Q5 content-hash backfill so stored hashes match the renamed labels (and repairs what the `20260808` and `20260911` renames left stale) |

Order, and why:

1. **Apply `20261128120000`** on its own. `ALTER TYPE … ADD VALUE` cannot run
   inside a transaction block (Supabase applies each migration independently).
   The renames are the tight direction — this one renames the **default**
   target (`opus_5` → `opus_5_5`), so the window touches every user who has
   never picked a model. `deepseek_v4`, `sonar_pro` and `glm_5_3` keep their
   labels.
2. **Apply `20261128120100`** after the enum change has committed.
3. **Deploy** the code immediately — apply → deploy, never the reverse, and
   keep the gap short.
4. **`npm run check:db-enum -- --strict`** to confirm the hosted enum caught
   up with the roster.
5. **Regenerate `src/lib/supabase/database.types.ts` from the live schema**
   (step 3 of "Applying a migration") and expect no diff. The committed file
   already lists the twenty-one labels, and it cannot have come from the hosted
   schema, which has not moved — so until this step runs it agrees with the
   migration _files_, which is exactly the state the 2026-07-25 incident hid
   behind.

Client side, the same renames are carried by fourteen new `LEGACY_TARGET_IDS`
entries and the UI store's persist `version` bump (7 → 8); both are in the
code already and need no operator step. What to check after the deploy:
`MODEL_*` / `PRICE_*` overrides that outlived the move
(`docs/runbooks/providers.md`).

## What the guardrails cover

| Check                                        | Catches                                                                                                              | Blind to                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `npm run typecheck`                          | roster ids that disagree with the generated types union                                                              | a hand-edited types file                    |
| `npm run test` (`model-target-enum.test.ts`) | a roster entry with no migration; generated types that disagree with the migrations; a rename with no legacy mapping | whether the hosted project applied anything |
| `npm run check:db-enum -- --strict`          | the hosted enum missing a roster label                                                                               | schema beyond `model_target`                |
| `npm run test` (`library-hash.test.ts`)      | the hash FORMULA drifting from the bytes Postgres computed (a fixture pinned against the hosted project)             | stored hashes left stale by a rename        |

The first two run in CI. The third needs credentials
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, or the anon key) and
so is a release-time step: without them it reports `SKIPPED` and exits 0, and
`--strict` makes the missing credentials fatal instead. It is read-only — it
probes PostgREST with an enum-typed filter and reads the status code.
