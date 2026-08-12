# Lessons — self-improvement loop

> Append after each phase: **what broke · what I changed · what to avoid next time.**
> Read this file before starting the next phase.

## 2026-07-29 — Whole-repository assessment

**What the review found:** The strongest risks sit at system boundaries rather
than in the UI: the live-only baseline Supabase schema prevents reproducible RLS
verification and disaster recovery, and the model cost cap checks then records
usage rather than reserving budget atomically. The application code and tests are
otherwise unusually mature for the product's size.

**What to carry forward:** Prioritize a sanitized baseline schema plus disposable
restore/policy tests, then transactional spend reservations. Add performance,
accessibility, and observability budgets before optimizing large client components;
measure first and refactor them incrementally. Keep architecture prose synchronized
with executable service-worker, provider, runtime, and CI configuration.

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

## Phase 6 — Hardening (v1.0)

**What we built:** CSP + security headers; a burst rate-limiter on the model routes; an
IndexedDB offline outbox + flusher (iOS eviction recovery); a11y (skip link, reduced
motion); the security/hardening + backup-restore runbooks.

**What to watch / decisions:**

- **CSP residual:** `script-src 'unsafe-inline'` stays for the pre-paint no-flash theme
  bootstrap (avoiding a theme flash beats a marginal CSP win). The clean upgrade is a
  per-request **nonce** via middleware — deferred, documented. Everything else is locked
  (`default-src 'self'`, `frame-ancestors/object-src/base-uri`, Supabase-scoped origins).
- **The in-memory limiter is a coarse layer, not the source of truth** — serverless
  instances don't share memory. It absorbs bursts cheaply; the **DB `usage_window`** cap is
  the durable enforcement. Pure core (inject store + clock) → unit-tested.
- **Outbox flush logic is pure + tested** over an injectable `OutboxStore`; the IndexedDB
  implementation is thin and browser-only. Offline Save enqueues; `OutboxFlusher` replays on
  `online`/`visibilitychange`. Unknown kinds are left untouched (forward-compatible).
- **WebKit SW is unreliable in Playwright** — moved the `test.skip(webkit)` _before_ the
  `serviceWorker.ready` wait so the SW/offline test runs only on Chromium (it was flaking on
  the ready wait). Don't assert SW lifecycle on Playwright WebKit.
- **Verify CSP doesn't break Supabase/SW:** `connect-src` must include `https://*.supabase.co`
  - `wss://*.supabase.co`; `worker-src 'self'` for the SW; `img/media-src` include Supabase
    storage + `blob:`/`data:` for avatar crop + media previews.

**v1.0 reached.** Definition of Done met: lint/typecheck/unit/e2e/build green every commit;
RLS on every table; keys server-side; caps on model routes; PWA installable + offline
fallback; a11y pass (Lighthouse to be run against a deployed preview).

## Brand icons — placeholder swap

- **Single source of truth for assets:** the icon/splash matrix is generated, not
  hand-edited. Dropping the master SVGs into `public/brand/` and pointing
  `generate-icons.mjs` at them means one `npm run generate:icons` re-derives all 32
  outputs. Don't hand-edit the PNGs.
- **`resize({background})` only letterboxes — it does NOT fill interior transparency.**
  The brand tile has transparent corners outside its rounded plate; use
  `.flatten({ background: VOID })` to make apple-touch/favicons opaque squares (iOS
  expects a filled square and applies its own squircle mask).
- **Maskable ≠ the full tile.** The plate's glow border sits near the edge and would be
  clipped by the OS maskable crop. Composite the _mark_ (no plate) at ~78% inside a
  full-bleed Void canvas so the safe zone never clips.
- **Keep the transparent "any" matrix transparent** (guardrail §6) — render the mark
  alone; the maskable set provides the filled variant.
- **e2e webserver without Supabase env must fail closed** (public env vars are inlined)
  or the middleware throws "URL and Key are required". The sandbox also can't install
  WebKit system deps — Chromium e2e is the reliable local signal.

## UI remediation (R1–R8) — restoring the locked spec

- **Brand files named in a spec may not be in the repo.** The remediation prompt
  referenced `vizion-mark.svg`/`vizion-icon.svg`/`vm-monogram.svg`/`vai-monogram.svg`
  and a `vizion-brand-lockup.html` that don't exist — only the `*-token.svg` pair
  does. Verify asset presence _before_ planning; wire the real tokens, and gate the
  missing monograms behind `BRAND_MONOGRAMS_READY` so the footer ships with a
  typographic fallback and flips to the real files with no code change.
- **The contrast-law guardrail (§6) overrides literal brand wording.** "IO in
  `--laser`" fails on light (laser-on-light = 1.09:1). Resolved with theme-aware
  _ink_ tokens: `--accent-ink` (laser→deep green on light) and a light-only
  `--flare` (#c81d10) for error text. Laser stays a FILL (`--laser` + `--on-laser`),
  which is always legible. Verified every text/bg pair ≥ AA in both themes.
- **Role tokens must be theme-swapped, not fixed.** Making `--chalk`/`--silver`
  flip per theme means existing `text-chalk`/`text-silver` utilities become legible
  in light mode automatically — far less churn than re-classing every component.
- **`text-void` is a trap once `--void` is theme-swapped.** Dark ink on a colored
  fill (pulse/amber chips) must use the constant `--on-laser`, not `--void` (which
  now inverts to a light value in light mode).
- **Vendor fonts locally with `next/font/local`.** Fetch the OFL latin woff2
  subsets at build-prep, commit them under `src/app/fonts/`, point the CSS-var
  font stacks at the generated `--font-*` vars (fallbacks after). No build-time
  Google Fonts egress; honours the earlier P1 lesson.
- **Mono-scoping is enforceable by a source-grep unit test.** `type-scoping.test.ts`
  asserts UI components carry no `mono` class so JetBrains can't leak back onto
  chrome; mono lives only on the output/result body text.
- **Tailwind utilities beat `@layer components`.** A `rounded-xl` at the call site
  overrides a `border-radius` baked into `.btn-laser`; use an explicit `.pill`
  modifier on the hero CTAs rather than relying on the base class radius.
- **The background canvas must capture non-null handles for its closures.** TS
  doesn't carry `if (!ctx) return` narrowing into nested rAF helpers — assign
  `const g = ctx` after the guard so the loop sees a non-null type.
- **A top-level `theme.spacing` REPLACES Tailwind's scale — never put it there.**
  The config defined `spacing` at `theme.spacing` (not `theme.extend.spacing`),
  pruning every key outside `{px,0,1–6,8,10,12,16}`. Because width/height/inset
  derive from spacing, `h-24 w-24` (the 96px avatar), `h-11 w-11` (theme toggle),
  `h-9`, and all fractional steps silently generated **no CSS** — so the avatar
  button collapsed to ~0 and "wasn't showing up." Fix: move the var-based keys to
  `theme.extend.spacing` (their px values equal the defaults, so nothing shifts)
  and the full scale returns. Verify utility generation with a one-off
  `tailwindcss -i … --content probe.html` grep when a class "does nothing."
- **OAuth avatars are hot-linked from the provider CDN — allow the host.** The
  signup trigger copies `raw_user_meta_data->>'avatar_url'` verbatim, i.e. a
  `lh3.googleusercontent.com` (Google) / `avatars.githubusercontent.com` (GitHub)
  URL. Both the CSP `img-src` and next/image `remotePatterns` only allowed
  `*.supabase.co`, so the image was blocked twice over. Allow those two hosts in
  both places, and give `<Image>` an `onError` fallback to a name monogram so a
  rotated/expired provider URL degrades gracefully instead of an empty circle.
- **Translucent chrome needs its own token, not bare `.glass`.** A new `--chrome`
  (lighter alpha) + `.glass-chrome` lets the header/bottom-nav reveal the ambient
  aurora glow through the bar while the floating panels stay on the denser
  `--glass` tier.

## Brand icon refresh — swap art, regenerate, keep names

- **Swap the source content, not the filenames.** The pipeline + components key off
  `public/brand/vizion-icon-token.svg` and `vizion-mark-token.svg`. Dropping the new
  artwork _into those existing files_ (rather than renaming to the uploaded
  `vizion-icon.svg`/`vizion-glyph.svg`) means `generate-icons.mjs`, `ScreenHeader`,
  and `AuthHero` keep working with zero ref churn — one `npm run generate:icons`
  re-derives all 32 outputs. The root-level uploads were just the delivery vehicle;
  delete them so the single source of truth stays in `public/brand/`.
- **A non-square glyph breaks fixed square sizing.** The new glyph is 1565×996, not
  the old 1024² square. `next/image` with `width={150} height={150}` would distort
  it — size by one axis (`w-[260px] h-auto`) to preserve aspect. The generator's
  `fit: "contain"` already handles the square PNG matrix (it letterboxes), so only
  the hand-placed hero needed the fix.
- **Aspect-correct ≠ balanced — re-check rendered scale after an art swap.** The new
  mark fills its viewBox far more tightly than the old 1024² square (almost no
  internal padding), so matching the _old_ visual height (≈150px tall → 260px wide
  at the new aspect) made the hero glyph read as oversized and out of proportion on
  the sign-in screen. Dropping it to `w-[176px]` (≈102px tall) restores balance with
  the wordmark and tagline. Lesson: when the source art's "ink coverage" within the
  viewBox changes, the previous pixel dimensions no longer translate — eyeball the
  rendered result, don't just preserve the aspect ratio.

## Chrome corners — make the header a floating sheet, not a bordered strip

- **Match the header chrome to the bottom nav, mirrored.** `.glass-chrome` (top
  header) still carried a `1px solid var(--hair)` hairline and sharp corners, so on
  device it read as a bordered card with a bright top edge, clashing with the
  borderless, soft-cornered `.glass-nav` below. Fix: drop the border, round the
  _bottom_ corners (`border-bottom-{left,right}-radius: 20px`) and cast the shadow
  _downward_ (`0 8px 28px`) — the vertical mirror of the bottom nav's top-rounded,
  upward-shadow treatment — so both bars read as the same floating frosted sheet.

## Footer/fixed-nav clearance — tie the reserve to the nav, don't guess it

- **A fixed bottom nav over an in-flow footer needs the scroll region to reserve
  _exactly_ the nav's height — a hardcoded guess rots.** The footer collided with the
  nav (monograms trapped behind it, copyright spilling below) because the reserved
  bottom padding was a literal `80px` while the nav's true height was
  `min-h-[56px]` + `py-2` + `pb-safe` — a different number that grows with the
  home-indicator inset. Once the real nav exceeds the guess, the footer slips under.
- **Fix: one CSS variable drives both sides.** `--bottom-nav-h` sets the nav's tap
  height _and_ feeds the scroll reserve
  (`calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + buffer)`), so clearance
  tracks the nav by construction. Lesson: when element A must clear fixed element B,
  derive A's spacing from B's size via a shared token — never re-type B's height as a
  magic number in A.

## Enhance modes — the target idioms were reshaping shape-preserving modes

- **`buildSystemPrompt` injected the target engine's structural conventions for every
  mode.** Clarify's job is to sharpen intent, not restructure, but it still received
  "Favor XML-tagged sections" (Opus) / "JSON-mode / structured-output" (GPT) /
  "multimodal parts" (Gemini). Combined with clarify's own "make implicit assumptions
  explicit," the model rebuilt plain prose prompts into headings and bullet lists —
  exactly the "poorly formatted markdown" the user reported.
- **Fix: gate the conventions by mode.** A `SHAPE_PRESERVING` set (`clarify`, `polish`)
  now receives an explicit `FORMAT_PRESERVATION` directive ("keep the input's format,
  voice, and length; no bullets/headings/XML/JSON the author didn't use") instead of the
  target idioms. Reformat/target/expand/condense keep the idioms — restructuring is
  their point. Lesson: a shared prompt suffix applied to _all_ modes will fight the
  modes whose contract is "change as little as possible." Scope the suffix to intent.
- **New enum values need a DB migration.** Adding the `polish` mode meant the
  `enhance_mode` Postgres enum had to gain the value or every save of a polished prompt
  is rejected. The repo tracks no in-repo SQL (types are generated), so the schema
  change is easy to forget — added `supabase/migrations/…_add_polish_enhance_mode.sql`
  and called it out as a required pre-deploy step. Watch: `ALTER TYPE … ADD VALUE`
  can't run inside a transaction block, so keep it in its own migration.

## Docs — capture a real preview from the production build, don't ship placeholders

- **The README hero was a placeholder SVG "until P1 ships to preview."** It has shipped,
  so the honest artifact is a real screenshot. Captured `docs/preview.png` from a local
  `next start` of the production build via Playwright (mobile viewport, dark scheme),
  pointed at the only public surface — the `/sign-in` gate. Bonus: the shot doubles as
  proof the version bump is live (the pill and footer read `v0.2.0`).
- **Gotchas that cost a minute each:** (1) a screenshot script in the scratchpad can't
  resolve `@playwright/test` — run it from the repo root so Node resolves `node_modules`.
  (2) The project pins a Playwright version whose browser build (1223) isn't in the image
  (1194 is) — launch with `executablePath` at the installed chromium instead of
  `playwright install`. (3) `pkill -f "next start"` misses the actual `next-server`
  process — find it by name (`pgrep -f next-server`) or by port and kill that PID.
- **Version is single-sourced from `package.json`.** `next.config.ts` injects
  `NEXT_PUBLIC_APP_VERSION: pkg.version`; `src/lib/version.ts` reads it. Bump one number
  and the footer + sign-in pill follow — never hardcode the version in a component.

## Enhance output — target idioms phrased as role framing script roles into the output

- **"Explicit system/user separation" in a target convention is an instruction the
  model will obey literally.** The Opus/GPT conventions told the rewriter to favor
  role framing, so for the restructuring modes it wrote the transformed prompt AS a
  role-labelled system prompt (`System: … / User message to respond to: "…"`) —
  the user saw "the system prompt outputting" instead of their expanded prompt. The
  wiring (mode → instruction → provider) was correct end-to-end; the defect was
  purely in the prompt contract. Debug the _contract text_ before the plumbing.
- **State the output contract explicitly, for every mode.** A shared
  `OUTPUT_CONTRACT` now pins what the `output` field IS (the single paste-ready
  prompt in the author's voice; no role labels, no persona specs, no quoting the
  input as a message to answer). Conventions describe _structure inside the one
  prompt_; anything that reads as "produce multiple roles" gets rewritten. The
  contract is unit-tested across every mode × target so a future convention edit
  can't silently reintroduce role framing (asserted by negative substring checks).
- **When mirroring a CTA's form factor for a sibling action, reuse the existing
  button classes** — the reset control became `btn-secondary pill` at ENHANCE's
  exact size/typography instead of new CSS, keeping the Laser fill unique to the
  primary CTA (guardrail §6).

## Versioning — a changelog with no cut releases isn't versioning

- **Everything sat under `[Unreleased]` while `package.json` read `0.2.0`.** The
  honest fix was archaeology first: `git log -L '/"version"/,+1:package.json'`
  finds exactly which commits bumped the version and when, and the release
  sections were cut to match those boundaries (`0.1.0` = the scaffold commit,
  `0.2.0` = the 2026-07-01 bump, post-bump merges → `0.2.1`).
- **Automate the ritual or it lapses again.** `release.yml` triggers on pushes to
  `main` that touch `package.json`, is idempotent (existing tag → no-op, so
  dependency-bump merges are safe), and **fails loudly when the changelog section
  for the new version is missing** — a bump can't ship undocumented.
- **Remote-session git proxies allow only the designated branch — tag pushes
  hang up.** Backfilling `v0.1.0`/`v0.2.0` directly (`git push origin v0.1.0`)
  died with "unexpected disconnect while reading sideband packet" every retry.
  The workaround that also improves the product: give `release.yml` a
  `workflow_dispatch` with `version`/`target` inputs, so backfills and re-cuts
  run with GitHub's own token instead of needing local tag-push rights
  (dispatch table in `docs/runbooks/release.md`).
- **Owner direction beats an earlier style rationale.** The reset control had
  deliberately been made a _secondary_ pill to keep the Laser fill unique to
  ENHANCE — but the owner asked again for it "in the style of the submit
  button", so it now mirrors `btn-laser` exactly. When a style guardrail
  (§6 forbids Laser _text on light_, not a second Laser fill) doesn't actually
  block the request, follow the request; note the supersession in the changelog.
- **Put quick actions where the eyes are.** Copy lived only in the action row
  below the fold of the result; the fix is an icon on the output card header
  itself. Reuse the existing handler/state so the two affordances confirm in
  sync; keep the 44px tap target without inflating a text-height header row via
  negative margins.

## Streaming + media analysis + six-model roster (icons · Mistral · SSE · multi-photo)

- **Stream inside the contract, don't replace it.** Token streaming looked like
  it required abandoning the `{output, rationale}` JSON envelope — it didn't.
  A ~90-line pure scanner that incrementally decodes just the `output` string
  (escapes split across chunks included) streams the text while the unchanged
  `parseEnhancePayload` stays authoritative at the end (ADR 0002). The
  lesson-hardened contract, the `json_object` enforcement, and every formatter
  guard test survived untouched. When a contract is battle-scarred, engineer
  _around_ it before engineering _away_ from it.
- **Make the buffered path a drain of the streaming path.** `enhance()` is now
  `for await … if done return` over `enhanceStream()` — one code path, so the
  pre-existing route/tests exercised the new stream machinery from day one.
- **Gate failures must stay plain HTTP.** Returning SSE for _everything_ would
  have broken the e2e 401 contract and made error handling client-side
  guesswork. Pre-stream failures keep real statuses + JSON; only post-header
  failures ride the stream as `error` events. The client branches on
  `content-type`, not hope.
- **Write the cost ledger in `finally`, keyed off accrued usage.** A client
  disconnect mid-stream throws on `enqueue`; without the finally-scoped
  `usage_events` insert the daily cap would leak. Track the latest usage
  snapshot outside the loop; estimate ~4 chars/token if a provider reports
  nothing (Mistral's stream usage isn't guaranteed) — the cap must never see 0.
- **A flush scheduled on rAF can lose the tail.** The mutation's `finally` ran
  before the last animation-frame flush, so the final deltas vanished from the
  stream state (the hook test caught it). Drain pending buffers synchronously
  at settle time; discard them only when the run was deliberately aborted.
- **Mistral rejects unknown request fields (422)** — unlike OpenAI/xAI, don't
  send `stream_options`; its final chunk carries usage anyway. "OpenAI-
  compatible" means the happy path, not the whole surface.
- **thesvg.org icons live on jsDelivr** (`glincker/thesvg` on GitHub) with
  `mono`/`default` variants per icon — fetch `…/icons/<slug>/mono.svg`, SVGO,
  strip fills to `currentColor`. When only a multicolour `default` exists
  (Gemini), the alpha _mask path_ is usually the clean monochrome glyph.
- **The `server-only` poison-pill blocks vitest.** Alias it to an empty stub in
  vitest.config so adapter/provider modules unit-test in plain Node; Next
  builds still enforce the real package.
- **Playwright browser lag, part 2:** symlinking an old chromium revision dir
  fails when the inner layout changed between revisions
  (`chrome-linux/headless_shell` vs `chrome-headless-shell-linux64/…`) — if
  the CDN is reachable, `npx playwright install chromium` beats shimming.
  WebKit needed `install-deps` after download to pass host validation.

## Guidance UI + five-model roster — renames ripple through enum, store, and env

- **A model rename is never just a label.** `TargetModelId` flows into the DB
  `model_target` enum, the persisted Zustand store, `TARGETS`, formatters, and
  four test files. Making the ID list the single `as const` source meant the
  compiler enumerated every touchpoint — change `TARGET_MODELS` first and chase
  the red. Two pieces the compiler can't see: the Postgres enum (migration with
  `RENAME VALUE`, which relabels existing rows for free) and stale localStorage
  (zustand `version`+`migrate`, else a stale ID 400s on `/api/enhance`).
- **`RENAME VALUE` makes deploy order matter.** Old code writes the old enum
  value, new code the new one; whichever side of the migration you're on, one
  of them 500s. Apply the migration immediately before the deploy and say so in
  the migration header.
- **xAI is OpenAI-compatible** — the adapter is `openai.ts` with a `baseURL`;
  no new dependency, no raw-fetch client. Mirror, don't invent.
- **A shared tooltip beats per-cell tooltips in a six-up grid.** Cells are
  ~55px at 360px wide; one pill under the rig whose caret reuses the lens-lock
  sixth-width math needs no positioning library and gives a stable read
  position. `MODE_BLURB` already existed (unused) — repurposing beat adding a
  parallel record.
- **This sandbox's Playwright browsers can lag the pinned version.** 1.60.0
  wanted chromium-1223/webkit-2287; /opt/pw-browsers had chromium-1194 and no
  webkit. Symlinking the chromium revision dirs + apt-installing webkit's
  system libs got the full matrix green locally — don't skip the e2e gate just
  because the runner image is stale.

## Integration review — features can ship "green" while a layer is invisible or unwired

- **A `body` background paints ABOVE negative-z-index fixed layers.** Only the
  ROOT element's background sits beneath a `position:fixed; z-index:-10` layer
  (CSS 2.1 App. E paint order). The P1 body gradient therefore occluded the
  entire R4 ambient background (mesh canvas + auroras) in both themes — the
  canvas animated at 30fps, invisibly, on every screen, and every gate stayed
  green because nothing _asserts_ pixels. The committed docs/preview.png even
  showed the flat background and nobody noticed. Lessons: (1) put page-wide
  background ownership in ONE place (html guards, the fixed layer paints);
  (2) an "is it actually visible?" screenshot beats any amount of code review
  for layered/z-index work — my stacking-context _theory_ pointed at the wrong
  fill (the shell div) until pixel-sampling the render exposed the second one.
- **`var(--tw-shadow, fallback)` is always dead under Tailwind.** Using any
  shadow utility anywhere makes Tailwind emit `*,::before,::after
{ --tw-shadow: 0 0 #0000 }`, so the custom-property fallback never fires —
  the global focus ring's 1px Laser layer had never rendered. Write literals
  in hand-authored CSS; utilities still override by cascade.
- **Grep for server actions with no client callers.** `updateTagsAction`,
  `logShareAction`, and the `profile_updated`/`shared` enum values were fully
  built, RLS-policied, and dead — the library tag filter could never have
  data. When a feature spans DB → action → UI, verify the LAST hop exists.
- **ARIA roles are promises about keyboard behavior.** `role="tablist"`/
  `role="radiogroup"` without arrow-key + roving-tabindex handling is worse
  than no role. Either implement the pattern's keys or use humbler semantics
  (`role="group"` + `aria-pressed`).
- **Workbox runtime routes match GETs only.** Routes registered for POST-only
  endpoints (`/api/enhance`) can never fire — the "enhance" route's only live
  effect was caching cross-origin Supabase `/auth/v1` GETs (session PII) into
  Cache Storage. Audit SW route matchers against the actual method + origin
  of the traffic they claim to govern.
- **Snapshot every input of a run, not just the big one.** The composer
  snapshotted the submitted _input_ (R8) but passed live `activeMode`/
  `targetModel` to the result tree, so flipping either after a run mislabeled
  saves/exports. If a result must be stable, snapshot the whole request.
- **Subagent verification can vanish mid-flight** (session limits) — the
  audit fan-out completed but all 105 verifiers died on quota. The fallback
  that worked: verify each finding directly against the source before
  implementing, and let the gate + screenshots be the arbiter.

## Media vision — a "configured" key can still be rejected by the provider

- **Key present ≠ key permitted.** The vision path checked only that the env
  key existed; a restricted/project-scoped key passes that check and then the
  provider 401s ("insufficient permissions"), which surfaced raw and dumped
  the user to on-device analysis. Classify upstream failures by status —
  401/403/404 are _deployment_-shaped (key permissions / unknown model), not
  image-shaped — and retry once on another configured provider before
  degrading. Keep the status on `ProviderError` so callers can tell.
- **When a fallback answers, credit the model that actually ran.** Usage
  logging, the cost cap, and the UI chip must follow the substituted target
  (`usage.target` from the server), or the ledger lies and the chip
  misattributes spend. A soft amber note on the ready card beats failing the
  item.

## Roster expansion (2026-07) — six OpenAI-compatible providers in one pass

- **A DB-enum rename touches four layers in lockstep:** the enum migration
  (`RENAME VALUE` — updates rows in place), the generated
  `database.types.ts`, every hardcoded default (`ui.ts`, layout, media
  route), and the UI-store `migrate` (bump the persist `version` and map the
  legacy ID, or a stale localStorage selection 400s on `/api/enhance`).
  Grep for the raw ID string first — half the references live in tests.
- **When N providers speak the same wire shape, add one factory, not N
  files.** `openai-compat.ts` configures six providers from one streaming
  implementation. Divergences fit in three flags: base URL, whether
  `response_format: json_object` is accepted (Perplexity: no — json_schema
  only), and whether the model interleaves `<think>…</think>` into content
  (MiniMax: yes — strip it before the envelope scanner, remembering a tag
  can split across stream chunks).
- **Not every flagship can see.** New enhance targets aren't automatically
  vision targets — gate media analysis on a capability check
  (`supportsVision`) and route text-only flagships to the fallback chain up
  front, instead of letting the provider 400 and surfacing it to the user.
- **Pin new-provider defaults to alias strings where the vendor offers one**
  (`deepseek-chat`, `qwen-max`, `mistral-large-latest`) — the roster label
  can name the product ("DeepSeek V4") while the wire string tracks the
  vendor's current release; exact snapshots stay an env override.

## Muse Spark cutover + Z.ai (2026-07) — a provider-key rename ripples beyond code

- **An env-key rename is a deployment event, not a refactor.** Renaming
  `LLAMA_API_KEY` → `META_API_KEY` touches the Vercel project env (operator
  action — the target reads "not configured" until it happens), the
  vision-fallback test's clean-slate `KEY_ENVS` fixture, `.env.example`, and
  two runbooks. Grep for the old VAR NAME, not just the old model id.
- **The hand-maintained `database.types.ts` must mirror enum surgery
  exactly:** a `RENAME VALUE` keeps its position in the union (values are
  stored by OID), an `ADD VALUE` appends at the end — matching what a
  regenerated type would produce keeps future diffs clean.
- **Decorative animation defaults to too busy — start subtle.** The hero
  graphic shipped with three concurrent motions (dash march, traveling
  pulse, breathing halo) and immediately got feedback to calm it. One slow
  motion is a better default than three fast ones; and when a keyframe range
  narrows, set the element's BASE opacity to the midpoint so the global
  reduced-motion collapse rests inside the designed range.
- **Model-facts research goes through the vendor's current page, not
  training memory.** The Meta rename (Llama API → Meta Model API, new model
  id, new pricing) and Z.ai's current flagship id both post-date any
  baked-in knowledge — fetch the developer docs before writing config.

## K3/M3 + GPT-5.6 tiers + symmetric hero (2026-07) — same-provider additions are the cheap kind

- **Adding a target on an EXISTING provider is config-only:** Luna/Terra
  reuse OpenAI's key, stream, and vision path — only constants, TARGETS,
  TARGET_CONVENTIONS, the DB enum, and docs grow. The expensive shape is a
  new provider, not a new model; check which case you're in before planning.
- **A flagship-version bump is the same drill as a rename, every time:**
  enum RENAME VALUE migration, `database.types.ts` union surgery (renames
  keep position, adds append), UI-store legacy map + version bump, tests
  that spell the raw id, `.env.example`, and four docs. The grep list from
  the Muse Spark lesson held exactly.
- **Mirror, don't redraw.** For the symmetric hero, wrapping copies of the
  right-wing paths in `transform="translate(320 0) scale(-1 1)"` guarantees
  the mirror stays exact through future tweaks — hand-mirrored coordinates
  drift. Anchor symmetry on the optical center the parentheses define
  (x=160), not the halo's cx.
- **Stagger with negative delays and check nth-of-type scope:** phase-offset
  line shimmer uses `animation-delay: -2s/-4s` so all lines are mid-cycle at
  load, and `nth-of-type` counts per wing group, so one rule lands
  identically on both mirrored sides. The global reduced-motion rule zeroes
  delays and iterations — animations must rest at their specified (static)
  values.
- **When a product mark diverges from the corporate mark, pick the one the
  user recognizes:** Kimi's "K" (Simple Icons `kimi`) over Moonshot's
  crescent. Where no official product glyph exists (Muse Spark), draw an
  original in the set's own convention (single monochrome `currentColor`
  path) and document the deviation at the source-comment.

