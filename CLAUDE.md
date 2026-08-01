# CLAUDE.md — VIZ(IO)N (Standard v2.0)

> Operating contract for any agent (or human) working in this repo. Read this
> first, then `tasks/lessons.md`, before starting a phase.

## 1. Role

You are a **senior staff engineer + UX lead** building **VIZ(IO)N**, a VASEY/AI
mobile-first prompt-engineering PWA — the successor to rePROMPTer 2. Sixteen target
models from twelve developers (Fable 5 · Opus 5 · Sonnet 5 · GPT-5.6 Sol/Luna/Terra ·
DeepSeek V4 · Gemini 3.6 Flash · Muse Spark 1.1 · MiniMax M3 · Mistral Large 3 ·
Kimi K3 · Sonar Pro · Qwen3.7 Max · Grok 4.5 · GLM-5.2), a per-model
thinking-depth selector, six enhancement modes,
media-aware prompting, accounts, and a versioned prompt library. **Ship-ready at
every commit.**

The **living canon** — reconcile against these — is the code, `CHANGELOG.md`,
`src/styles/tokens.css`, and the audit ledger under `docs/audits/` (see
`docs/decisions/0005-living-canon.md`). The v1-era planning documents
(`VIZION FINAL PLAN v1.md`, `VIZION-product-spec.md`, `VIZION-style-guide.html`)
are **historical, not authoritative**: they moved to `docs/history/`; source
comments still cite them by section (`product-spec §4.1`) for rationale only.

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

**What green does not mean.** The e2e `mobile-safari` project is WebKitGTK on
Linux, not Mobile Safari. It is evidence about the *rendering engine* — cascade
layers, computed styles, layout — and is **not** evidence about the iOS
*platform*: capability detection, touch-input semantics, storage eviction, or
Home Screen web-app behaviour. It diverges from iOS in both directions, so
"missing in WebKit" does not mean "missing on iOS". Before writing an iOS claim
into a comment, commit, or changelog, read
`docs/runbooks/ios-verification.md` — it carries the measured divergences and
the rule. Two wrong claims have already shipped from getting this backwards.

## 4. CI

`.github/workflows/ci.yml` runs on PR + push to `main`:
`lint · typecheck · icon generation · unit tests · build · Playwright e2e ·
production `npm audit` (blocking) · full-tree `audit:check` (blocking)`.
Preview deploy per PR on Vercel.
`.github/workflows/release.yml` tags `v<version>` + publishes a GitHub Release
(notes from `CHANGELOG.md`) when a `package.json` version bump lands on `main` —
procedure in `docs/runbooks/release.md`.

## 5. Required files

`README.md` · `LICENSE` · `CHANGELOG.md` · `SECURITY.md` · `CLAUDE.md` ·
`AGENTS.md` (environment/runtime notes; defers here for everything else) ·
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

Vercel (primary). Preview deploy per PR; production on `main`. The provider-proxy
routes run on the **Node** runtime, not Edge — they import the provider SDKs behind
`server-only`, which Edge cannot load. (This section previously claimed Edge and cited
it as the DDoS posture; no route has ever declared `runtime = "edge"`. The abuse
control that actually exists is atomic per-user admission in `spend_reserve` — see
§6.) Secrets live in Vercel project env, never in the repo (`.env.example` documents
the shape only).

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
- Rate limits on all endpoints; the abuse control is atomic per-user admission
  in `spend_reserve` (§7), not an edge posture.
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
