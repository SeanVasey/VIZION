<div align="center">

<img src="./public/icons/icon-192.png" alt="VIZION" width="96" height="96" />

# VIZION

**A VASEY/AI prompt-engineering studio — mobile-first PWA.**

_Clarify · Polish · Expand · Condense · Reformat · Adapt — the same idea, fitted to the engine that's about to receive it._

[![CI](https://img.shields.io/github/actions/workflow/status/SeanVasey/vizion/ci.yml?branch=main&label=CI)](https://github.com/SeanVasey/vizion/actions)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PWA](https://img.shields.io/badge/PWA-installable-C7FD26?logoColor=0F1012)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/license-MIT-B9BCC5)](./LICENSE)

</div>

> **Successor to rePROMPTer 2.** Where rePROMPTer _upgraded_ a prompt, VIZION
> _transforms_ it — across twenty-one target models from twelve developers
> (Fable 5.2 · Opus 5.5 · Sonnet 5.5 · Haiku 5.5 · GPT-6.2 Astra · GPT-6.2 Sol ·
> GPT-6.1 Terra · GPT-6 Luna · DeepSeek V4 Pro · Gemini 4 Carbon/Neon/Hydrogen ·
> Muse Wonder 1.0 · Muse Spark 1.3 · MiniMax M3.1 Flash · Mistral Large 4 ·
> Kimi K3.1 Pro · Sonar Pro · Qwen4 Max · Grok 4.7 · GLM-5.3),
> one thinking-depth dial for every model, six enhancement modes, and media-aware
> prompt construction, with accounts and a versioned prompt library.

<div align="center">

<!-- Live captures of the shipped app, rendered from the production build
     (CAPTURE=1 npx playwright test capture.spec.ts --project=mobile-chrome). -->
<img src="./docs/preview.png" alt="VIZION sign-in gate — the VIZION mark, wordmark, VASEY/AI + version pills, and the three Supabase auth methods" width="300" />

<br /><br />

<img src="./docs/shot-enhance.png" alt="VIZION composer — the six-mode rail, target-model and thinking-depth selectors, and the prompt field" width="264" />
&nbsp;&nbsp;
<img src="./docs/shot-library.png" alt="VIZION library — saved prompts with per-model badges, version counts, tags, and the activity feed" width="264" />

</div>

## Architecture

```
Client (PWA, Next.js 15 · React 19)
  ├─ App shell (Workbox precache) · Zustand (UI) · TanStack Query (server state)
  ├─ Routes: /enhance  /library  /profile  /(auth)
  └─ Service worker: SWR(same-origin static assets) · NetworkOnly navigations → offline.html
        │  HTTPS — no model keys client-side
        ▼
Next Route Handlers (Node) ── Provider Adapter ──┬─ Anthropic  (fable_5_2 · opus_5_5 · sonnet_5_5 · haiku_5_5)
  ├─ /api/enhance   (mode + target → formatter)  ├─ OpenAI     (gpt_6_2_astra · gpt_6_2_sol · gpt_6_1_terra · gpt_6_luna)
  ├─ /api/media     (extract → attributes)        ├─ Google     (gemini_4_carbon · gemini_4_neon · gemini_4_hydrogen)
  └─ per-user rate limit + cost cap + audit log   ├─ Mistral    (mistral_large_4)
                                                  ├─ xAI        (grok_4_7)
                                                  └─ OpenAI-compatible proxy:
                                                     DeepSeek (deepseek_v4) · Meta (muse_wonder_1_0 · muse_spark_1_3)
                                                     MiniMax (minimax_m3_1_flash) · Moonshot (kimi_k3_1_pro)
                                                     Perplexity (sonar_pro) · Qwen (qwen4_max)
                                                     Z.ai (glm_5_3)
        │
        ▼
Supabase ── Postgres (RLS) · Auth (magic link · GitHub · Google) · Storage (avatars, media)
```

See [`docs/architecture.md`](./docs/architecture.md) and the locked decision log in
[`docs/decisions/`](./docs/decisions).

## Status

| Phase              | Scope                                                     | State   |
| ------------------ | --------------------------------------------------------- | ------- |
| **Shell**          | Tokens · manifest · Workbox SW · safe-area · nav · themes | 🟢 done |
| **Auth & profile** | Supabase Auth · RLS · avatar crop · onboarding            | 🟢 done |
| **Enhance core**   | Provider adapter · 6 modes · transformation diff · caps   | 🟢 done |
| **Library**        | Save · immutable versions · diff/restore · activity feed  | 🟢 done |
| **Media prompts**  | Attach media · extraction · generation-syntax formatters  | 🟢 done |
| **Hardening**      | CSP · rate limits · eviction outbox · a11y · checklist    | 🟢 done |

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in to enable Supabase + providers (no secrets committed)
npm run generate:icons          # produce the transparent-PNG icon + splash matrix
npm run dev                     # http://localhost:3000
```

### Verification gate (run before every commit)

```bash
npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build
```

## Versioning & releases

Semantic Versioning, single-sourced from `package.json` (surfaced in the UI via
`NEXT_PUBLIC_APP_VERSION`) and documented in [`CHANGELOG.md`](./CHANGELOG.md)
(Keep a Changelog). Merging a version bump to `main` makes
[`release.yml`](./.github/workflows/release.yml) tag `v<version>` and publish a
GitHub Release with the matching changelog section as notes. Full procedure:
[`docs/runbooks/release.md`](./docs/runbooks/release.md).

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind + CSS-var tokens ·
TanStack Query · Zustand · Workbox · Supabase (Postgres + RLS, Auth, Storage) ·
Vercel.

## Brand

VIZION is a **VASEY/AI** product. No association with VASEY.AUDIO.

The identity is the **VIZION mark** — a chevron framing a bar and split ring —
shipped as an iOS 26 Liquid Glass icon set under `public/brand/`.

**`public/brand/vizion-glyph.svg` is the single raster source of truth**: the
mark alone, flat, on a tight 1024 × 892.8 viewBox. `npm run generate:icons`
composes the entire 31-file icon + splash matrix from it via `sharp`, painting
it with the locked colorways it reads from `tokens.css` — `Laser #C7FD26`,
`Void #0F1012`, and the dark theme's `--onyx` (`#2B2D33`) for the charcoal
mark. Don't hand-edit the PNGs, and don't edit `public/brand/` to change a
derivative.

The colorways are:

- **Installed** (flat Laser plate · charcoal `--onyx` mark · a stroke painted
  under the mark) — **every plated surface a launcher installs**: the
  Add-to-Home-Screen tile (`apple-touch-icon.png`), the maskable tiles and the
  scalable `app-icon.svg`'s light branch. On the PNG tiles the stroke is Laser
  shaded 0.25 toward Void (`#99C221` from today's tokens); in the SVG it is the
  Laser token itself.
- **Outlined, no plate** (charcoal mark · full Laser stroke) — the transparent
  `any` matrix only, because a launcher paints its own ground behind it: the
  charcoal fill carries the mark on a light ground, the Laser stroke on a dark
  one.
- **Light** (Laser plate + Void ink, flat) — the house colorway for the raster
  favicons plus `favicon.ico`, and the square `og:image` share tile.
- **Dark** (Void plate + Laser glyph, flat) — the iOS splash screens (matching
  the manifest's `background_color`).

**The installed tile is a Laser plate under a charcoal mark, with a stroke
meant to be invisible in Light and to become the outline in Dark**
([ADR-0017, Amendment 7](./docs/decisions/0017-outlined-home-screen-icon.md),
2026-11-28 — an owner direction, superseding the inverted accent-ink tile of
Amendments 5–6). **This tile has no device pass.** What earlier passes
established still stands: iOS reads `apple-touch-icon` from the head, does
**not** evaluate `media` on icons and **freezes** the tile at capture (device
passes 2026-08-12 and -13), and it derives the dark appearance from that PNG by
segmenting a foreground from the flat plate and keeping only the pixels whose
colour is distinct from the plate, on its own near-black plate (owner
screenshots 2026-08-11 and 2026-09-05).

That mechanism is why the PNG tiles' stroke is **not** literally Laser. A PNG
is flat pixels: a stroke identical to the plate does not exist in the file, so
nothing downstream can keep it. The literal tile — flat Laser plate, flat dark
mark — is the #105-era tile the owner already photographed (ADR-0017,
Amendment 3): in Dark the plate was swapped for `#101113` and the dark mark was
kept and invisible. The shade gives the ring pixels of its own. 0.25 toward
Void is the low end of the 0.25–0.35 range the 2026-09-05 screenshots showed
iOS keeping, so it is the least visible ring in Light for which any evidence of
survival exists; that evidence was a large fill inside a Void outline, not a
ring ~30 glyph units wide lying against the plate, so whether iOS keeps this
one is an expectation, not a measurement. The cost in Light is a faint
darker-green halo (1.7:1 against the plate) rather than nothing. The shade is
one exported constant, `TILE_STROKE_SHADE` in `scripts/generate-icons.mjs`, to
retune after a device pass — never a second link, a `media` query or a matcher.
`docs/runbooks/icon-install-repair.md` is the icon contract.

The **arrangement** ADR-0015 settled is unchanged: `metadata.icons.apple` holds
one unconditional link, at `/icons/apple-touch-icon.png`. **Do not add a second
`apple-touch-icon` link, a `media` query, or a JS matcher.** Each has shipped
here, and each shipped the invisible mark: a `media` pair (#108), that pair
reordered plus a client-side matcher (#111), and a self-inverting SVG as a Home
Screen route (#111). Every one bet that iOS would re-resolve or select
something; it does not.

`/icons/app-icon.svg` is the installed tile as vector in **both** appearances:
the plate follows `prefers-color-scheme` (flat Laser in light, a Void gradient
in dark) while the mark stays the charcoal mark with a Laser stroke. Because a
vector consumer evaluates the stylesheet, the owner's model holds literally
here: on the light plate the stroke is the plate's own colour and cannot be
seen, and on the dark plate the same stroke is the outline. It serves SVG-aware
icon consumers; it does not reach the iPhone Home Screen while the explicit
Apple link exists, and the PNG tile is not a fallback to it
([runbook](./docs/runbooks/icon-install-repair.md)).

See [the iOS runbook](./docs/runbooks/ios-verification.md) for the measured
result table and the superseded arrangements.

There are no `src/app/icon*`/`apple-icon` convention files. Declaring
`metadata.icons` at all suppresses the convention links — it is an
all-or-nothing merge — so `layout.tsx` declares the whole icon head and every
file lives under `public/icons/`.

**Share artwork** (`npm run generate:social`, also token-driven) is the one
other pair of generated files:

- `og-tile.png` — 1200 × 1200, the Light appearance at share resolution. This is
  `og:image`, and it is square because every consumer of `og:image` except X
  crops toward a square: iOS Safari's Share Sheet takes the centre 640 × 640,
  which of a landscape card kept one arm of the chevron and half a sentence.
- `social-card.png` — 1280 × 640, the descriptive card. Now `twitter:image`
  only (X reads it first and genuinely wants 2:1), plus the artwork for
  GitHub → Settings → General → Social preview.

The rest of `public/brand/` is reference, not raster input, and all of it belongs
to the current identity — the retired I›O `*-token.svg` pair is gone.

- **Composed previews** (`vizion-icon-{light,dark,clear,tinted}.svg`) and
  **background layers** (`vizion-icon-bg-*.svg`) carry a baked squircle clip and
  specular gloss: they show how the icon _appears_ once iOS has masked and
  glassified it. Rasterizing them would bake in the corners and gloss the OS
  applies at runtime, so the generator never reads them.
- **Foreground layers** (`vizion-icon-foreground-{lime,ink,mono}.svg`) are the
  Icon Composer stack, the source set for a native `.icon` build.
  `foreground-lime.svg` also serves as evidence: it carries
  `translate(133.12, 165.66) scale(0.74)`, which the generator reproduces to
  0.03 px — the check that the composed plates really are the shipped artwork.

**In the app, no `public/brand/` file is rendered at all.** Both brand surfaces —
the `ScreenHeader` mark and the sign-in hero — use `BrandMark`: the master glyph
inlined as a single path on `currentColor`, paired with `text-accent` so it
follows the theme. Never a hardcoded fill; brand Laser as ink on the light
canvas is a 1.09:1 contrast FAIL. `tests/unit/brand-mark.test.ts` keeps the
inlined geometry equal to the master.

The header used to serve the composed `vizion-icon-light.svg` as a plated tile.
It no longer does, because that plate is a _gradient_
(`#ECFF52 → #DFFA04 → #C2E000`): almost none of its area is the accent, so it
measured `#C9E601`–`#D3EF02` beside a wordmark reading a flat `--accent-ink` and
the two greens visibly disagreed. On `currentColor` the mark and the wordmark
are the same token by construction and cannot drift apart.

The brand green is `--laser`, and the **token leads**. It was retuned `#B7FF3C`
→ `#DFFA04` to meet the Liquid Glass set, then pulled back off yellow to
`#C7FD26` (hue ~75°) when the `#DFFA04` set read too yellow beside the neon
buttons — see [ADR-0013](./docs/decisions/0013-brand-green-retune.md) and its
2026-08-11 amendment. The generator closes the loop: it reads `--laser`,
`--void` and the dark theme's `--onyx` out of `tokens.css` rather than restating
them, so every generated icon follows the token by construction. The Liquid Glass **source** SVGs in
`public/brand/` still carry `#DFFA04` — they are Icon Composer artwork for a
future native `.icon` build, never rasterized into the PWA, so their green is
independent of the shipped token until that art is re-exported.

## License

[MIT](./LICENSE) © 2026 Sean Vasey (VASEY/AI). Vendored fonts under
`src/app/fonts/` are licensed separately under the [SIL Open Font License
1.1](./src/app/fonts/OFL.txt).