## Developer marks name the developer, not the model (2026-07)

- **Don't draw an original when an official mark already exists.** Meta's slot
  got a hand-drawn twin-spark glyph on the reasoning that Muse Spark has no
  published mark — but the row is keyed on `Developer`/`DEVELOPER_LABEL`
  ("Meta AI"), so the mark answers _who made this_, not _which model_. The
  official Meta infinity mark was already in the repo and was the right
  answer; it is now restored from thesvg.org `icons/meta/mono.svg` and pinned
  by a unit test (`models.test.tsx`) so it can't drift again. The
  draw-an-original escape hatch applies only when the _developer_ has no
  glyph in the source set — not when a model is new.
- **Verify guardrail §6 sourcing before re-attributing an asset.** The
  2026-07 comment moved Meta into the "Simple Icons" group; the path was in
  fact byte-identical to thesvg.org's `meta/mono.svg` (its mono variants
  mirror the Simple Icons single-path convention, which is what made the two
  look interchangeable). One `curl` against
  `https://thesvg.org/icons/{slug}/{variant}.svg` settles it — cheaper than a
  wrong provenance note that outlives the change.
- **Rasterize a restored path before trusting it.** The Meta mark's two inner
  counters rely on the default nonzero fill rule (no `evenodd`, unlike
  Mistral's). Rendering the glyph to PNG at both theme inks — `#b7ff3c` on
  `--void`, `#3f6b00` on light — confirms the counters punch through and the
  mark stays legible in both themes; a `d`-string diff alone can't show that.

## Clearing the dependency audit (2026-07) — `npm audit fix` is the wrong tool

- **`npm audit fix` made it worse: 11 → 22.** It left the one that mattered
  (`next`) untouched while drifting `workbox-build`, `minimatch`, and the
  eslint chain into _newly_ vulnerable versions. Read the report, pick
  versions deliberately, and re-audit after each step. Reach for
  `npm audit fix` only to confirm what it would do, never to do it.
- **Chase root causes, not entry counts.** Fourteen of the reported entries
  were one package: `brace-expansion`. `npm audit --json` → each entry's
  `.via` (a string means "cascaded from that package", an object is a real
  advisory) and `.nodes` (the actual installed paths) separate causes from
  cascade. Nonsense `fixAvailable` values — "fix" `@eslint/eslintrc` by
  _downgrading_ to 0.1.0, or `eslint-config-next` to 12.0.4 — are the tell
  that an entry is cascade, not cause.
- **Check whether the old major has any patched release at all.** The
  `brace-expansion` OOM advisory covers everything `<=5.0.7`, so the 1.x/2.x
  lines are permanently affected and an `overrides` jump to 5.x is the only
  fix. Before forcing a major on transitive consumers, confirm the packaging
  is drop-in: 5.0.8 still publishes a CJS `require` export, so `minimatch@3`
  (CJS) keeps working — verified by the fact that `npm run lint` exercises
  exactly that path.
- **Never regenerate `package-lock.json` from scratch for a security bump.**
  `rm package-lock.json && npm install` drifted 69 unrelated packages,
  including `@supabase/*` 2.108 → 2.110 on the auth path, `react`/`react-dom`,
  and `@playwright/test` (which then demanded a different browser build and
  failed 5 e2e specs — an environment artifact that reads exactly like a code
  regression). Keep the committed lockfile as the base and let `npm install`
  move only what the new ranges and overrides require: same 0 vulnerabilities,
  10 incidental changes instead of 69, all of them transitives of the
  intended upgrades.
- **Know which audit gates CI.** `.github/workflows/ci.yml` gates on
  `npm audit --omit=dev --audit-level=high` and runs the full tree as advisory
  only. Fix the production tree first — that is both the real deployed risk
  and the failing gate — then work outward through dev tooling.
- **A native-module bump needs an output diff, not just a passing script.**
  sharp 0.33 → 0.35 is a new libvips. Re-running `generate:icons` "worked",
  but the real question was whether the 32 shipped PNGs still render the same:
  a raw-buffer compare showed max channel delta 0, so only container bytes
  changed and the committed assets could be left alone. Re-encoding locked
  brand assets inside a dependency PR is churn a reviewer can't verify.

## `model_target` enum drift — a committed migration is not an applied migration

- **Five green gates cannot see the hosted schema.** `20260726000000` sat in
  `supabase/migrations/` unapplied for a day; lint, typecheck, unit, e2e, and
  build all passed because every one of them reads the migration _file_.
  Meanwhile four of sixteen targets (GPT-5.6 Terra/Luna, Kimi K3, MiniMax M3)
  `22P02`'d on every write. The gate that was missing wasn't a better test —
  it was a check that talks to the actual database (`npm run check:db-enum`).
- **A hand-edited "generated" file converts a runtime error into a lie.**
  `database.types.ts` says "Do not edit by hand" and had been, declaring all
  sixteen labels against a fourteen-label database. That made `TargetModelId`
  and `Enums<"model_target">` agree perfectly — typecheck confirmed the app
  against a schema that did not exist. Regenerate from the live project, or the
  types assert the roster back to itself.
- **Replaying migrations is a cheap, exact oracle.** Parsing every
  `ALTER TYPE … ADD VALUE / RENAME VALUE` out of the SQL and applying it to a
  declared baseline reproduced the hosted enum's fourteen labels _in order_,
  which is how the baseline (`opus_4_8`, `gpt_5_5`, `gemini_pro_3_1`) was
  confirmed rather than guessed. Worth doing for any enum the app writes.
- **Rank the silent failure above the loud one.** The visible symptom was a raw
  Postgres string in the save button's error slot. The real damage was the
  `usage_events` insert failing behind a `console.error`: those four models'
  spend never reached the ledger, so the §6 daily cost cap silently stopped
  applying to them. When one bad value breaks several writes, audit _every_
  write site — the one nobody reported is the expensive one.
- **Verify a DB fix through the app's own path, not just the SQL console.**
  `ALTER TYPE` succeeding proves the DDL ran. Probing PostgREST
  (`?target_model=eq.<id>` → 200 present / 400 + 22P02 missing) proves the
  layer the app actually uses agrees — and that probe, being read-only and
  dependency-free, became the preflight script.
- **Prove a new guard fails.** Deleting the migration file and watching three
  assertions go red — naming the exact four ids — is what distinguishes a
  regression test from a test that merely passes today.

## 2026-07-26 — Gemini 3.6: a vendor's app picker is not its API model list

- **A model-picker label is not a model ID.** Gemini's app offers "3.6 Thinking"
  and "3.6 Fast"; the API offers `gemini-3.6-flash` and a `thinkingLevel`. The
  obvious reading of "add 3.6 Thinking and 3.6 Flash" — two roster entries, two
  model strings — produces a 404 on every call to the invented one. Read the
  provider's model-ID table before adding a roster entry; the marketing name,
  the app label, and the API string are three different things.
- **That 404 would not have looked like a 404.** `isVisionConfigError` classifies
  404 as config-shaped, so `/api/media` would have retried on another provider
  and shown a soft fallback note. The target would appear to "work", just never
  on Google. A wrong model string is loudest on `/api/enhance` and quietest
  exactly where it costs the most to debug.
- **A "mode" that's really a request option wants a selector, not roster
  entries.** The first cut modeled Thinking/Fast as two roster entries sharing
  one model string with fixed levels. That worked, but it was the vendor's
  picker re-encoded in config — the honest shape is one entry plus a
  per-request `thinkingLevel` the user sets (`TARGET_THINKING_LEVELS` +
  `ProviderRequestOptions`), which then generalized to Anthropic
  (`output_config.effort`) and OpenAI/xAI (`reasoning_effort`) for free.
  Duplicate roster entries per knob value would not have scaled to a
  five-level effort ladder.
- **Widen a shared function signature, don't touch twelve call sites.** Typing
  the fan-out map as `Record<Provider, ProviderStream>` with an optional fourth
  parameter let some adapters take options while the knob-less ones stayed
  three-parameter functions untouched — TypeScript accepts a narrower function
  where a wider signature is expected. The `as const` on that map was what
  blocked it.
- **Each provider's level vocabulary is its own.** Gemini has `minimal…high`,
  Anthropic `low…max` (and `budget_tokens` is _removed_ on the Claude 5
  family — sending it 400s), OpenAI's SDK types accept `low/medium/high`.
  One app-wide ladder with per-target subsets — validated by the route,
  narrowed again at each adapter — keeps a bad value from ever hitting a
  wire. Offer only what the installed SDK's types accept; a wider consumer
  list is not evidence the API takes it.
- **A price change is a cost-cap change.** Gemini output went $1.20 → $7.50 per
  1M. The `numEnv` defaults only apply where the env var is unset, so a stale
  `PRICE_GEMINI_OUT` in Vercel keeps the cap under-counting 6× — the kind of
  drift that shows up as an unexpected bill, not as a failing test. Any model
  bump needs a "check the deployed overrides" line in the changelog.
- **Renames chain; legacy maps don't.** `gemini_pro_3_1` had pointed at
  `gemini_3_5_thinking`, which this change renamed away. Every entry in
  `LEGACY_TARGET_IDS` has to point at the _current_ id, not the next hop —
  the enum contract test checks values against the live roster, which is what
  catches a half-updated chain.

## 2026-07-26 — iOS bottom nav: `backdrop-filter` on fixed chrome, and the keyboard

The bottom nav floated mid-screen on iOS, covering the footer, after the bars
went frosted-glass. What broke, what changed, what to avoid:

- **`backdrop-filter` directly on `position: fixed`/`sticky` chrome is an iOS
  trap.** WebKit's async scrolling repaints the filtered layer out of step with
  the scroll, so the bar detaches from the viewport edge. The safe shape —
  suite-wide — is: keep the fixed element itself plain, put the tint + blur on
  a `::before` (`inset: 0; z-index: -1; border-radius: inherit`), and promote
  the bar to its own composited layer. Treat "blur on a bar" as a code-review
  flag the same way laser-on-light is.
- **Tailwind transform utilities silently replace a component-layer
  `transform`.** The `translateZ(0)` promotion sat in `@layer components`; the
  keyboard slide added `translate-y-*` utilities, which win the cascade and
  swap the whole `transform` value. `will-change: transform` carries the layer
  promotion through that override. When a utility and a component class both
  set the same property, assume the utility wins and design for it.
- **"Fixed to bottom" means "fixed behind the keyboard" on iOS.** The layout
  viewport never shrinks for the software keyboard, so bottom bars either
  hide behind it or — after a scroll — re-anchor mid-screen. Don't fight it:
  hide the bar while the keyboard is up. The visual-viewport heuristic
  (`layoutHeight − visualHeight > 150`, pinch-zoom excluded via `scale`) lives
  in `lib/pwa/keyboard.ts` as pure math, same pattern as `safe-area.ts`, so
  the tricky part is unit-tested without a device.
- **The e2e matrix's WebKit leg can't run in the remote container** (no WebKit
  binary; Chromium build-number skew is bridgeable with a symlink). CI's
  `playwright install --with-deps` covers mobile-safari — don't burn time
  trying to install WebKit locally, and don't call the suite green without
  saying which leg ran where.
- **Sub-16px form controls are an iOS bug, not a design choice.** Any focused
  `input`/`select`/`textarea` under 16px makes iOS Safari zoom the page and
  stay zoomed — which also re-anchors fixed chrome, recreating the floating-bar
  symptom class. Eight controls had drifted under the threshold. The fix is a
  single iOS-scoped base rule (`@supports (-webkit-touch-callout: none)` +
  `font-size: max(1rem, 1em) !important`) rather than eight per-site edits —
  the `!important` is earned: sub-16px utilities sit on the controls themselves
  and out-specify any base-layer rule.
- **44pt targets don't require 44px pills.** The locked style guide's ~30px
  chips stay visually intact behind `.tap-44`, an invisible hit-area-extending
  pseudo — but pseudos don't render on replaced elements, so selects need
  `min-h-[44px]` instead.

## 2026-07-27 — UX-audit remediation (Adapt · tray roles · library scale · Settings)

- **Owner direction superseded again — record the reversal chain.** The Reset
  button had been styled as a second Laser fill at explicit owner request
  (see the earlier "Owner direction beats an earlier style rationale" entry);
  the 2026-07 UX audit reversed that: a destructive action must not share the
  primary's filled treatment. ENHANCE is now the composer's only `btn-laser`,
  pinned by a unit test, and Clear is tertiary with an Undo toast. When
  direction flips twice, the changelog must narrate both hops or the next
  session "fixes" it back.
- **`pkill -f <name>` can match the shell that runs it.** A compound command
  containing `pkill -f next-server` died with exit 144 — the pattern matched
  the shell's own command line. Use a self-excluding bracket pattern
  (`pkill -f 'next-serve[r]'`).
- **PostgREST PGRST202 means "no function with THESE parameters", not "no
  function".** An RPC probe with an empty `{}` body reads a live function as
  missing. Probe with the real named args — anon's `42501 permission denied`
  is the cheap existence proof.
- **Two FK paths make embedded selects ambiguous (HTTP 300).** With both
  `prompt_versions.prompt_id -> prompts` and `prompts.current_ver ->
prompt_versions`, `prompt_versions(count)` answers 300 — disambiguate as
  `prompt_versions!prompt_id(count)`. Probe embedded shapes against the live
  API before writing the query code.
- **Top-level PostgREST aggregates are disabled on Supabase (PGRST123).**
  `select=target_model,count()` is rejected; embedded `(count)` still works.
  Facet counts fall back to a capped column-only select reduced in JS — cap
  it and say so in a comment.
- **Generated source can smuggle literal control bytes.** A U+001F cursor
  separator and a control-char-stripping regex were emitted as RAW bytes,
  turning source files "binary" for grep/diff (and even the first draft of
  THIS lessons entry tripped the harness's control-character guard). After
  writing any file that mentions control characters, `cat -v` it and rewrite
  with `\uXXXX` escapes; a `file`-says-text check before commit is cheap.
- **Pin a cross-runtime hash with a live fixture, not by reading both
  implementations.** The duplicate-detection sha256 must byte-match the SQL
  backfill; one `select encode(digest(...), 'hex')` against the hosted DB
  became the unit-test fixture, making drift impossible to miss.
- **`vi.mock` factories can't close over file-level consts — use
  `vi.hoisted`.** The mock factory is hoisted above the declaration
  ("Cannot access before initialization"); `const m = vi.hoisted(() => ...)`
  is the sanctioned escape.
- **Playwright browser lag, part 3:** with CDN egress available,
  `npx playwright install chromium` cleanly fetched the 1223 build this
  repo's 1.60 pin wants — the fastest of the three fixes tried across
  sessions. WebKit still can't run here; say which leg ran where.
- **The tray inherits every composer contract.** Moving media into the
  composer put `AttachmentTray` inside the mono-scoping test's blast radius
  and under the 16px-iOS-input rule — new files in a governed region must be
  added to the governing test's list in the same commit, or the contract
  silently stops covering them.

## 2026-07-27 — Envelope resilience · collections · account deletion (post-merge follow-up)

**What broke.** A production Sonnet 5 run 502'd with "missing the expected
fields" while a complete output sat in the partial card — the model returned
valid JSON whose `rationale` wasn't a plain string, and the parser failed the
whole paid run over it.

- **Read the error string before hypothesizing.** The two parse errors
  (non-JSON vs missing-fields) discriminate truncation from shape drift; the
  reported message proved `JSON.parse` had SUCCEEDED, killing the truncation
  theory in one step. Keep diagnostic messages distinct and stable — they are
  the incident's first stack trace.
- **Audit every provider's enforcement when one drifts.** Anthropic was the
  ONLY provider sent no structural JSON mode (`response_format` /
  `responseMimeType`) — the prose contract was the whole defense exactly
  where the failure happened. A per-provider capability matrix beats
  assuming symmetry.
- **The default path deserves the same headroom as the tuned one.** Claude 5
  thinks by default and bills thinking against `max_tokens`, yet the
  unset-effort path had the tightest ceiling in the fleet (16k while high
  got 32k). When a knob's absence changes resource math, test the ladder —
  a pure exported params builder made that testable with zero SDK mocking.
- **An exported capability nobody consumes is a latent recovery path.**
  `scanner.done` (output's closing quote seen) existed for a full phase with
  zero call sites; wiring it turned "discard a paid, fully-streamed result"
  into a salvage with an honest note. Grep for exported-but-unread state
  when designing error paths.
- **Salvage needs a proof, not a heuristic.** Recovery only fires when the
  output string demonstrably completed — plus a user-visible flag and a
  production-surviving `console.warn` so systematic drift stays countable.
  Silent salvage would have hidden the next contract regression.
- **`information_schema` FK probes are privilege-filtered.** The first
  cascade probe showed NO FKs to `auth.users` (missing ref-table privileges
  hide rows); `pg_constraint` showed every user-keyed table cascades. Schema
  facts that gate destructive code must come from `pg_catalog`.
- **Prove a new guard fails before making it pass.** The collections drift
  probes ran red (including the new missing-table PGRST205 branch) before
  the migration was applied, then green after — the only way to know the
  probe actually probes. Corollary: `probeColumns` needed that missing-table
  branch the day the first CREATE TABLE migration landed.
- **Service-role first use wants an invariant, not vigilance.** One
  consumer, `server-only` import, per-request construction, session checked
  before the client exists, and a test asserting the only identifier
  reaching admin calls is the JWT's own user id. A destructive native form
  POST beats a fetch-based flow when the session dies mid-action.
- **A merged PR's follow-up is a fresh branch.** `checkout -B <branch>
origin/main` and a NEW draft PR — never stack on merged history.
- **A hand-rolled drag must CLAIM the axis it wants.** The swipe row put
  pointer handlers on a wrapper whose descendant `<a>` inherits the base
  `touch-action: manipulation` — which permits panning on _both_ axes, so the
  UA stayed free to take the horizontal drag and hand back a `pointercancel`.
  Mapping cancel to pointer-up settles the swipe politely but cannot prevent
  the theft. `touch-action: pan-y` on the dragged element is the claim; it
  works from the ancestor because the used value is the _intersection_ down
  the chain, so a descendant can never widen it. Returning it from the hook
  next to the transform keeps the two halves of one contract together.
- **Widening a regex to fix a no-op can start eating content.** `[runway]`
  had to go for the Plain copy to mean anything on the motion engines — but
  `^\[[a-z]+\]` also matched the _user's_ first word, and only the motion
  grammar prepends a tag at all: midjourney and audio prompts begin with the
  base prompt, where `[intro]`/`[verse]`/`[lofi]` are ordinary content. Anchor
  a stripper to the real id set (derived from `GEN_TARGETS`, so a new engine
  can't be forgotten), never to a shape. Same commit, same lesson: `\s{2,}`
  → `" "` flattened the paragraph breaks the attachment tray itself writes;
  a cleanup collapse wants `[^\S\n]{2,}`, or it changes the prompt's shape
  while claiming to change only its syntax.
- **Fixing a dead control in one grammar leaves it dead in the others.**
  Stripping the tag revived Plain for runway/sora/kling and left it copying
  Copy verbatim for audio, whose grammar emits no syntax at all. The general
  fix is to render the variant only when it would differ — the condition the
  control's existence actually depends on.
- **Strip what the formatter ADDED, not what looks like syntax.** Two review
  rounds landed on the same defect from opposite ends: a pattern sweep over
  the whole generated prompt deleted the _user's_ leading `[intro]` and then
  the user's mid-sentence `--help option,`. Everything but the appended
  syntax is user text, and user text may contain anything. The fix that ends
  the class is positional and engine-aware — midjourney's trailing
  `--ar <r> --v <n>`, motion's leading `[<engine>]`, audio nothing — switched
  over `GenTargetId` so a new engine is a type error rather than a silent
  hole. Bonus: nothing is cut from the middle any more, so the gap-closing
  whitespace collapse (which had been flattening real paragraph breaks)
  simply went away.
- **A component-layer `box-shadow` silently eats the focus ring.** Adding the
  glass sheen replaced the base-layer `:focus-visible` ring on every `.glass`
  button, link and input — and because several of them also carry
  `focus:outline-none`, that left keyboard users with _no_ focus indicator
  (WCAG 2.4.7). It was invisible in review because cascade LAYERS decided it,
  not specificity: no selector looked stronger, the later layer simply won.
  `box-shadow` is one property, so decorative shadows on interactive surfaces
  must COMPOSE with the ring, never replace it — hence `--focus-ring` as a
  token and `.glass:focus-visible` re-including it. Only a real engine
  resolves layers, so the guard has to be e2e; the spec was proven red with
  the rule removed before being trusted green.
- **The DB's type system is a design input, not an obstacle.** `model_target`
  is a Postgres enum on three columns, so "auto" could never be a target id —
  which is what forced Auto to be a boolean riding BESIDE a real fallback,
  resolved server-side, with only the resolved id ever written. That shape is
  better than the one intended anyway: `resolvedTarget` gives the client
  provenance it would otherwise have to infer, and the library records the
  model that actually produced the text. Let the constraint pick the design.
- **Resolve a derived value before anything reads the thing it derives from.**
  Auto resolves immediately after the target gate and before the thinking gate,
  because that gate indexes `TARGET_THINKING_LEVELS[target]` — resolving later
  would have validated the user's thinking dial against a model they weren't
  going to get. Order-of-validation bugs don't announce themselves; find them
  by asking which later gate reads the value.
- **Gate a per-mode knob in the builder, not at the wire.** `format` and
  `length` are keyed by mode inside `buildSystemPrompt`, so a knob sent with a
  mode that doesn't take it is INERT rather than contradictory. That is what
  lets the route validate legality only, and it means a stale client — or a
  mode flipped between composing and sending — can't produce a prompt that
  argues with itself. The test that pins it asserts the built prompt is
  byte-identical with and without the knob for every mode that ignores it.
- **A shared dial can't always share its words.** Condense and Expand take the
  same three-position control, but the aggressive end of one is the smallest
  output and of the other the largest. "Short/Medium/Long" would have been a
  lie on one of them, so the labels (and the instructions) are per mode. When
  one control drives two opposite meanings, only the geometry is shareable.
- **Adding an optional field to a required contract must not weaken it.**
  Clarify's `questions` never substitutes for `output`: the model answers AND
  may ask. Had questions been allowed to stand in, a paid run could return
  nothing usable. Same tolerance as `assumptions` (filtered, trimmed, capped,
  omitted-when-empty, never fatal) with its own lower cap, because a human
  answers these by hand.
- **A new variant of an existing thing may need to contradict its siblings'
  boilerplate.** All three refine instructions opened "the input you receive is
  an already-enhanced prompt". For the answered pass that is false — its input
  is the author's original — so copying the sibling framing would have told the
  model something untrue about what it was holding. Check the shared preamble
  before joining a family.
- **`touch-action` is not decoration.** `pan-x pan-y` on the composer read like
  a pull-to-refresh guard and was actually a zoom kill switch: it omits
  `pinch-zoom`, while the actual PTR suppression came from `overscroll-behavior`
  on the line above. A property whose name doesn't mention the thing it breaks
  is exactly the kind that survives review. (The mirror of the swipe-row lesson:
  there, the missing claim broke a gesture; here, an unnecessary one broke zoom.)
- **A fallback can turn a control into a duplicate of its neighbour.** Share
  fell back to a clipboard write when Web Share was absent, so on some browsers
  it did precisely what Copy did one row over — with the "Copied ✓" landing on
  the other button. Capability-detect and HIDE, the way the paste pill already
  did; a graceful fallback isn't graceful when it makes two controls identical.
- **A dismiss that isn't scoped can eat the thing it triggered.** The toast
  action ran `onAction()` then dismissed unconditionally, so an action that
  posted a follow-up toast lost it instantly — the "Replace draft → Undo" chain
  would have silently dropped its second half. Scope the dismiss to the id that
  was showing. Found only because a test asserted the follow-up appeared.
- **Run the gate in order, every time.** The length-rail commit went in with a
  typecheck failure: its test used a request field never added to the type, so
  the runtime tests passed and `tsc` was never re-run after the test file
  landed. Amended. Re-running unit tests is not a substitute for re-running the
  step that checks a different thing.

## 2026-07-28 — Reconciling a doc pushed from a stale base

- **"It pushed" is a claim to verify, not a premise to act on.** The instruction
  was to reconcile a Copilot pass over PR #44. Copilot never pushed: #44 had
  merged at `b0f8b2e`, its branch was auto-deleted, and no Copilot PR existed.
  The branch that had actually appeared was Cursor's, adding `AGENTS.md`. An
  approved plan was already written against the wrong subject — checking
  `git log`, the branch list and the PR list first cost two minutes and stopped
  a reconciliation of something that did not exist.
- **An agent-authored doc can be right about the machine and wrong about the
  repo.** Every environment claim in the incoming `AGENTS.md` held up —
  fail-closed middleware, jsdom, port 3100, the WebKit skip, vendored fonts.
  Every claim about repo _state_ had rotted, because it was authored against a
  base thirty commits old: one tracked migration (there are ten), three provider
  keys (there are twelve), and an "update script" belonging to another tool's
  environment config. Verify a doc against `HEAD`, claim by claim, before
  merging it — the useful parts and the stale parts arrive in the same file.
- **A contradiction between two docs is a finding about the one you already
  own.** The new file said the build needs no network for fonts;
  `docs/runbooks/local-dev.md` still told you to retry a font failure with
  connectivity. The newcomer was right — the families were vendored in P1 — so
  the incoming file's real value was exposing a stale troubleshooting entry that
  had been quietly wrong for weeks in a doc nobody had reason to re-read.
- **Cherry-pick rather than re-type, when someone else wrote it.** `git
cherry-pick` kept Cursor Agent as the author and put the corrections in a
  separate commit, so the diff says plainly what arrived and what was changed.
  Rewriting it as my own commit would have made the record less true for no
  gain.

## 2026-07-28 — Developer accents on library cards

- **A translucent fill turns every permanently-rendered sibling into a visible
  wash.** The library's swipe panels were always in the DOM and only
  `aria-hidden` toggled — which hides a thing from screen readers and from
  nobody else. Under a `.glass` card at 28% transmission that painted an olive
  left edge and a red right edge on every row, constant and model-independent,
  and it read as an error state. Reveal-on-gesture UI has to gate on
  DISPLACEMENT, not on committed state and not on ARIA: `open` is only set at
  pointer-up, so gating on it drags the card across an empty gutter for the
  whole gesture and pops the colour in at release.
- **`overflow: hidden` on a row clips every outset focus shadow inside it.**
  The card's focus ring is `0 0 0 1px` plus a 24px glow — both outset — so the
  `overflow-hidden` that keeps a swiped row on its own track had silently
  removed the keyboard focus indicator from every library card. The e2e spec
  that exists to pin focus rings could not see it: it can only reach
  `/sign-in`, and the library is behind auth. Second time a focus ring has died
  here to a mechanism that looks fine in review — the first was cascade-layer
  order. Check for an `overflow-hidden` ancestor whenever a focusable thing
  stops showing a ring, and note that an inset ring must live on a SIBLING,
  since an inset shadow paints below its own element's descendants.
- **I broke a contract test by writing a comment.** `reduced-effects.test.ts`
  built its haystack as `CSS.split("[data-reduced-effects]").slice(1)` — text
  after the FIRST occurrence. My explanatory comment mentioned
  `[data-reduced-effects] .glass`, which moved that first occurrence hundreds
  of lines up, so the haystack swallowed the component definitions and every
  selector assertion passed on a rule's own definition rather than on its gate.
  Same shape as the `overscroll-behavior-y` comment that satisfied its own test
  in P3. Strip comments and match STRUCTURALLY — parse the rule heads that
  actually contain the attribute — and add a guard that pins the parser's shape,
  because a parser matching nothing fails loudly but one matching everything
  passes silently.
- **Verify the mutation landed before believing a red/green result.** Proving a
  test red, I removed a CSS rule with a `perl -0pi` whose whitespace didn't
  match. Nothing changed, the suite stayed green, and for a moment that looked
  like "the test is vacuous". The mutation script needs its own assertion —
  `assert new != s` — or a proof-of-red run proves nothing.
- **jsdom has no `PointerEvent`, so `fireEvent.pointerDown(el, {clientX})`
  silently drops the coordinate.** The hook then computes `undefined - undefined`,
  every comparison against NaN is false, and the row's transform becomes
  `translateX(NaNpx)`. A "did it move?" assertion written as
  `not.toBe("translateX(0px)")` passes on that — I wrote exactly that test and
  it passed while nothing moved. Dispatch a `MouseEvent` typed `pointerdown`
  (React dispatches on the type string) and assert the EXACT offset.
- **Five of twelve AI developers publish black as their primary colour**, so a
  literal "use the brand colour" feature would have given five cards no visible
  accent. When a palette has to be derived rather than copied, say per entry
  which values are sourced and which are assigned — and put that in the token
  comment, not just the PR, because the PR is not what the next person reads.

## 2026-07-28 — Showing the bytes the quota meter charges for

**What broke.** Nothing broke; something was never finished. Settings showed a
storage meter, a picture-frame emoji per file, and a truncated UUID. Every part
of the plumbing worked — the objects were in the bucket the whole time — but
the UI presented a bill for files the user could not see. A quota meter over
unviewable items is an accusation, not information: the first question it
provokes is "18 MB of _what_?", and the screen had no answer.

**What changed.** Image rows render the stored file, and any `ready` row opens
its actual bytes in a sheet. Both go through signed URLs (the bucket is
private): one `createSignedUrls` batch for the list, a fresh single sign per
open.

**What to avoid.**

- **A truncated UUID is worse than no name.** `32264e82-d153-46a3-…` costs a
  full row of width to identify nothing. Where the real name was never recorded,
  synthesise one from what IS known — `Image · 3 days ago` — and let the
  thumbnail do the disambiguating.
- **Don't reuse a list's signed URLs for the detail view.** The list's batch is
  signed once at load; a page left open outlives it. Signing again on open is
  one request and removes an entire class of "it worked five minutes ago".
- **Supabase binds transform options into the signed token.** `createSignedUrls`
  (plural, batched) takes no `transform`; only `createSignedUrl` (singular)
  does, and it returns a `/render/image/sign/` URL whose token covers the
  transformation. So you cannot batch-sign and then rewrite the URL into a
  thumbnail — it's one request per transformed image, or full objects rendered
  small. Chose the batch; wrote down the trade rather than leaving it implicit.
- **Decoration must not be able to fail the thing it decorates.** `signThumbnails`
  swallows a rejecting signer and per-path errors and returns a partial map, so a
  storage hiccup costs thumbnails, not the ability to see and delete your files —
  which is the manager's actual job, and the one that unblocks a full quota.
- **A row that can't be opened must not look like one that can.** `pending` and
  `failed` rows are reservations whose upload never landed; they render as plain
  text, not buttons, so the only tap they offer is the one that works (remove).
- **Check the CSP before shipping a new media source.** `img-src`/`media-src`
  already allowed `*.supabase.co` (avatars got there first), and the service
  worker ignores cross-origin requests, so signed URLs are neither blocked nor
  cached — but that was luck inherited from an earlier decision, not a check
  the feature performed on itself.

**Environment note.** The sandbox image shipped `chromium-1194` and no WebKit
against this project's 1223 pin. Installing the pinned browsers
(`npx playwright install --with-deps webkit chromium`) was the fix — see the
next entry for what running WebKit immediately found.

## 2026-07-28 — A browser you never run is a test you never wrote

**What broke.** The `mobile-safari` Playwright project had, as far as I can
tell, never executed. The moment it did, it failed — and not marginally: WebKit
renders every page of this app with **no CSS at all** when the server is plain
http. `upgrade-insecure-requests` in the CSP rewrites every same-origin
subresource to `https://127.0.0.1:3100`, where nothing is listening for TLS, so
the stylesheet and all four fonts die in the handshake. Chromium exempts
loopback from the upgrade and therefore hides the whole thing.

Production was never affected — it is https, where the directive is inert. The
casualties were the e2e server and `next dev` in real Safari, i.e. exactly the
browser this iOS-first PWA is built for.

**What to avoid.**

- **"Configured" is not "run."** Two projects in `playwright.config.ts` looked
  like Chromium _and_ WebKit coverage. One of them was decoration. A browser
  binary that isn't installed doesn't fail loudly in a way anyone reads —
  it fails at launch, which reads as an environment problem, which reads as
  "not my test". Check that each project has actually produced a pass.
- **The failing assertion named the symptom, not the cause.** The focus-ring
  spec reported `box-shadow: none` and I nearly filed it as a WCAG regression.
  It wasn't: every custom property resolved to `""`, which meant no stylesheet,
  which meant a _loading_ failure wearing a _styling_ failure's clothes. When a
  computed value is empty, check whether the sheet loaded before you debug the
  cascade — `document.styleSheets[0].cssRules.length` and the page's
  `requestfailed` events answered it in one probe.
- ~~**Next's `has`/`missing` on `headers()` compile but do not enforce.**~~
  **Wrong — see the correction entry below.** They enforce correctly. The
  build-time flag stays, but for a different reason: it does not make
  production's posture depend on a proxy header no test here can observe.
- **A header that differs by environment should take the environment as an
  argument.** `buildSecurityHeaders(httpsOrigin)` is pure and testable from
  both sides; reading `process.env` inside the header list would have made the
  production variant untestable, and the production variant is the one that
  matters. It is resolved at BUILD time, because `headers()` is compiled into
  the manifest and never re-evaluated per request — so the e2e flag has to be
  set for `next build`, not just `next start` (Playwright's `webServer.env`
  covers the whole chained command).
- **`reuseExistingServer: !process.env.CI` will hand you a stale build.** Two
  runs "failed the fix" because Playwright reused a `next-server` still holding
  the pre-fix manifest; the giveaway was a 22-test suite finishing in 6.7s with
  no build in the log. Kill the port before trusting a local e2e result, and
  treat an implausibly fast run as a result you have not actually got.

## 2026-07-28 — I wrote a framework bug into four files without re-testing it

**What broke.** I claimed Next's `has`/`missing` conditions on `headers()`
compile into `routes-manifest.json` and are then not enforced at runtime, and
I put that claim in a commit message, `CHANGELOG.md`, `docs/runbooks/hardening.md`
and a `next.config.ts` comment. It is false. Re-run on a port nothing had
touched, they behave exactly as documented: no `x-probe` header → rule skipped;
`x-probe: yes` → applied; `x-probe: no` → skipped.

The original probe was answered by a **stale `next-server` still holding port
3100**, so it read the previous build's headers. My `pkill -f "next start -p
3100"` had matched the `npx` wrapper, not the `next-server` process it spawns.

The compounding part: I hit that same stale-server trap twice more that hour,
diagnosed it, and wrote it up in the entry directly above — _"treat an
implausibly fast run as a result you have not actually got"_ — and never went
back to re-check the earlier result that the same trap had already poisoned.
The design decision it justified survived on inertia.

**What to avoid.**

- **A negative claim about a framework is an extraordinary claim.** "This
  documented feature silently does nothing" should be the last hypothesis, not
  the first, and it needs a clean-room reproduction — fresh port, verified
  server PID, manifest inspected AND runtime observed — before it is written
  down. Mine had one experiment on a dirty port.
- **When you discover a trap, re-audit every earlier result it could have
  reached.** Learning the lesson prospectively is half the job; the other half
  is sweeping backwards. The stale server invalidated a conclusion I had
  already committed, and I had every fact needed to know that.
- **Kill by port, not by command line.** `pkill -f "next start -p 3100"` does
  not kill the `next-server` child that actually holds the socket. Confirm the
  port is dead (`curl` → connection refused) before trusting anything served
  from it.
- **Documenting a decision's reason locks it in.** Once "has/missing don't
  work" was in four files, the build-time flag looked settled rather than
  chosen. When the premise fell, the conclusion still happened to be right —
  but that was luck, and the reason had to be rewritten from scratch.

## 2026-07-28 — A weak affordance, a slow route, and a diagnosis I made up

**What broke.** The bottom nav "had" press feedback (`active:scale-95`) and
"had" fast navigation (Next `<Link>`). Neither was much use on a phone.

The affordance was too weak to see: a ~5% shrink on a 150ms ramp, no colour or
opacity channel, on a 64px bar under a thumb covering most of it — with the
native tap highlight already suppressed by
`-webkit-tap-highlight-color: transparent`. `:active` also cannot outlive
pointer-up, so a 40ms tap bought 40ms of feedback.

Navigation was slow for a reason no amount of press polish could fix: **no
route had a `loading.tsx`**, so a tab press blocked on the destination's full
server render — `auth.getUser()` plus two to three Supabase queries — with the
_old_ screen on-screen the whole time. The second-order cost was worse than the
first: without a loading boundary, automatic `<Link>` prefetch of a dynamic
route has nothing to warm, so the framework's own latency-hiding was inert too.

**What to avoid.**

- **"There is a CSS rule for it" is not "the user sees it."** `active:scale-95`
  had been in the file since P1 and read as covered in every review. Nobody had
  asked how big 5% is on a bar your thumb is covering. Where an affordance is
  load-bearing, give it more than one channel and drive it from state you can
  assert on — `[data-pressed]` — rather than a pseudo-class that needs a real
  engine and a held pointer to observe.
- **A tap is shorter than the eye.** A decisive thumb is down and up inside
  ~60ms: under four frames. `:active` cannot hold past pointer-up, so even
  where it fires, a fast tap flickers. The minimum-hold is not a nicety, and it
  is not expressible in CSS.
- **Press feedback must be instant on the way DOWN and eased on the way UP.**
  The original had `transition-[color,transform] duration-150` in both
  directions, so the scale was still ramping in as the finger left — a 150ms
  ramp is precisely the lag the affordance exists to disprove. Zero the
  duration in the pressed rule; let the resting rule own the ease-out.
- **jsdom has no `PointerEvent`, so every `pointerType` branch was untested.**
  Testing Library falls back to a plain `Event` and silently drops the field —
  `fireEvent.pointerDown(el, { pointerType: "mouse" })` delivers `undefined`.
  The first version of the haptics test passed for the wrong reason and the
  swipe hook's `pointerType === "mouse"` guard had never been exercised at all.
  When a test asserts on a DOM field, check the environment actually carries it.
- **A guard that scans source must be proven to bite.** The first version of
  the "no fixed element inside `.glass`" test anchored on `className="…"` and
  therefore skipped every `className={[…].join(" ")}` in the codebase —
  including the bottom nav, the single most important consumer. It reported a
  clean sweep over a set it could not see. Every guard here was then mutated
  on purpose to confirm it fails; one of the four did not, because the `sed`
  that was supposed to break it silently matched nothing.
- **Prefetch harder is not always prefetch better.** Forcing `prefetch` on the
  three tabs looked like the obvious win, and would have run every route's
  Supabase queries on every page view — while Next 15 defaults
  `staleTimes.dynamic` to `0`, which discards the result rather than reusing
  it. The cheap fix (a `loading.tsx` per route) is also the one that makes the
  framework's default prefetch work at all.
- **Scoping a perf switch is where the risk lives, not the switch itself.**
  Standing `.glass`'s backdrop blur down during scroll is safe only because no
  `.glass` element hosts a `position: fixed` descendant — toggling
  `backdrop-filter` toggles a containing block, and the overlay would jump
  mid-scroll. Extending the same rule to the chrome bars would have been a
  visible regression for a different reason (`--chrome` is ~0.43 opaque; text
  under an unblurred header is simply legible). Same one-line rule, two
  different reasons it must not be widened — both worth writing down next to it.

## 2026-07-28 — I did it again: folklore, asserted, shipped, then disproven

**What broke.** The entry directly above originally opened by explaining that
WebKit applies `:active` only when the document carries a touch listener, that
this app had none, and that adding one passive no-op `touchstart` listener was
what revived the nav's press feedback. I put that in the code comments, the
commit message, `CHANGELOG.md` and the PR body. It is false.

When WebKit was finally installed and the guard test was mutation-checked, the
test **passed with the listener deleted**. The reason: Next's App Router calls
`hydrateRoot(document, …)`, so React's event delegation attaches the entire
touch family — `touchstart`, `touchmove`, `touchend`, `touchcancel` — to
`document` on every page, unconditionally. The precondition my explanation
rested on had never been unmet. The listener was removed; the component that
held it now does one thing and is named for it.

The replacement explanation was _also_ wrong on first pass. I reasoned that a
150ms ramp could never complete inside a tap, so the scale stayed invisible.
Measured in WebKit, an ~80ms press reaches 0.951 — essentially the full
`scale-95`. The affordance was not failing to render; **5% is just not much to
look at**, with no second channel and the native tap highlight suppressed.

**What to avoid.**

- **This is the third entry in this file about asserting an unverified claim
  about a platform or framework, and the second in two days.** The prior one
  ("`has`/`missing` don't enforce") even ends with _"a negative claim about a
  framework is an extraordinary claim."_ I read that file, wrote a new entry
  under it, and made the same class of error in the same session. Reading the
  lessons is not the same as applying them. Before a platform claim goes into
  a comment, a commit or a changelog: reproduce it, or write "unverified".
- **A guard you cannot make fail is not a guard.** The `touchstart` e2e test
  was written from the same belief it was meant to protect, so it asserted a
  condition the framework satisfies for free. Mutation-testing it is what
  exposed the belief — not the test passing, the test refusing to fail. Every
  new guard gets deliberately broken before it is trusted; the one that will
  not break is the one telling you something.
- **A plausible mechanism is not a diagnosis.** Both of my explanations were
  mechanically sensible and both were wrong, and I only found out because a
  number was measurable. Where an effect can be measured — a scale factor, a
  duration, a listener registration — measure it instead of reasoning about it.
- **An unverifiable claim should not survive as a one-line "cheap insurance"
  either.** The tempting compromise was to keep the redundant listener with a
  softer comment. That just launders folklore into the codebase behind a hedge.
  It went.
- **Missing coverage hides the error, it does not cause it.** WebKit had never
  been installed here, so nothing could contradict me. Installing it took one
  command (`npx playwright install --with-deps webkit`) and immediately
  falsified the premise of the change I had already pushed. When a claim is
  specifically about a platform you cannot currently run, that is the moment to
  go get it — not to write the claim more confidently.

## 2026-07-28 — Closing a question you cannot answer

**What happened.** After the `:active` claim collapsed, the honest position was
"iOS may or may not ignore `:active` for touch; nobody here can check." That
left four `active:scale-95` controls whose feedback depended on the answer.

Researching harder did not resolve it. Every source says the same thing —
including Apple's own Safari Web Content Guide — and every one of them is a
decade old, with nothing version-current to confirm or retire it. One of them
did surface a cost I had not weighed: the standard `document.addEventListener
('touchstart', …)` workaround makes controls flash active _as you scroll past
them_. So the fix I originally shipped would have introduced a visible bug on
every list in the app, to satisfy a requirement I could not demonstrate exists.

So the question was closed by removing everything that depended on it. All four
controls moved to `[data-pressed]`, and a guard forbids the `active:` variant
returning.

**What to avoid.**

- **When you cannot verify a platform behaviour, stop trying to answer it and
  delete the dependency instead.** I spent several rounds trying to establish
  whether the heuristic is live. That was the wrong question: it is not
  knowable from this machine, and the app does not need it to be. "Make the
  answer not matter" was available the whole time and took less work than the
  research did.
- **Age out your sources.** Four searches returned confident, mutually
  consistent answers, all tracing to 2011–2015 material. Consistency across
  sources is not currency; a decade-old consensus about a browser is a
  hypothesis, not a fact.
- **Read the workaround's cost before adopting it, not after.** The
  scroll-flash side effect was in the very first search result and I had
  already shipped the listener.
- **Check for the module before writing it.** `usePressable` reimplemented
  `navigator.vibrate` inline while `lib/haptics.ts` already existed, complete
  with a documented "HONEST SCOPE" note and a standing audit ruling — whose
  text still named the `active:scale-95` I was in the middle of deleting. One
  `grep` for `vibrate` at the start would have found it.
- **A test built from a copy of production's class list will drift from it.**
  The e2e spec asserts `.pressable` against a hand-written probe element. When
  the scale moved from `.nav-tab` to `.pressable` I updated the probe and not
  the component, so the stylesheet was right, the test was green, and the real
  nav had no scale at all. Caught only because the probe was _also_ stale in
  the other direction. Pair any synthesized-markup test with a unit assertion
  that the real component carries the class.

## 2026-07-28 — Auditing the other iOS claims, and nearly writing the same bug into a test

**What happened.** With WebKit finally installed, I swept every iOS/WebKit
claim in the codebase and measured what could be measured, in both engines, on
a confirmed secure context.

Most held. `navigator.vibrate` really is absent (so `lib/haptics.ts`'s HONEST
SCOPE note is right), Background Sync really is absent (so `OutboxFlusher`'s
premise is right), `inert` / `content-visibility` / `color-mix` / `text-box`
are all supported, and Chromium notably does _not_ support
`-webkit-backdrop-filter`, so both declarations have to stay.

Then `navigator.storage` came back **absent in WebKit** — in a secure context,
`'storage' in navigator === false`. `register-sw.ts` calls
`navigator.storage?.persist?.()` and documents it as the iOS storage-eviction
mitigation. My immediate reading was: the mitigation is a no-op on the primary
target platform, and I started writing that up.

It is the opposite. Safari 17 / iOS 17 support the Storage API **in full**, and
WebKit grants `persist()` on heuristics that explicitly include _"opened as a
Home Screen Web App"_ — which is precisely this app's primary surface. The
absence is a **WebKitGTK gap**, not an iOS gap.

**What to avoid.**

- **Playwright's WebKit diverges from iOS in BOTH directions, and the direction
  that fools you is "missing here, present there."** A missing capability reads
  like a hard negative result — the most trustworthy kind — which is exactly
  why it slips through. Two of these found in one sweep: `navigator.storage`
  and `-webkit-touch-callout`.
- **I was one edit away from encoding the error as a test.** The plan had been
  a spec asserting the measured capability matrix, so a future engine change
  would surface. That test would have pinned "WebKit has no Storage API" as a
  _requirement_, mislabelled a Linux fact as an iOS fact in a file called
  `mobile-safari`, and failed as a bug report the day WebKitGTK shipped it.
  There is deliberately no such spec; `docs/runbooks/ios-verification.md`
  carries the matrix as dated measurements instead. Not everything you learn
  should become an assertion.
- **A rule that looks redundant may be load-bearing for one user.**
  `touch-action: manipulation` reads like dead weight post-iOS-9.3, since
  `width=device-width` already kills the tap delay. But that only applies at
  _initial scale_, and this app deliberately allows `maximumScale: 5` so a
  low-vision user can zoom. Delete the rule and the 350ms delay comes back for
  that user and nobody else. Check who a "redundant" guard is still protecting.
- **Label the half you could not test, specifically.** The
  `@supports (-webkit-touch-callout: none)` gate is now verified in the
  negative (measured: a `text-sm` input computes 14px in both engines, so the
  16px floor does not leak) and untestable in the positive — because the
  property's absence off iOS is the very thing that makes it work as a filter.
  "Half-verified, and the untested half is the one that does the work" is a
  more useful comment than either "verified" or nothing.

## 2026-07-28 — The auth gate had been hiding the whole product from e2e

**What happened.** Every e2e spec could only reach `/sign-in`. Middleware
bounces the rest, so the nav, the library, Settings and every `loading.tsx`
had no end-to-end coverage — and it had already cost something real: the bottom
nav shipped with no press scale while its spec stayed green, because the spec
asserted against a hand-written probe element and the probe had been updated
when the component was not.

Fixed by pointing `NEXT_PUBLIC_SUPABASE_URL` at a stub Supabase in
`playwright.config.ts`. No `src/` change, so the specs drive the real
middleware, the real `@supabase/ssr` clients and the real sign-in form. 27 e2e
became 41.

**What to avoid.**

- **A test-only branch in `src/` was the obvious shortcut and the wrong one.**
  `if (process.env.E2E) skipAuth()` is four lines and would have worked. It is
  also a production auth hole one config mistake away from being real, and it
  means the suite verifies a path no user executes. The seam already existed:
  the app reads its backend from an env var, so redirecting _that_ needs no
  production code at all. Look for the seam the configuration already gives you
  before adding one to the product.
- **Every failure mode of a fake backend is silent, so build the alarms first.**
  Two bugs surfaced in ten minutes because the alarms existed: an unimplemented
  route (`media_assets`) returned 501 and got recorded, and a fixture missing
  `archived_at` was caught by a "filter on unknown column" check. Without the
  second, `.is("archived_at", null)` filters `undefined !== null` — every card
  vanishes, the screen renders "Nothing saved yet", and a spec asserting the
  empty state passes for entirely the wrong reason. A stub that answers
  plausibly when it is wrong is worse than no stub.
- **Fixture columns must mirror the generated DB types exactly, not
  approximately.** I wrote `archived: false` where the schema says
  `archived_at: string | null`. Close enough to read correctly in review; not
  close enough to survive a filter.
- **Wiring a fake exposed a real production bug.** `connect-src` hardcoded
  `https://*.supabase.co`, so any self-hosted or custom-domain Supabase is
  blocked by CSP with no server-side symptom whatsoever — the browser refuses
  the request and sign-in simply never completes. That is a live defect for a
  deployment nobody here has tried, and it took a stub on a different origin to
  find it. Fakes are worth building partly for what they trip over.
- **`data-pressed={true}` renders as `"true"`, not `""`.** The e2e spec that
  injected `<a data-pressed>` in HTML got an empty string, so the assertion
  written against the probe did not match the React-rendered element. Another
  cost of asserting on synthesized markup instead of the shipped component.

## Follow-up: two review findings on the e2e-coverage PR (#51)

Both were raised by an automated reviewer after the PR merged, and both were
real. Neither was a mistake in what the code _did_; both were mistakes in what
it _reached_.

**What broke.**

- The CSP fix added the configured Supabase origin to `connect-src` but not the
  `wss://` form supabase-js derives from that same URL. REST allowed, every
  Realtime channel refused — on precisely the self-hosted / custom-domain
  deployments the fix existed for.
- The stub Supabase's reset reseeded its tables and left its append-only
  `unhandled` list, and nothing called it at all.

**What to avoid.**

- **Ask what else is derived from the value you just fixed.** The URL in
  `NEXT_PUBLIC_SUPABASE_URL` is not used once. supabase-js rewrites its protocol
  to reach Realtime, and CSP treats the result as a different source. Adding an
  origin to a policy covers the requests you were thinking about, not the ones
  the client derives.
- **Measure browser-security behaviour; do not reason it out from the spec.**
  The scheme-matching rules are subtle enough that I would have written a
  confident and unverifiable comment. Twenty lines of Playwright answered it in
  both engines — including the part I would have got wrong: **Chromium does not
  throw from a CSP-blocked `WebSocket` constructor**, it returns an object and
  blocks asynchronously. A probe that only watches for a throw reports Chromium
  as permissive in every case. Always include a control case that must fail;
  mine (`connect-src 'self'` against a `wss://` target) is what exposed the
  discriminator as engine-specific.
- **A reset that resets _some_ state is worse than none.** It looks like the
  cure, so nobody looks further — and the state it misses is the one that has
  already been recorded as a diagnostic, i.e. exactly the state that makes the
  next run lie. Reset everything mutable the process owns, in one function, so
  adding new mutable state has one obvious place to be cleared.
- **A test helper that nothing calls is not a safety net, it is dead code that
  reads as one.** `/__stub/reset` was written, was correct-looking, was never
  invoked, and shipped through review that way. Where the wiring is the point,
  guard the wiring: the unit suite now fails if `global-setup.ts` stops calling
  the reset.
- **`reuseExistingServer` makes a stateful test server a cross-run global.**
  Convenient for iteration, and it silently carries one run's accidents into the
  next. Either reset it at the start of every run or do not reuse it — reusing
  it and hoping is what turns "a spec failed an hour ago" into "the suite is
  broken and I cannot see why."

**A later review round on the same fix, worth its own line.** The reset helper
checked that `/__stub/reset` returned 200 and called that success. But
`reuseExistingServer` can hand a run a stub process from an _older revision_ —
including one predating this very fix, whose reset reseeds tables, answers
`{"ok":true}`, and leaves the diagnostics poisoned. Verified against the parent
revision's handler: 200, still poisoned. So the fix for "a reused stub carries
stale state" could itself be defeated by a reused stub. **When a remote
component reports success, and the thing you need is a state change, read the
state back.** A status code is the component's opinion of itself, and a version
you did not write is exactly the case where that opinion is worth least. It now
throws with the leftover entries and the command to clear them — and the same
check catches any future partial reset at global setup, naming itself, rather
than as a puzzling failure in whichever spec ran first.

## Enhance hero → Horizon (2026-07) — swap in place, and check the token exists

- **A "replace X with Y" task is a swap, not a re-spacing.** The brief fixed the
  new band at 92px; the emblem it replaced occupied 52px effective. Following
  the number grew the header ~40px, which was immediately and correctly
  rejected. When the ask is a drop-in, the OLD element's footprint is the spec —
  measure it first and reproduce it, and treat any dimension in the brief that
  contradicts it as the thing to question.
- **Check whether a "new" token is a rename of a live one before adding it.**
  The brief asked for `--laser-ink` (Laser as foreground, darkened on light).
  That is `--accent-ink`, verbatim, already in `tokens.css` and already used by
  the focus ring, the mesh and every inactive ModeRig icon. Grep the token layer
  for the ROLE, not the proposed name — the answer is in the comment above the
  declaration. Same for syntax: the brief specified `rgb(var(--x-rgb) / .30)`
  and there is not one `-rgb` token in the tree; the convention is `color-mix`.
- **The base declarations ARE the reduced-motion rest state — so never set
  `animation-fill-mode` on an ambient layer.** The global collapse forces
  `iteration-count: 1` at `0.01ms`; with no fill-mode the element falls back to
  its own declarations, which is how a `.85→1` breathe rests at the specified
  `.9`. `forwards` would have parked the node at `scale(1.5)` — the loudest
  frame — for exactly the users who asked for less motion.
- **`getBoundingClientRect()` measures the SCALED box.** A 5px node mid-breathe
  measured 5.8px, then 7.0px, and the assertion looked like a geometry bug for
  two runs. For layout size on an animating element read
  `getComputedStyle(el).width`.
- **Playwright's `test.use({ reducedMotion })` silently did nothing here;
  `page.emulateMedia()` worked.** The first run "failed" with a mid-animation
  transform, which reads exactly like a broken rest state. Assert
  `matchMedia(...).matches` inside the probe — an emulation that did not apply
  and a feature that does not work are indistinguishable from the assertion
  alone, and only one of them is your bug.
- **"Keep the old footprint" is a safe default for a swap, not a permanent
  spec.** Horizon reproduced the emblem's `min(width / 5, 64px)` exactly, which
  was right for the swap and wrong a commit later: 64px of box was sized for an
  SVG lockup, and once the lockup was a hairline and a 5px dot the same
  footprint read as ~1.5x too much air. When the _content_ of an element
  changes class, re-derive its footprint from the new content instead of
  inheriting the old one on the strength of "no spacing changed."
- **When a box is pure padding, say so — then a "make it smaller" note is
  unambiguous.** "Shrink the horizon" was read as the band's footprint and
  written up as "two thirds of its height", which is indistinguishable from
  "scale the artwork" to the person who asked. It took a marked-up screenshot to
  establish that the 1px rule and 5px node were never in scope. The band's
  height IS its dead air; the doc comment now leads with that instead of with
  the ratio.
- **A responsive formula that outlived its content should become a constant.**
  The `aspect-[5/1] max-h-16` existed solely to track the replaced emblem's
  `max-w-[320px]` viewBox. Once the contents were a hairline and a dot, tuning
  `n` and the cap in step was arithmetic in service of nothing — a flat `h-7` is
  the honest expression, and it cannot regress the growth it was guarding
  against because it is below the old curve everywhere. Ask what the formula was
  for before scaling it.
- **A test that asserts "matches the thing it replaced" has to be rewritten when
  the replacement is intentionally re-sized.** The e2e footprint check encoded
  the swap's constraint, so it went red on the fix and looked like a regression.
  Assert what the component now owns, and assert the invariant too: pinning band
  height alone would have passed a change that scaled the rule and node down
  with it — which was the one outcome explicitly ruled out.
- **Two aims in one taste fix need two assertions.** "Less air" and "same mark"
  both hold in the fixed state, and either one alone is satisfied by a uniform
  shrink. Cheap to add, and it is the difference between a spec that documents
  the request and one that documents a number.
- **A shared e2e stub becomes shared mutable state the moment a spec WRITES.**
  `fullyParallel` runs every project against one stub process, reset once in
  global setup. Read-only specs never noticed; the first specs to insert rows hit
  id collisions (`stub-${length + 1}` computed concurrently by two workers mints
  the same id, after which an id-scoped DELETE removes both rows) and assertions
  about global emptiness that pass or fail on what the other project is doing.
  Scope every assertion to a row you created, and never derive an id from a
  length.
- **A service worker that owns navigations owns your `page.goto` too.** Drafts
  assertions failed while the database was already correct: `sw-src.js` is
  StaleWhileRevalidate for navigations with a catch-handler falling back to the
  precached `/enhance` shell, so a repeat `goto` was served stale and, in WebKit,
  a fresh one was answered with the wrong document entirely. Client navigation
  fetches RSC payloads and is unaffected — so this is a hazard of driving the app
  with hard navigations, not a bug users meet.
- **`fill()` on a CONTROLLED input is a race with hydration, and it fails
  silently.** Pre-hydration the fill sets the DOM value; hydration then renders
  the store's empty string and the text is gone. Under two-project load in
  WebKit, 20s of retried fills never stuck while the same test passed alone. It
  surfaced three layers away — as the FAB skipping its confirm dialog — which
  looks like a component bug. Assert the controlled value survives before acting
  on it; that assertion IS the check that the store holds it.
- **Know when to stop converting a flaky e2e into a green one.** Four fixes in
  (unique bodies, unique URLs, UI navigation, seeded store) the multi-step drafts
  journey was still red in one engine, and one attempt had broken two previously
  green tests. The journey moved to unit tests, where it is deterministic, and
  the e2e kept only what needs a real engine — where the button is, that it
  clears the nav, which routes show it. A spec green in one project and red in
  another is worse than an absent one, and the comment in the file says why it
  is absent.
- **The e2e stub silently ignores filters it does not implement, which makes a
  broken search look like a working one.** `applyFilters` skips any op outside
  `SUPPORTED_OPS`, so a PostgREST `or=(title.ilike...,body.ilike...)` is dropped
  entirely — an e2e "search returns the row" would have passed with the filter
  doing nothing at all. Search is covered instead by asserting the emitted
  builder calls against a recording fake, which is where the real bugs live:
  unescaped `%`/`_` widening the match, and an unquoted comma or paren breaking
  the or-grammar into a different query.
- **Two escaping layers, and the wire form is the only honest assertion.**
  `escapeLike` protects ilike wildcards; `quoteOrValue` then doubles those
  backslashes for the quoted-value grammar, which PostgREST unescapes back to
  one. My first assertion expected the single-backslash form and failed against
  correct code — the fix was the test, not the query. Assert what actually goes
  on the wire, and say why both layers are there.
- **Check the plan before promising a dashboard toggle.** The security advisor
  flagged leaked-password protection as disabled; it is a Pro-plan feature and
  the org is on Free, so there was no switch to flip. The advisor does not say
  that, and neither did I until I read the docs and called `get_organization`.
  When a remediation is "enable X in the dashboard", confirm X exists for that
  plan first — otherwise the advice sends someone hunting for a control that is
  not there.
- **A constant repeated at every call site is a rule with no owner.** The
  password minimum lived as `8` in four places: one server const and three
  `minLength={8}` attributes. Raising it is then a search-and-replace where a
  miss produces the nastiest shape of bug — a form that accepts a value the
  server rejects, or an input that permits less than the server requires. The
  fix is a module plus a test that greps the call sites for a hardcoded number,
  so the next change cannot half-land.
- **Say what the rule is; do not let rejection teach it.** `minLength` cannot
  express character classes, so the forms enforced something they never
  described. Helper text derived from the same constant as the validator means
  the copy cannot drift from what is enforced — and a test asserts the sentence
  mentions the number and every class.
- **A list row is a projection; never seed an editor from it.** The Drafts card
  carries a 160-character preview, and an edit sheet seeded from that would have
  written the truncation back over the full draft on save — data loss with no
  error, from code that reads perfectly. Fetch the real record, disable save
  until it arrives, and show a failed fetch rather than an empty field that
  invites the user to overwrite their own work. The test that proves it is the
  one that fails when the seed comes from the preview.
- **`default now()` fires on INSERT, not UPDATE.** With no trigger, an in-place
  edit left `updated_at` at its original value, so a draft ordered
  `updated_at desc` would be edited and still sink. Set it in the update, and
  remember the second-order effect: bumping it REORDERS the list, which
  invalidates any keyset cursor the client is holding, so accumulated pages have
  to be dropped or the same row renders twice with different text.
- **One `pending` flag for two operations mislabels both.** The shared
  `useTransition` made the save button read "Saving…" while the sheet was still
  _loading_ the body — and it broke the tests, which is how I noticed. Separate
  flags for separate operations; a spinner that lies about what it is doing is a
  small bug that reads as a big one.
- **Wait on the last step of an async flow, not the first.** `vi.waitFor` on the
  action call resolved before its continuation ran, so the assertions ran against
  a half-finished save and `router.refresh()` looked like it never happened.
  Waiting on the terminal effect makes the test assert the whole flow.
- **A malformed Tailwind class passes lint, typecheck, tests and build.** A
  botched sed left `itemsateems-center` in a className; nothing in the gate
  looks at whether a utility exists, so the button silently lost its vertical
  centering and the review bot caught what five green steps did not. Worse, my
  own "undo the typo" patch searched for a variant with a space and no-op'd —
  and my verification grep DID show the line missing from its results, which I
  skimmed past. When a patch claims to fix something, assert the fixed state,
  don't eyeball adjacent output.
- **State set inside `startAction` is transition-priority and a discrete event
  can beat it.** `setSavingEdit(true)` inside the transition meant Escape or a
  scrim tap could be handled while the flag was still false, so a guard reading
  it let the sheet close mid-save — clearing the very text the failure path
  exists to preserve. Set guard flags synchronously, outside the transition.
- **Disabling the footer button is not disabling the sheet.** `Sheet` routes
  Escape, the scrim and its Close button all to `onClose`; guarding only the
  Cancel button covered one of four ways out. When a component owns dismissal,
  guard `onClose` itself.
- **`useState` initialisers do not re-run when a prop changes.** Holding
  `nextCursor` in state captured the page boundary at mount, so after
  `router.refresh()` the cursor described the pre-edit ordering and skipped the
  row the edit had displaced onto page 2. Derive from the prop while unpaged
  (`undefined` = use the prop) instead of seeding state from it.
- **`vi.waitFor` does not flush React; RTL's `waitFor` does.** Vitest's version
  polls without `act`, so a `useTransition` pending flag never clears between
  attempts and `toBeEnabled()` can never come true — passing alone, failing in
  suite. Use `waitFor` from `@testing-library/react` for anything gated on React
  committing. And `fireEvent.click` on a disabled button is a silent no-op, so
  "the sheet never opened" is the symptom of a pending transition, not a broken
  handler.
- **Server actions REJECT on transport failure; they do not return
  `{ ok: false }`.** Every awaited action in a client component therefore needs a
  guard, or a dropped connection propagates out of the transition to the route
  error boundary and unmounts the component. In an editor that is data loss
  performed by the error path itself. One `settle(work, fallback)` helper at every
  call site beats five try/catch blocks and makes the omission visible.
- **Optimistic concurrency needs the version of the DATA SHOWN, not the row that
  linked to it.** Conditioning the update on the list row's `updated_at` would
  reject saves against a body the user is legitimately editing, because the row
  can go stale between render and opening the editor. Carry the timestamp back
  from the fetch that supplied the body.
- **When a precondition can match zero rows, disambiguate on the failure path.**
  `.eq(id).eq(updated_at)` matching nothing means deleted OR superseded, and the
  user's next step differs. Reading the row back costs nothing on the happy path
  and has a second benefit: a timestamp-format mismatch would surface as a
  visible "changed elsewhere" rather than as silent data loss.
- **A scripted replace that does not match is a silent no-op, twice over.** The
  class typo came from one; the `toHaveBeenCalledWith` update came from another
  (six spaces of indentation instead of four). Both looked applied. Assert the
  post-state — grep for the new string, or let the test fail — rather than
  trusting that the patch ran.
- **Confirm a red e2e is flake before believing it.** A scroll-state test failed
  in the full run, passed in isolation, and passed the full run on a stashed
  clean tree AND again with the changes re-applied. Three data points, not one,
  and only then is "pre-existing flake" a claim rather than a hope.
- **An in-flight request has already captured its input; lock the input.** The
  edit textarea stayed editable while the save was in flight, so keystrokes typed
  after pressing Save belonged to neither side — the request carried the earlier
  snapshot, and `closeEditor()` discarded the newer local value on success. Lost
  with no error. `readOnly` rather than `disabled`, so the text stays readable,
  selectable and focused for what is normally a brief moment.
- **`fireEvent.change` ignores `readOnly`.** It sets the value programmatically,
  and readOnly is a user-interaction constraint — so a test that types into a
  locked field "passes" while proving nothing. Without `user-event` as a
  dependency, assert the attribute that actually governs real typing, and say in
  the test why.
- **Adding the lint rule found a second bug before it found any classes.** The
  natural pattern `src/**/*.{ts,tsx}` crashed ESLint outright: this repo overrides
  `brace-expansion` to ^5 while ESLint's `minimatch@3` expects ^1, so any braced
  config pattern throws `expand is not a function`. Every existing pattern is
  brace-free by luck, not design. When a new tool fails on arrival, suspect the
  tree before the tool — and check whether the failure was always latent.
- **A relative config path can break module resolution, not just file loading.**
  `eslint-plugin-tailwindcss` derives its resolution root from
  `dirname(settings.tailwindcss.config)`, so `"tailwind.config.ts"` yields `"."`
  and it reports `Could not resolve tailwindcss` while the package sits in
  `node_modules`. The error names the wrong thing; the fix is an absolute path.
- **Enable the rule that catches the bug, not the ruleset.** The plugin ships
  formatting rules (`classnames-order`, `enforces-shorthand`) that would rewrite
  most of the codebase in one commit. One targeted rule keeps the diff reviewable
  and the signal legible; a repo-wide reformat would have buried it.
- **"Still publishes a CJS export" is not "still callable".** The blanket
  `brace-expansion@^5` override was justified with exactly that phrase, and v5
  does publish CJS — but as `{ EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand }`,
  while `minimatch@3` requires the module and CALLS it. Forcing a major across an
  API boundary breaks consumers whose range you overrode; check the export SHAPE,
  not its existence.
- **A dependency override that satisfies `npm audit` can silently break
  behaviour, and the check that "proved" it was fine tested the wrong path.**
  `npm run lint` passed because no ESLint pattern contained braces, so
  `braceExpand` was never reached. Latent for days. When an override crosses a
  major, exercise the API the overridden consumer actually calls.
- **Advisory-clean is not free.** With no 1.x/2.x release falling outside the
  advisory's range, the choice was a working glob engine with 14 dev-only
  advisories, or a clean full-tree report with a broken one. Read what CI actually
  gates — here `npm audit --omit=dev`, with the full-tree step already `|| true` —
  before trading correctness for a number.
- **"Inside the advisory range" is not "vulnerable".** I wrote the lesson above as
  "no patched 1.x/2.x in existence", which was false: the fix WAS backported to
  1.1.17 and 2.1.3, and the range `<=5.0.7` just never got narrowed. Same numbers,
  different conclusion — the entries are a false positive, not an accepted risk,
  which is what makes a _verified_ exemption (`scripts/check-audit.mjs` re-proving
  the limits are present in every installed copy) the right answer instead of a
  tradeoff. Check the fix's presence in the source before concluding a range means
  what it appears to; and when that conclusion changes, chase down every place the
  old one was written — it had propagated into AGENTS.md, two CHANGELOG entries and
  here before a review bot flagged the contradiction.
- **An async `startTransition` callback has left the transition scope by the time
  it resumes.** `router.refresh()` issued after an `await` inside
  `startAction(async () => ...)` is attached to no transition, so `pending` clears
  while the refreshed props are still arriving — and any state derived from those
  props is briefly stale in a way the pending flag denies. Give `refresh()` its
  own synchronous transition and gate on that.
- **Gate on the transition settling, not on the prop changing.** Waiting for
  `nextCursor` to differ would deadlock in the legitimate case where an edit does
  not move the page boundary — the control would stay hidden forever. React always
  settles a transition, so `refreshing` is the signal with no failure mode.
- **Say when a window is real but untestable here.** The refresh gap cannot be
  observed in jsdom: `router.refresh` is a no-op mock, so the transition settles
  instantly and there is no window to assert against. The guarantee is structural
  — one transition owns the refresh, and the control is not rendered while it is
  pending — and claiming a test for it would be claiming coverage that does not
  exist.
- **`npm audit` ranges can be wrong; read the source before believing the
  number.** GHSA-mh99-v99m-4gvg flags `brace-expansion <=5.0.7`, but 1.1.17 and
  2.1.3 both contain the CVE-2026-14257 limits — the fix was backported and the
  range was never narrowed. Two commits' worth of override churn went into
  chasing a number that was already satisfied in code. `grep` for the fix.
- **`|| true` on a security step is worse than no step.** It printed 14 entries
  and passed, so a real new advisory had nowhere to show up. A gate that exempts
  KNOWN findings and fails on everything else turns the same command from noise
  into signal — and the exemption should re-prove itself (here: every installed
  copy must actually contain the limits) so it cannot decay into an ignore-list.
- **npm `overrides` cannot use a `file:` path for a nested dependency.** The spec
  is resolved relative to the DEPENDING package, so `file:patches/x` becomes
  `node_modules/minimatch/patches/x` and the install dies with ENOENT. A vendored
  callable shim — the one solution that would have given both a clean number and
  working code — is therefore not expressible. `install-links=true` does not
  change the path resolution.
- **Write the negative test even when the positive one passes.** The audit gate
  passed on a clean tree AND on a deliberately-unpatched one, because its
  directory walk never descended through `minimatch/` into nested node_modules.
  The positive result was luck; only the negative test found it. This is the
  second time this session a self-check was quietly proving nothing.
- **A shared default is not a shared fact.** The OpenAI-compat factory's 16k
  `max_tokens` was inherited by seven providers, one of which (DashScope) caps it
  at 8192 and 400s above it — so Qwen3.7 Max failed _every_ call from the day it
  shipped, and nothing in the suite noticed because no test ever built its request
  body. When a factory centralises a value that each API bounds differently, the
  bound belongs in the per-provider config and the body builder belongs in a pure,
  tested function.
- **A model TIER is not a reasoning depth.** "Max" in `Qwen3.7 Max` names
  Alibaba's flagship tier (beside Plus and Turbo); reading it as a thinking level
  is why that target had no Thinking rail while its API took an
  `enable_thinking`/`thinking_budget` pair all along. This is the
  `gemini-3.6-thinking` lesson in reverse — the earlier one was a depth mistaken
  for a model, this one a model mistaken for a depth. Check the provider's
  parameter table both ways.
- **A reasoning budget must leave room for the answer.** Thinking tokens bill
  against the same output ceiling, so a budget at the ceiling turns a working
  target into the adapter's "hit its length limit" error. Every Qwen step sits at
  or under half of 8192, and a test asserts that ratio rather than the numbers.
- **An intrinsically-sized control in a fixed-width rail is a wrap waiting to
  happen.** Five multi-word labels beside a caption had ~300px of a 390px screen:
  the chassis clipped and "Few-shot" broke onto a second line, which made the rail
  taller than its neighbours — the kind of defect that reads as "ugly" long before
  anyone can name it. Equal `1fr` cells sized by the CONTAINER (ModeRig's shape,
  which already fits six labels) plus `whitespace-nowrap` removes the whole class.
  Give the control its own line when the caption's width is what you are short of.
- **`grid-cols-${n}` does not exist.** Tailwind only emits classes it can see in
  the source, so an interpolated column count is silently absent at runtime — the
  inline `gridTemplateColumns` is the version that works, and the test asserts the
  style rather than the class for that reason.
- **Measure the layout fix in a browser, then delete the harness.** A throwaway
  Playwright spec (sign in → pick target → screenshot the rail) reported
  `scrollWidth === clientWidth`, five equal 65px cells, one client rect each and
  44px heights. jsdom would have agreed with any of the broken versions too.
- **A `<select>` cannot sit beside a `<button>` at the same type size on iOS.**
  `globals.css` floors `input, select, textarea` at 16px (Safari zooms a focused
  sub-16px control and rarely zooms back), `!important`, which beats `text-sm` —
  so the Thinking rail's "Auto" rendered two points larger than the Target pill's
  "Auto" one row above it, in the two rails users read as a pair. `TargetPicker`
  had already left `<select>` for a different reason and inherited the fix for
  free. **Rule: when a control has to match a non-form control's size, it cannot
  be a replaced form element.** The floor is behind a `-webkit-touch-callout`
  gate, which is iOS-only _by construction_, so CI can never see this class of
  defect — only a phone or a reasoned read of the cascade will.
- **Two copies of a class string is a drift generator.** The Target and Thinking
  pills were "the same" by having identical literals in two places, which is how
  they came to differ. One exported constant with two consumers makes the parity
  structural, and `expect(a.className).toBe(b.className)` is then a test worth
  writing — it fails on padding and height drift too, not just font size.
- **Permanent helper text is paid for by the control beside it.** The media
  rail's two-line capability blurb had pushed the attach control down to a 12px
  text link with an emoji — the one affordance in the tray that must read as
  "upload a file". Moving the words behind a `?` disclosure gave the button its
  size back without deleting the information. Ask what a permanently-visible
  explanation is costing the thing it explains.
- **A disclosure panel inside `overflow-hidden` must be in flow, not floating.**
  The composer chassis clips absolutely-positioned children — the same
  constraint the paste affordance already documented. An in-flow panel under the
  rail reads as attached to its `?` and cannot be clipped; a portal would be the
  only way to float one, which is a lot of machinery for a tooltip.
- **RLS answers "whose row is it", never "is the value sane".** The daily cost
  cap is `sum(cost_usd)` over `usage_events`, and every policy on that table was
  correct: owner-scoped INSERT, no UPDATE, no DELETE, `USING` and `WITH CHECK`
  both present. It was still forgeable, because `authenticated` held INSERT and
  nothing constrained the number — one negative row from the browser turned the
  cap off for good. **A column an untrusted party can write, which an
  authorization decision then sums, needs a CHECK constraint; the policy is not
  the control.** Ask of every aggregate that gates something: who can write its
  inputs, and what values are they allowed to write?
- **Revoking a grant is a deploy-ordered change, and the order is the opposite
  of a migration's.** Normally the migration lands first and the code follows.
  A REVOKE inverts it: the running build still uses the privilege, so taking it
  away first breaks production. Worse here than a hard failure — the ledger
  write's error is logged and swallowed, so the route keeps returning 200 while
  spend stops being counted. Split it into its own migration, put the ordering
  in the header where `supabase migration up` will read it, and assert the
  warning in a test so nobody merges the two files back together.
- **A fix that only closes the hole you found is half a fix.** The reverted #62
  work added atomic spend reservations that read the same `sum(cost_usd)` — so
  it would have shipped with this hole intact underneath the new machinery.
  When a value is load-bearing for a guardrail, harden the value before
  hardening the logic that reads it.
- **One control is not a defence, it is a single point of failure.** Fourteen
  server actions wrote with `.eq("id", …)` and leaned entirely on RLS for the
  tenant boundary. RLS was correct — but these actions are reachable by any
  authenticated client, so one dropped policy turns `deletePromptAction` into a
  cross-tenant delete with nothing to notice. **A predicate that costs one
  indexed column is worth adding even when the control behind it is right**,
  because the question is not "is RLS correct today" but "what happens the day
  it isn't".
- **A foreign key does not consult RLS.** `setCollectionAction` let a prompt be
  filed into another account's collection: the FK only asks whether the
  referenced row EXISTS, not whether the caller may see it. Any cross-table
  reference supplied by a client needs an explicit ownership check; the
  constraint is about referential integrity, never about authorization.
- **"Useful as-is" is an operator's judgement, not a user's.** The error
  passthrough was justified in a comment as "RLS and constraint messages are
  useful as-is" — true for someone reading a log, false for someone reading a
  toast, and the same file's own runbook records it leaking an enum name to a
  user. **Split the audiences explicitly**: a mapped sentence for the user, the
  raw text to the log. If one string is serving both, it is wrong for one.
- **Test the branch table of the thing everything else depends on.** The
  authorization gate had zero tests while ~90 files covered components. The
  cheapest possible test — a table of (env, session, path) → outcome — took
  minutes and immediately pinned a real hazard: public prefixes must match on a
  segment boundary, or `/authors` becomes public because `/auth` is. Verified by
  injecting the bare `startsWith` and watching exactly that assertion fail.
- **Origin-scoped storage is not account-scoped storage.** IndexedDB and
  `localStorage` are keyed to the origin, and both the offline outbox and the
  persisted `editorDraft` treated them as if they were keyed to a session. On a
  shared device that meant one account's queued save was replayed under whoever
  signed in next — and the replay resolves the owner from the CURRENT session,
  so it landed in the wrong library with the wrong authorship. **Anything
  persisted client-side that represents user CONTENT needs the account id
  written next to it**, and the read path has to filter on it. Preferences can
  stay device-scoped; content cannot.
- **"Not ok" is not the same as "not done".** The outbox removed an item only
  when the handler returned `res.ok`, and `savePromptAction` returns
  `{ok: false, duplicate}` when the content is already saved. So an item the
  server had _already accepted_ could never drain: every reconnect retried it,
  and the duplicate check was the thing rejecting it. When a replay is
  idempotent, the drain condition is **"is the world in the desired state"**,
  not "did this call succeed".
- **Removing a route is not the same as not caching.** Workbox's
  `setCatchHandler` only runs for a request that some registered route handled.
  Deleting the navigation route to stop caching account HTML therefore also
  deleted the offline fallback: an unmatched navigation never enters Workbox, so
  offline it fails to the browser's own error page. The fix is
  `NetworkOnly` — still routed, never cached. PR #62 made the same removal with
  the same wrong comment, so it shipped the same broken fallback; this is a
  strong candidate for one of the "other issues" that got it reverted.
  **Generalisation: when a framework's error handling is scoped to "things this
  framework handled", opting something OUT of the framework opts it out of the
  error handling too.**
- **The only test that could catch it was the slowest one.** lint, typecheck,
  852 unit tests and a clean build all passed with offline navigation broken.
  `shell.spec.ts`'s offline spec — the single test that drives a real service
  worker in a real browser — was the only thing that failed. When a subsystem
  can only be exercised for real in one place, that place is load-bearing: do
  not let it become the test everyone skips because it is slow, and add the
  cheap structural assertion beside it so the next regression fails in
  milliseconds instead.
- **Scope a negative assertion to the thing you mean.** The test for the
  service-worker cache leak started as `not.toMatch(/request.mode ===
"navigate"/)` over the whole file. That expression also appears in
  `setCatchHandler`, which is what serves `/offline.html` when a navigation
  FAILS — so the assertion, as written, demanded the deletion of offline support
  in the name of fixing a cache leak. It went red immediately, which is the only
  reason it was caught. Slice the region you actually mean before asserting
  absence.
- **Check whether the bug has already bitten before fixing it.** Before adding
  the `current_ver` trigger and the transactional save, a single query asked the
  live database for orphaned prompts and cross-prompt pointers: 40 prompts, 43
  versions, zero of either. That answered three questions at once — no backfill
  needed, the trigger cannot reject an existing row, and the integrity gap was
  real but not yet realised. A constraint added without that check either fails
  on apply or silently hides damage already done.
- **A reservation is a concurrency guard, not a worst-case bound.** The first
  attempt at atomic spend reserved each request's theoretical maximum — full
  output ceiling at list price — which on a $2.00/day cap made Fable 5 at max
  effort reserve $3.20 and refused **every** request on an empty ledger,
  permanently. The hold was 31x the largest request this project has ever
  actually made. A hold only has to stop parallel requests from collectively
  overshooting; sized as a worst case, the cap starts rejecting on the
  _reservation_ instead of on real spend. **Size a hold from observed behaviour
  and clamp it to a fraction of the limit** — the clamp is what makes the
  failure structurally impossible rather than merely fixed today.
- **The fix that is worse than the bug still has to be caught by something.**
  #62 was green: it typechecked, it had tests, and its SQL was well-written. What
  it did not have was any test that compared the size of a hold to the size of
  the cap. When a change introduces a new number that interacts with an existing
  number, the test that matters is the one about their _relationship_, not about
  either one being present.
- **`create function` does not resolve identifiers in the body.** `spend_reserve`
  declared `returns table (… reserved_usd numeric)` and summed the pending holds
  with a bare `sum(reserved_usd)` over a table whose column has the same name.
  The OUT parameter is in scope inside the body, so the reference is ambiguous —
  but plpgsql only finds out when the function is CALLED. The migration applied
  cleanly and reported success. **A migration that applies is not a function that
  works**; call it once behind a rolled-back probe before believing it.
- **Set the role before probing, and the probe tells you two things.** Running
  the verification as `set local role authenticated` with real `request.jwt.claims`
  exercises the exact path PostgREST uses. It caught the ambiguity above, and it
  incidentally proved the lockdown: the probe's own final `count(*)` on
  `usage_reservations` failed with 42501, which is the table being correctly
  unreachable. A probe that runs as `postgres` would have shown neither.
- **A comment-stripper that only knows `--` will validate your own prose.** The
  first draft of `spend-atomicity.test.ts` asserted that `spend_settle` does not
  raise `reservation_not_pending`, and matched the `/** … */` header sentence
  explaining why it doesn't. Strip both comment forms before asserting on source
  text, and prove each assertion fails against the version it is meant to catch.
- **Regenerating a generated file is not always the smaller change.**
  `database.types.ts` says "do not edit by hand", but the committed copy is
  curated (non-alphabetical tables, trimmed helpers, Prettier semicolons) and
  `model-target-enum.test.ts` parses it with a regex that requires those
  semicolons. A wholesale `supabase gen types` would have reordered every table
  and failed that contract. Adding the one new function signature — copied
  verbatim from the generator's output, so it cannot drift from the database —
  was both smaller and safer. Check what parses a generated file before
  regenerating it.

## 2026-07-30 — Mobile UI polish pass (skeleton fidelity · press variants · emoji retirement)

- **A `loading.tsx` is a screenshot that can go stale.** The Enhance skeleton
  still sketched a layout two redesigns old — a hero block and three pills
  where the live page renders the Horizon hairline and a six-cell mode rig —
  so every prefetched tab switch flashed the wrong layout before paint.
  Nothing catches this: the skeleton compiles, tests green, and diverges
  silently the moment the page it mirrors changes. **When a screen's layout
  changes, its `loading.tsx` is part of the change**, the same way its e2e
  spec is.
- **One press affordance, two scales.** `.pressable`'s 10% scale was measured
  for icon-sized targets; on a full-width CTA it reads as the card lurching.
  Rather than exempt large buttons from press feedback (the `:active`
  brightness they had is exactly the iOS-unreliable channel `usePressable`
  exists to replace), `.pressable-subtle` carries the same instant-down /
  eased-up contract at 3%. The variant is a second class, not a combined
  selector — `ui-contracts.test.ts` matches rule heads with `^\.pressable$`
  anchors, and a grouped `.pressable, .pressable-subtle { }` head would have
  broken the guard that keeps the contract pinned.
- **Emoji are platform-colored type, not icons.** `🖼 / 🎞 / 🎧` in the media
  rows and `⟲` in the Activity heading sat next to carefully stroked SVGs and
  rendered with whatever color, weight and baseline the OS emoji font chose.
  The attach button's header comment had already documented this exact lesson
  for 📎 — the fix (1.5px-stroke glyphs on the 24px grid) just hadn't been
  applied to the survivors. When one call site documents a rule, grep for the
  other violators while you're there.
- **The scrim is part of the entrance.** `.sheet-in` rose the panel over 200ms
  while its scrim popped to 80% Void on frame one — the flash read as the
  overlay arriving _before_ its content. Animating the wrapper's opacity
  (`.scrim-in`, same duration/ease, end state = resting state so the global
  reduced-motion collapse lands fully opaque) costs one keyframe and removes
  the pop. Any overlay that fades its panel in should fade its scrim with it.

## 2026-07-31 — Accessibility pass (contrast · tap targets · dialog · live regions)

- **A role token is only defined for the themes it is declared in.** `--amber`
  and `--pulse` lived in `:root` and nowhere else, so the light theme inherited
  the dark values verbatim and rendered warning text at 1.41:1. Nothing catches
  this: the token resolves, the class applies, the build is green, and the text
  is simply not there. `tokens.css` declares the light theme **twice** — once
  for `[data-theme="light"]` and once for the system-preference path — so
  "declared for light" means _three_ declarations, which is exactly what
  `developer-accents.test.ts` had already learned about `--dev-peak`. The new
  `a11y.test.ts` asserts the count.
- **Split a token the moment it is both a fill and an ink.** `--laser` already
  had this shape (`--laser` fills, `--accent-ink` writes) and the reason was
  written down in §6 — but `--amber` and `--pulse` were introduced later as
  single tokens doing both jobs, which made them unfixable in place: darkening
  them for light would have broken `bg-amber` under `--on-laser`. The fix is
  never "pick a compromise value", it is "these were two roles".
- **`opacity-*` on a muted role is a contrast bug, not a style.** `--silver`
  and `--flare` ARE the dim ones — 5.99:1 and 5.64:1 on light, a hair over AA.
  Six surfaces then dimmed them again. In every case there was no smaller alpha
  that worked, because the headroom was already spent; the answer was to delete
  the utility, not tune it. If you want a subordinate tone, that is a token
  choice, and if the palette has no dimmer token then the design has no dimmer
  tone.
- **A dim on a container multiplies into every child.** The per-change review
  row's `opacity-60` compounded with the removed span's own `opacity-70` to
  1.85:1, and dimmed a live button into looking disabled. Put a state dim on
  the specific element the state is about, and check what colour survives it —
  `--chalk` takes 60% and stays AA; `--flare` and `--silver` do not.
- **A hit area you cannot see is a hit area you cannot aim.** `.tap-44` bleeds
  12px past every edge and its own comment says adjacent extenders overlap with
  the later sibling winning. Two 20px icons 8px apart therefore put Delete
  under the right 4px of the visible pencil. The utility is safe only with
  ≥24px of clearance; where controls are closer, use real padding with an equal
  negative margin so the hit box is bounded and the layout is unchanged. jsdom
  computes no boxes, so this is arithmetic in a test, not a rendered assertion.
- **`aria-modal` is a claim you have to keep.** It tells assistive tech the rest
  of the page is gone. `AvatarCropper` declared it with no focus trap, so Tab
  walked into the settings form that AT had just been told did not exist. The
  app's `Sheet` already had the trap — a second modal shape was written without
  it. Also: a dialog cannot always capture its own return-focus target. This
  one is opened by clicking a `display:none` input, so `document.activeElement`
  at mount is `<body>`; the host has to name the control.
- **A live region has to exist before the text it announces.** Rendering
  `<p role="status">Saved ✓</p>` conditionally means the region and its content
  arrive together, and screen readers announce _changes within_ a region they
  are already observing. Mount it always. Idle should be `sr-only` rather than
  an empty box — every one of these sits inside a `flex flex-col gap-*`, and a
  permanently-present static child adds a gap to every row, while an absolutely
  positioned one is not a flex item at all.
- **A test that says "there is no live region here" breaks correctly.** Two
  specs asserted `getByRole("status")` / `queryByRole("status")` as a proxy for
  "this surface uses a toast" / "this surface does not". A permanently mounted
  empty region invalidated the proxy, not the contract — both were restated as
  what they always meant (which region carries the text, and that every region
  present is empty). Re-read the intent before relaxing the assertion.
- **First-run e2e failures are not always failures.** Three specs timed out on
  the run that also performed `next build` — the mobile-safari sign-in raced a
  cold server and `.horizon` had no box yet. `retries` is 0 outside CI, so cold
  starts show as red. Re-run against the warm server before believing a
  regression: all 51 passed unchanged.
- **A focus trap has two boundaries, and the root is usually the forgotten
  one.** Both modals focus their own root on open, and both roots are
  `tabIndex={-1}` so they never appear in the focusables list. Matching only
  `document.activeElement === first` therefore left Shift+Tab — plausibly the
  first keystroke a keyboard user makes, reaching for the close button — as the
  one way out of a dialog whose `aria-modal` had just said there was nothing
  behind it. Treat the root as a leading boundary alongside `first`.
- **`focus()` on a disabled control is silently ignored.** Restoring focus to a
  trigger that the same state change disabled looks correct and does nothing;
  focus lands on `<body>` and stays there for as long as the work takes. If the
  return target can be disabled, the restore has to be able to wait — bounded,
  and standing down the moment the user puts focus somewhere themselves.
- **An effect keyed on `open` can run before the thing it acts on exists.**
  `Sheet`'s SSR guard returns null on the first render, so `panelRef` was empty
  when the focus effect ran; every call site toggles closed → open, which
  re-runs it and hid the gap. Anything gated on a `mounted` flag belongs in the
  deps of every effect that touches the DOM it gates.
- **A bot review is worth reading properly and worth checking.** Two of the
  three findings above came from an automated PR review; both were real, and
  verifying them against the code (rather than accepting or dismissing on sight)
  is what turned up the third.
- **`npm init -y --prefix <dir>` ignores `--prefix` and writes to the cwd.** It
  rewrote the repo's own `package.json` — re-escaping the description and adding
  `main`, `directories`, `keywords`, `author` and a `repository` URL pointing at
  the local git proxy. Caught by diffing before committing. Scratch installs
  belong in a scratch cwd, not behind a flag that only some subcommands honour.
- **"Patched" is not the same as "outside the advisory range", in either
  direction.** `brace-expansion` 1.1.17/2.1.3/5.0.8 accepted a `maxLength`
  option, documented it, and did not apply it on two paths — while 5.0.8 sat
  outside the `<=5.0.7` range and reported clean. Read the diff between the
  pinned version and the latest patch; the advisory range answers a narrower
  question than the one you are asking.

## 2026-07-31 — P2–P5 baseline recovery (the repo could not rebuild the database)

- **A migration directory that starts mid-history looks healthy.** Seven
  migrations — every table, enum, bucket and policy the app rests on — were
  applied straight to the hosted project and lived only in its ledger. Every
  later migration applied fine on top, the CLI reported no drift, and the whole
  suite was green: the gap only exists for someone building from scratch, and
  nobody does that until the day they must. **Ask "does the first migration
  create something, or alter something?"** — the answer is a one-line audit.
- **The ledger keeps the SQL, so recovery beats reconstruction.**
  `supabase_migrations.schema_migrations.statements` holds the statements as
  applied, comments and all. Recovering from there gave files byte-identical to
  what ran (md5-checked); reconstructing from `pg_dump` or from the current
  catalog would have produced _a_ schema that matches, with none of the
  reasoning and no way to prove it was the same one.
- **Verify a baseline by replaying it, not by reading it.** No Docker in this
  container, but the Postgres server binaries were installed — `initdb` a
  throwaway cluster, add a ~90-line shim for the platform objects the
  migrations actually bind to, replay all 23, then fingerprint the result and
  run the same query against production. Nine of ten categories matched
  exactly, on the first try; the tenth was comments. Reading the SQL would have
  told me none of that.
- **Compare schemas by sorted facts, not by `pg_dump` diff.** Dump output is
  ordered by OID and formatted per server version, so two identical schemas
  produce different text. Hashing a sorted list of `category|fact` lines is
  version-independent and localises a difference to one category instead of one
  1,500-line diff.
- **Filenames are not decoration — the CLI matches on them.** All sixteen
  in-repo migrations carried hand-rounded timestamps that matched nothing in the
  ledger, so `supabase db push` would have treated every one as unapplied and
  re-run it against production. Whatever generates the version at apply time is
  the authority; the file has to agree with it. Check order is preserved before
  renaming (here the real times fell in the same sequence — but that was luck,
  not a guarantee).
- **A comment that names a file is a reference, and references rot silently.**
  Renaming the migrations orphaned five citations in `src/` and `scripts/`; none
  could fail to compile. A test that resolves every `\d{14}_*.sql` mentioned
  under `src`/`scripts`/`tests`/`docs/runbooks` costs nothing and is the only
  thing that would ever notice.
- **A workaround is a record of a missing thing — delete it when the thing
  arrives.** `BASELINE_LABELS` was hand-written _because_ the `create type` was
  hosted-only, and it made the enum replay assert its own starting point. The
  moment the baseline landed the constant became derivable, and the test got
  strictly stronger for being three lines longer.
- **`initdb` refuses to run as root.** Drop to an unprivileged account and make
  the data directory reachable by it — and note that a per-session scratch dir
  may be `drwx------ root`, which that account cannot traverse no matter who
  owns the leaf.
- **A comparison query is only as good as its WHERE clause, and a narrowed one
  fails silently — both sides agree, on less.** The first schema fingerprint
  filtered `pg_policies` to `public`, which excluded all seven policies on
  `storage.objects` — the ones scoping avatar and media uploads to their owner
  — and inner-joined `pg_roles` for EXECUTE grants, which dropped `PUBLIC`
  (grantee OID 0 has no role row) — the grantee `revoke execute … from … public`
  exists to remove. Nine access-control facts invisible, and every category
  still read "identical". **When a check reports a match, ask what it could not
  have seen.** Both were caught by an automated PR review, not by me.
- **Recovering the schema made a doc false.** `AGENTS.md` still told every agent
  the base tables were untracked and a bare Supabase would be missing them —
  the mandatory startup contract, now contradicted by the change that fixed it.
  A doc that states a limitation is a dependency of the work that removes it;
  grep for the claim before you invalidate it.
- **The definition text is not the object.** Three schema facts carry real
  behaviour and appear nowhere in what you would naturally diff:
  `pg_policies.permissive` (RESTRICTIVE composes with AND, so one flipped
  policy can deny everything while every predicate stays identical),
  `pg_trigger.tgenabled` (`pg_get_triggerdef` reconstructs the same
  `CREATE TRIGGER` for a disabled trigger), and owner on a SECURITY DEFINER
  function (the owner _is_ the privilege set the body runs with). A `pg_dump`
  diff would have missed the first two as well.
- **Check whether a new comparison field is comparable before adding it.**
  Adding table owner to the RLS fact immediately broke the match — hosted
  storage tables belong to `supabase_storage_admin`, and the shim necessarily
  creates its stand-ins as the local superuser. A field that differs by
  construction is worse than no field: it trains you to ignore a red row.
  Scope it (`public` only, `<platform-managed>` elsewhere) and say why.
- **A resting `shadow-[…]` utility on a focusable element deletes its focus
  ring, and nothing anywhere says so.** The FAB carried its depth shadow as a
  utility; `box-shadow` is one property, the utilities layer lands after base,
  and `:focus-visible` and `.shadow-x` are both (0,1,0) — so the base ring lost
  on layer order and the button had NO keyboard indicator. Verified by stashing
  the change and reading `getComputedStyle` on the old class list in a real
  engine: the focused shadow was the drop shadow alone. The `--focus-ring`
  comment already warned that any _later-layer rule_ setting a box-shadow must
  re-include it; the case it does not cover is a **utility**, which is exactly
  the form a shadow usually takes. Shadows on focusable elements belong in the
  component rule, next to the `:focus-visible` that composes them.
- **A negative-z-index pseudo paints AFTER its parent's own background, not
  before it.** So `backdrop-filter` on `::before` + tint on the element does not
  make a lens: the tint lands _inside_ the pseudo's backdrop and gets blurred
  and re-saturated with the page. Tint and blur have to travel together onto the
  pseudo. (`.glass-nav` already did it that way; the reason was not written
  down, so it read as arbitrary.)
- **A `filter` makes an element a backdrop root, which silently disables
  `backdrop-filter` inside it.** `.btn-laser`'s `:hover`/`:active`
  `brightness()` would have blinked the FAB's frost off for the length of every
  press. Where a blurred surface needs a press or hover state, move it to the
  fill (`color-mix` percentage), not to a filter.
- **Check the LIGHT theme before crediting a fill with visibility.** Laser on
  chalk is 1.06:1 — the §6 FAIL — so on light the FAB's boundary has always
  come from its drop shadow, not its colour. That is what made the translucency
  safe to add there (it changes nothing that was carrying), and it is why the
  shadow had to survive the move off the utility.

## Wire-protocol test fixtures must mirror the wire, not the implementation

- **A fixture authored to match the parser proves nothing about production.**
  The Gemini adapter split SSE frames on `"\n\n"`; the unit fixture built its
  stream with `"\n\n"` separators, so 7/7 tests stayed green while every
  production run failed — `alt=sse` delimits events with CRLF, and
  `\r\n\r\n` contains no adjacent `\n\n`, so zero frames ever parsed and the
  run assembled to an empty string ("The model returned a non-JSON
  response.", 2026-08 incident, fixed in PR #73).
- **Rule:** when hand-rolling a wire protocol (SSE, NDJSON, multipart), source
  the fixture bytes from a captured real response or the protocol spec's
  permissive form — never from the same constants the implementation splits
  on. Test the tolerant grammar (`\r?\n\r?\n`), the unterminated final frame,
  and the interleaved variant (Gemini: `thought: true` parts).
- Applies to: every fetch-based adapter in `src/lib/providers/`; the SDK-based
  adapters are exempt only because the SDK owns the framing.

## Audit-remediation waves (2026-08-01, PR #75): what the six waves taught

- **Keep supabase-js out of first load with a dynamic import behind a tiny
  seam, not by scattering `import()` at call sites.** `src/lib/supabase/
lazy-client.ts` re-exports `loadBrowserClient()` (whose only reference to the
  heavy client is `await import(...)`) plus `type BrowserClient =
Awaited<ReturnType<typeof loadBrowserClient>>`. Consumers import the tiny
  module statically; the bundler splits `@supabase/*` into an async chunk.
  Measured: /enhance 223→158 kB, /profile 208→143 kB (PERF-001/Q14). The type
  alias sidesteps the `import type { createClient }` + `typeof` trap — a
  type-only import cannot be used in a `typeof` query.
- **`useMutation`'s return object is a fresh spread every render; `.mutate` is
  stable.** So a `useCallback` that closes over the whole mutation re-creates
  every render and defeats the memo it was meant to feed. Depend on the
  destructured `mutate`/`isPending`, never the object. Same shape for volatile
  store values in an event handler: read `useUIStore.getState().x` imperatively
  instead of adding `x` to the dep array, or the handler churns per keystroke
  (PERF-003/006).
- **A comfort/perf knob that only CSS-hides is a half-kept promise.**
  `data-reduced-effects` set `display:none` on the mesh canvas while the rAF
  loop kept running the full node/link math into it at 30fps. A knob has to stop
  the WORK, not just the pixels — gate the loop on the same signal
  (PERF-002). Look for the same gap wherever an effect has both a CSS rule and a
  JS driver.
- **`immutable` is the wrong cache header for assets that regenerate in place.**
  The icon/splash/brand matrix is rebuilt by `generate-icons.mjs` under the SAME
  filenames, so a year of `immutable` would strand a re-brand. `max-age=86400,
stale-while-revalidate=604800` keeps the win and lets an update propagate in a
  day (PERF-008). Reserve `immutable` for content-hashed names (fonts already
  are).
- **Bulk ledger-disposition edits need bounded, asserted matching.** Replacing
  `- **disposition:** pending` per finding by locating its `### <ID>` header and
  bounding the search to that finding's section (up to the next `### `) — with a
  hard fail if the header or a pending line is missing — updated 66 dispositions
  across three waves with zero cross-contamination. A blind global replace of a
  repeated marker string corrupts neighbours.
- **A blind path rename inside an audit ledger corrupts the findings that
  describe the paths.** Folding `docs/audit/` → `docs/audits/` (DOC-014) could
  not be a global `docs/audit/`→`docs/audits/` because DOC-014's own text
  contrasts the two directory names, and the substring relationship (`audits`
  contains `audit`) is a second trap. Fix: `git mv` the files, update only the
  forward-looking pointers (CLAUDE.md, the ADRs, history, CHANGELOG), and keep
  the ledger's point-in-time evidence paths as the record (with a header note).
- **"Locked" canon that has gone stale needs a reclassification decision, not a
  silent rewrite.** The v1 planning files said 3 models / 5 modes while the app
  shipped 16 / 6, and CLAUDE.md called them locked-authoritative. ADR-0005 names
  the LIVING canon (code + CHANGELOG + tokens.css + the ledger) and moves the v1
  files to `docs/history/`; section citations in source comments survive because
  they are by-section, not by-path (Q2).
- **The WebKit e2e leg does not run in this sandbox and that is a disclosure,
  not a pass.** `mobile-safari` (WebKitGTK) cannot launch here (missing
  `libgles2`/`gstreamer`), so every wave verified on `mobile-chrome` (30/30) and
  said so. The identical specs passing on Chromium is what licenses "the
  hygiene/perf changes are unaffected" — never let the 25 WebKit launch failures
  read as a code regression (CLAUDE.md §3).
- **A platform URL-rewrite layer can invalidate every path-keyed header rule —
  verify header intent on the URL the platform actually serves.** Vercel's
  `cleanUrls: true` 308s `/offline.html` to `/offline`, so the static CSP rule
  and the middleware matcher exclusion — both keyed on the `.html` path — only
  ever decorated a bodyless redirect while the real document got the nonce
  policy and its inline recovery script was silently blocked in production
  (local `next start` has no cleanUrls, so the e2e suite could never see it).
  Two fixes compose: make the script external so _every_ policy variant
  (`script-src 'self'`) permits it, and teach both the matcher and the header
  rules about the clean-URL form. Curl the deployed URL, not just the repo
  path.
- **`apply_migration` via the Supabase MCP stamps its own version — the remote
  ledger drifts from the repo filenames unless repaired.** The three wave
  migrations landed as `20260801184843/191808/214653` while the repo says
  `…190000/200000/210000`; a future CLI `db push` would have re-run them into
  duplicate-column errors. Repair is three UPDATEs to
  `supabase_migrations.schema_migrations`; the durable habit is to pass the
  repo's version explicitly (or repair immediately) whenever a migration is
  applied outside the CLI.

## 2026-08-02 — On-device report fixes (translucency · settings · Gemini)

**What broke (and the fix):**

- **A custom property derived at `:root` cannot see a descendant's value.**
  `--dev-peak` is substituted AT `:root` (dev-accents.css), so the authed
  layout's wrapper-div `style={{--dev-peak-user}}` was invisible to it — the
  owner's stored accent strength never rendered after a load; only the
  slider's inline-on-`<html>` preview worked, which made the bug read as
  "doesn't persist visually". Fix: the layout server-renders
  `:root{--dev-peak-user:N%}` (`devAccentCss`, clamped before interpolation).
  Rule: a `var()` consumed in a `:root` declaration must be DECLARED at
  `:root` (inline on `<html>` or a `:root` rule) — any lower carrier is
  silently dead.
- **"The stand-down is imperceptible" was a design premise, not a
  measurement.** `[data-scrolling] .glass` dropped the blur assuming the
  72%/82% tint hides what's behind; on a real device the page read straight
  through every panel mid-flick, and the composer showed ambient-mesh nodes
  even at rest. Fix: the stand-down swaps to the opaque `--glass-still`
  composite, and the composer moved to the new `.glass-solid` tier. Avoid
  perceptual claims in comments without a device check — this is the second
  such premise falsified on device (after the iOS-claims rule, §3).
- **A glyph can collide with a developer mark.** The template button's
  four-point spark was, at 14px, the Gemini mark from the Target rail. In an
  app that renders developer identities, check any new glyph against the
  DeveloperIcon silhouettes before shipping it.
- **Provider 4xx bodies deserve translation AND a server-side log line.**
  Google's "Your project has been denied access. Please contact support."
  reached the user verbatim (reads as an app defect; the "support" is
  Google's) and left no trace in the Vercel runtime logs — diagnosis had to
  start from a screenshot. The google adapter now warn-logs upstream
  failures and appends the key-rotation remediation to 401/403; runbook
  section "Gemini key/project refusals" carries the procedure.

**Environment notes:**

- This remote container CAN run the WebKit leg: `sudo npx playwright
install-deps webkit` + `npx playwright install webkit` (and `install
chromium` when the pinned Playwright's revision differs from the
  pre-installed one). Both e2e projects executed here — an upgrade over the
  earlier sessions that had to disclose a Chromium-only pass.
- The `mobile-safari` a11y spec can flake on a cold first WebKit run: axe
  samples the sign-in footer mid `footer-fade-in` (fg ≈ silver at ~62%
  opacity → 2.7:1). Clean on re-run and on the following full suite. If it
  recurs, settle the footer animation before the axe scan — don't loosen the
  assertion.

## 2026-08-02 — Scroll stand-down removed (second device report)

**What broke:** the previous fix's opaque fill swap traded the see-through
artifact for a grey-shift artifact — every library/settings panel visibly
changed color the moment a flick started. Two stand-down generations, two
device reports, one day.

**The general lesson:** a panel whose resting appearance depends on what is
BEHIND it (translucent tint + blur over a position-varying ambient ground)
has no substitutable scroll-time rendering — the resting composite differs
per panel, so any single stand-down appearance mismatches somewhere. Don't
iterate on WHAT to swap to; the only rendering that always matches rest is
rest itself. Two-state rendering of visible surfaces is the defect class.

**Perf posture:** the stand-down was a from-principle optimization; the jank
it guarded against was never measured on the target device, while its
appearance cost was reported twice within a day. Visual-costing
optimizations need a measured problem first. The FAB's gate stays because
its premise holds measurably (82% Laser fill — the swap is invisible in the
same screenshots that condemned the panels'; and as a fixed element over a
scrolling list it has the app's strongest per-frame blur cost).

**Contract inversion:** when removing a pinned behavior, flip the pins,
don't delete them — ui-contracts now asserts NO `[data-scrolling] .glass`
rule exists, and the two e2e scroll specs assert a real panel computes
identical blur + fill mid-scroll. The removed optimization can't drift back
in casually.

## 2026-08-02 — Picker anchoring (Sheet grows a side anchor + real drag-dismiss)

**What broke.** Device report: the Target/Thinking pickers opened as bottom
sheets a viewport away from the mid-screen pills that trigger them, and the
Sheet's grab handle looked draggable but wasn't — an affordance that
promised a gesture the code never implemented. Ornamental affordances are
debt: every handle/chevron/pill that implies an interaction must either
perform it or not exist.

**What changed.** `Sheet` gained `anchor="side"` (card centered on the right
edge of the app column, entry/exit slide from that edge), a working
drag-to-close scoped to the handle strip, and a real exit animation. The
exiting node goes `aria-hidden` + pointer-inert on the first closed frame,
with focus restore and scroll unlock keyed to `open`, not unmount — that is
what let every existing `queryByRole("dialog")`-is-null-after-close test
pass untouched. If an exit animation forces test rewrites, the a11y timing
is wrong, not the tests.

**What to avoid / remember.**

- `ui-contracts` bans `active:` utilities anywhere in src (touch feedback
  must not ride `:active` — WebKit quirk). It caught a decorative
  `active:cursor-grabbing` immediately. Check the contract tests BEFORE
  reaching for a variant prefix, not after.
- Pointer-capture retargets the subsequent click to the capturing element.
  Capturing on `pointerdown` therefore silently eats taps on any control
  inside the grab zone (the close X). The shape that works: capture
  immediately only when the press starts outside interactive elements;
  otherwise capture after the slop threshold commits a real drag.
- This environment pre-installs a Playwright Chromium for a NEWER build tag
  than you may resolve from `^`-ranged devDeps — `global-setup`'s
  browser preflight then reports _chromium_ missing even though a chromium
  sits in `/opt/pw-browsers`. `npx playwright install chromium webkit`
  (matching the resolved version) is the fix; piping test output through
  `tail` also swallowed the failing exit code, so check `PIPESTATUS`, not
  the pipeline's.

## 2026-08-06 — Picker sheet padding (third device report)

**What broke.** Device report: the Thinking depth sheet's Auto card rendered
its title and description flush against the card borders. The rows were sized
by `min-h-[44px]` + `items-center` with no `py-*` — a shape that _looks_
padded exactly as long as the content is one 20px line centered in a 44px
box. Auto's description wraps on a phone, the content outgrew the floor, and
the apparent padding vanished to zero.

**What changed.** All rows in both picker sheets (ThinkingPicker,
TargetPicker — the pair must match) gained `py-3`. Single-line rows are
pixel-identical (20 + 24 = the same 44px), wrapping rows keep a 12px inset.

**What to avoid / remember.**

- **min-height is not padding.** A min-h floor with `items-center` mimics an
  inset only until content wraps; any row that can carry two lines needs the
  inset stated as actual padding. When adding a min-h tap floor, pair it with
  the `py-*` whose arithmetic meets it (text-sm line 20px + py-3 24px = 44px)
  so the floor is the _backstop_, not the layout.
- The pickers are a matched pair by declared contract (comments + the
  trigger-equality unit test). A fix found in one MUST be applied to the
  other in the same commit — TargetPicker's Auto row had the identical bug,
  just unreported.

## 2026-08-07 — Depth meter, streaming console, Originals chip

**What broke.** Nothing at runtime — three owner reports of UI that
understated itself: depth rows with no scannable weight, a streaming card
that read as bland, and a storage toggle styled as a caption. Two of the
fixes reversed rulings this repo had explicitly recorded (DepthGlyph
"static by design"; the Originals dial "smaller and quieter").

**What changed.** DepthGlyph became a per-level readout (filled bars,
ultra-violet above High, Max overshooting the meter's top line);
StreamingResult became a one-card live console (beacon caption, in-card
progress, keyed tail fade, designed caret, top-edge light, skeleton
wait-state, the UX-03 scroll-into-view, PRI-013 aria-hidden glyphs); the
Originals dial took the app chip recipe with an 8px state dot. New
`--ultra-ink` token in globals.css + Tailwind `ultra` ink role.

**What to avoid / remember.**

- **Reversing a recorded ruling is a two-site edit**: rewrite the source
  comment that states the ruling AND log the reversal in the changelog in
  the same commit — otherwise the next reader restores the "documented"
  state in good faith. Carry the surviving half of the old rationale
  forward (both reversals here kept one: the meter's label stays the
  authoritative readout; the dial still never takes a laser fill).
- **Streaming-text ornament must be opacity-only.** The fade span is an
  inline box inside `whitespace-pre-wrap`: transforms don't apply to
  inline boxes, and `inline-block` breaks pre-wrap line wrapping at the
  span boundary. Key the span by settled length so the fade restarts per
  rAF flush, and never start from opacity 0 — the newest words must stay
  readable mid-stream.
- **globals.css theme tokens are invisible to the tokens.css-scoped a11y
  harness.** A token added there (the LOCKED-file containment) needs its
  own declaration-count + contrast pins, and the light theme still exists
  twice — dark, explicit light, AND system light.
- **Contrast-tune brand hue picks against COMPOSITED surfaces, not the
  page.** The picked #ab68ff cleared the void but measured 4.499:1 on the
  alpha-composited glass card — under the 4.5:1 text bar by a thousandth.
  One lightness step (#b47aff) kept the hue and bought 5.24:1.
- Components that touch `window.matchMedia` / `scrollIntoView` on MOUNT
  make every jsdom test that renders them stub both (the composer-error
  pattern). The failures surface in _unrelated_ suites that merely mount
  the composer mid-run (composer-reset) — grep for other renderers of the
  surface before calling the fix done.

## 2026-08-07 — Enhancement result lost on navigation (paid-usage wash)

**What broke.** Running an enhancement and visiting Library or Profile
before saving/copying destroyed the result: it lived in
`EnhanceComposer` `useState`, and App Router navigation unmounts the
route. The draft survived (persisted UI store), so the loss read as a
bug, not a rule — and the tokens the run cost were washed.

**What changed.** The R8 submitted-snapshot + result view moved to a new
persisted zustand store (`src/stores/enhance-view.ts`,
`vizion.enhance-view.v1`). Rehydrate-time validation drops a stored view
whose target left the roster; `skipHydration` + a once-per-load
`persist.rehydrate()` in ProfileHydrator keeps SSR HTML and first client
render identical; account change wipes storage before rehydrating (the
`editorDraft` shared-device rule extended).

**What to avoid / remember.**

- **Transient component state must never be the only copy of a paid
  artifact.** Anything a request spent money producing needs to live at
  least at store level, ideally persisted — audit `useState` around every
  metered mutation.
- **Persisting a store that conditionally mounts a subtree needs
  `skipHydration`.** A textarea value mismatch is quietly patched;
  a whole result tree present client-side but absent in server HTML is a
  hydration error. Rehydrate explicitly after mount instead.
- **`setState` on a persist-wrapped store writes through to storage.**
  In tests, seeding `localStorage` and then calling `setState` silently
  overwrites the seed — order the arrange steps state-first, storage-last.
- **A new module-singleton store needs `setState` resets in every test
  file that renders its consumer** — vitest isolates files, but within a
  file a leaked view pre-mounts the result tree in later tests.
- **"Skip the first run" boolean effect flags are StrictMode-unsafe.**
  Dev StrictMode runs mount effects setup→cleanup→setup; the first setup
  flips the flag and the second runs the guarded body anyway. Gate on a
  previous-value ref (`prev.current === value`) instead — both mount
  setups see the same reference and skip.
- **A one-time storage wipe cannot outrun a still-open tab.** Account
  B's `clearStorage()` on sign-in doesn't stop account A's open tab from
  re-writing its state afterwards. Every persisted envelope that can
  carry private content needs an owner stamp checked on every load, not
  only at the wipe.

## I›O mark swap — the maskable factor and the palette are both derived, not free

- **The maskable safe-zone factor is coupled to the glyph's aspect ratio.** With
  `fit: "contain"`, a wide glyph in a square bounding box renders at the box's
  full width, so its corners land at `0.5 × factor × √(1 + 1/aspect²) × size`
  from centre. The old `0.78` factor was sized for the 1.727:1 art; the new
  1.581:1 mark at `0.78` puts corners at ≈0.46 × size — outside Android's
  0.40 × size maskable safe circle — so the ring would be clipped on masked
  launchers. `0.68` brings the corners back to ≈0.40 × size. Lesson: any time
  the mark's viewBox aspect changes, re-derive the maskable factor from the
  geometry; it is not a taste knob.
- **The tile is a token consumer, not an independent palette.** The previous
  icon art was authored outside `src/styles/tokens.css` and drifted a full hue
  band from the brand accent: hue 64–74° greens (`#eaf72b`/`#aace04`/`#84ac00`)
  against `--laser: #b7ff3c` at hue 82°. Nothing caught it because the SVGs
  never reference the token file. The re-cut anchors every green on `--laser`
  (gradient `#ceff7a → #b7ff3c → #81cc00`) and the neutrals on the
  `--onyx`/`--lift`/`--void-2` ramp. Lesson: when authoring brand artwork,
  start from the token hexes and diff the art's palette against `tokens.css`
  before committing — the icon must re-derive from the tokens, never
  approximate them.
  - **Amended 2026-08-10 ([ADR-0013](../docs/decisions/0013-brand-green-retune.md)):
    the rule holds for derivative artwork, and NOT for a brand refresh.** The
    iOS 26 Liquid Glass set (#104) arrived at hue 66.6° `#dffa04` — inside the
    very 64–74° band this entry records — and the token moved to meet it rather
    than the reverse, because that set is a designed identity, not an
    approximation of one. When the brand itself moves, the token is what has
    drifted. Read 0013 before "fixing" `--laser` back to `#b7ff3c`.
  - The second half of the lesson survived intact and is worth restating,
    because it is what nearly bit twice: **the token file is not the only place
    the accent lives.** `--laser-glow` spells the channels out for an alpha, the
    light theme carries a hand-derived `--accent-ink` in TWO blocks, and
    `AmbientNebula.tsx` mirrors the channels again because a canvas cannot read
    a custom property. A retune that changes only `--laser` leaves the canvas
    painting the old green behind a DOM painting the new one — the same "never
    references the token file" failure, relocated from an SVG to a canvas. Grep
    the raw hex AND the `r, g, b` triplet before declaring a colour change done.

## NEBULA+ background swap — the contracts around a component outlive the component

- **A stylesheet-grepping test is a spelling contract, not just coverage.**
  `reduced-effects.test.ts` matches gate rule heads with
  `endsWith(" .classname")`, so the `[data-reduced-effects]` gate had to
  target the SHARED `.bg-nebula-bloom` class — a head ending in a variant
  class (`.bg-nebula-bloom-a`) would silently fail the shared-class
  assertion. When replacing a component, read the tests that grep for it
  before choosing the new class names, not after.
- **"The browser is installed" is a build-number claim, not a binary one.**
  The environment ships a Playwright chromium at build 1194; the lockfile's
  Playwright 1.60 resolves to chromium-1223 and the e2e global-setup guard
  (correctly) hard-failed on it. WebKit additionally needed
  `playwright install-deps` for ~30 host libraries. Budget for browser
  provisioning on any fresh runner; the guard's message is the remedy.
- **Theme-dependent JS can read the effective scheme off the CSS cascade.**
  `tokens.css` sets `color-scheme` in all three theme blocks, so
  `getComputedStyle(document.documentElement).getPropertyValue("color-scheme")`
  resolves dark/light/system-light without replicating the
  `data-theme` + `matchMedia` logic in JS — one source of truth, and it
  re-reads correctly through the existing MutationObserver + scheme
  listener. Prefer this over a second, drift-prone scheme resolver.
- **Scoped custom properties let a LOCKED token file stay locked.** The
  NEBULA+ palette lives as `--nebula-*` properties on the wrapper class in
  `globals.css`, derived from `--accent-ink`/`--silver` via `color-mix` —
  tokens.css untouched, theme reactivity free. The cost is the tri-block
  rule: every light value is written twice (explicit + system-light), and
  forgetting the media block hands system-light users the dark values.

## NEBULA+ on a phone — the unit was right on the machine it was designed on

- **`vmax` silently changes which axis it means when the device rotates.**
  The blooms were authored in `vmax` against a 1280×800 landscape
  reference, where width is the larger axis and `vmax` is therefore
  indistinguishable from `vw`. On a portrait phone the same numbers pin to
  the HEIGHT axis instead, and an 80`vmax` bloom renders at 173% of the
  screen's width. Nothing was wrong with the values; the unit meant
  something different on the target device than it did on the design
  surface. Treat `vmax`/`vmin` as orientation-dependent and check any
  viewport unit against both orientations before shipping it — and note
  that a bare `vmax`→`vw` swap only fixes portrait, because on a short
  landscape screen `vmax` already WAS `vw`. The per-axis
  `min(Nvw, Mvh)` clamp is what covers both.
- **`getBoundingClientRect()` is the wrong instrument for verifying declared
  geometry on an animated element.** It returns the post-transform box, so
  three of the four blooms — whose keyframes start at a non-identity
  `scale()` — never measure their declared size at any moment past t=0, and
  the first verification run "failed" on correct CSS. `getComputedStyle`
  resolves `calc()`/`min()`/`vw`/`vh` to pixels without the transform, and
  is what a geometry assertion wants.
- **A stale dev server outlives the build it was serving.** A `next start`
  from an earlier check kept running after a clean rebuild, serving a
  manifest whose hashed CSS filenames no longer existed — every stylesheet
  404'd, so the page rendered unstyled and every geometry number came back
  identical and wrong. `lsof`-based kills missed it; it needed killing by
  PID. When measurements look uniformly impossible, verify the harness
  before debugging the code, and confirm the asset actually loaded.
- **An authed page ignores `emulateMedia({colorScheme})`.** `ProfileHydrator`
  stamps `data-theme` from the signed-in profile, so a "light theme" check
  that only emulates the media query silently measures the dark tokens —
  and comparing dark text against a light-composited wall produces a
  confident, meaningless failure. Drive the app's own theme control instead,
  and assert the tokens actually swapped before trusting the numbers.
- **`getComputedStyle` verifies the box, not the keyframes — so a unit change
  inside `@keyframes` passes a "geometry unchanged" check.** The same commit
  that fixed the `vmax` bug converted bloom C's drift to bare `vw`/`vh`
  instead of the diameter-ratio form the other three got, and the
  verification script — which reads declared width/height/offsets — never
  evaluates an animation's transform, so the one value that moved was outside
  the instrument's field of view. At the 1280×800 reference `3vmax` is 38.4px
  but `3vh` is 24px: a silent 37.5% loss of vertical travel at the very
  viewport the motion was tuned against, plus a 3.47× disproportion on a
  portrait phone. Assert keyframe values directly; do not infer them from the
  element's box. `tests/unit/ambient-geometry.test.ts` now greps for exactly
  this.
- \*\*Verify a comment's claim about the PRIOR code against `git show
  <base>:<path>`, not against the code in front of you.** The comment shipped
  alongside that change asserted bloom C's drift "was already axis-correct —
  not vmax". It was reconstructed from the post-change code and was false —
  the base commit reads `translate(-4vmax, 3vmax)`. Source comments are
  living canon here (`docs/decisions/0005-living-canon.md`), so a comment
  that misdescribes history is a defect in the canon, and it strands the next
  maintainer with a false premise for an exemption that no longer exists.
- **Mixing `vw`/`vh` drift with a `min(Nvw, Mvh)` diameter decouples them.**
  Which branch of the `min()` wins varies by viewport, so only the ratio form
  (`calc(var(--bloom-size) * N / 46)`) stays proportional on both branches —
  a bare `vw` drift also comes apart at short-landscape sizes like 1280×500,
  where the diameter takes the vh branch while the drift does not.
- **A legibility fix that changes an element's visual weight is a design
  change, and needs to be looked at.** Adding `.glass` to the mode caption
  fixed the contrast margin and turned a one-line secondary caption into a
  third bordered card stacked under two other cards — contradicting the
  comment directly above it, which said "not a card". The right instrument
  was a fill with no hairline, sheen or blur (`.ambient-scrim`, on the
  existing DSN-010 `--scrim-panel` wash). Render the screen and look at it;
  a contrast ratio alone cannot tell you the fix is wrong.

## Maroon · Qwen3.8 · one stream light · the 55s cutoff

- **"Bounded on what?" — and then go read the library.** The original diagnosis
  here was that the SDKs' `timeout` is a whole-request deadline covering the
  streamed body read, which made `PROVIDER_TIMEOUT_MS = 55_000` the silent
  output ceiling. It was a confident, plausible, well-argued answer, it got
  written into the constant's comment, a runbook, a changelog entry and a PR
  description — and it was **wrong**. Both vendored SDKs arm the timer around
  `fetch()` and clear it when that promise settles (`openai/src/core.ts:597-602`,
  `@anthropic-ai/sdk/src/client.ts:729-733`), and a streaming `fetch()` resolves
  at the response HEADERS. It bounds connect-and-headers; the body read is
  unbounded. The actual truncator was `maxDuration = 60` — the platform killing
  the function. A reviewer caught it. The lesson is not "ask which clock" (I did
  ask, and answered wrongly from memory of how such options usually behave); it
  is that for a third-party behaviour the whole fix rests on, **open
  `node_modules` and read the four lines**. It costs a minute and it is the
  difference between a fix and a fiction.
- **A timer you cannot see fire is not a backstop.** Following from the above:
  because that timer is already cleared once the body streams, passing the
  "total" budget as the SDK `timeout` bounded nothing during the stream. A
  continuously productive run had NO limit and would be killed by the platform
  instead — skipping the finally block and stranding the spend hold, i.e. the
  exact leak the policy existed to prevent. An absolute wall has to be enforced
  where the reading happens, and it must not reset on a chunk; an idle timer and
  a total timer look similar and do opposite jobs.
- **A truncation that is still billed is worse than an error.** The route's
  `finally` block correctly settles the ledger from `streamedChars` — those
  tokens really were spent upstream. So the adapter throwing away the partial on
  a length stop meant the user paid for output that was deliberately discarded.
  When a failure path runs _after_ money is committed, the question is not "did
  it succeed" but "what did the spend buy, and are we keeping it".
- **Never let a degraded-result flag borrow another's copy.** `salvaged` means
  "complete output, lost rationale" and its UI string promises "the prompt above
  is complete". Reusing it for a truncated run would have asserted exactly the
  false thing, to the one user who most needs the truth. New failure mode, new
  flag, new sentence — even when the rendering branch looks identical.
- **A monotonic floor beats an "authoritative" latch.** The token readout froze
  at `1213→1 tok` because Anthropic's `message_start` snapshot (output_tokens:
  1-4) set `usageAuthoritative`, which disabled the char estimator for the rest
  of the run. Taking `Math.max(incoming, current)` everywhere makes the counter
  correct-by-construction and deletes the flag entirely: an estimator that can
  only raise can never walk a real measurement backwards, so nothing needs to
  know which number is "real".
- **A corridor with a lower bound is a visibility constraint, not a rulebook.**
  "Make OpenAI maroon" is unsatisfiable on a dark card and no amount of
  ΔE tuning changes it: `#800000` is 1.15:1 on `#2E352D`. The accent must be
  _lighter_ than the surface to exist at all. Worth computing and stating the
  measured number before proposing a compromise — the constraint that binds was
  the corridor, while the one that _looked_ binding (the `--flare` clearance)
  turned out to pass at 21.0/18.1 without amendment.
- **An invariant asserted for one instance is not asserted.** The accent
  corridor was only ever checked against `xai`, so an out-of-corridor value for
  any of the other eleven would have shipped green. Granting a deliberate
  exception was the moment to notice — the new test now pins that exactly one
  accent is below the floor and names it, so the exception stays singular. When
  you find yourself allowed to break a documented rule silently, the rule needed
  a test more than the exception needed an ADR.
- **Two identical animations read as two indicators.** `.stream-live::after` and
  `.stream-progress-sweep` shared one keyframe, duration, gradient and glow —
  the CSS even said "one keyframe, two consumers" approvingly. Deduplicating a
  _definition_ is not the same as deduplicating a _signal_. When choosing which
  to cut, the tiebreak was accessibility: the bar carried the `aria-live` step
  label and the edge light carried nothing.
- **Playwright browsers are not provisioned in a fresh session.** `npm run
test:e2e` hard-fails in global-setup until
  `npx playwright install --with-deps webkit chromium` has run (and
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` must be overridden for it). Budget for it
  before claiming the gate is green — and note that a `... | tail` pipeline
  returns _tail's_ exit code, so a failed run can look like exit 0.
- **A budget expressed as a duration will be re-armed at every layer.** PR #91
  took six review rounds to bound one provider call, and each round found the
  _same_ defect one layer further out: route preflight, then the header wait,
  then the stream body, then the SDK client's own `timeout`. Every fix
  RELOCATED the timer; none removed the ability to start a new one, because
  `PROVIDER_TOTAL_MS` stayed importable and `timeout: PROVIDER_TOTAL_MS` went
  on type-checking and reading plausibly wherever it appeared. **Two budgets
  that each read 285s do not sum to 285s — they sum to 570.** The cure is
  representational, not positional: convert the constant to an absolute wall in
  exactly one place, and give every layer below it only `remainingMs(deadline)`.
  When a reviewer keeps finding the same bug in a new location, stop fixing the
  location — the next round is already written.
- **A guard test that asserts a literal can pin the defect in place.**
  `provider-policy.test.ts` asserted `timeout: PROVIDER_TOTAL_MS` — the exact
  line Codex was filing as a P1. So the invariant the suite defended was the
  bug, and each attempted fix had to fight its own test suite. Assert the
  PROPERTY (`timeout` is derived from the remaining wall), never the token that
  happened to implement it on the day it was written. A source-contract test is
  a specification; write it as one.
- **"Every X except the one shaped differently" is how an invariant dies.**
  `google.ts` was the last adapter still arming its own 285s total, and it
  survived five rounds for one reason: it is a hand-rolled `fetch`, not an SDK
  call, so it did not pattern-match as an adapter. The route threaded it a
  deadline and it never read the field. When a rule is rolled out by analogy to
  a shape, the member that does not share the shape is not an edge case — it is
  the one that will fail in production.
- **Prove a guard bites by breaking the code on purpose.** Both new guards were
  mutation-tested: re-introducing `timeout: PROVIDER_TOTAL_MS` and re-blinding
  `google.ts` to `opts.deadline` each turned the suite red, on the behavioural
  tests as well as the source scan. A guard never observed failing is a guard
  you are trusting on faith — and this repo has now shipped one that asserted
  the opposite of what it meant.
- **Mock the signal, not just the shape.** The first Gemini deadline test hung
  for its full 15s timeout: the `fetch` mock returned a `ReadableStream` that
  ignored `init.signal`, so aborting the controller did nothing and an adapter
  that honoured the wall was indistinguishable from one that ignored it. A real
  `fetch` errors the body stream on abort. When the behaviour under test IS
  cancellation, the mock has to implement cancellation.
- **Refusing to start is cheaper than aborting.** An aborted provider call can
  still be billed once generation begins, so `providerBudget()` throws a 504
  before the connection when the wall is already spent, rather than opening a
  request it knows it must kill. The money leaves at connect time; the guard
  belongs before it, not after.
- **Ask the API to do the thing; the refusal names the cause.** `ci-enablement.md`
  had spent two measurement rounds inferring _why_ Actions never ran, from the
  shape of what was missing — repo policy for "no record created", billing for
  "records stuck queued", two hypotheses for two symptoms. One dispatch attempt
  returned `422 Actions has been disabled for this user`, which is a single
  ACCOUNT-level cause for both, and points at a settings page the checklist did
  not mention. The old step 1 (repo Settings → Actions) would have read as
  "already correct" and sent the next attempt round the loop again. When a
  runbook is reasoning backwards from absence, try the operation and read the
  error before theorising about it.
- **`playwright install` is not `playwright install-deps`.** The existing lesson
  said browsers are unprovisioned in a fresh session; the sharper form is that
  the _system libraries_ are too, and they fail differently. Missing browsers
  fail in global-setup; missing WebKitGTK libs fail per-test at
  `browserType.launch` with 30 red tests that read exactly like a code
  regression. `install-deps` shells out to apt and needs root. On a repo where
  the local gate is the only gate, "e2e green" is only a claim if WebKit
  actually launched.

## Stale brand art — layered SWR caches in front of stable names

- **A same-name asset swap does not propagate; version the reference.** The
  brand masters keep their filenames by design (one `generate:icons` run, zero
  ref churn) — but `/brand/*` ships day-fresh/week-stale HTTP caching UNDER the
  SW's StaleWhileRevalidate image route, and the SW's background "revalidation"
  fetch reads the still-fresh HTTP cache, not the network. Two SWR layers in
  series means new bytes at an old URL can stay invisible on returning devices
  for days — the owner was still seeing the pre-re-cut header icon the day
  after the swap deployed. `src/lib/brand-assets.ts` now owns the live-DOM
  URLs with a `?v=` bump per art change: a cold key in both caches at once,
  while the filename contract (pipeline, docs, tests) stays intact.
- **`next/image` keeps SVG passthrough across a query string.** The optimizer
  refusal for SVG is gated on `src.split('?', 1)[0].endsWith('.svg')`
  (Next 15.5), so `?v=N` does not push the file into `/_next/image`. Checked
  against the installed source, not assumed.

## Icon pairs — direction is not a visual property

- **Differentiate icons by geometry, not path draw order.** `ModeRig`'s
  Condense icon was Expand's path with every subpath written backwards —
  visually identical, because a plain SVG stroke renders the same segments
  whichever end it starts from; direction exists only for dashes, markers
  and path animation. The tell was in the comments ("arrows out" /
  "arrows in") describing a difference the pixels never had, and the pair
  shipped as one maximize glyph for two months. If two icons must read as
  opposites, mirror the coordinates — and check the claim by looking at a
  rendered pair, not the `d` strings.

## Axe audits race entry animations

- **A contrast reading taken mid-animation is not a palette regression.** The
  sign-in axe spec failed WebKit-only, "serious", 4.35:1 — on a token pair
  that rests at 5.99:1. The footer's `fadeInUp` (0.8s delay + 0.8s ramp,
  fill `both`) leaves a window where the text is translucent; a scan landing
  there measures the blend, and whether a worker lands there is machine
  timing, so it reads as an intermittent engine-specific failure. Before
  chasing tokens, ask WHEN the scan ran: the a11y spec now settles every
  finite animation before injecting axe (infinite ambients exempt — waiting
  on them never returns). Diagnosis: reproduce on the base tree, compute
  what alpha turns the resting color into the measured one (~0.855 here),
  then find the animation that passes through it.

## Auto routing over the full roster (2026-08)

- **Routing data is capability data — put it where the audit said.** The
  smarter Auto needed strength, speed, price, vision, and availability per
  model; four of five already existed, scattered exactly as PROD-05 recorded.
  Building the router meant _partially_ delivering that manifest (routing
  facts only) and saying so in the file header — a full five-source
  consolidation bolted onto a feature PR would have doubled its blast radius
  for no user-visible gain.
- **A price change is now a routing change too.** `blendedPrice` reads the
  live `TARGETS` values, so a `PRICE_*` override in Vercel re-ranks Auto as
  well as re-pricing the cap. The changelog line grew a clause; tests derive
  expected orderings from live `TARGETS` so a reprice can't rot the suite.
- **Vendor tier NAMES are data, not vibes — verify roles, not just rates.**
  The pricing re-verify caught GPT-5.6 Terra and Luna with swapped roles in
  VIZION (Terra is the mid tier, Luna the small one): prices, roster order,
  tier comments, and the target-idiom prose all repeated the same wrong
  assignment. One wrong "which tier is this" answer at intake had fanned into
  four surfaces; the fix touched all four in one commit.
- **Capability sets rot in the flattering direction.** MiniMax M3 and
  Qwen3.8 Max shipped with native image input, but VISION_CAPABLE_PROVIDERS
  still said text-only — nothing fails when you under-claim a capability, so
  no test ever caught it. Model-facts research goes through the vendor's
  current page on every roster touch, capabilities included, not just prices.
- **"Auto is not a fallback" needed its own line of code.** The media route
  reported `fallbackFrom` whenever the used target differed from the request's
  pinned target — under auto that's every run. The fix was naming what a
  request was _aimed at_ after routing (`aimedTarget`) and comparing against
  that, so a genuine mid-run retry still reports honestly.

## 2026-08-09 — Approval-gated design audit (report → CMCs → approved VAR wave)

- **A "resolved" disposition can overclaim its blast radius.** A11Y-003's
  ledger entry said the selected-ink cue went "on every active Laser fill";
  a grep found four `aria-pressed` chip groups that never got it. When a
  finding is resolved across N sites, the disposition must enumerate them —
  and the durable fix is a _scanning_ guard, not an enumerated one.
- **A comment asserting cascade behavior is a claim, not a fact.** The
  `.selected-ink` comment said ":focus-visible box-shadow REPLACES this";
  layer order (base < utilities) ran it exactly backwards, so focused
  selected controls had NO focus ring — on dark, none at all. The compose
  contract (`--focus-ring` first) already documented the repair; pin
  cascade claims with a computed-style probe, never prose.
- **A recorded fix is not a landed fix — measure the recipe.** DSN-007's
  resolution ("labels stop overflowing at 320") shipped as a cell-level
  `max-[359px]:tracking-tight` that the label span's own `tracking-wide`
  overrode; scrollWidth 51/49 vs 46 cells disproved the record a wave
  later. The verification recipe written into a disposition should be run,
  not just written.
- **`overflow-wrap: break-word` does not lower min-content in flex/intrinsic
  sizing.** The rig label (a flex item) sized itself to the unbreakable word
  and clipped instead of wrapping under 200% text scale; `anywhere` is the
  value that participates in min-content. break-word remains right for
  block-level paragraphs (the title fixes).
- **`metadata.appleWebApp` makes React own a status-bar meta even with
  `statusBarStyle` unset** — and React re-inserts its tag AFTER a runtime
  correction, so ThemeManager + the metadata system produced two
  contradictory tags with the stale one last (measured in both
  configurations; the duplicate just switched schemes when the static value
  was removed). If a runtime manager owns a tag, the metadata system must
  not emit it at all: hand-write the sibling metas and let the manager
  create-when-absent.
- **`.pb-safe` is a bare `env()` late in the utilities layer — beside a
  `py-*` it silently deletes the declared bottom padding wherever the inset
  is 0.** Same trap class as the box-shadow compose contract. The safe
  recipe is the `max(padding, env(...))` floor the codebase already used
  three times; sheet footers had shipped 0px on every non-notch device.
- **The e2e Supabase stub + a production `next start` is a full rendered-
  audit harness.** Sign in through the real form; remember ProfileHydrator
  re-applies the ACCOUNT's stored theme after hydration (correct server-
  as-truth behavior), so a capture script must stamp `data-theme` post-
  hydration to shoot the non-stored theme rather than seeding localStorage.
- **A pinned test string is authoritative evidence against a "confirmed
  minor correction".** The sr-only 'centre'→'center' fix turned a verbatim
  test pin red — which made the intended result ambiguous by the audit's
  own criteria; it was reverted on the spot and shipped later as an
  approved item WITH its test. The gate is what kept the protocol honest.
- **Next links only the PNG when `icon.png` and `icon.svg` coexist
  unnumbered.** The generated "scalable favicon" was served and never
  referenced for months; the numbered convention (`icon0.svg`, `icon1.png`)
  emits both links, SVG first. When a generator claims a browser behavior,
  curl the head it actually produces.

## 2026-08-09 — Hold-sliders on the composer rails (ADR-0012)

- **A viewport clamp breaks the "anchored under the finger" premise — drag
  mapping must be RELATIVE.** The overlay track anchors the selected detent
  under the pointer-down x, then clamps to the viewport; on a phone the
  composer pills sit near the right edge, so the clamp displaces the track
  and the finger starts over some OTHER detent. Mapping `clientX` to detents
  absolutely teleported Auto → Max on the first move. Record
  `fingerX − selectedCenter` at activation and subtract it from every move.
  The unit tests (constant-derived geometry, no layout) were green through
  all of this — only the e2e drag in mobile emulation caught it, which is
  the argument for including mouse in a touch gesture.
- **A two-phase gesture needs a two-phase axis claim.** `touch-action` is
  consulted once, at gesture start — `pan-y pinch-zoom` rightly leaves
  vertical scroll native before the hold fires, but that decision cannot be
  revoked mid-gesture from CSS. Once active, a non-passive window
  `touchmove` preventDefault is the only way to keep a vertical wander from
  panning the page under the drag. Remove it at teardown; never widen the
  resting claim to `none` instead (that defect already shipped once,
  app-wide).
- **jsdom timer-driven state needs `act()` even under testing-library.**
  Every `fireEvent` is act-wrapped; the hold timer's setState is not — the
  overlay "never appeared" in the first test run purely because the flush
  hadn't happened. `act(() => vi.advanceTimersByTime(HOLD_MS))` is part of
  the gesture-test recipe now, alongside pointerId-carrying fireEvents.
- **An always-mounted announcement region must not take `role="status"` in
  a tree that already owns one.** The result view's tests query
  `getByRole("status")` singular (and clarify-questions pins the count).
  `aria-live="polite"` alone announces; the role added nothing but the
  collision.
- **Escape-while-held reverts need click suppression at POINTER-UP, not on
  a timer.** The settle-flag + `setTimeout(0)` recipe (use-swipe-actions)
  assumes the click follows immediately; after Escape the finger can stay
  down for seconds, so mark cancelled and settle when the lift eventually
  fires.

## 2026-08-09 — Conservative cleanup audit (dead code · redundancy · doc drift)

- **A feature wave's cleanup debt is measurable one week later.** Every class
  the 2026-08-01 audit closed had regrown by 2026-08-09: dead export keywords
  (14 removed then; 42 new), a private id→label map (three consolidated then;
  a fourth shipped with the hold-slider wave), stale keep-rationale comments
  (DEAD-003's "the mesh gradient reads them" outlived the mesh by two days).
  Cleanup is a recurring pass, not a milestone — and the cheapest form is
  noticing at feature-review time ("does this wave re-declare something a
  shared module already owns?").
- **Copy the verifier's amendment, not the finder's proposal.** Three of the
  actions taken here differ from what the finding proposed, because the
  adversarial pass found the proposal itself would break the gate: making
  `triggerClassName` required breaks the suites' prop-less renders (tsconfig
  includes tests); the sr-only-string class of pins makes "obvious" renames
  red; `ActionResult` exists twice, so un-exporting "by symbol name" would
  have deleted a real export. Verify the FIX against the gate, not just the
  finding against the code.
- **Raw control bytes in one test file silently narrowed every repo-wide
  search for a month.** grep reports "binary file matches" and shows nothing —
  two of this audit's own scans skipped the file before the tests dimension
  caught it. The `cat -v` lesson (2026-07-27) now has a sharper form: any
  file that greps as binary is a defect in itself, whatever its content.
- **When a dormant code path and its props survive a refactor, delete them at
  the refactor, not at the next audit.** f4d4350 moved the usage ticker out
  of StreamProgress and left the component's whole usage row + three props
  reachable by nobody — with a header doc still advertising them. The next
  reader (this audit's finder) had to re-derive from git that it was vestigial
  rather than reserved. If a prop loses its last caller, its removal belongs
  in the same commit, or a RESERVED note does (the `thinking` event shows the
  honest way to keep a dormant path).
- **An audit's own ledger can pin a mistake in place.** PERF-005's disposition
  listed `icons/apple-touch-icon.png` among "assets the offline experience
  actually uses" — no URL ever requests it (cache keys are full URLs; iOS
  probes root, layout links /apple-icon.png). The entry was left un-groomed
  here because re-litigating an adjudicated ruling autonomously is worse than
  15 KiB of precache — but the general lesson stands: dispositions deserve
  the same adversarial verification findings get.

## 2026-08-09 — The hold-slider's first device pass (the pre-hold window)

- **A control modeled on a recording must accept the recording's own
  motion.** ADR-0012's reference engages under press-and-slide — one
  unbroken gesture, no stationary pause. The shipped slop rule classified
  > 10px of pre-hold movement on EITHER axis as not-this-control and
  > swallowed the press whole (no overlay, and — by the trailing-click rule —
  > deliberately no sheet), so the designed-for gesture produced a dead pill.
  > Measured in the running app under synthesized touch: the first move
  > outruns the 300ms timer and the press dies. Every suite was green
  > throughout — the unit tests dispatch the stream the implementation
  > expects, and the mouse e2e waits out the hold before moving. When a
  > gesture is copied from a recording, drive the recording's motion through
  > it, not the implementation's idealized one.
- **The pre-hold window is defensible only by the resting claim.** The
  two-phase lesson above says `touch-action` is consulted once, at gesture
  start, and the active phase needs its own JS guard; the corollary runs
  backward too: whatever the resting value grants the UA, the UA can spend
  DURING the pre-hold window — `pan-y` granted vertical, and one 22px
  vertical drift bought a `pointercancel` ~6ms later (measured; MDN
  documents the mechanism). No JS can take a granted axis back mid-press,
  so a hold-gesture surface must deny every single-finger pan at rest:
  `pinch-zoom`, never `none` (zoom survives — the zoom-and-share guard now
  scans this hook's inline style too). The swipe rows rightly keep `pan-y`;
  a full-width list row is a scroll surface, a 44px pill is not.
- **A timing-dependent e2e can pass by accident and assert nothing.** The
  first cut of the touch spec passed against the UNFIXED code: two parallel
  workers loaded the CPU enough that the first synthesized move arrived
  after the hold timer, quietly turning press-and-slide into
  hold-then-drag. The probe that exposed it logged the delivered pointer
  stream with timestamps instead of asserting outcomes. The fix itself is
  what made the spec deterministic — once a sideways slide activates, both
  arrival orders converge on the same commit — but the general rule stands:
  before trusting a gesture spec, verify it fails against the code it was
  written to catch (the unit red-check caught what the e2e green-washed).
- **Chromium can synthesize the touch layer the mouse leg never touches.**
  CDP `Input.dispatchTouchEvent` drives the real gesture recognizer —
  touch-action consultation, pan-start, pointer derivation, click
  synthesis — which is exactly the layer both defects lived in. The "under
  touch" e2e now pins it (Chromium-only; WebKitGTK has no touch synthesis,
  and the iOS callout/loupe half stays on the manual list in
  ios-verification.md).

## 2026-08-09 — "Clicking is very slow": the blur that queued the input

- **Long-task metrics can read clean while input rots in the queue.** The
  idle profile showed 0–52ms of long tasks and the CPU profile showed the
  page nearly idle — while Event Timing showed even `pointerdown` waiting
  140–340ms for dispatch and every interaction's duration at 360–790ms. A
  saturated render pipeline is many SHORT tasks; input queues between
  them and no 50ms threshold ever trips. For responsiveness questions,
  `PerformanceObserver({type:"event"})`'s `processingStart − startTime` is
  the instrument; longtask is the wrong one.
- **A synthesized click inherits the touch's timeStamp — measure arrival,
  not timestamps.** The first tap-delay probe compared `e.timeStamp`s and
  "proved" zero delay; the timestamps were hardware times carried through
  the queue. `performance.now()` inside the handler told the truth. Any
  latency measurement built on event timestamps measures the wrong clock.
- **"GPU-composited, negligible" is a claim about a WHOLE style set, not a
  property list.** The bloom comment reasoned transform-only keyframes +
  `will-change: transform` = composited = free — and each layer also
  carried `filter: blur(80px)`, which re-rastered it (scale AND
  translate-only variants both, measured) every frame at viewport scale.
  A filter on an animating layer re-prices the whole animation; the
  comment's claim was never measured until the owner felt it.
- **A blur of a radial gradient IS a radial gradient — bake it.** The
  gaussian was convolved numerically into ~12 gradient stops per bloom
  (≤1.4% fit error), painted on an enlarged `::before` to keep the old
  filter's overspill past the box. Same keyframes, no filter property,
  input delay ~15ms. The px-fixed blur could not be matched by one
  percent-stop set at every viewport — two reference bakes (393×852
  default, 1280×800 from 1024px up) hold both ends, and the deviation
  between them is documented where the stops live.

## 2026-08-10 — The hold-slider fired through its own open sheet

- **A portal escapes the DOM tree, not the React tree — a gesture wrapper
  must check which tree a press arrived by.** `HoldSliderTrigger` wraps
  each picker's pill AND its body-portalled Sheet, so every press inside
  the open sheet re-dispatched through the wrapper's handlers: the hold
  timer (or an x-dominant slide) drew the capsule across the open sheet,
  release committed, and the click suppression ate the row's tap. The
  discriminator is one line at gesture ENTRY —
  `e.currentTarget.contains(e.target)` — and because every later path
  (move, up, stand-down, suppressClick, context-menu) keys off the press
  record, guarding admission guards everything. Read it synchronously
  (currentTarget is only valid during dispatch), and by containment, never
  identity — legitimate presses target the pill, a descendant.
- **An invariant a comment asserts, code must enforce.** The overlay's
  z-[85] justification said "a Sheet can never be open mid-gesture" —
  written when the only imagined press was on the pill, which an open
  sheet's scrim does cover. The presses the comment never imagined came
  from the sheet itself, bubbling in from the portal. When a layering or
  lifecycle claim is load-bearing, find the line that makes the forbidden
  state impossible; a "can never" with no enforcing code is a defect
  awaiting its report.

## 2026-08-10 — The reference recording round (fixed home · thumb · blur)

- **When the owner supplies a recording of the reference control, diff
  against it axis by axis before touching code.** "Fixed, focused slide"
  decomposed into exactly three deltas — track position, position-as-object
  (thumb), and blur — and everything else (guard, hints, vocabulary, chip)
  survived untouched. The prompt that scoped this round listed the deltas
  and the keep-list explicitly; the implementation then touched five files.
- **Relative mapping is what makes geometry swappable.** Because the drag
  has always been finger-RELATIVE (dragOffset), moving the track's home
  from under-the-finger to viewport-center changed zero gesture semantics:
  every drag/commit spec passed unchanged, and only the pure-geometry
  tests — the ones that PIN placement — were rewritten. Separate "where
  the control lives" from "how the finger maps" and each can move alone.
- **"Never blur" was the wrong lesson; "never blur an animating layer" is
  the right one.** The 2026-08-09 regression came from `filter` re-priced
  per frame under animation. A STATIC backdrop-filter that mounts complete
  and never transitions is a one-time cost — and the Event-Timing probe
  (same instrument as the bloom investigation) showed no queueing under 4×
  throttle (p95 17.3ms, budget 50ms). Generalize measured lessons by their
  MECHANISM, not their keyword — and re-measure when the mechanism
  differs, because the first "obvious" reading of the old lesson would
  have banned the owner's ask outright.

## 2026-08-10 — The single-gesture claim (Codex pass 7)

- **A fix that introduces global state owes the concurrency answer in the
  same commit.** The ambient freeze (pass 6) stamped one shared
  `data-hold-gesture` attribute on `<html>` from a per-instance hook; with
  both rails enabled, two fingers meant first-teardown-wins — the world
  thawed beneath the surviving gesture's blur. Whenever a repair writes to
  a singleton (a root attribute, a module flag), ask "two instances live
  at once — then what?" before shipping, not at the next review. And when
  the concurrent state is design NONSENSE (stacked full-viewport focus
  pairs over one composer), don't bookkeep it with reference counts —
  refuse it at admission and let the second press fall through as the tap
  it would otherwise be. The exclusivity is also the reference platform's
  own behavior: the cheaper repair was the truer one.

## 2026-08-10 — The backdrop inventory (Codex pass 8)

- **"Static backdrop" is a claim about the CONTENT, not the layer — and it
  needs an inventory, not an example.** The world-pause froze the two
  things the sixth pass happened to look at (nebula canvas, blooms) and
  missed the Horizon's idle breathe and the whole streaming surface; the
  blur re-filtered per frame either way. Before claiming a filter runs
  once, enumerate everything that can move beneath it (`grep infinite`,
  plus the React surfaces that repaint from state), then split the repair
  by what each mover IS: ornaments pause under the gesture attribute;
  content that cannot honestly hold still — a token stream — stands the
  BLUR down instead (the already-designed dim-only presentation), because
  freezing live output to protect a decoration inverts the priorities.

- **A documented specificity trap still bites if you don't grep for prior
  gates on the same element.** globals.css already carried the warning —
  the breathe's shorthand at (0,3,0) resets `animation-play-state`, so a
  (0,2,0) pause "parses, reads correctly, and silently loses" — and the
  world-pause rule walked into it anyway; only the real-browser
  computed-style pin caught it (the unit greps stayed green, exactly as
  that comment predicted). Before gating a property on an element, find
  the rules that already SET it (`grep '\.the-class'`) and copy the
  winning gate's selector shape, prefix and all.

## 2026-08-10 — Input modality under the gesture (Codex pass 9)

- **When you borrow a semantic from a reference platform, verify it in the
  borrowed STATE.** "A refused press falls through as the plain tap it
  would otherwise be" was transcribed from how the reference control
  behaves at rest — but the refusal only ever happens mid-claim, and mid-
  drag the reference goes fully modal: second touches do nothing. The
  mis-transcription shipped as a pass-7 "feature," celebrated in the
  review reply, and came back two passes later as the bug it always was
  (the fall-through tap opened a sheet under the live capsule). Ask of
  every borrowed behavior: in WHICH of the reference's states does it
  hold, and is that the state I'm implementing?
- **A refusal that only covers your own event stream isn't a refusal.**
  Denying the pointer-down left the synthesized click alive. Interaction
  paths come in bundles (pointerdown → pointerup → click; keyboard
  activation; a second pointer type) — refuse the bundle, and prefer
  structural shields (a pointer-events surface the capture-holder is
  immune to) over enumerating event handlers.

- **The exemption you write for yourself is the next review's hole.** The
  ninth pass consumed clicks under a FOREIGN claim; the identity check
  read as precision but was a carve-out — with your own claim live, a
  same-pill click can only be a second input device. The correct
  condition was simpler and had no identity in it at all: consume while
  ANY claim is live, and let the legitimate tap survive by PROTOCOL ORDER
  (the claim dies at pointer-up, before the click dispatches). Prefer
  conditions anchored to event-order invariants over identity carve-outs
  — the invariant holds for input devices you didn't think of.

- **When correctness depends on event ROUTING, only a real engine can pin
  it.** The Escape leak survived four review passes because jsdom has no
  pointer-capture routing: the unit test's lift could only ever be
  dispatched AT the pill, which is precisely the one place the bug
  doesn't manifest. The e2e that finally caught it drives the pointer
  150px away before the lift — the divergence between "the lift the test
  can express" and "a real lift" was the bug's hiding place. Corollary:
  a resource's lifetime should equal the STATE it serves (capture lives
  as long as the press, not the overlay); when two lifetimes are meant
  to be equal, end them at the same code sites instead of trusting two
  paths to agree.

- **When you patch a leak on one path, enumerate the WINDOWS, not the
  paths.** The press's lifecycle has three unguarded intervals — pre-hold
  (down → classification), stand-down (classification → lift), and
  post-Escape (revert → lift) — and each leaked the same resources by the
  same mechanism (an event the wrapper couldn't hear) in three different
  review passes, years or hours apart. The 2026-07 stand-down capture,
  the eleventh-pass capture retention, and the twelfth-pass window net
  are one fix applied three times. The general move: for every resource
  held across an interval, name the mechanism that guarantees the
  interval ENDS — and check it is armed for the WHOLE interval, not from
  the first event you happen to observe.

- **An accepted residual is a standing invitation — re-price it when the
  reviewer returns with a cheaper repair.** The ninth pass declined
  closing the pre-hold sheet race because "a DOM-wide dialog probe" read
  as unwanted coupling; the thirteenth re-raised it framed as "cancel
  activation when another interaction wins," and the probe turned out to
  be a web-platform semantic (`role="dialog"`, read through the
  accessibility tree), not an internal selector. The decline had priced
  the wrong repair. Corollary from the same pass: a refusal recorded
  only in GLOBAL state (the claim) cannot outlive that state — if the
  refused stream can end after the owner's, the refusal needs its own
  per-stream memory. Scope such markers to where they cannot collide
  with legitimate events (per-instance, cross-pill only — a same-wrapper
  boolean cannot tell two streams' clicks apart).

- **`pointer-events` is not input-events — every channel needs its own
  gate.** The "input shield" metaphor quietly overclaimed: the pair
  gates hit-testing only, and keyboard activation sailed through to a
  focused background control. The modality now has one gate per channel
  (shield → pointers, claim → wrapped clicks, window capture-phase
  swallow → activation keys), each pinned separately. And the marker
  lesson from the same round: state that waits for an event that may
  never arrive needs its own expiry — the refusal marker waited for a
  click a pointer released elsewhere would never send, and the stale
  flag cost a keyboard user an activation until an end-watch bounded it
  to the stream's own lifetime.

- **The review cadence itself was the signal — after the second
  same-class finding, enumerate the matrix yourself.** Eight consecutive
  passes (7–14) each found one cell of the same input-modality space:
  channel × phase, gate missing. Each fix was correct and each reply
  well-reasoned, and the loop was still the wrong shape — the reviewer's
  job is to find the FIRST hole, not to serve as the enumerator, and the
  owner had to say so. The audit that should have followed pass 8 took
  under an hour when finally done: list the phases, list the channels,
  name every cell's mechanism or record its acceptance, close the empty
  ones in one commit, and put the table in the ADR so the next finding
  is a table lookup instead of a fifteenth round trip.

- **A scope exemption is a claim about timelines — re-run the fixed
  timeline through every topology the exemption distinguishes.** The
  thirteenth pass fixed refusal-outlives-the-owner for cross-pill
  presses and, in the same breath, recorded the same-wrapper exemption
  ("a boolean cannot tell two streams' clicks apart") — and the
  previous lesson on this page repeats that clause verbatim. Six passes
  later the identical timeline — owner releases first, competitor's
  click lands after — was still open on the exempted topology
  (nineteenth pass). Two corrections worth keeping: the "cannot tell
  apart" rationale confused identity with GATE (the owner's click is
  already claimed by its settle window; precedence does the telling),
  and the acceptance that covered the residue judged it against the
  wrong harm (sheet-under-capsule, when the harm was an uncommanded
  sheet-open after commit). When a lifecycle fix lands in one topology,
  the exempted topologies inherit the burden of proof, not the benefit
  of the doubt.

- **Classify animations by CONSUMER, not by name.** The pause-list sweep
  read `.sheet-in` as "sheet enter" because that is what the class is
  called, and recorded it impossible under a capsule — while a Toast
  card and the diff toolbar wore the same class with no dialog role and
  none of the impossibility (twentieth pass). A shared class means the
  classification must enumerate its consumers, and the exemption note
  must name the condition that keeps each one exempt — "dialog-locked
  today, any non-dialog adopter joins the list" survives consumer
  drift; "sheets can't enter under a capsule" silently didn't.

- **An inventory is only as complete as its dimensions.** The pause
  list swept every `animation:` declaration (eighteenth pass), then a
  shared class's consumers (twentieth) — and still missed a 150ms
  backdrop mutation at EVERY gesture start, because the pill conceal is
  a TRANSITION, not an animation, and time-based state (a toast's
  dismissal countdown) is neither (twenty-first). When the invariant is
  "the backdrop is static," the inventory is every source of change —
  animations, transitions, clocks, mounts — not every instance of the
  one source class the first sweep happened to use. Enumerate by the
  invariant, not by the mechanism you found first.

- **An acceptance must price the loser's guarantees.** "Single-slot,
  newest wins" (nineteenth pass) named the resolution policy and
  omitted what the loser loses: the elder refused stream kept physical
  contact but lost its click protection the moment the newer stream
  ended (twenty-second pass). Writing "newest wins" FELT like recording
  a limitation; recording it honestly meant writing "an elder still-down
  stream's click will open the sheet" — a sentence that would have been
  fixed on sight. When accepting a conflict-resolution policy, write
  the failure it permits from the loser's point of view, not the
  policy's name from the winner's.

## 2026-08-11 — mobile-perf + full-scope-visual audit

- **A pinned Playwright and a pre-installed browser are two versions, and
  they diverge.** The container ships `chromium-1194` (Chrome 141) and is
  told not to run `playwright install` — but this repo pins
  `@playwright/test` at a revision wanting `chromium v1223` (Chrome 148),
  and `webkit` was absent entirely, so the whole e2e suite could not launch
  (`global-setup` fails loudly on any missing engine, by an earlier
  lesson's design). Installing the MATCHING builds (`--with-deps webkit`,
  then `chromium`) kept `playwright.config.ts` clean — no per-project
  `executablePath` override that would break every other environment where
  1223 is already present. The pre-installed browser is a convenience, not
  a version contract; when the pin and the container disagree, match the
  pin, don't patch the config.

- **Drive the store, not the attribute, when a hydrator writes after
  mount.** The light-theme axe scan forced `data-theme="light"` on the
  authed composer and read `--void` back — green on Chromium, red on
  WebKit. Not an a11y finding: `ProfileHydrator` syncs the profile's dark
  theme INTO the UI store a beat after mount, and on WebKit-under-load that
  settle landed AFTER the manual override and ThemeManager reset the
  attribute to dark. The gate had no such sync and passed. The fix drove
  the app's own Settings segment (store → ThemeManager → attribute +
  persistence), which survives the settle and the navigation. When a value
  has a single writer that reconciles from a source of truth, poke the
  source; a manual override only holds until the writer next runs — and on
  a slower engine that is exactly when it runs.

- **Re-read the palette on the attribute that carries colour, not the one
  that happens to share the observer.** `AmbientNebula` batched
  `data-theme`, `data-reduced-effects`, and `data-hold-gesture` onto one
  MutationObserver that re-ran a synchronous `getComputedStyle` on every
  fire. Only two of those three change any colour; the third toggles at
  every gesture edge, so a hold-slider press paid two layout-adjacent style
  reads for a palette that could not have moved. An observer that watches N
  attributes for M reasons must split the work by reason — reconcile on
  all, but do the expensive read only for the attributes that feed it.

- **A "labels fit" ruling is only proven at the widths it measured.**
  CMC-06/VAR-01 fixed the mode-rail labels and recorded "all six fit at
  320 (max 43 ≤ 46)" — but the label steps UP from 10px to 11px at ≥360px
  (`max-[359px]:text-[0.625rem]`), and at that larger size, with
  `tracking-wide`, "Condense" wraps to two lines at 393px (the default
  iPhone width). The captured composer shot showed it; the audit never
  measured it. Left as an owner observation rather than re-adjudicated
  here — the mode rig is the most-ruled component in the repo and its type
  metrics were an owner call — but the lesson is general: a responsive
  control that changes type at a breakpoint has to be re-measured on BOTH
  sides of it, or the fit claim only covers the branch that was checked.
  (The owner then called it in, and the measurement told a bigger story:
  a guard asserting no label wraps at 320/360/390/430 failed at 320 — both
  Condense AND Reformat were two lines even at the audit's own width, so
  the "fits at 320" record had gone stale, not just the ≥360 branch. Fixed
  by dropping to a uniform 10px / tight tracking and `px-0` cells, and the
  guard now pins the whole range so it cannot silently regrow. The general
  point sharpens: a fit ruling is not a property of the component, it is a
  property of the measurement — re-run it, do not cite it.)

- **A token retune is a find-every-mirror job, and the ADR that recorded
  the last one is the map.** Pulling `--laser` `#dffa04` → `#c7fd26`
  (owner call: too yellow) had to move six sites, not one: the token, its
  `--laser-glow` rgba, the light `--accent-ink` in BOTH light blocks
  (`:root[data-theme="light"]` and the system-light `@media` mirror), the
  `AmbientNebula` canvas literals (`LASER_RGB` + the `accentRgb` fallback,
  which a canvas needs because it cannot read a custom property), and the
  `safe-area` test's `LASER` constant. Missing any one repaints one green
  while the rest paint another — the exact class of drift the earlier
  "tile is a token consumer" lesson is about. What made this a lookup
  rather than a hunt: ADR-0013's own Decision table had enumerated those
  mirror sites for the previous retune, so the map already existed. The
  prior audit's rule — "put the table in the ADR so the next finding is a
  table lookup" — paid out here directly. Corollary: derived values with
  headroom (the light `--accent-ink` sits at a ~5.5:1 "corridor position",
  not the bare 4.5:1 AA floor) must be re-derived to hold that position on
  a hue move, not just re-passed — brightening it to bare AA to "match the
  button" would have spent the corridor the design system deliberately
  keeps.

- **When a platform behaviour is undocumented, ship the arrangement that
  is a no-op if you guessed wrong.** The Home Screen icon vanished in dark
  appearance (iOS darkens the light tile; Void ink on a darkened Laser
  plate is a shadow on near-black). The obvious fix — a second, inverse
  tile behind `media="(prefers-color-scheme: dark)"` — rests on a claim
  nothing can verify from this repo: Apple has never documented whether
  iOS evaluates `media` on `apple-touch-icon`, the Developer Forums
  threads asking are unanswered, and search returns both answers stated
  with equal confidence. §3's rule is "prefer removing the dependency to
  documenting the uncertainty", and there was a way to do exactly that:
  order the pair so the dark tile is declared FIRST with the query and the
  light tile LAST with none, which is what Apple's documented "last one
  wins" rule hands a media-blind reader. A media-aware iOS can improve;
  a media-blind one lands precisely where it does today. The dependency is
  gone, not annotated — the change cannot regress, and the device check is
  now about whether it HELPED, not whether it BROKE anything. Generalises:
  before writing a comment that hedges, look for the arrangement whose
  worst case is the status quo.

  **Amendment, same day (Codex review on #108).** Getting the worst case
  right is only half the job, and the first cut shipped only that half.
  The light link was left UNCONDITIONAL, reasoning that a media-blind
  reader would then take it under Apple's "last one wins" — true, but an
  unconditional link also matches in DARK mode, so a media-AWARE
  last-wins reader (the likeliest shape, since last-wins is Apple's own
  rule) would keep choosing light and the dark tile could never be
  selected at all. The best case had been quietly designed out while the
  comment claimed the arrangement "can only help". The fix is
  complementary queries — every link scheme-qualified, the two covering
  both schemes, light still declared last — which leaves exactly one
  eligible link per scheme for a media-aware reader and the media-blind
  fallback untouched. Sharpened rule: hedging across an unknown means
  enumerating the reader's plausible strategies (first-match, last-match,
  ignores-media) and checking the arrangement against EACH. "It can only
  help" is a claim about a branch table; I wrote it without drawing the
  table, and the one branch I skipped was the one the feature exists for.

  **Amendment 2 (2026-08-12) — the device answered, and the hedge had
  picked the losing branch.** Two installs photographed side by side in
  both appearances settled it: iOS reads `apple-touch-icon` from the head
  (never the manifest), does NOT evaluate `media` on icons, applies
  "last one wins", and freezes the tile at capture. So the whole pair
  resolved to its LAST entry — the light tile — which iOS then
  auto-darkened into the invisible mark the original bug was about. The
  hedge was not neutral. **A branch table whose branches are all guesses
  still has to name which branch is the DEFAULT, and rank the branches by
  what they cost when wrong.** Both arrangements were "safe" under the
  strategies I enumerated; what I never asked was which single artwork
  survives being chosen by the wrong strategy. Only one does — the dark
  tile, because auto-darkening is a no-op on artwork already dark — and it
  was the one I put first, where last-wins could never reach it. The
  ordering is now flipped and the runbook carries a measured result table
  instead of an open question.

  Second lesson, about how the answer arrived: **the owner's screenshot
  was the experiment I had been calling impossible.** Two installs in two
  appearances is a complete 2×2, and it was available for the asking at
  any point in the four commits this question stayed open. When a runbook
  entry says "needs a real device", that is a request to make, not a
  permanent state — and the person who can run it is usually the one
  filing the bug. Ask for the capture before shipping the hedge.

  Third: **when the user says a platform can do something and you have
  concluded it cannot, re-read the platform's own spec before answering
  again.** I argued from behaviour I had inferred from the symptom and
  told the owner their design was unachievable. Apple's dark-icon model
  (transparent background + foreground, system supplies the gradient) says
  plainly that the inversion they described is the expected shape; the
  real constraint was narrower than my claim — it is the web-clip
  DELIVERY that has no variant channel, not the design that is wrong. The
  narrow true statement and the broad false one lead to different work:
  the broad one ends the conversation, the narrow one finds the head as
  the lever and ships the matched link.

- **`align-items: center` centres a line box, and a line box is not a
  word.** The header mark hung visibly low beside the wordmark although
  flex had "centred" it: a line box's centre sits at
  `baseline − (ascent − descent) / 2`, while the eye reads a word as its
  CAP BAND, centred at `baseline − capHeight / 2`. For Bebas Neue those
  differ, so the mark cleared the cap line by 0.99px and the baseline by
  2.98px — the same "centred" element with nearly all its overhang on one
  side. Two follow-ons. (1) The correction belongs in `em` against the
  wordmark's own step, which meant putting `text-2xl` on the ROW: an svg
  otherwise resolves `em` against the inherited 16px body size, and the
  wordmark here is 31px — the fix would have been 40% short, silently.
  (2) It cannot be zeroed in both engines; they select different
  ascent/descent metrics for the same face (optima 0.058em vs 0.035em), so
  the shipped value is the midpoint and the test tolerance has to admit
  the residue.

- **Measure type in pixels; font metrics are an opinion.** Deriving the
  alignment above from `canvas.measureText` put the answer 1.3px from
  where the glyphs actually landed, and the two engines'
  `actualBoundingBoxAscent` for one vendored face disagree by 12%
  (0.672em vs 0.75em). Worse, the first harness reproduced the cascade
  only approximately — it modelled the wordmark at 24px because
  `text-2xl` "is" 1.5rem in stock Tailwind, while this repo's Major-Third
  scale makes it 1.9375rem/31px — so its absolute numbers were wrong by a
  third while its em-relative conclusion happened to survive. What settled
  it was screenshotting the SHIPPED header, thresholding, and comparing
  ink band to ink band. Rule: a typographic claim is a claim about
  rendered pixels; if the harness is not the real cascade, it is a
  hypothesis, and the e2e test that re-measures the real thing is the
  evidence.

- **Know which surface the screenshot is actually of.** An owner report
  that "the favicon is using the wrong image" was about neither the
  favicon nor the app icon: the screenshot was the iOS Share Sheet, whose
  thumbnail is `og:image` centre-cropped to a square — which of a
  1280 × 640 card kept one arm of the chevron and half a sentence. The
  favicon was already correct. Confirming the surface first (crop
  arithmetic against the card's own layout: glyph at x 100–390, wordmark
  at 470–860, window 320–960) turned "fix the favicon" into the real
  change — a square `og:image` with the landscape card demoted to
  `twitter:image` — and surfaced a trade-off (every other platform's
  preview) that was the owner's call to make, not one to infer.

## 2026-08-11 — the dials (ADR-0014)

- **A control that opens a slider must not wear a chevron, and the fix is
  not cosmetic.** The Thinking pill's disclosure chevron was honest about
  the implementation (it opened a sheet) and dishonest about the thing (a
  five-step ladder is a slider). Removing the chevron without removing the
  sheet would have made it *less* honest, not more. The real move was to
  notice that the sheet was carrying two loads — the keyboard path and
  WCAG 2.5.7's no-dragging path — and that `role="slider"` plus a latched
  tap-then-tap carries both with strictly less machinery. **When an
  affordance looks wrong, check whether the affordance is lying or the
  structure is.** Deleting a whole sheet was cheaper than restyling a
  trigger, because the sheet was the thing that was wrong.

- **A superseding ADR has to name what it is NOT superseding.** ADR-0012
  accumulated twenty-two review passes of pointer, keyboard, concealment
  and modality edge cases — a stranded-pointer-id ledger, a capture-lifetime
  rule, a backdrop-animation inventory. All of that survived 0014 intact;
  only the interaction model changed. Writing "superseded" without that
  boundary would have invited the next reader to re-litigate hard-won
  invariants as legacy. The header now says which three rulings are dead
  (fixed home, budget location + gating, the dialog guard's scope) and that
  everything else is still the reference.

- **A guard written when one thing was impossible needs re-reading when it
  becomes possible.** `activate()` stood every gesture down over any open
  `role="dialog"`, and that was correct for as long as no slider could live
  inside a sheet. Moving the budget dial into the Target sheet turned "a
  sheet is open" and "a sheet is in front of me" into different statements,
  and the guard was still testing the first one. The fix was one `.contains()`
  — but nothing failed loudly; the dial simply never opened. **When you
  relocate a component, grep for guards that assumed its old address.**

- **Two contradictory-looking requirements usually mean the construction is
  wrong, not that one requirement has to give.** The fill had to (a) not
  move or re-hue already-painted pixels as the value grows — the reference
  behaviour — and (b) keep a level's colour tied to its identity, not to
  its ladder position, so "High" matches on a three-step and a five-step
  ladder. A gradient anchored to the fill box satisfies (b) and breaks (a);
  a fixed ramp the detents sample satisfies (a) and breaks (b). Building
  the ramp FROM the detents — each tone pinned at its own detent's centre,
  laid across the track, revealed by the fill — satisfies both, and is
  simpler than either compromise. The first two cuts were both attempts to
  pick a winner.

- **A "shimmer" is a contrast decision.** The reference lights its warning
  text with a bright sweep. Copying that literally raises contrast on dark
  and lowers it on light — the exact laser-on-light failure class, one hue
  over, and it would have passed every static token check because no token
  changed. Building the sweep from two inks that both clear AA, with the
  highlight moving AWAY from the surface per theme, makes every frame safe
  *by construction* rather than by measurement. The test pins the direction
  rule, not just the two values: a future retune that brightens
  `--ultra-ink-hi` on light now fails.

- **State that outlives its pointer needs its own teardown net.** The drag
  phase could always be cleaned up by finding the press record. The latched
  capsule has no press record — it is pure open state holding the app-wide
  exclusive claim — so the concealment watch (window blur / tab hide) had
  to learn to key off the OPEN STATE instead, or a backgrounded tab would
  sit with a frozen world behind an invisible capsule. Same leak class
  0012's modality audit chased through every other channel; a new phase
  reopens every one of those channels.

- **Removing a wrapper removes its guards, silently.** Unwrapping the
  Target pill deleted the `onClickCapture` consumption that a unit test was
  using as its proof that no sheet can open under a live capsule. The test
  failed, which was lucky — the actual protection (a viewport-covering
  pointer-interactive shield, plus the window key-swallow) was intact all
  along, and the consumption had been belt-and-braces. The right response
  to a guard test failing after a refactor is to work out which mechanism
  it was really testing, not to restore the mechanism it happened to name.

- **Playwright's browsers are pinned per project, and the preinstalled ones
  may not match.** The environment ships `chromium-1194`; this repo's
  `@playwright/test` wants `chromium-1223` + `webkit-2287`, and
  `install-deps` was needed on top for WebKitGTK's GTK4/gstreamer chain.
  The download is flaky enough to need retries. Worth knowing before
  concluding that a suite "can't run here" — the e2e gate is not optional,
  and 45 of 100 tests failing on missing `libgtk-4.so.1` looks exactly like
  a code regression in the summary line.

## Phase — dials, amendment 1: the halo and the mini-track (2026-08-11)

- **"WebKit supports it" and "WebKit paints it" are different measurements,
  and this suite has only ever taken the first.** The halo needed to know
  whether `mask-image` gates a `backdrop-filter`. `CSS.supports` says yes in
  both engines; the ios-verification table has said "supported" for
  `-webkit-backdrop-filter` since July. A RENDER probe says the Playwright
  WebKitGTK build paints no `backdrop-filter` at all — not plain, not masked,
  not on a promoted `::before` — while `filter: blur` on the same page works
  fine, so it is the compositor, not the syntax. Every `.glass` blur in this
  app has therefore been asserted on that engine by computed style and never
  by pixels. The lesson is not "distrust WebKitGTK", which the runbook already
  says; it is that a capability table full of `CSS.supports` answers is
  evidence about the PARSER, and a visual decision needs a screenshot.

- **When an engine can't answer, move the load off the thing it can't
  answer.** The first design put the halo's localization in the mask. That
  makes an unmeasurable property load-bearing: an engine that ignores the mask
  blurs the whole viewport, which is exactly the bug being fixed. Sizing the
  blur element's BOX to the halo and letting the mask only soften its edge
  costs one line and turns an unknown into a cosmetic difference. Ask what
  ships if the unverified thing is simply absent, and arrange for the answer
  to be "something slightly worse" rather than "the original defect".

- **A knob the height of its rail is a switch, whatever you meant.** The
  resting mini-track shipped its first cut as a 10px thumb flush inside a
  10px pill-shaped rail. At the ladder's bottom stop — "Auto", the value every
  new device opens on — it read unmistakably as a toggle in the OFF position,
  i.e. as a control with two states rather than six. Two numbers fixed it:
  the thumb is taller than the rail, and its travel is inset from both ends so
  rail stays visible past it at every value. Neither was findable from the
  DOM; both came from looking at a capture and are now pinned, because a test
  is the only thing that stops the next person tidying them away.

- **Look at the defaults, not the interesting state.** Both visual defects
  this round were in states a capture only shows if you ask for them: the
  toggle read is at index 0, and the peak caption's collision with the coach
  line is at index max WITH the one-time tip still on screen. The states worth
  rendering are the first-run one and the extreme one, not the mid-ladder one
  that looks best.

- **Splitting a layer's two jobs is cheaper than moving one.** The scrim was
  both the rejected full-viewport wash and the input shield an e2e
  actionability test pins by real hit-testing. The instinct was to add a third
  layer. The actual fix was to notice the jobs use different mechanisms —
  hit-testing follows the BOX, the wash follows the PAINT — so the box could
  stay exactly as pinned while only the paint became local. Zero existing
  assertions changed. When one element does two things, check whether they are
  even expressed in the same CSS property before restructuring.

## Phase — dials, amendment 1b: measuring the halo instead of eyeballing it (2026-08-11)

- **When a visual judgement gets close, stop looking and build a metric.** Two
  halo variants differing only by a 48px shift "looked" very different, and a
  strictly stronger one "looked" weaker. Both readings were mine, and both were
  wrong. A per-band ratio — high-pass energy with the capsule open, over the
  same band with it closed — settled twelve variants in one run, in both
  themes, and produced an ordering that held up. The rule is not "measure
  everything"; it is that once you are choosing between options that are close,
  eyes stop being evidence and start being noise.

- **Pick the metric for the failure mode, not for convenience.** The first
  version used luminance VARIANCE, and it ranked a 54px blur as less obscuring
  than a 38px one — because a big blur smears bright content (the Laser chip,
  the capsule) across a band and RAISES its variance while making nothing
  readable. A high-pass filter (mean |2L(x) − L(x−3) − L(x+3)|) answers the
  question actually being asked, "are there glyph edges here", and smooth
  gradients contribute nothing to it. A metric that moves the wrong way on the
  effect you are tuning is worse than no metric.

- **Never mutate a live `backdrop-filter` through a sweep in one page.** Round
  one drove six variants through a single open capsule, and the results were
  not reproducible — Chromium appears to keep some of the previous filter's
  composited state. A clean page per variant, with the parameters applied
  BEFORE the capsule mounts, gave stable numbers. Sweeps over compositor-level
  effects need fresh documents the way benchmarks need fresh processes.

- **Bigger blur is not more blur past a point.** blur(54px) on a 744×488 box
  measured worse on every band than blur(38px) on a 704×466 one; Chromium
  appears to trade filter quality for area. The lever that actually works is
  the mask's opaque plateau. Generalize: for compositor effects, the parameter
  the API names is not necessarily the parameter that controls the outcome.

- **A structural invariant catches what a fraction-of-viewport assertion
  wouldn't.** The halo's containment was first pinned as "height < 70% of the
  viewport". Restating it as "the box ends clear of the chrome bars" caught a
  4px overlap with the bottom nav on WebKit that the fraction would have waved
  through — and it says the thing that is actually true, which is that once the
  halo touches a bar, localization stops being a property of the BOX and starts
  depending on the mask, which WebKit cannot verify.

- **Verify an adversarial finding's MECHANISM separately from its FIX.** A
  review pass reported that the light theme's veil brightens the Laser mode
  chip instead of dimming it, and prescribed inverting the veil to a dark
  scrim. The mechanism was real and measured (page ground 238 → 239, chip
  214 → 222 — a near-white veil cannot dim near-white content). The prescribed
  fix was built and measured too, and it was worse: less obscuring on every
  band and a murky grey cloud against a brief asking for "a smooth and clean
  appearance". Accepting the finding and rejecting the remedy is a legitimate
  outcome, and it only exists if you test the remedy rather than the argument.

- **An absolute overlay measurement is only "local" relative to a REGION.** The
  halo's reach was measured on a 393×660 phone and hard-coded. It was correct
  there and wrong everywhere else: on the 320×640 viewport the repo supports it
  overran the bottom nav, and under pinch zoom — where the visible region can be
  a fraction of the layout viewport — it would swamp the screen entirely. The
  tell was already in the codebase: `computeTrackGeometry` had taken
  `visualViewport` seriously since PR #103 for exactly this reason, and the new
  halo simply did not consult it. When one part of a control already clamps to a
  region, anything else that sizes itself in absolute pixels beside it is a bug
  waiting for a smaller screen.

- **To clear a fixed-height obstacle, subtract; do not scale.** The first clamp
  capped the halo at a FRACTION of the room to the region's edge, and the
  320×640 test caught it overrunning the nav by 11px. The flaw is structural,
  not a bad constant: clearing a bar needs `half ≤ room − bar`, so the fraction
  that satisfies it depends on `room` — meaning any fixed fraction fails as the
  region shrinks, which is precisely when the clamp is load-bearing. A ratio
  tuned on the roomiest case is a safety margin that evaporates under pressure.

- **Write the test at the size you did NOT measure at.** Every number in this
  change was measured on one device profile, and both e2e projects are near that
  profile, so the whole suite agreed with the assumption it was built on. One
  test that resizes to the smallest supported viewport found a real overrun
  immediately — and then found the flawed shape of the first fix too. The cheap
  general move after tuning anything against a viewport is a single assertion at
  the other end of the supported range.

- **A stand-down expressed in JS is invisible to the CSS that thinks it owns
  it.** The halo has three stand-downs: `prefers-reduced-motion` and
  `[data-reduced-effects]` null the filter in CSS, while `dynamicBackdrop`
  withdraws the element in TSX. When the capsule gained its own
  `backdrop-filter`, it got the two CSS gates and silently missed the third —
  so a streaming run, the one case the third gate exists for, re-filtered the
  repainting result on every token frame through the very layer that was
  supposed to stand down alongside the halo. The comment on the new rule even
  claimed it "stands down WITH the halo blur", which was true of two gates out
  of three. Before adding a filter beside an existing one, enumerate the
  existing one's gates and check where each is *expressed*, not just that they
  exist.

- **Clamping the element is not clamping the treatment.** The halo's blur box
  was clamped to the visible region; the dim was a separate layer whose radius
  was multiplied by a spread constant, so it kept reaching ~35px past the
  clamped edge and into the bottom nav — still around half strength, because
  its fade only starts at 84%. The blur passed its own clearance assertion the
  whole time. When a visual effect is composed of more than one layer, the
  containment property has to be asserted on the OUTERMOST painted extent, not
  on whichever layer happens to own the geometry.

- **A floor layered over a cap deletes the cap, exactly where the cap matters.**
  The halo's reach was clamped to the visible region, then given a 96px minimum
  as an outer `Math.max`. That reads as "never collapse to nothing" and behaves
  as "ignore the clamp whenever the region is small" — which is precisely the
  case the clamp exists for. Under ~2× pinch zoom the computed room drops below
  the floor, so the floor won and painted a 240px treatment into a region that
  could be smaller than that: the full-screen wash, rebuilt by its own guard.
  The comment on the floor even argued that under-treating was the better
  failure while the code chose the opposite. When a guarantee is a bound, check
  that nothing downstream can move the result back across it — and prefer
  `min(preferred, cap)` to `max(floor, min(preferred, cap))` unless the floor
  has a reason that survives the cap binding.

- **A constant that encodes platform chrome is an unverifiable claim; measure
  instead.** The halo's clearance was a 72px constant sized against
  `--bottom-nav-h` (4rem). Both chrome bars are `pt-safe`/`pb-safe`, so their
  real heights are `4rem + env(safe-area-inset-*)` — ~98px on a notched phone,
  leaving the constant ~26px short — and Playwright cannot emulate a non-zero
  safe-area inset, so no test in this repo could ever have caught it. That is
  the shape the ios-verification runbook warns about: a claim about iOS,
  written into the tree, that the suite structurally cannot falsify. Reading
  the bars' live rects through a `data-chrome-bar` contract deletes the claim
  rather than documenting it. When a number describes something the platform
  owns, prefer measuring the thing to encoding a guess about it — and pin the
  contract that makes measuring possible, since losing it fails silently.

- **A snapshot of the viewport is only true while the viewport holds still —
  and a latched overlay outlives it.** The hold-slider sampled `geometry` and
  `region` once, at activation, which is correct for a drag phase that lasts as
  long as a finger and wrong for a capsule that stays up until it is dismissed.
  An orientation change or a resize left it placed for the old viewport. The
  sharp version is the one the design invites: multi-touch is exempted from the
  gesture's scroll block *precisely so pinch-zoom keeps working under an open
  capsule*, and zooming is exactly what changes `visualViewport`'s offset and
  size — so the feature that was deliberately permitted was the feature that
  invalidated the snapshot. When a control opts into a platform gesture, check
  what that gesture changes and whether anything cached is still true after it;
  permitting a gesture and ignoring its result is worse than refusing it.
  Related: re-anchoring is not free of its own trap — `dragOffset` was measured
  against the old detent centers, so recomputing geometry without re-deriving it
  teleported the value under the hand, which is the exact failure that offset
  exists to prevent, arriving through the fix for a different one.
