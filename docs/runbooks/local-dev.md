# Runbook — local development

## Prerequisites

- Node ≥ 20 (CI uses Node 22). npm ≥ 10.

## First run

```bash
npm install
cp .env.example .env.local       # fill in to enable Supabase + provider calls
npm run generate:icons           # transparent-PNG icon + iOS splash matrix
npm run dev                      # http://localhost:3000  (opens on /enhance)
```

## Verification gate (run before every commit — non-skippable)

```bash
npm run lint
npm run typecheck
npm run test        # Vitest unit
npm run test:e2e    # Playwright shell/PWA (builds the SW + a prod server)
npm run build       # must pass clean
```

One-liner:

```bash
npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build
```

## Service worker

- Source: `src/lib/pwa/sw-src.js` (hand-authored Workbox).
- Built to `public/sw.js` by `scripts/build-sw.mjs` via the `prebuild` hook (so a plain
  `npm run build` always regenerates it). `public/sw.js` is gitignored.
- The SW registers only in production or on https/localhost (see `register-sw.ts`), so a
  normal `next dev` session will not install it; use `npm run build && npm run start` to
  exercise offline behavior locally.

## Icons & splash

- Regenerate with `npm run generate:icons` (uses `sharp`). Every output lands
  under `public/icons/` and `public/splash/` — there are no `src/app/`
  convention icons any more, because `src/app/layout.tsx` declares
  `metadata.icons` itself (declaring the key suppresses the convention links
  wholesale — Next's all-or-nothing merge). ONE master drives generation:
  `public/brand/vizion-glyph.svg` — the flat mark on a tight viewBox — painted
  with colorways derived from the `tokens.css` Laser/Void tokens. Drop new
  artwork into that file and re-run, without touching the manifest references
  (DOC-010: no longer placeholders).
- Adding or renaming an icon means editing the `metadata.icons` block too —
  nothing auto-wires it now. The `apple` array holds **exactly one** link, with
  **no `media` query**, pointing at `apple-touch-icon.png` — the **outlined**
  tile (flat Laser plate, lime-filled mark, Void outline). One link is a decision,
  not an oversight ([ADR-0015](../decisions/0015-pinned-home-screen-tile.md)):
  iOS freezes the tile at Add-to-Home-Screen and auto-darkens it. The tile used
  to be pinned to the dark colorway because only already-dark _flat_ artwork
  survived that; the outlined colorway
  ([ADR-0017](../decisions/0017-outlined-home-screen-icon.md)) carries its own
  contrast instead, so the brand green is back on the tile. **Do not add a
  second link, a `media` query, or a JS matcher** — all three have shipped here
  and all three shipped the invisible mark. Pinned by `tests/e2e/shell.spec.ts`.
- The manifest link is hand-written in the root layout's `<head>` with
  `crossOrigin="use-credentials"`, not declared through `metadata.manifest`:
  a manifest is fetched with credentials omitted by spec, and Vercel's preview
  protection is a cookie, so without the attribute a preview redirects its own
  manifest fetch to Vercel's SSO page and installs without a name. Keep it that way; the e2e head test
  pins exactly one credentialed link.
- Share artwork is a separate script: `npm run generate:social` writes
  `public/brand/og-tile.png` (square, the `og:image`) and
  `public/brand/social-card.png` (landscape, `twitter:image` + the GitHub social
  preview). It needs Playwright's Chromium for the vendored Bebas Neue.
- Do NOT point the generator at the composed previews
  (`public/brand/vizion-icon-{light,dark,clear,tinted}.svg`) or the background
  layers (`vizion-icon-bg-*.svg`): they carry a baked squircle clip and
  specular gloss, so rasterizing them double-masks the corners iOS rounds at
  runtime. They are appearance reference only.
- The `any` matrix ships transparent and the maskable/apple-touch/favicon set
  ships opaque — `tests/unit/icon-alpha.test.ts` enforces it (guardrail §6 /
  INV-09), so a regeneration that flattens the wrong set fails the gate rather
  than shipping. The same test pins the outlined colorway on every installed
  tile — a green-led plate, a green-led fill at the mark's centre, and a Void
  stroke on the row through it — so a regeneration that drops either carrier
  fails the gate.

## Playwright

- First time only: `npx playwright install --with-deps` to fetch browsers.
- `npm run test:e2e` builds the SW, runs `next build`, and serves on port 3100.

## Troubleshooting

- **`next/font` build failure** → not a network problem. The three families are vendored
  as woff2 under `src/app/fonts/` and loaded with `next/font/local`, so the build makes
  no font request at all; check the files are present rather than your connectivity.
  Fallbacks (`Arial Narrow`, `system-ui`, `ui-monospace`) are declared behind each
  variable in `tokens.css`.
- **SW not updating** → it is served `no-store`; hard-reload or clear the
  `vizion-*` caches in DevTools → Application.
