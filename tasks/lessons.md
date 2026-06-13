# Lessons — self-improvement loop

> Append after each phase: **what broke · what I changed · what to avoid next time.**
> Read this file before starting the next phase.

## Phase 0 + P1 — Shell

**What we built:** full repo scaffold (CLAUDE.md v2.0, configs, CI, docs) + the
installable PWA shell (tokens, fonts, manifest, Workbox SW, safe-area v2 template,
3-tab nav, dark/light/system themes, Enhance composer shell, auth gate stub).

**What to watch / avoid going into P2:**

- **`next/font/google` needs network at build time.** If a build runs in an offline
  sandbox it will fail on font fetch. Fallbacks are declared, but consider vendoring
  fonts locally (`next/font/local`) if CI ever loses egress.
- **`public/sw.js` is generated, not committed.** It is built by the `prebuild` hook;
  any deploy/test path that skips `prebuild` (e.g. a bare `next start` without a prior
  `build`) will 404 the SW. Playwright builds it explicitly in `webServer`.
- **Icons are committed placeholders.** `npm run generate:icons` must be run (and the
  output committed) before the manifest/SW reference real files. Final brand art swaps
  in without manifest edits.
- **SW only registers on https/localhost/prod** — `next dev` won't install it, so
  offline behavior must be verified via `build` + `start` (or Playwright).
- **Server-as-source-of-truth is documented but not yet enforced** (no persistence
  beyond localStorage in P1). P2 must add the Supabase re-hydration path before any
  data is treated as durable.
- **Guardrail to honour from P2:** RLS policy ships _with_ each table's migration — never
  a table without a policy.

**What broke during P1 (and the fix):**

- **Workbox `injectManifest` does not bundle.** A hand-authored SW that `import`s
  `workbox-*` shipped bare ESM imports → "ServiceWorker script evaluation failed" and
  the worker never activated. Fix: `scripts/build-sw.mjs` now esbuild-bundles the source
  to a classic-worker IIFE (preserving `self.__WB_MANIFEST`) _before_ `injectManifest`.
  If we ever move to `generateSW`, this step goes away.
- **Don't precache a redirecting URL.** Precaching `/` failed because `/` 307-redirects
  to `/enhance` and Workbox refuses redirected responses. Precache `/enhance` (the real
  entry screen) instead, both in `additionalManifestEntries` and `APP_SHELL_URL`.
- **Playwright WebKit + offline reload is flaky** ("WebKit encountered an internal
  error" on `reload()` under `setOffline`). SW _registration_ is still asserted on
  WebKit; the offline-navigation assertion is scoped to Chromium via `test.skip`.
- **`next/font` icon glyph SVGs:** librsvg (sharp) rejects a redefined attribute — every
  `<text>` must set `font-size`/`font-weight` exactly once. Keep per-node attrs out of the
  shared attr string.
- **`npm audit` posture:** high/critical findings are all dev/build tooling (esbuild via
  vite/vitest) that never ships. CI gates on `npm audit --omit=dev --audit-level=high`
  (clean) and runs a full-tree report as advisory-only. Revisit when bumping to vitest 3.x.
- **`tsconfig` `noUncheckedIndexedAccess`** makes regex capture groups `T | undefined` —
  guard `match?.[1]` rather than asserting.

## Phase 2 — Auth & profile

**What we built:** Supabase Auth (magic link + GitHub + Google), session middleware +
route gating, `profiles`/`oauth_identities` with RLS + auto-profile trigger, avatar
storage + client-side cropper, the profile screen, and magic-link → set-password
onboarding. Supabase project provisioned via MCP; migrations applied live.

**What broke (and the fix):**

- **`middleware.ts` must live in `src/` when you use a `src/` dir.** A repo-root
  `middleware.ts` is silently ignored — no gating at all. Moved to `src/middleware.ts`
  (build then shows `ƒ Middleware`). Verify with `curl -I /` → expect a 307 to `/sign-in`.
- **`@supabase/ssr` and `@supabase/supabase-js` versions must align.** `ssr@0.5.2` with
  `supabase-js@2.108` produced `never` query types and a 3-vs-4-arg `SupabaseClient`
  mismatch. Fix: bump `@supabase/ssr` to `^0.12` (peers `supabase-js ^2.108`). When the
  typed client returns `never` on `.update()`, suspect a version skew first.
- **Zombie dev servers hide behind `next-server`, not `next start`.** A detached
  `next-server` from an earlier run kept answering on the test port, so `reuseExistingServer`
  served a stale (pre-middleware) build and 6 e2e tests "failed" against old code. Kill with
  `fuser -k 3100/tcp` / `pkill -f next-server`, not just `pkill -f "next start"`.
- **Auth gating changes the PWA offline model.** Every app route now redirects by session
  state, so none is safe to precache (redirected responses can't be cached). The offline
  fallback is the static `offline.html`; visited routes are cached at runtime via SWR.
- **Supabase security advisors after DDL:** pin `search_path` on trigger functions, revoke
  `EXECUTE` on `SECURITY DEFINER` functions from `anon`/`authenticated`, and drop the broad
  SELECT policy on public Storage buckets (public URLs work without it; it only enabled
  listing). Re-run `get_advisors` until clean.
- **Don't seed `auth.users` by hand.** The sandbox (correctly) blocks fabricating users in
  the live auth tables. Verify RLS via the advisors + types/build; exercise real sign-in on
  the preview with actual email/OAuth creds.

**Carry into P3:** model keys server-side only; rate limit + cost cap on the enhance route;
the provider adapter reads model strings from server config (swap ≠ refactor).
