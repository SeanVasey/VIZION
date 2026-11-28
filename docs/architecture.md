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

- **Fable 5.2** — goal + constraints briefs over step-by-step scaffolds; XML sections for layered context.
- **Opus 5.5** — XML-tagged sections, CoT scaffolds where reasoning helps, structured for long context.
- **Sonnet 5.5** — clear direct instructions, XML sections for layered context, literal precision.
- **Haiku 5.5** — compact self-contained brief: one goal, the constraints that matter, the exact output shape; the small, fast tier.
- **GPT-6.2 Astra** — goal and finished-answer criteria up front, planning left to the engine; explicit schema where wanted.
- **GPT-6.2 Sol** — terse directive instructions; exact output format or schema spelled out where a machine-readable result is wanted.
- **GPT-6.1 Terra** — goal-first directive brief; the balanced mid tier.
- **GPT-6 Luna** — short self-contained prompts, explicit format; the small, fast tier.
- **DeepSeek V4 Pro** — plain complete problem statement, reasoning left to the engine, explicit format.
- **Gemini 4 Carbon** — goal, constraints and finished-answer criteria, planning left to the engine; the deep-reasoning tier.
- **Gemini 4 Neon** — concrete well-scoped instructions with explicit grounding; for engineering work, files, interfaces and acceptance criteria named outright.
- **Gemini 4 Hydrogen** — concrete grounded instructions in a tight brief; goal and constraints in separate blocks; the fast tier.
- **Muse Wonder 1.0** — goal and done-criteria up front, the route left to the engine; numbered constraints, output contract near the top.
- **Muse Spark 1.3** — explicit goal up front, numbered constraints, output contract at the top.
- **MiniMax M3.1 Flash** — tight ordered brief; goal, constraints, and deliverable up front.
- **Mistral Large 4** — concise front-loaded instructions; economy over scaffolding.
- **Kimi K3.1 Pro** — clear goal + constraints with key context front-loaded; long-context friendly.
- **Sonar Pro** — research-brief phrasing: scope, time window, source/citation expectations.
- **Qwen4 Max** — well-separated task/context/format sections; language expectations stated.
- **Grok 4.7** — direct plain-spoken instructions, inline context, explicit output format.
- **GLM-5.3** — labeled task/context/constraints/format parts; acceptance criteria stated.

Twenty-one targets from twelve developers (the 2026-11-28 roster; the text of
each convention is `TARGET_CONVENTIONS` in `src/lib/providers/formatters.ts`).
The seven 2026-07 additions (DeepSeek · Meta · MiniMax · Moonshot · Perplexity ·
Qwen · Z.ai) all speak the OpenAI wire shape and share one streaming factory
(`src/lib/providers/openai-compat.ts`). Model strings live in server config so
swaps are a config change, not a refactor.

### Thinking dial

ONE reasoning-depth dial, for every model ([ADR-0018](./decisions/0018-one-ladder.md)):
**Auto · Low · Medium · High · Max**. The rail shows for any target whose
API takes a per-request depth (`TARGET_HAS_THINKING` in
`src/lib/constants.ts`) and always under Auto routing; a target with no knob
shows no rail and is sent nothing. Since 2026-11-28 that is Sonar Pro alone —
Mistral Large 4, both Muse models and MiniMax M3.1 Flash each gained an effort
word.
It is a slider, not a menu: `role="slider"` on the pill, arrow keys stepping the
ladder, and a capsule track that expands over the pill under a tap or a hold
([ADR-0014](./decisions/0014-dials.md)); at the screen's edge a held drag keeps
stepping on a timer (edge auto-step, ADR-0018).

The level rides the enhance request in the app's vocabulary (validated
server-side against `THINKING_LEVELS`); the **adapter** translates it onto the
model's own words through one table, `providerEffort` in
`src/lib/providers/errors.ts`. The vocabulary is chosen **per target**
(`TARGETS[id].effort` in `src/lib/providers/config.ts`), not per provider
(ADR-0018, Amendment 1): Gemini 4 Carbon stops at `high` where Neon and
Hydrogen add `xhigh`, so one "Google vocabulary" would either 400 Carbon or cap
its siblings a stop short. A vocabulary is named for its shape, and
`tests/unit/models.test.tsx` pins `TARGET_HAS_THINKING` to the presence of
`effort` so the client's and the server's copy of the fact cannot disagree.

