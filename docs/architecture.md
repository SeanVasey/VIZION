# VIZION — Architecture

Condensed from the v1 planning docs (`docs/history/VIZION FINAL PLAN v1.md §3`,
`docs/history/VIZION-product-spec.md §2`). Those are historical (ADR-0005); this
working map plus the code are the canon of record.

## Layers

```
Client (PWA, Next.js 15 · React 19)
  ├─ App shell (Workbox precache) · Zustand (UI state) · TanStack Query (server state)
  ├─ Routes: /enhance  /library  /profile  /(auth)
  └─ Service worker strategies (below)
        │  HTTPS — model keys never client-side
        ▼
Next Route Handlers (Node serverless) — Provider Adapter
  ├─ /api/enhance   mode + target → per-model formatter → provider
  ├─ /api/media     extract → attributes (P5)
  └─ atomic admission: rate limit + cost cap + hold, one per-user lock
        │
        ▼
Supabase — Postgres (RLS) · Auth (magic/GitHub/Google) · Storage (avatars, media)
```

## Service-worker strategy (FINAL_PLAN §3)

| Surface                   | Strategy                        | Cache            |
| ------------------------- | ------------------------------- | ---------------- |
| Same-origin static assets | stale-while-revalidate          | `vizion-shell`   |
| Navigations               | **network-only** (never cached) | —                |
| Mutations (save/version)  | `online` + `visibilitychange`   | IndexedDB outbox |
|                           | flush, scoped to the account    |                  |

Navigations are network-only because Cache Storage is origin-wide, not
account-scoped, and `/library`, `/library/[id]` and `/profile` are
server-rendered with the account's content. They are still _routed_ (via
`NetworkOnly`) rather than left unmatched: `setCatchHandler` only runs for a
request some Workbox route handled, so an unrouted navigation would fail
offline to the browser's own error page instead of the fallback.

`vizion-enhance` and `vizion-library` do not exist. The routes that would have
populated them were removed — one targeted POST-only endpoints a GET runtime
route can never match (its only live effect was caching Supabase `/auth/v1`
session PII), the other targeted `/api/library` and `/api/prompts`, endpoints
that have never existed. Library data flows through server components and
server actions.

A failed navigation is caught and served the precached `/offline.html`. The SW is
hand-authored at `src/lib/pwa/sw-src.js` and compiled to `public/sw.js` by
`scripts/build-sw.mjs` (Workbox `injectManifest`) via the `prebuild` hook.

## Safe-area v2 — luminance-polarity template

`src/lib/pwa/safe-area.ts` computes WCAG relative luminance of a surface color and
derives the content polarity + iOS status-bar style generically (no per-app tuning).
`ThemeManager` applies the resolved `theme-color` + `apple-mobile-web-app-status-bar-style`
on every theme change; CSS `env(safe-area-inset-*)` utilities handle layout insets.

## Provider adapter (P3)

A single `enhance(input, mode, target)` interface fans out to model-specific formatters:

- **Opus 5** — XML-tagged sections, explicit system/user separation, CoT scaffolds.
- **Sonnet 5** — clear direct instructions, XML sections for layered context, literal precision.
- **GPT-5.6 Sol** — developer/system/user roles, JSON-mode / structured-output, tool schemas.
- **GPT-5.6 Luna** — goal-first directive brief; the family's balanced mid tier.
- **GPT-5.6 Terra** — short self-contained prompts, explicit format; the family's fast tier.
- **Fable 5** — goal + constraints briefs over step-by-step scaffolds; XML sections for layered context.
- **DeepSeek V4** — plain complete problem statement, reasoning left to the engine, explicit format.
- **Gemini 3.6 Flash** — multimodal "parts", system-instruction conventions,
  grounding; goal and constraints in separate blocks for the reasoning passes.
- **Muse Spark 1.1** — explicit goal up front, numbered constraints, output contract at the top.
- **MiniMax M3** — tight ordered brief; goal, constraints, and deliverable up front.
- **Mistral Large 3** — concise front-loaded instructions; economy over scaffolding.
- **Kimi K3** — clear goal + constraints with key context front-loaded; long-context friendly.
- **Sonar Pro** — research-brief phrasing: scope, time window, source/citation expectations.
- **Qwen3.7 Max** — well-separated task/context/format sections; language expectations stated.
- **Grok 4.5** — direct plain-spoken instructions, inline context, explicit output format.
- **GLM-5.2** — labeled task/context/constraints/format parts; acceptance criteria stated.

