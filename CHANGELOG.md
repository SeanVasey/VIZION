# Changelog

All notable changes to VIZ(IO)N are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — developer marks on the model roster

- **Every target model now shows its developer's mark** — monochrome SVGs
  sourced from thesvg.org (open source) and optimized with SVGO, drawn with
  `currentColor` in the theme-aware accent ink (Laser in dark, deep green in
  light, AA in both). The mark appears on the Enhance target picker and the
  Profile default-model picker (left edge of the select), on the Library
  model-filter chips, and beside the usage readout on each result.

### Added — multi-photo queue, integrated into the composer column

- **Attach several files at once** — each gets its own card (thumbnail, name,
  size) with a staged Laser progress bar ("Uploading… / Analyzing with
  {model}…"), then its visual description, usage chip, and Insert/Copy
  actions. Files process sequentially (kinder to the rate limiter, cost cap,
  and mobile radio); the 50 MB quota is enforced across the whole selection
  before anything uploads.
- **The media studio now reads as part of the composer column** — the hard
  hairline divider is gone, a hint line ties it to the prompt box above, and
  the attach control is a dashed glass tile. The generation studio (engine
  chips · base prompt · save) tracks the most recently analyzed reference.

### Added — photo analysis by the selected model, with a description box

- **Media analysis now runs on the model selected in the composer** (all six
  targets, dispatched per provider) instead of always Opus, and the model
  returns a required prose **visual description** alongside the detected
  attributes. A new "Visual description" content box shows it with a
  per-analysis usage quick view (developer mark, model, tokens in→out, cost —
  the media route now returns usage to the client and logs the actual target).
- **"Insert into prompt"** drops the description straight into the prompt box
  above (appended after a blank line when a draft exists) and confirms with a
  ✓ state; Copy remains for external use. If the selected model can't analyze
  images, the on-device fallback degrades gracefully with a note.

### Added — live streaming enhancement

- **Enhanced text now streams token-by-token into the result surface** — the
  `/api/enhance` route returns a Server-Sent-Events stream (status ladder →
  deltas → usage → done) instead of one buffered JSON blob, while the
  `{output, rationale}` model contract and every auth/rate/cost gate stay
  exactly as they were (gate failures remain plain JSON with real statuses).
- **A Laser progress bar with the current processing step** (Queued → Reaching
  the model… → Generating… → Building the diff…) and a **live usage quick
  view** (tokens in→out and running cost, authoritative from each provider's
  stream usage reporting) sits above the streaming output. Honors
  `prefers-reduced-motion` with a static pulse.
- **RESET now cancels an in-flight run** (the stream aborts server-side and
  whatever usage accrued still reaches the cost ledger — even on disconnect).

### Added — Mistral Large 3 target

- **The roster grows to six with Mistral Large 3** (Mistral's current flagship,
  `mistral-large-latest`, $2/$6 per MTok defaults — both env-overridable via
  `MODEL_MISTRAL` / `PRICE_MISTRAL_*`). Mistral's API is OpenAI-compatible, so
  the adapter mirrors the Grok pattern with no new dependency.
- **Deploy notes:** apply the `add_mistral_large_3` enum migration *before*
  deploying (safe direction — old code never writes the value), and add
  `MISTRAL_API_KEY` to the Vercel project env; until set, the target returns
  503 "not configured" while the other five keep working.

### Changed — roster ordered by developer

- **Models are grouped by developer, best model first within each group**:
  Anthropic (Fable 5, Opus 4.8) and OpenAI (GPT-5.6 Sol) always lead, then the
  remaining developers alphabetically — Google (Gemini 3.5 Thinking), xAI
  (Grok 4.5). The order is locked by a unit test against `DEVELOPER_ORDER`.

### Added — guidance strip + mode help pill

- **A two-line guidance strip now sits directly below the header** on the
  Enhance screen, explaining what the app does and pointing at the six modes.
- **Hovering, focusing, or tapping a mode shows a help pill** under the mode
  rig — one shared `role="tooltip"` glass pill whose caret tracks the described
  cell; it hides on leave/blur/Escape (and auto-hides after a beat on tap).
  The previously unused `MODE_BLURB` copy was rewritten in plain language and
  wired to the pill via `aria-describedby`.

### Changed — five target models

- **The roster grows from three to five:** Opus 4.8 · **GPT-5.6 Sol** (renamed
  from GPT-5.5) · **Fable 5** (new, Anthropic) · **Gemini 3.5 Thinking**
  (renamed from Gemini Pro 3.1) · **Grok 4.5** (new — xAI, a new provider).
  The `model_target` enum migration renames values in place, so existing
  library entries relabel automatically; stale localStorage IDs migrate on
  first load.
- **Deploy note:** the Grok 4.5 target needs `XAI_API_KEY` in the Vercel
  project env; until set it returns 503 "not configured" while the other four
  targets keep working.

## [0.2.1] - 2026-07-02

### Added — one-tap copy on the Enhanced output card

- **A copy icon now sits directly on the "Enhanced" card header**, next to the
  change count, so the enhanced prompt can be copied the moment it renders —
  no scrolling to the action row. It's a 44px tap target that flips to a Laser
  check while the copy is confirmed, and it shares the confirmation state with
  the action-row **Copy** button (which remains for discoverability).

### Changed — Reset now mirrors the ENHANCE button

- **The composer's reset control is now styled identically to the submit
  button** — the same Laser-fill pill, height, and typography as **► ENHANCE**
  (`↺ RESET`), per product direction. This supersedes the interim icon-only
  circle and the secondary surface-fill pill it briefly became.

### Added — versioning is now released, tagged, and automated

- **The changelog is now actually versioned.** Everything previously piled under
  `[Unreleased]` has been cut into real releases (`0.1.0`, `0.2.0`, and this
  `0.2.1`) with dates and compare links, matching the `package.json` bumps that
  shipped them.
- **New Release workflow** (`.github/workflows/release.yml`): on every push to
  `main` that changes `package.json`, it reads the version and — if the
  `v<version>` tag doesn't exist yet — creates the tag and publishes a GitHub
  Release whose notes are extracted from this changelog's matching section.
- **Versioning runbook** (`docs/runbooks/release.md`): the semver policy, the
  single-source version wiring (`package.json` → `NEXT_PUBLIC_APP_VERSION` →
  UI pills/footer), and the release checklist (bump + changelog cut in one PR;
  the workflow tags and publishes on merge).

### Fixed — enhanced output no longer renders as a role-scripted system prompt

- **The `output` field is now contractually the prompt itself.** For the
  restructuring modes (Expand / Condense / Reformat / Target), the target idioms in
  `buildSystemPrompt` — "explicit system/user separation" (Opus), "developer/system/
  user role framing" (GPT) — read as an instruction to *script roles*, so the model
  returned a role-labelled system prompt (`System: … / User message to respond to:
  "…" / Task: …`) instead of an improved version of the user's prompt. Every mode ×
  target now carries an explicit `OUTPUT_CONTRACT` (the output is the single,
  paste-ready message in the author's voice — never role labels, never a persona
  spec, never the input quoted as a message to answer), and the target conventions
  were reworded to keep their structural idioms (XML sections, output-format specs)
  without the role-framing triggers. Unit-tested across all six modes and all three
  targets.

## [0.2.0] - 2026-07-01

### Changed — docs, release version, and a real README preview

- **App version bumped to `0.2.0`.** Surfaced automatically wherever the build injects
  `NEXT_PUBLIC_APP_VERSION` (`pkg.version` in `next.config.ts`) — the sign-in gate's
  version pill and the footer now read `v0.2.0`.
- **README hero is now a real capture, not a placeholder.** Replaced the placeholder SVG
  with `docs/preview.png` — a production-build screenshot of the shipped sign-in gate
  (aperture glyph, wordmark, VASEY/AI + version pills, the three Supabase auth methods,
  branded footer) — and removed the now-unused `docs/hero-placeholder.svg`.
- **README + docs reflect six modes.** Updated the mode list, the "six enhancement
  modes" copy, and the v0.3 status row (`5 modes` → `6 modes`); added a **Modes** section
  to `docs/runbooks/providers.md` documenting all six and the `SHAPE_PRESERVING`
  (Clarify / Polish) format-preservation behavior.

### Added — Polish mode (corrections-only enhancement)

- **New sixth enhancement mode, `polish`.** It keeps the input as close to the original
  as possible while fixing spelling, grammar, and punctuation and making only the
  smallest wording / word-order changes needed for the prompt to read clearly. It never
  adds, removes, reorders, or elaborates on ideas, and never restructures prose into
  lists or sections. Sits next to Clarify in the mode rig (now six equal cells).
- **DB:** requires the `polish` value on the `enhance_mode` enum — see
  `supabase/migrations/20260701000000_add_polish_enhance_mode.sql`. Apply before deploy.

### Fixed — Clarify no longer reshapes prose into bullet lists / markdown

- **Shape-preserving modes now keep the author's format.** `buildSystemPrompt` was
  injecting the target engine's structural idioms (Opus → XML-tagged sections, GPT →
  JSON / structured-output, Gemini → multimodal "parts") for *every* mode. For Clarify
  — whose job is to sharpen intent, not restructure — this pushed the model to rebuild a
  plain prose prompt into headings and bullet points. Clarify and Polish now receive an
  explicit format-preservation directive instead of the target idioms, so prose stays
  prose unless the input was already structured.

