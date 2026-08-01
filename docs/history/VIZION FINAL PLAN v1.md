# VIZ(IO)N — FINAL PLAN v1.0

**Status: LOCKED** · VASEY/AI · Prompt-engineering studio (mobile-first PWA)
**Repo target:** `SeanVasey/vizion` · **Deploy:** Vercel · **Companion:** `VIZION_CLAUDE_CODE_PROMPT.md`

> Successor to rePROMPTer 2. Same two-model lineage widened to a three-model panel (Opus 4.8 · GPT-5.5 · Gemini Pro 3.1) with per-target formatting, five enhancement modes, media-aware prompt construction, accounts, and a versioned prompt library. This document is the canonical locked plan; the build prompt operationalizes it.

-----

## 1. Decision log (LOCKED)

|#  |Decision                                 |Choice                                      |Rationale                                       |State|
|---|-----------------------------------------|--------------------------------------------|------------------------------------------------|-----|
|D1 |Framework                                |Next.js 15 App Router + React 19 + TS       |RSC keeps model keys server-side; house standard|🔒    |
|D2 |Styling                                  |Tailwind + CSS-var tokens (7 roles)         |Instant dark/light swap, token-driven           |🔒    |
|D3 |Server state                             |TanStack Query                              |Offline-aware cache for prompts/history         |🔒    |
|D4 |UI state                                 |Zustand                                     |Lightweight editor/mode/model store             |🔒    |
|D5 |PWA                                      |Workbox custom SW + manifest                |App-shell precache; iOS-correct install         |🔒    |
|D6 |DB                                       |Supabase Postgres + **RLS from day one**    |Per-user isolation at the database              |🔒    |
|D7 |Auth                                     |Supabase Auth — magic link + GitHub + Google|Three required methods, JWT ≤7d + rotation      |🔒    |
|D8 |Storage                                  |Supabase Storage (per-user prefix)          |Avatars + media, policy-scoped                  |🔒    |
|D9 |Model access                             |Next route-handler **provider adapter**     |Keys hidden, cost caps, model-string agnostic   |🔒    |
|D10|Async jobs                               |Inngest (deferred to v0.4+)                 |Queued media extraction / batch re-targeting    |🔒    |
|D11|Brand house                              |VASEY/AI — **no VASEY.AUDIO association**   |Brand-separation rule                           |🔒    |
|D12|Icon rule                                |Transparent PNG suite + `any`+`maskable`    |Suite-wide PWA icon standard                    |🔒    |
|D13|Safe-area                                |Reusable v2 luminance-polarity template     |Closes recurring iOS notch issue generically    |🔒    |
|D14|Provider logos                           |Source from thesvg.org → Potrace/SVGO       |Suite icon pipeline standard                    |🔒    |
|D15|Magic-link accounts set a password (A4)  |Yes, at onboarding                          |Durable email+password credential per brief     |🔒    |
|D16|`MediaAsset` is a first-class entity (A5)|Yes                                         |Attached media is core input                    |🔒    |

**Open question carried to v0.3 (must resolve before media GA):** media-detail extraction runs **on-device** (fast, private, limited) vs. **via model proxy** (richer, token cost). Default lean: proxy behind a feature flag with on-device fallback, decided after a latency/cost spike in Phase 4.

-----

## 2. Design tokens (LOCKED — derived from `IMG_2994.JPG`)

```
--void:   #0F1012   /* background            */
--onyx:   #2B2D33   /* surface / glass        */
--silver: #B9BCC5   /* secondary / muted / borders */
--chalk:  #F2F3F6   /* primary text / light base   */
--laser:  #B7FF3C   /* accent / primary action / IO highlight */
--pulse:  #3DD68C   /* success (derived)      */
--flare:  #FF5247   /* error (derived)        */
--amber:  #FFC24B   /* warning (derived)      */
```

**Hard rule:** `--laser` is fill/accent on dark surfaces only. Buttons = Void text on Laser fill, never Laser text. Laser text on Chalk = 1.09:1 (FAIL) — prohibited.

**Type:** Bebas Neue (display) · Reddit Sans (body/UI) · JetBrains Mono (prompt/diff/metadata). Scale: Major Third (1.25) — `12·14·16·20·25·31·39`.

**Spacing:** 4px base, 8-pt rhythm. **Elevation:** translucency + light, not shadow (3 tiers: Void base → glass Onyx → glass + Laser edge-light).

