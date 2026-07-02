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
  does. Verify asset presence *before* planning; wire the real tokens, and gate the
  missing monograms behind `BRAND_MONOGRAMS_READY` so the footer ships with a
  typographic fallback and flips to the real files with no code change.
- **The contrast-law guardrail (§6) overrides literal brand wording.** "IO in
  `--laser`" fails on light (laser-on-light = 1.09:1). Resolved with theme-aware
  *ink* tokens: `--accent-ink` (laser→deep green on light) and a light-only
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
  artwork *into those existing files* (rather than renaming to the uploaded
  `vizion-icon.svg`/`vizion-glyph.svg`) means `generate-icons.mjs`, `ScreenHeader`,
  and `AuthHero` keep working with zero ref churn — one `npm run generate:icons`
  re-derives all 32 outputs. The root-level uploads were just the delivery vehicle;
  delete them so the single source of truth stays in `public/brand/`.
- **A non-square glyph breaks fixed square sizing.** The new glyph is 1872×1084, not
  the old 1024² square. `next/image` with `width={150} height={150}` would distort
  it — size by one axis (`w-[260px] h-auto`) to preserve aspect. The generator's
  `fit: "contain"` already handles the square PNG matrix (it letterboxes), so only
  the hand-placed hero needed the fix.
- **Aspect-correct ≠ balanced — re-check rendered scale after an art swap.** The new
  mark fills its viewBox far more tightly than the old 1024² square (almost no
  internal padding), so matching the *old* visual height (≈150px tall → 260px wide
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
  *bottom* corners (`border-bottom-{left,right}-radius: 20px`) and cast the shadow
  *downward* (`0 8px 28px`) — the vertical mirror of the bottom nav's top-rounded,
  upward-shadow treatment — so both bars read as the same floating frosted sheet.

## Footer/fixed-nav clearance — tie the reserve to the nav, don't guess it

- **A fixed bottom nav over an in-flow footer needs the scroll region to reserve
  *exactly* the nav's height — a hardcoded guess rots.** The footer collided with the
  nav (monograms trapped behind it, copyright spilling below) because the reserved
  bottom padding was a literal `80px` while the nav's true height was
  `min-h-[56px]` + `py-2` + `pb-safe` — a different number that grows with the
  home-indicator inset. Once the real nav exceeds the guess, the footer slips under.
- **Fix: one CSS variable drives both sides.** `--bottom-nav-h` sets the nav's tap
  height *and* feeds the scroll reserve
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
  their point. Lesson: a shared prompt suffix applied to *all* modes will fight the
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
  purely in the prompt contract. Debug the *contract text* before the plumbing.
- **State the output contract explicitly, for every mode.** A shared
  `OUTPUT_CONTRACT` now pins what the `output` field IS (the single paste-ready
  prompt in the author's voice; no role labels, no persona specs, no quoting the
  input as a message to answer). Conventions describe *structure inside the one
  prompt*; anything that reads as "produce multiple roles" gets rewritten. The
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
  deliberately been made a *secondary* pill to keep the Laser fill unique to
  ENHANCE — but the owner asked again for it "in the style of the submit
  button", so it now mirrors `btn-laser` exactly. When a style guardrail
  (§6 forbids Laser *text on light*, not a second Laser fill) doesn't actually
  block the request, follow the request; note the supersession in the changelog.
- **Put quick actions where the eyes are.** Copy lived only in the action row
  below the fold of the result; the fix is an icon on the output card header
  itself. Reuse the existing handler/state so the two affordances confirm in
  sync; keep the 44px tap target without inflating a text-height header row via
  negative margins.
