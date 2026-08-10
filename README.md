<div align="center">

<img src="./public/icons/icon-192.png" alt="VIZION" width="96" height="96" />

# VIZION

**A VASEY/AI prompt-engineering studio — mobile-first PWA.**

_Clarify · Polish · Expand · Condense · Reformat · Adapt — the same idea, fitted to the engine that's about to receive it._

[![CI](https://img.shields.io/github/actions/workflow/status/SeanVasey/vizion/ci.yml?branch=main&label=CI)](https://github.com/SeanVasey/vizion/actions)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PWA](https://img.shields.io/badge/PWA-installable-B7FF3C?logoColor=0F1012)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/license-MIT-B9BCC5)](./LICENSE)

</div>

> **Successor to rePROMPTer 2.** Where rePROMPTer _upgraded_ a prompt, VIZION
> _transforms_ it — across sixteen target models from twelve developers
> (Fable 5 · Opus 5 · Sonnet 5 · GPT-5.6 Sol/Terra/Luna · DeepSeek V4 ·
> Gemini 3.6 Flash · Muse Spark 1.1 · MiniMax M3 · Mistral Large 3 · Kimi K3 ·
> Sonar Pro · Qwen3.8 Max · Grok 4.5 · GLM-5.2), a per-model thinking-depth
> selector, six enhancement modes, and media-aware
> prompt construction, with accounts and a versioned prompt library.

<div align="center">

<!-- Live capture of the shipped sign-in gate (v0.3.0), rendered from the production build. -->
<img src="./docs/preview.png" alt="VIZION sign-in gate — the I›O mark, wordmark, VASEY/AI + version pills, and the three Supabase auth methods" width="300" />

</div>

## Architecture

```
Client (PWA, Next.js 15 · React 19)
  ├─ App shell (Workbox precache) · Zustand (UI) · TanStack Query (server state)
  ├─ Routes: /enhance  /library  /profile  /(auth)
  └─ Service worker: SWR(same-origin static assets) · NetworkOnly navigations → offline.html
        │  HTTPS — no model keys client-side
        ▼
Next Route Handlers (Node) ── Provider Adapter ──┬─ Anthropic  (fable_5 · opus_5 · sonnet_5)
  ├─ /api/enhance   (mode + target → formatter)  ├─ OpenAI     (gpt_5_6_sol · gpt_5_6_luna · gpt_5_6_terra)
  ├─ /api/media     (extract → attributes)        ├─ Google     (gemini_3_6_flash)
  └─ per-user rate limit + cost cap + audit log   ├─ Mistral    (mistral_large_3)
                                                  ├─ xAI        (grok_4_5)
                                                  └─ OpenAI-compatible proxy:
                                                     DeepSeek (deepseek_v4) · Meta (muse_spark_1_1)
                                                     MiniMax (minimax_m3) · Moonshot (kimi_k3)
                                                     Perplexity (sonar_pro) · Qwen (qwen3_8_max)
                                                     Z.ai (glm_5_2)
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
composes the entire 33-file icon + splash matrix from it via `sharp`, painting
it with the locked colorways — `Laser #DFFA04`, `Void #0F1012`. Don't hand-edit
the PNGs, and don't edit `public/brand/` to change a derivative.

The appearances are:

- **Light** (Laser plate + Void ink) — the base. Drives the opaque surfaces:
  the iOS Add-to-Home-Screen tile (`apple-touch-icon`), the favicons and
  `favicon.ico`, the maskable tiles, and the App Router `icon`/`apple-icon`.
- **Laser glyph on transparent** — the `any` PWA icon matrix, which ships
  transparent per guardrail §6.
- **Dark** (Void plate + Laser glyph) — the iOS splash screens, matching the
  manifest's `background_color`.

The rest of `public/brand/` is reference, not raster input. The composed
previews (`vizion-icon-{light,dark,clear,tinted}.svg`) and the background layers
(`vizion-icon-bg-*.svg`) carry a baked squircle clip and specular gloss — they
show how the icon _appears_ once iOS has masked and glassified it. Rasterizing
them would bake in the corners and gloss the OS applies at runtime, so the
generator never reads them.

## License

[MIT](./LICENSE) © 2026 Sean Vasey (VASEY/AI). Vendored fonts under
`src/app/fonts/` are licensed separately under the [SIL Open Font License
1.1](./src/app/fonts/OFL.txt).
