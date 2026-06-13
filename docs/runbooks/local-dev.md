# Runbook — local development

## Prerequisites

- Node ≥ 20 (CI uses Node 20). npm ≥ 10.

## First run

```bash
npm install
cp .env.example .env.local       # values needed only from P2 onward
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

- Regenerate with `npm run generate:icons` (uses `sharp`). Output under `public/icons/`
  and `public/splash/`, plus `src/app/icon.png` / `src/app/apple-icon.png` (Next
  auto-wires these as favicons). These are **placeholder** assets — swap for final brand
  art without touching the manifest references.

## Playwright

- First time only: `npx playwright install --with-deps` to fetch browsers.
- `npm run test:e2e` builds the SW, runs `next build`, and serves on port 3100.

## Troubleshooting

- **`next/font` build failure** → the font fetch needs network at build time. Retry with
  connectivity; fallbacks (`Arial Narrow`, `system-ui`, `ui-monospace`) are declared.
- **SW not updating** → it is served `no-store`; hard-reload or clear the
  `vizion-*` caches in DevTools → Application.