### Fixed — footer no longer collides with the fixed bottom nav

- **Footer is now guaranteed to clear the bottom nav.** The branded footer lives in
  normal scroll flow at the end of each page while the nav is `position: fixed` at the
  viewport bottom, so the nav floated *over* the footer — trapping the VM / V·AI
  monograms behind it and pushing the copyright lines out below it. Prior patches
  reserved a hardcoded `80px` of bottom padding that wasn't tied to the nav's real
  rendered height (`min-h-[56px]` + `py-2` + `pb-safe`), so the reserve could
  under-shoot the nav and let the footer slip under it.
- **Single source of truth for the nav height.** Introduced `--bottom-nav-h` (`4rem`,
  == 64px at the default root size, in rem so the bar scales with the user's font
  setting alongside its rem-sized icons and labels). The nav sizes its tap targets to
  it (`min-h-[var(--bottom-nav-h)]`) and the scroll region reserves
  `calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 1.5rem)`, so the reserved
  clearance always tracks the nav by construction — the two can never drift out of
  sync the way the fixed guess could.
- **Reservation is scoped to where the nav actually renders.** A shared
  `showsBottomNav(pathname)` predicate now drives both the nav's visibility and the
  scroll reservation, so the auth gate / onboarding screens (which hide the nav) no
  longer strand ~64px of empty space beneath the footer.

