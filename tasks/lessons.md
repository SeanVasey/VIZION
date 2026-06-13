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

## Phase 3 — Enhance core

**What we built:** the provider adapter (`enhance(input, mode, target)`) over Anthropic
(official SDK, `claude-opus-4-8`), OpenAI (SDK), and Google (REST); five modes; per-target
formatters; the `/api/enhance` route with a server-side rate limit + daily cost cap backed
by a `usage_events` ledger; the transformation diff (pure LCS word-diff) + copy/share/export.

**What to watch / decisions:**

- **Provider neutrality of the contract.** Rather than couple to each SDK's structured-
  output feature (which differ and drift), the JSON-only contract is enforced in the
  _system prompt_ and validated on parse (`parseEnhancePayload`). One code path, three
  providers; the Anthropic call still uses the official SDK per guidance.
- **Keys are server-side only.** All provider modules import `server-only`; a missing key
  throws `ProviderNotConfiguredError` → 503 with a friendly "add the key" message. Live
  enhancement needs the user's `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`.
- **Model strings are config (D9).** `MODEL_OPUS`/`MODEL_GPT`/`MODEL_GEMINI` + `PRICE_*`
  envs; defaults `claude-opus-4-8` / `gpt-5.5` / `gemini-pro-3.1`. GPT/Gemini defaults are
  named product targets — point them at a real deployed string via env.
- **Caps are enforced before the model call.** `usage_window(p_rate_seconds)` (SECURITY
  INVOKER, RLS-scoped) returns recent-count + today's cost in one round trip; the route
  429s on either limit, then logs a `usage_events` row after a successful call.
- **API routes must 401, not redirect.** Middleware now returns JSON 401 for unauth
  `/api/*` instead of bouncing to `/sign-in` (asserted in e2e — no session needed).
- **Live multi-provider calls aren't covered by automated tests** (no keys + can't seed
  users). Pure logic — diff, formatters, cost, exporters — is unit-tested; the route's
  auth gate is e2e-tested; the provider calls are typed + built. Exercise live enhancement
  on the preview once keys are set.

**Carry into P4:** save → `Prompt` + immutable `PromptVersion`; reuse the word-diff for
diff-any-two-versions; activity feed logs every event type; tags + search + model filter.

## Phase 4 — Library & versioning

**What we built:** `prompts` + immutable `prompt_versions` + `activity_events` (RLS from
creation); save / revise→append / restore / delete; the library browser (search + tag +
model filter); prompt detail with diff-any-two + version history; the activity feed.

**What to watch / decisions:**

- **Immutability via RLS, not just convention.** `prompt_versions` has select + insert
  policies but **no update/delete** policy — so RLS denies any mutation, making snapshots
  truly immutable. Restore never edits a version; it only re-points `prompts.current_ver`.
- **Circular FK** (`prompts.current_ver` ↔ `prompt_versions.prompt_id`): create `prompts`
  with a nullable `current_ver`, create `prompt_versions`, then `ALTER TABLE prompts ADD
CONSTRAINT … on delete set null`. Insert version → set `current_ver` in a second update.
- **`prompt_versions` RLS joins through the parent** (`exists (select 1 from prompts …)`)
  rather than carrying its own `user_id` — keeps a single source of ownership truth.
- **The word-diff is reused for version diffs.** `diffWords(a.output_text, b.output_text)`
  powers both the live transformation diff and diff-any-two — one tested primitive.
- **Library list keeps queries light:** prompts (flat) + a `prompt_id`-only count query;
  avoids embedding the full version bodies. Filtering (search/tag/model) is a pure,
  unit-tested client function.
- **Activity is logged from the server actions** (created/enhanced/saved/restored/shared);
  the feed reads the last 20, newest-first, linking back to each prompt.

**Carry into P5:** `MediaAsset` is first-class (A5); extraction pipeline behind a flag
(on-device vs proxy — default proxy + on-device fallback); generation-syntax formatters
(Midjourney image-ref · Runway/Sora/Kling motion · audio spec); storage budget + Amber
warnings near quota.

## Phase 5 — Media prompts

**What we built:** `media_assets` + a private `media` bucket (RLS owner-only); attach +
upload; the flagged extraction pipeline (proxy vision via `/api/media`, on-device
fallback); pure generation-syntax formatters; the media studio UI; storage budget.

**What to watch / decisions:**

- **Open question resolved as planned:** `NEXT_PUBLIC_MEDIA_EXTRACTION` defaults to
  `proxy` (vision via the model proxy) and falls back to **on-device** (canvas palette +
  dimensions; audio duration) when the flag is `ondevice`, the key is missing, or the
  proxy call fails. Video uses a client-captured frame as the proxy image.
- **The generation formatters are the testable core** — `buildGenerationPrompt` is pure
  and deterministic per engine (MJ `--ar/--v/--iw`, motion phrasing, audio spec). Live
  vision needs `ANTHROPIC_API_KEY`; everything else (palette quantize, budget, parsing) is
  unit-tested without keys.
- **`/api/media` is a model route** → it reuses the same auth + rate-limit + cost-cap +
  usage-logging as `/api/enhance` (asserted 401 unauth in e2e).
- **Private bucket, signed URLs.** The `media` bucket is not public; the Midjourney image
  ref uses a 7-day signed URL. Owner-scoped storage policies key on the `{user_id}/…` path
  prefix (same pattern as avatars, but private).
- **jsonb typing:** `MediaAttributes` lacks a string index signature, so writing it to the
  `extracted` jsonb column needs `as unknown as Json`.

**Carry into P6 (Hardening):** rate limits on all endpoints (✓ on model routes — audit the
rest); strip `console.*` (✓ next.config); edge DDoS posture; iOS storage-eviction recovery
(`navigator.storage.persist()` ✓ — add re-hydrate-on-launch + IndexedDB outbox on
`visibilitychange`); backup-restore test; full WCAG AA pass + Lighthouse PWA.
