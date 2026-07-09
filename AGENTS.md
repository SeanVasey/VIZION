# AGENTS.md — VIZ(IO)N

The authoritative operating contract lives in `CLAUDE.md` (roles, guardrails,
verification gate, project structure). Read it first. This file adds
environment/runtime notes for agents.

## Cursor Cloud specific instructions

VIZ(IO)N is a single Next.js 15 (App Router) / React 19 PWA — there is one
service (the Next app) plus the external Supabase + model-provider backends it
talks to. Node ≥ 20 is required (the VM ships Node 22, which is fine).

### Commands (all defined in `package.json`)

- Dev server: `npm run dev` → http://localhost:3000 (the standard way to run the
  app in development).
- Verification gate (run before every commit, per `CLAUDE.md` §3):
  `npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build`.
- Unit tests only: `npm run test` (Vitest, jsdom). E2E: `npm run test:e2e`
  (Playwright, on port 3100 — it does its own `next build` + `next start`).

### Non-obvious gotchas

- **The app runs and passes the whole gate with NO secrets.** `.env.local` is
  optional for startup: when `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` are
  unset, `src/lib/supabase/middleware.ts` fails closed — every protected route
  redirects to the public `/sign-in` gate and `/api/*` returns 401. So the
  sign-in gate is the only surface you can exercise without configured secrets.
- **Exercising the core flow (prompt enhancement) needs real secrets** that are
  not in the repo: a Supabase project (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) **and** at least
  one model-provider key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
  `GOOGLE_API_KEY`), plus a way to sign in. See `.env.example` for the full
  shape. The Supabase schema was applied live (only one migration is tracked in
  `supabase/migrations/`), so a bare local Supabase will lack the app tables.
- **Playwright browsers are required for `test:e2e`.** The update script installs
  the Chromium + WebKit browser binaries. If a fresh VM is missing the WebKit
  system libraries, run `npx playwright install --with-deps webkit` once.
  Chromium is the reliable local e2e signal — WebKit's service-worker/offline
  emulation is flaky and one SW test is `test.skip`-ped on WebKit by design.
- **`public/sw.js` is generated, not committed.** It is produced by the `prebuild`
  hook (`scripts/build-sw.mjs`) and by `test:e2e`'s web server. A bare
  `next start` without a prior `build`/`build:sw` will 404 the service worker.
- **The service worker only registers on https/localhost/prod** — `next dev` does
  not install it, so verify offline/PWA behavior via `build` + `start` (or e2e).
- **Fonts are self-hosted** (`next/font/local`, committed under `src/app/fonts/`),
  so the build needs no network for fonts.