### Changed — nav chrome & glyph balance

- **Top header now reads as a floating sheet.** `.glass-chrome` drops its hairline
  border and sharp corners in favour of softly rounded *bottom* corners (20px) and a
  gentle downward shadow — the vertical mirror of the bottom nav, so both bars share
  the same borderless frosted-glass treatment instead of the header showing a bright
  contrasting edge.
- **Hero glyph rescaled for balance.** The refreshed mark fills its viewBox far more
  tightly than the old square art, so the sign-in hero glyph rendered oversized at
  `w-[260px]`. Reduced to `w-[176px]` (native aspect preserved) so it sits in
  proportion with the wordmark and the rest of the page.

### Changed — refreshed app icon & glyph

- **New master brand artwork.** Replaced both source SVGs in `public/brand/` with
  improved designs: `vizion-icon-token.svg` is now a glossy black squircle with a
  lime-green glowing border framing the aperture glyph, and `vizion-mark-token.svg`
  is the refined glyph alone (chrome parentheses around a neon bar, chevron and
  split ring, with dot accents and lens flares) on a transparent ground.
- **Whole matrix re-derived.** Ran `npm run generate:icons` so all 32 outputs —
  the transparent `any` PWA icons, maskable tiles, `apple-touch-icon`, favicons,
  iOS splashes, and the App Router `icon.svg`/`icon.png`/`apple-icon.png` — now
  reflect the new design. The iOS Add-to-Home-Screen tile and PWA install icon
  pick up the new look with no further changes.
