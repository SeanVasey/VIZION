# Changelog

All notable changes to VIZ(IO)N are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — v0.3 Enhance core (P3)

- Provider adapter (`enhance(input, mode, target)`) fanning out to per-target
  implementations: Anthropic/Opus (official SDK), OpenAI/GPT (SDK), Google/Gemini
  (REST). Model strings are env-overridable config (D9); keys are server-side only.
- Per-target idiomatic formatters (Opus XML/CoT · GPT roles/JSON · Gemini
  parts/system-instruction) and the five modes (clarify · expand · condense ·
  reformat · target).
- `/api/enhance` route: auth-required, with a per-user **rate limit + daily cost
  cap** enforced server-side before any model call (backed by a `usage_events`
  ledger with RLS + a `usage_window` aggregate).
- The **transformation diff** — input on the Void end, enhanced output on the
  Chalk end, changed tokens lit in Laser, with a plain-language rationale —
  plus copy / share / export (Markdown · JSON · text) and an Amber cap warning.
- Tests: word-diff, formatters/parse, cost + exporters (unit); enhance-API 401
  (e2e). Pure word-level LCS diff lives in `src/lib/enhance/diff.ts`.

### Added — v0.2 Auth & profile (P2)

- Supabase Auth wired end-to-end: magic link + GitHub + Google on the sign-in gate, with
  OAuth/PKCE (`/auth/callback`) and email-OTP (`/auth/confirm`) route handlers and
  sign-out.
- Session middleware (`src/middleware.ts`) refreshes the JWT and gates every route to the
  sign-in page when signed out (server is the source of truth).
- Database (applied to the live project): `profiles` + `oauth_identities` with **RLS
  owner-only policies from creation**, an auto-profile trigger on signup, an `updated_at`
  trigger, and a `password_set` flag. Security advisors: clean.
- Avatars: Supabase Storage bucket (public read, owner-scoped writes) + a dependency-free
  client-side square→circular **avatar cropper**.
- Profile screen with real data — editable full name, display name, email (re-verify),
  default model, and theme; preferences sync to the account and hydrate on load.
- Magic-link → set-password onboarding (D15/A4), enforced by the `(app)` layout.
- Routes reorganised into an authenticated `(app)` group; offline shell decoupled from
  auth (static `offline.html` fallback). Tests: onboarding gate (unit), auth-gate +
  PWA/offline (e2e). Docs: `docs/runbooks/auth-setup.md`.

### Added — v0.1 Shell (Phase 0 + P1)

- Repo scaffold: Standard `CLAUDE.md` v2.0, configs (TypeScript strict, Tailwind +
  CSS-var tokens, ESLint, Prettier, EditorConfig), `.env.example` (keys only),
  `SECURITY.md`, `docs/` (architecture + decision log + runbook), `tasks/lessons.md`,
  `.github/workflows/ci.yml` (lint · typecheck · test · build · npm audit).
- Design tokens: the seven locked roles + Amber, with dark/light/system theming.
- Typography via `next/font` — Bebas Neue (display) · Reddit Sans (body) · JetBrains
  Mono (utility).
- PWA shell: `manifest.webmanifest` (`any` + `maskable`, transparent-PNG matrix),
  hand-authored Workbox service worker (SWR shell · network-first enhance/auth ·
  cache-fallback library) with an offline fallback, iOS splash placeholders.
- Safe-area **v2 luminance-polarity template** wiring status-bar tint + nav contrast.
- 3-tab bottom nav (Enhance · Library · Profile) and the Enhance composer shell
  (mode chips · mono editor · target club rack · ENHANCE CTA).
- Auth gate stub (brand + value prop + three method buttons; Supabase wiring in P2).
- Tests: Vitest unit (safe-area math, contrast guardrails, UI store) and Playwright
  e2e (shell render, nav, theme, manifest, SW, offline shell).

[Unreleased]: https://github.com/SeanVasey/vizion/commits/main