-----

## 3. Architecture (condensed)

```
Client (PWA, Next.js)
  ├─ App shell (Workbox precache) · Zustand (UI) · TanStack Query (server)
  ├─ Routes: /enhance  /library  /profile  /auth
  └─ Service worker: SWR(shell) · network-first(enhance, auth) · cache-fallback(library)
        │
        ▼ HTTPS (no model keys client-side)
Next Route Handlers (Edge)  ── Provider Adapter ──┬─ Anthropic (opus_4_8)
  ├─ /api/enhance   (mode + target → formatter)   ├─ OpenAI (gpt_5_5)
  ├─ /api/media     (extract → attributes)         └─ Google (gemini_pro_3_1)
  ├─ per-user rate limit + cost cap + audit log
        │
        ▼
Supabase  ── Postgres (RLS) · Auth (magic/GitHub/Google) · Storage (avatars, media)
```

Provider adapter exposes `enhance(input, mode, target)` and `extractMedia(asset)`; model strings live in config so swaps are non-breaking (D9).

-----

## 4. Data model (reference)

Entities: **User · Profile · OAuthIdentity · Prompt · PromptVersion · MediaAsset · ActivityEvent.** Full field-level schema in `VIZION-product-spec.md §5.1`. RLS: every table carries `user_id`; policies = `auth.uid() = user_id`; child tables join through parent ownership. `PromptVersion` rows are immutable snapshots; `Prompt.current_ver` points at the active one.

-----

## 5. Build phases & acceptance criteria

|Phase                          |Scope                                                                                                      |Done when…                                                                                                     |
|-------------------------------|-----------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
|**v0.1 — Shell**               |Repo scaffold, CLAUDE.md v2.0, tokens, PWA manifest + SW, safe-area template, bottom-nav, themes           |Installs to iOS Home Screen; offline shell loads; safe-area clean on notch + home-indicator; Lighthouse PWA ✓  |
|**v0.2 — Auth & profile**      |Supabase Auth (3 methods), RLS, profile + circular avatar crop, magic-link→password flow                   |All three sign-ins work; OAuth auto-populates + editable; non-OAuth sets password; profile syncs across devices|
|**v0.3 — Enhance core**        |Provider adapter, 5 modes, model selector, transformation diff, copy/export                                |Each mode returns a diff with rationale for all 3 targets; keys never reach client; cost cap enforced          |
|**v0.4 — Library & versioning**|Save → Prompt + PromptVersion, history, diff/restore, activity feed, tags/search                           |Versions immutable; restore sets current_ver; feed logs all event types; search filters by model/tag           |
|**v0.5 — Media prompts**       |Attach image/video/audio, extraction pipeline (flagged), generation-syntax formatters (MJ/Runway/etc.)     |Reference attaches; extracted attributes fold into a target-formatted generation prompt; storage budgeted      |
|**v1.0 — Hardening**           |Rate limits everywhere, console strip, edge DDoS, storage eviction handling, backup-restore test, a11y pass|Security checklist green; WCAG AA across UI; eviction recovery verified; restore test passes                   |

-----

## 6. Non-negotiables / guardrails

- **No DIY auth.** Supabase Auth only. JWT ≤7d + rotation.
- **RLS from day one** — never ship a table without a policy.
- **Model keys server-side only**; per-user rate limit + cost cap on every model route; parameterized queries; `npm audit` in CI.
- **Safe-area** via the v2 luminance-polarity template on every full-bleed surface and the bottom-nav.
- **Icons:** transparent PNGs, full size matrix, manifest declares `any` + `maskable`.
- **Brand separation:** VASEY/AI only. No VASEY.AUDIO crossover anywhere in copy, assets, or metadata.
- **Server is source of truth** — local cache is convenience; never the only copy of a prompt (iOS ITP eviction).

-----

## 7. Definition of Done (v1.0)

Lint + typecheck + unit + integration + build pass before every commit · Conventional Commits · PRs carry what/why/verified · CI green on PR + main · README (centered icon, shields badges, hero, architecture) · LICENSE · CHANGELOG · SECURITY · `.editorconfig` · `.gitignore` · `.env.example` · `.claude/` + `docs/` + `.github/workflows/` present · Lighthouse PWA + a11y ✓ · all six phase acceptance criteria met.