- **Login hero sized to the glyph.** `AuthHero` now renders the wide glyph
  (1872×1084) at its native aspect ratio instead of forcing a 150×150 square.

### Fixed — avatar, composer & ambient polish

- **Profile avatar now renders.** Root cause was the Tailwind config defining
  `theme.spacing` at the top level, which *replaced* the scale and pruned
  `h-24`/`w-24` (and `h-11`, `h-9`, every fractional step) — so the 96px avatar
  button generated no size and collapsed to a dot. Moved the var-based 8-pt keys
  into `theme.extend.spacing` (identical px values) to restore the full scale.
  Additionally allowed the OAuth avatar CDNs (`lh3.googleusercontent.com`,
  `avatars.githubusercontent.com`) in both the CSP `img-src` and next/image
  `remotePatterns`, and added a name-monogram fallback with `onError` recovery so
  an expired provider URL no longer leaves an empty circle.

### Changed — integrated composer & ambient glow

- **Unified Enhance composer.** The target-model picker is nested into the
  composer's rounded top rail (as an `appearance-none` dropdown with a chevron),
  and a reset (↺) control plus the **► ENHANCE** action sit in the rounded bottom
  rail beside the token/media readouts — so every control lives inside one
  rounded-rectangle surface, with a Laser `focus-within` edge-glow.
- **Ambient aurora behind translucent chrome.** Added drifting Laser glow blooms
  (CSS, paused under reduced-motion) to the neural-mesh background and a new
  `--chrome` token + `.glass-chrome` so the header and bottom nav are more
  translucent and reveal the glow beneath. Canvas specks are slightly brighter
  with a soft halo on the Laser nodes.

### Fixed — UI remediation (R1–R8): restore the locked VIZION spec

- **Brand wiring (R1):** the squircle `vizion-icon-token.svg` now sits left of the
  wordmark in the top bar; the transparent `vizion-mark-token.svg` is the centered
  login hero. New `BrandPills` (VASEY/AI + live `v{version}` read from
  `package.json` via `NEXT_PUBLIC_APP_VERSION`, never hardcoded).
- **Type system (R2):** Bebas Neue / Reddit Sans / JetBrains Mono are now
  self-hosted via `next/font/local` (vendored OFL woff2 in `src/app/fonts/`).
  JetBrains Mono is scoped to the enhanced-prompt **output/result region only**;
  every other surface — including the prompt input editor — is Reddit Sans
  (guarded by `tests/unit/type-scoping.test.ts`). The wordmark is now plain
  `VIZION` (IO in accent), with the bracket/chevron motif left to the mark/icon.
- **Light/dark & contrast (R3):** role-mapped tokens for both themes;
  `--chalk`/`--silver` swap per theme. Added `--on-laser` (constant dark ink on
  laser fills) and theme-aware `--accent-ink`/light `--flare` so laser/error are
  never used as low-contrast text on light. Every text/bg pair passes WCAG AA in
  both themes.
- **Glass + background (R4):** an ambient neural-mesh `<canvas>`
  (`NeuralMeshBackground`) decoupled from React, capped ~30fps, particle count
  scaled to viewport, fully paused on `document.hidden`, with a static-gradient
  fallback under `prefers-reduced-motion`. Glass stays on floating elements only;
  the active result surface gets a top-edge laser shimmer.
- **Mode instrument & balance (R5):** the five modes are now one glass chassis
  (`ModeRig`) with a sliding laser lens-lock indicator, symmetric at 360/390/430px.
  The target-model picker is a centered content-width pill; full width is reserved
  for the Enhance CTA and the mode grid. Unified `.btn-laser`/`.btn-secondary`/
  `.btn-destructive` system.
- **Auth & profile (R6):** branded OAuth marks (multicolor Google G, theme-aware
  GitHub) via `ProviderIcon`, capped/centered. The profile shows the auth provider
  as its branded mark ("Connected with GitHub"); sign-out is a capped destructive
  button.