The seven 2026-07 additions (DeepSeek · Meta · MiniMax · Moonshot · Perplexity ·
Qwen · Z.ai) all speak the OpenAI wire shape and share one streaming factory
(`src/lib/providers/openai-compat.ts`). Model strings live in server config so
swaps are a config change, not a refactor.

### Thinking selector

Targets whose provider takes a per-request reasoning-depth option get a
"Thinking" selector in the composer (`TARGET_THINKING_LEVELS` in
`src/lib/constants.ts` — absent target = no knob = no selector). The chosen
level rides the enhance request (validated server-side) into the provider
adapter, which translates it onto that provider's parameter:

| Provider                                | Parameter                                       | Levels offered                    |
| --------------------------------------- | ----------------------------------------------- | --------------------------------- |
| Anthropic (Fable 5 · Opus 5 · Sonnet 5) | `output_config.effort`                          | low · medium · high · xhigh · max |
| OpenAI (GPT-5.6 Sol/Luna/Terra)         | `reasoning_effort`                              | low · medium · high               |
| Google (Gemini 3.6 Flash)               | `generationConfig.thinkingConfig.thinkingLevel` | minimal · low · medium · high     |
| Qwen (Qwen3.7 Max)                      | `enable_thinking` + `thinking_budget` (tokens)  | low · medium · high · xhigh · max |
| xAI (Grok 4.5)                          | `reasoning_effort`                              | low · medium · high               |

"Auto" (the default) sends nothing — the provider's own default applies. The
selection persists per target in the UI store. Vendors' consumer-app picker
labels (Gemini "Thinking"/"Fast", ChatGPT "Ultra"…) are marketing names for
these values, not separate models or API strings.

A model **TIER** is not a thinking level either. "Max" in `Qwen3.7 Max` names
Alibaba's flagship tier (beside Plus and Turbo) and says nothing about
reasoning depth — reading it as one is what left that target with no selector
while its API took a `thinking_budget` all along.

## Data model (P2/P4)

Entities: `User · Profile · OAuthIdentity · Prompt · PromptVersion · MediaAsset ·
ActivityEvent · Collection · Draft · UsageEvent · UsageReservation`. Most tables
carry `user_id` with RLS `auth.uid() = user_id`; `PromptVersion` is the exception
— it has no `user_id` and its policies traverse the parent prompt's ownership
(`exists (select 1 from prompts …)`), keeping one source-of-ownership truth.
`PromptVersion` rows are immutable snapshots; `Prompt.current_ver` points at the active
one. Full field-level schema in `docs/history/VIZION-product-spec.md §5.1` (v1-era,
historical — ADR-0005).

`supabase/migrations/` is the whole schema, from `create type public.theme`
onward — not a patch set layered on a hosted base. `npm run db:verify` replays
it from empty; `docs/runbooks/migrations.md` covers applying, verifying, and
diffing against the hosted project.

## z-index ladder (DSN-018)

The stacking order is coherent but was documented only in a component comment.
The full ladder, lowest to highest:

| Layer | z-index | Where |
| --- | --- | --- |
| Ambient background (ground + blooms + particle field) | `-10` | `AmbientNebula` |
| Glass/chrome `::before` tints | `-1` | `.glass-chrome` / `.glass-nav` pseudo |
| Content (mode-rig cells, bottom-nav base) | `1`–`10` | in-flow chrome |
| Sticky result action bar | `30` | `TransformationDiff` |
| Fixed chrome (header, FAB, keyboard bar) | `40` | `ScreenHeader` · `NewPromptFab` · `KeyboardActionBar` |
| Bottom nav | `50` | `BottomNav` |
| Avatar-crop modal | `60` | `SettingsPanel` |
| Sheets | `70` | `Sheet` |
| Toasts | `80` | `Toast` |
| Skip-to-content link | `100` | root layout |

The one non-obvious relation — toast (`80`) over FAB (`40`) so a confirmation
is never hidden behind the compose button — is intentional. Keep new overlays
inside these bands rather than inventing new literals.

## Offline / eviction posture

Server is the source of truth. The client calls `navigator.storage.persist()`,
re-hydrates from Supabase on launch, and flushes an IndexedDB outbox on
`visibilitychange` — local storage never holds the only copy of a prompt.
