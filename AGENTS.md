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
- **`supabase/migrations/` is incremental, not a schema.** The base tables
  (`profiles`, `prompts`, `prompt_versions`, `usage_events`, `media_assets`)
  were applied live and are **not** tracked; the files there only add to that
  baseline — enum expansions, media roles, library organization, collections
  (the last being the one tracked `create table`). Point a bare local Supabase
  at the app and it will be missing the core tables.
- **Chromium is the reliable e2e signal.** Playwright WebKit's service-worker
  and offline emulation is unreliable — `serviceWorker.ready` hangs and
  `reload()` throws internally — so the SW lifecycle + offline-fallback test is
  `test.skip`-ped on WebKit by design (`tests/e2e/shell.spec.ts`). If you ran
  only one browser leg, say which.
- **Fonts are self-hosted** — `next/font/local` over woff2 vendored under
  `src/app/fonts/` — so the build needs no network for fonts. Any advice
  blaming a build failure on a font fetch predates that and is wrong.