- **Footer (R7):** canonical `Footer` on login + profile — "VASEY/AI Presents" /
  Vasey Multimedia, dynamic year, version pill, safe-area aware. VM + V/AI
  monograms render behind `BRAND_MONOGRAMS_READY` (typographic fallback until
  Sean's real files land) with `filter:invert(1)` theming.
- **iOS & performance (R8):** library rows memoized; the media studio is a
  route-level dynamic import; the result tree reads the *submitted* input so typing
  never re-renders it; canvas paused offscreen.

### Changed — Brand icons

- Replaced the placeholder aperture glyph across the full icon/splash matrix with
  the master brand artwork. Two hand-authored SVGs now live in `public/brand/`:
  `vizion-icon-token.svg` (the branded Void plate + glow border) and
  `vizion-mark-token.svg` (the aperture mark on a transparent ground).
- `scripts/generate-icons.mjs` now rasterizes those master SVGs instead of the
  removed `scripts/lib/glyph.mjs` placeholder builder: the transparent "any"
  matrix and iOS splashes use the mark; apple-touch, favicons, and the App
  Router `icon.png`/`apple-icon.png` use the opaque plate; maskable tiles center
  the mark in the safe zone on a full-bleed Void canvas.
- Added `src/app/icon.svg` (the master tile) so modern browsers get a scalable
  favicon, with `icon.png` as the raster fallback.

### Added — v1.0 Hardening (P6)

- **Content-Security-Policy** + the full security-header set in `next.config.ts`
  (`default-src 'self'`, Supabase-scoped `connect/img/media`, `frame-ancestors`/
  `object-src`/`base-uri` locked; HSTS, nosniff, `X-Frame-Options: DENY`).
- **Rate limit on every model route**: an in-memory burst limiter
  (`src/lib/security/rate-limit.ts`) layered in front of the DB cost/rate cap.
- **iOS storage-eviction recovery**: an IndexedDB **offline outbox**
  (`src/lib/pwa/outbox.ts`) that queues failed mutations (e.g. Save) and replays
  them via `OutboxFlusher` on `online` / `visibilitychange` (no Background Sync
  on iOS); `navigator.storage.persist()` requested on SW registration.
- **Accessibility (WCAG AA)**: skip-to-content link, `prefers-reduced-motion`
  handling, focusable main landmark; existing visible focus ring + labels.
- Security/hardening checklist + backup-restore runbook (`docs/runbooks/hardening.md`).
- Tests: rate-limiter + outbox-flush (unit); CSP header + skip link (e2e).

### Added — v0.5 Media prompts (P5)

- `MediaAsset` is first-class (A5): a `media_assets` table (RLS owner-only from
  creation) + a private `media` Storage bucket with owner-scoped policies.
- Attach an image / video / audio reference in the Enhance studio; it uploads to
  the owner's prefix and records the asset.
- **Extraction pipeline behind a flag** (`NEXT_PUBLIC_MEDIA_EXTRACTION`, default
  `proxy`): vision via the model proxy (`/api/media`, Anthropic, cost-capped) with
  an **on-device fallback** (canvas palette + dimensions, audio duration) — the
  locked open question resolved as *proxy + on-device fallback*.
- **Generation-syntax formatters** (pure, unit-tested): Midjourney image-ref
  (`--ar/--v/--iw`), Runway/Sora/Kling motion phrasing, and an audio spec — fold
  the detected attributes into a generation-ready prompt that can be copied/saved.
- Storage budget with an **Amber** warning near quota (50 MB).

### Added — v0.4 Library & versioning (P4)

- Schema (RLS owner-only from creation): `prompts`, immutable `prompt_versions`
  (no update/delete policy → snapshots), and `activity_events`. `Prompt.current_ver`
  points at the active version; versions chain via `parent_ver`.
- Save flow: an enhancement saves a `Prompt` + first `PromptVersion`
  (Save-to-library on the diff). Revise → re-enhance → append a new version.
- Prompt detail (`/library/[id]`): version history, **diff any two versions**
  (reusing the word-diff), one-tap **restore** (sets `current_ver`), and delete.
- Library browser: search + tag + model filter over saved prompts; the **activity
  feed** (created · enhanced · saved · shared · restored) tied to the profile.
- Pure helpers (`deriveTitle`, `parseTags`, `filterPrompts`, `relativeTime`) with
  unit tests.

### Added — v0.3 Enhance core (P3)

- Provider adapter (`enhance(input, mode, target)`) fanning out to per-target
  implementations: Anthropic/Opus (official SDK), OpenAI/GPT (SDK), Google/Gemini
  (REST). Model strings are env-overridable config (D9); keys are server-side only.
- Per-target idiomatic formatters (Opus XML/CoT · GPT roles/JSON · Gemini
  parts/system-instruction) and the five modes (clarify · expand · condense ·
  reformat · target).
- `/api/enhance` route: auth-required, with a per-user **rate limit + daily cost
  cap** enforced server-side before any model call (backed by a `usage_events`
  ledger with RLS + a `usage_window` aggregate).
- The **transformation diff** — input on the Void end, enhanced output on the
  Chalk end, changed tokens lit in Laser, with a plain-language rationale —
  plus copy / share / export (Markdown · JSON · text) and an Amber cap warning.
- Tests: word-diff, formatters/parse, cost + exporters (unit); enhance-API 401
  (e2e). Pure word-level LCS diff lives in `src/lib/enhance/diff.ts`.

### Added — v0.2 Auth & profile (P2)

- Supabase Auth wired end-to-end: magic link + GitHub + Google on the sign-in gate, with
  OAuth/PKCE (`/auth/callback`) and email-OTP (`/auth/confirm`) route handlers and
  sign-out.
- Session middleware (`src/middleware.ts`) refreshes the JWT and gates every route to the
  sign-in page when signed out (server is the source of truth).
- Database (applied to the live project): `profiles` + `oauth_identities` with **RLS
  owner-only policies from creation**, an auto-profile trigger on signup, an `updated_at`
  trigger, and a `password_set` flag. Security advisors: clean.
- Avatars: Supabase Storage bucket (public read, owner-scoped writes) + a dependency-free
  client-side square→circular **avatar cropper**.
- Profile screen with real data — editable full name, display name, email (re-verify),
  default model, and theme; preferences sync to the account and hydrate on load.
- Magic-link → set-password onboarding (D15/A4), enforced by the `(app)` layout.
- Routes reorganised into an authenticated `(app)` group; offline shell decoupled from
  auth (static `offline.html` fallback). Tests: onboarding gate (unit), auth-gate +
  PWA/offline (e2e). Docs: `docs/runbooks/auth-setup.md`.

## [0.1.0] - 2026-06-13

### Added — v0.1 Shell (Phase 0 + P1)

- Repo scaffold: Standard `CLAUDE.md` v2.0, configs (TypeScript strict, Tailwind +
  CSS-var tokens, ESLint, Prettier, EditorConfig), `.env.example` (keys only),
  `SECURITY.md`, `docs/` (architecture + decision log + runbook), `tasks/lessons.md`,
  `.github/workflows/ci.yml` (lint · typecheck · test · build · npm audit).
- Design tokens: the seven locked roles + Amber, with dark/light/system theming.
- Typography via `next/font` — Bebas Neue (display) · Reddit Sans (body) · JetBrains
  Mono (utility).
- PWA shell: `manifest.webmanifest` (`any` + `maskable`, transparent-PNG matrix),
  hand-authored Workbox service worker (SWR shell · network-first enhance/auth ·
  cache-fallback library) with an offline fallback, iOS splash placeholders.
- Safe-area **v2 luminance-polarity template** wiring status-bar tint + nav contrast.
- 3-tab bottom nav (Enhance · Library · Profile) and the Enhance composer shell
  (mode chips · mono editor · target club rack · ENHANCE CTA).
- Auth gate stub (brand + value prop + three method buttons; Supabase wiring in P2).
- Tests: Vitest unit (safe-area math, contrast guardrails, UI store) and Playwright
  e2e (shell render, nav, theme, manifest, SW, offline shell).

[Unreleased]: https://github.com/SeanVasey/vizion/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/SeanVasey/vizion/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SeanVasey/vizion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SeanVasey/vizion/releases/tag/v0.1.0
