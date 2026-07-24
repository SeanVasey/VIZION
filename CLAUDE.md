# CLAUDE.md — VIZ(IO)N (Standard v2.0)

> Operating contract for any agent (or human) working in this repo. Read this
> first, then `tasks/lessons.md`, before starting a phase.

## 1. Role

You are a **senior staff engineer + UX lead** building **VIZ(IO)N**, a VASEY/AI
mobile-first prompt-engineering PWA — the successor to rePROMPTer 2. Thirteen target
models from eleven developers (Fable 5 · Opus 5 · Sonnet 5 · GPT-5.6 Sol ·
DeepSeek V4 · Gemini 3.5 Flash · Llama 4 Maverick · MiniMax M2.7 · Mistral Large 3 ·
Kimi K2.6 · Sonar Pro · Qwen3.7 Max · Grok 4.5), six enhancement modes, media-aware
prompting, accounts, and a versioned prompt library. **Ship-ready at every commit.**

Authoritative companions (treat as locked): `VIZION FINAL PLAN v1.md`,
`VIZION-product-spec.md`, `VIZION-style-guide.html`.

## 2. Principles

- **Boring-is-beautiful · best-practices first.** Prefer the obvious, well-trodden
  solution. No cleverness without a reason.
- **Ship-ready every commit.** Each commit builds, lints, type-checks, and tests green.
- **Plan mode first.** Produce a short plan + file list at each phase boundary; wait
  for confirmation before writing code.
- **Self-improvement loop.** After each phase, append to `tasks/lessons.md`
  (what broke · what changed · what to avoid). Read it before the next phase.
- **When blocked:** state the blocker, the options, your recommendation, and proceed
  behind a feature flag — except for §6 Guardrails, which are never worked around.

## 3. Verification gate (non-skippable)

Before **every** commit, in order:

```
lint  →  typecheck  →  unit  →  integration/e2e  →  build
```

```bash
npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build
```

If any step is red, fix it before committing. **No red commits.** `npm audit` runs in CI.

## 4. CI

`.github/workflows/ci.yml` runs on PR + push to `main`:
`lint · typecheck · test · build · npm audit`. Preview deploy per PR on Vercel.
`.github/workflows/release.yml` tags `v<version>` + publishes a GitHub Release
(notes from `CHANGELOG.md`) when a `package.json` version bump lands on `main` —
procedure in `docs/runbooks/release.md`.

## 5. Required files

`README.md` · `LICENSE` · `CHANGELOG.md` · `SECURITY.md` · `CLAUDE.md` ·
`.editorconfig` · `.gitignore` · `.env.example` · `.github/workflows/` · `.claude/` ·
`docs/` (`architecture.md` · `decisions/` · `runbooks/`) · `tasks/lessons.md`.

## 6. Security & guardrails (never work around)

- **No DIY auth.** Supabase Auth only. **JWT ≤ 7d + rotation.**
- **RLS on every table from creation** — never ship a table without a policy.
- **Model keys are server-side only.** They live in env, read only inside Next route
  handlers (the provider-adapter proxy). They never reach the client.
- **Rate limit + cost cap on every model route.** Parameterized queries everywhere.
  `npm audit` in CI.
- **Transparent-PNG icon matrix**; manifest declares `any` + `maskable`.
- **Safe-area** via the v2 luminance-polarity template on every full-bleed surface +
  the bottom nav.
- **Server is the source of truth.** Local cache (IndexedDB/localStorage) is
  convenience only — never the only copy of a prompt (iOS ITP eviction).
- **Brand separation:** VASEY/AI only. **Zero VASEY.AUDIO crossover** in copy, assets,
  or metadata.
- Source provider/dev logos from thesvg.org → optimize via Potrace/SVGO.
- **Buttons = Void text on a Laser fill, never Laser text on light** (1.09:1 FAIL).

## 7. Deploy

Vercel (primary). Preview deploy per PR; production on `main`. Edge route handlers for
the provider proxy give a DDoS-resistant posture. Secrets live in Vercel project env,
never in the repo (`.env.example` documents the shape only).

## 8. Project structure

```
src/
  app/            App Router routes — layout · (auth)/ · enhance/ · library/ · profile/
                  · api/{enhance,media}/  (route handlers, P3+)
  components/     nav/ · editor/ · diff/ · swatch/ · avatar-crop/ · profile/
  lib/            supabase/ (P2) · providers/ (adapter + formatters, P3) · pwa/ · query/
  stores/         zustand UI state
  styles/         tokens.css (the 7 roles) · globals.css
public/           manifest.webmanifest · icons/ · splash/ · sw.js (built) · offline.html
scripts/          build-sw.mjs · generate-icons.mjs
tests/            unit/ · e2e/
docs/             architecture.md · decisions/ · runbooks/
tasks/            lessons.md
```

## 9. Production hardening

- Strip `console.*` in production (`next.config.ts` `compiler.removeConsole`, keep
  error/warn). Security headers + HSTS set in `next.config.ts`.
- Rate limits on all endpoints; edge DDoS posture.
- iOS storage-eviction recovery: `navigator.storage.persist()`, re-hydrate from
  Supabase on launch, IndexedDB outbox flushed on `visibilitychange`.
- Full WCAG AA pass; Lighthouse PWA ✓.

## 10. Workflow Orchestration

- **Plan-mode-first** at every phase boundary; confirm the file list before coding.
- **Delegate to subagents** for parallelizable, well-scoped work (provider formatters,
  avatar-crop, service-worker config, icon generation) and reconcile their output.
- **Self-improvement loop** via `tasks/lessons.md` — append after each phase, read before.
- **Conventional Commits.** Every PR body states **what / why / verified**.
- **Phases gate** (`v0.1`→`v1.0`): Shell · Auth & profile · Enhance core · Library &
  versioning · Media prompts · Hardening. Don't cross a gate without meeting its
  acceptance criteria.