| Vocabulary | Targets                                                  | Parameter                                                                      | low · medium · high · max → |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `five`     | Fable 5.2 · Opus 5.5 · Sonnet 5.5 · Haiku 5.5            | `output_config.effort`                                                         | low · medium · high · max   |
| `five`     | Muse Wonder 1.0 · Muse Spark 1.3 · MiniMax M3.1 Flash    | `reasoning_effort`                                                             | low · medium · high · max   |
| `openai`   | GPT-6.2 Astra · GPT-6.2 Sol · GPT-6.1 Terra · GPT-6 Luna | `reasoning_effort`                                                             | low · medium · high · max   |
| `toXhigh`  | Grok 4.7 · Gemini 4 Neon · Gemini 4 Hydrogen             | `reasoning_effort` (Grok) · `generationConfig.thinkingConfig.thinkingLevel`    | low · medium · high · xhigh |
| `toHigh`   | Gemini 4 Carbon · Mistral Large 4                        | `generationConfig.thinkingConfig.thinkingLevel` · `reasoning_effort` (Mistral) | low · medium · high · high  |
| `three`    | DeepSeek V4 Pro · Kimi K3.1 Pro · GLM-5.3                | `reasoning_effort`                                                             | low · high · high · max     |
| `threeX`   | Qwen4 Max                                                | `reasoning_effort`                                                             | low · high · high · xhigh   |
| —          | Sonar Pro                                                | none (the legacy chat endpoint documents no knob)                              | nothing is sent             |

Every row is monotone and keeps the ends honest — Low is the model's cheapest
word, Max its costliest — so the peak caption's "highest cost" holds on a
three-valued API too. `minimal` and `xhigh` remain in the wire vocabulary for
old drafts and stores and fold onto Low and High (`normalizeThinkingLevel`),
except where the API serves `xhigh` as a tier of its own (`five`, `openai`,
`toXhigh`, `threeX`), where it rides through. Qwen moved from a token budget
(`enable_thinking` + `thinking_budget`) to an effort word with Qwen4; the
per-stop budget table is gone.

"Auto" (the default) sends no level from the client; the **route** resolves it
to the app's own default for the job, using the same tier split routing uses
(`defaultThinkingLevel` in `src/lib/enhance/auto-target.ts`). A heavy job —
a structure-inventing mode, or a long or media-bearing input — gets `high`. A
light job gets the **moderate** stop, read off the target's vocabulary:
`medium` where Medium is a word of its own, **`low`** where it is not
(`hasDistinctMedium` — the `three` and `threeX` rows: DeepSeek V4 Pro, Kimi
K3.1 Pro, GLM-5.3, Qwen4 Max). Before 2026-11-28 Auto returned `medium` for
every light job, which those APIs fold onto `high`: the lightest job ran at the
heaviest job's depth. Vendor defaults (`high` on most of the roster, `max` on
Kimi K3.1 Pro, GLM-5.3, Muse Wonder 1.0 and MiniMax M3.1 Flash) are not
inherited by an untuned run. The route echoes what it chose as
`resolvedThinking` on the result — present only when the dial was on Auto and
the target has a knob — and the result meta reads it back as, for example,
"· Medium thinking (auto)". The selection persists as one value in the UI
store, whatever the model.

A completed turn the model **declined** — a refusal stop reason (`refusal`,
`content_filter`, Gemini's `SAFETY` family; `REFUSAL_STOPS`) with nothing
decoded — is raised as `ProviderRefusalError` and reaches the client as a 422
error event that says the model declined, rather than as "non-JSON response".

A model **TIER** is not a thinking level. "Max" in `Qwen4 Max` names
Alibaba's flagship tier and says nothing about reasoning depth — reading it as
one is what once left that target with no selector while its API took a
reasoning control all along.

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

| Layer                                                 | z-index  | Where                                                 |
| ----------------------------------------------------- | -------- | ----------------------------------------------------- |
| Ambient background (ground + blooms + particle field) | `-10`    | `AmbientNebula`                                       |
| Glass/chrome `::before` tints                         | `-1`     | `.glass-chrome` / `.glass-nav` pseudo                 |
| Content (mode-rig cells, bottom-nav base)             | `1`–`10` | in-flow chrome                                        |
| Sticky result action bar                              | `30`     | `TransformationDiff`                                  |
| Fixed chrome (header, FAB, keyboard bar)              | `40`     | `ScreenHeader` · `NewPromptFab` · `KeyboardActionBar` |
| Bottom nav                                            | `50`     | `BottomNav`                                           |
| Avatar-crop modal                                     | `60`     | `SettingsPanel`                                       |
| Sheets                                                | `70`     | `Sheet`                                               |
| Toasts                                                | `80`     | `Toast`                                               |
| Skip-to-content link                                  | `100`    | root layout                                           |

The one non-obvious relation — toast (`80`) over FAB (`40`) so a confirmation
is never hidden behind the compose button — is intentional. Keep new overlays
inside these bands rather than inventing new literals.

## Offline / eviction posture

Server is the source of truth. The client calls `navigator.storage.persist()`,
re-hydrates from Supabase on launch, and flushes an IndexedDB outbox on
`visibilitychange` — local storage never holds the only copy of a prompt.
