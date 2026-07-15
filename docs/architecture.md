# VIZ(IO)N — Architecture

Condensed from `VIZION FINAL PLAN v1.md §3` and `VIZION-product-spec.md §2`. This is the
working map; the locked plan is canonical.

## Layers

```
Client (PWA, Next.js 15 · React 19)
  ├─ App shell (Workbox precache) · Zustand (UI state) · TanStack Query (server state)
  ├─ Routes: /enhance  /library  /profile  /(auth)
  └─ Service worker strategies (below)
        │  HTTPS — model keys never client-side
        ▼
Next Route Handlers (Edge) — Provider Adapter
  ├─ /api/enhance   mode + target → per-model formatter → provider
  ├─ /api/media     extract → attributes (P5)
  └─ per-user rate limit + cost cap + audit log
        │
        ▼
Supabase — Postgres (RLS) · Auth (magic/GitHub/Google) · Storage (avatars, media)
```

## Service-worker strategy (FINAL_PLAN §3)

| Surface                               | Strategy                       | Cache            |
| ------------------------------------- | ------------------------------ | ---------------- |
| App shell + same-origin static assets | stale-while-revalidate         | `vizion-shell`   |
| Auth / session + `/api/enhance`       | network-first (10s timeout)    | `vizion-enhance` |
| Library / history reads               | network-first + cache fallback | `vizion-library` |
| Mutations (save/version)              | Background Sync (Android) /    | IndexedDB outbox |
|                                       | `visibilitychange` flush (iOS) |                  |

A failed navigation is caught and served the precached `/` shell. The SW is
hand-authored at `src/lib/pwa/sw-src.js` and compiled to `public/sw.js` by
`scripts/build-sw.mjs` (Workbox `injectManifest`) via the `prebuild` hook.

## Safe-area v2 — luminance-polarity template

`src/lib/pwa/safe-area.ts` computes WCAG relative luminance of a surface color and
derives the content polarity + iOS status-bar style generically (no per-app tuning).
`ThemeManager` applies the resolved `theme-color` + `apple-mobile-web-app-status-bar-style`
on every theme change; CSS `env(safe-area-inset-*)` utilities handle layout insets.

## Provider adapter (P3)

A single `enhance(input, mode, target)` interface fans out to model-specific formatters:

- **Opus 4.8** — XML-tagged sections, explicit system/user separation, CoT scaffolds.
- **GPT-5.6 Sol** — developer/system/user roles, JSON-mode / structured-output, tool schemas.
- **Fable 5** — goal + constraints briefs over step-by-step scaffolds; XML sections for layered context.
- **Gemini 3.5 Flash** — multimodal "parts", system-instruction conventions, grounding.
- **Grok 4.5** — direct plain-spoken instructions, inline context, explicit output format. (xAI — new provider; needs `XAI_API_KEY`.)

Model strings live in server config so swaps are a config change, not a refactor.

## Data model (P2/P4)

Entities: `User · Profile · OAuthIdentity · Prompt · PromptVersion · MediaAsset ·
ActivityEvent`. Every table carries `user_id`; RLS policy = `auth.uid() = user_id`.
`PromptVersion` rows are immutable snapshots; `Prompt.current_ver` points at the active
one. Full field-level schema in `VIZION-product-spec.md §5.1`.

## Offline / eviction posture

Server is the source of truth. The client calls `navigator.storage.persist()`,
re-hydrates from Supabase on launch, and flushes an IndexedDB outbox on
`visibilitychange` — local storage never holds the only copy of a prompt.
