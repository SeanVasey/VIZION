# AGENTS.md — VIZ(IO)N

The authoritative operating contract lives in `CLAUDE.md` (role, principles,
verification gate, guardrails, project structure). Read it first, then
`tasks/lessons.md`. This file adds only environment and runtime notes — the
things that are true of the machine rather than of the product.

First-run setup, icon generation, the service-worker build and troubleshooting
live in `docs/runbooks/local-dev.md` and are not repeated here.

## Shape of the thing

One service: a Next.js 15 (App Router) / React 19 PWA, plus the external
Supabase and model-provider backends it talks to. Node ≥ 20 (CI uses 22).

## Commands

- **Dev server:** `npm run dev` → http://localhost:3000
- **Verification gate** (before every commit, per `CLAUDE.md` §3):
  `npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build`
- **Narrower runs:** `npm run test` (Vitest, jsdom) · `npm run test:int`
  (integration only) · `npm run test:e2e` (Playwright — does its own
  `build:sw` + `next build` + `next start` on :3100) · `npm run format:check`
- **Before e2e, once per machine:** `npx playwright install --with-deps` — the
  same line CI uses.
- **`npm run check:db-enum`** — a read-only preflight asking the *hosted*
  Postgres whether it actually has what the app expects: every `model_target`
  enum label, plus the columns and functions later migrations added. Worth
  knowing about because the static checks cannot catch what it catches —
  `tests/unit/model-target-enum.test.ts` proves the roster, the migrations and
  the generated types agree with each other, and all three can agree while the
  live project is simply behind on applying a migration. That gap shipped once.
  It needs Supabase credentials; without them it reports SKIPPED and exits 0.

## Non-obvious gotchas

- **The whole gate runs with NO secrets.** `.env.local` is optional for
  startup: with `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` unset,
  `src/lib/supabase/middleware.ts` fails closed — every protected route
  redirects to the public `/sign-in` gate and `/api/*` returns 401. So the
  sign-in gate is the only surface you can exercise unconfigured, and it is
  what the e2e suite drives.
- **Exercising the core flow needs real secrets**, none of which are in the
  repo: a Supabase project (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) **and** at least
  one of the twelve provider keys — one key buys you that developer's models
  only. `.env.example` is the shape of record.
- **`supabase/migrations/` is the whole schema.** It starts at
  `create type public.theme` and builds every table, enum, storage bucket and
  RLS policy from nothing — point a bare local Supabase at it and you get the
  real database. This was **not** true before 2026-07-31: the P2–P5 base tables
  had been applied live and tracked nowhere, so the directory was a patch set
  layered on a schema you had to already have. `npm run db:verify` replays the
  whole thing against a throwaway Postgres and is the check that keeps it
  honest; `docs/runbooks/migrations.md` is the procedure.
- **Filenames are the hosted ledger's versions.** The Supabase CLI matches the
  leading 14 digits against `supabase_migrations.schema_migrations`; a file
  whose version is not there is not skipped, it is applied. Never rename one to
  a "tidier" timestamp, and when you apply a migration make the file agree with
  the version the ledger records.
- **Chromium is the reliable e2e signal.** Playwright WebKit's service-worker
  and offline emulation is unreliable — `serviceWorker.ready` hangs and
  `reload()` throws internally — so the SW lifecycle + offline-fallback test is
  `test.skip`-ped on WebKit by design (`tests/e2e/shell.spec.ts`). If you ran
  only one browser leg, say which.
- **Fonts are self-hosted** — `next/font/local` over woff2 vendored under
  `src/app/fonts/` — so the build needs no network for fonts. Any advice
  blaming a build failure on a font fetch predates that and is wrong.
- **`brace-expansion` is overridden PER MAJOR, and it has to stay that way.**
  A single blanket `"brace-expansion": "^5.0.8"` forces v5 into `minimatch@3`
  (reached via `@eslint/config-array`, `@eslint/eslintrc`, eslint and three of
  its plugins). v5's CJS entry exports an OBJECT —
  `{ EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand }` — while minimatch@3 does
  `require('brace-expansion')` and calls the result, so brace expansion through
  minimatch@3 dies with `TypeError: expand is not a function`. That broke every
  braced glob in the tree, and it went unnoticed because nothing in the repo used
  one: an ESLint `files: ["src/**/*.{ts,tsx}"]` is the first thing to hit it.
  The keys are `brace-expansion@1` / `@2` / `@5`, each pinned to the newest
  release of its own line, so every consumer gets an API it can actually call.
  **Consequence, deliberately accepted:** the advisory range is `<=5.0.7`, so
  every 1.x and 2.x release matches it no matter how patched, and the FULL-tree
  `npm audit` reports 14 high entries, all in dev tooling (the eslint chain and
  workbox-build). See the next bullet for why that is a false positive. CI gates
  `npm audit --omit=dev --audit-level=high`, which stays at **0**, and the
  full-tree step is now GATED by `npm run audit:check` rather than
  `npm audit || true`.
- **The 14 full-tree entries are one advisory, and it is a false positive.** They
  all fan out from GHSA-mh99-v99m-4gvg on `brace-expansion` (range `<=5.0.7`).
  The fix — CVE-2026-14257's `EXPANSION_MAX` / `EXPANSION_MAX_LENGTH` limits —
  WAS backported to 1.1.17 and 2.1.3; the advisory range was never narrowed, so
  patched releases still match it. Verify for yourself:
  `grep EXPANSION_MAX_LENGTH node_modules/minimatch/node_modules/brace-expansion/index.js`.
  It also cannot be removed: `eslint@9` requires `minimatch@^3.1.5`, and
  minimatch@3 calls brace-expansion as a function, so a 1.x is the only patched
  shape available to it. **`npm audit` cannot reach 0 on the full tree while this
  project uses ESLint 9** — which is why the gate verifies the exemption instead
  of chasing the number. `scripts/check-audit.mjs` fails on any advisory that is
  not exempt, AND re-proves each exemption by checking that every installed copy
  really contains the limits, so the allowlist cannot rot into a blanket ignore.
- **`eslint-plugin-tailwindcss` must stay on the `3.x` line** while this project
  is on Tailwind 3. `4.x` declares `peer tailwindcss@^4` and will not install
  without `--force`. Its `settings.tailwindcss.config` also has to be an
  ABSOLUTE path: the plugin derives its module-resolution root from
  `dirname(config)`, so a relative value yields `"."` and it fails with
  `Could not resolve tailwindcss` even though the package is present.
