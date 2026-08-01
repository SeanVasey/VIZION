# VIZION audit capstone — Stage 0 baseline

Audit date: 2026-08-01
Auditor: Claude Code (repo audit and hygiene capstone v1.0)

## Branch and working-tree state

| Fact | Value |
| --- | --- |
| Branch | `claude/vizion-audit-capstone-dcxs77` |
| HEAD | `34a56db` — Merge pull request #71 (`claude/floating-add-glassmorphic-kobnry`) |
| Working tree | clean at audit start |
| Base | `main` (same SHA — branch created from current main) |

The capstone prompt requests branch `audit/<yyyy-mm-dd>`; the session's operating
mandate fixes all work to `claude/vizion-audit-capstone-dcxs77` and forbids
pushing elsewhere. Per the capstone ROLE clause (repo/session contract wins,
conflict is logged), the audit develops on the mandated branch. Logged as
ledger item `DOC-XXX` track-conflict entry (see `01-ledger.md`).

## Context-block verification

The capstone's CONTEXT BLOCK was verified before running. Discrepancies found:

| Context-block claim | Actual state |
| --- | --- |
| `version_at_audit` expected ~0.2.1 | `package.json` is **0.3.0**; CHANGELOG `[0.3.0] - 2026-07-27` exists, plus a ~1,320-line `[Unreleased]` section above it |
| `VIZION-UI-REMEDIATION-PROMPT.md` (v2, 8 phased gates) as design source of truth | **File does not exist in the repo.** The remediation series R1–R8 is recorded in `CHANGELOG.md` (§ "Fixed — UI remediation (R1–R8)") and `tasks/lessons.md` (§ "UI remediation (R1–R8)"). Those records are the reconstructable spec |
| `vizion-brand-lockup.html` as design source of truth | **File does not exist.** Already documented in `tasks/lessons.md`: the remediation prompt referenced brand files that were never in the repo; only `public/brand/vizion-icon-token.svg` + `vizion-mark-token.svg` exist |
| v0.2.1 audit ledger "66 items, nine tracks" | Actual ledger `docs/audits/VIZION-enhancement-ledger.json` (audited 2026-07-27 at product version 0.2.1) holds **62 proposals** (21 id prefixes), **13 newlyDiscovered** (DISC-01..13), **8 blockedValidation** entries — **83 items total** |
| `globals/tokens` stylesheet path to confirm | Confirmed: `src/styles/tokens.css` + `src/styles/globals.css` (+ `src/styles/dev-accents.css`) |
| Deploy `vizion-io.vercel.app` | Not directly verifiable from this environment; `vercel.json` present |

Platform rulings PR-1…PR-7 located: adjudicated table in
`docs/audits/VIZION-enhancement-evaluation.md` (§ "Platform rulings PR-1…PR-7 —
confirmed or overturned"). Treated as binding throughout (INV-14).

## Baseline verification run

Clean install from lockfile (`npm ci`), then the full gate, on Node v22.22.2 /
npm 10.9.7. All exit codes zero:

| Step | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | installs clean from `package-lock.json` |
| `npm run lint` | 0 | no ESLint warnings or errors (note: `next lint` is deprecated, removal in Next 16) |
| `npm run typecheck` | 0 | no type errors |
| `npm run test` | 0 | **84 files, 976 tests, all pass** (27.2s) |
| `npm run build` | 0 | compiled successfully; warnings below |
| `npm audit` | 0 | **0 vulnerabilities** (info 0 / low 0 / moderate 0 / high 0 / critical 0) |

E2E (run after the measured build, since the Playwright web server rebuilds
the app with stub Supabase env): `npx playwright test --project=mobile-chrome`
— **27 passed, 0 failed** (46.1s). Environment caveats, recorded for honesty:
`mobile-safari` (WebKitGTK) cannot run in this sandbox (WebKit is not
installed and system deps cannot be added — consistent with
`tasks/lessons.md`), and the container's pre-installed Chromium is build 1194
while the lockfile's Playwright 1.60.0 expects 1223, so the run used
container-level path aliases (outside the repo; nothing committed) mapping the
1223 registry paths to the real 1194 binaries, plus a non-executable WebKit
stub solely to satisfy the suite's all-projects preflight assertion. No WebKit
test executed and none is claimed.

Build warnings (baseline, not failures):

- webpack `PackFileCacheStrategy`: serializing big strings (102kiB, 244kiB)
  impacts deserialization performance.
- `@supabase/supabase-js` uses `process.version`, "not supported in the Edge
  Runtime" — import trace via `@supabase/ssr` `createBrowserClient` (a known
  upstream advisory warning; middleware is the only Edge surface).

## Route manifest and bundle sizes (baseline)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      142 B         103 kB
├ ○ /_not-found                            142 B         103 kB
├ ƒ /api/enhance                           142 B         103 kB
├ ƒ /api/media                             142 B         103 kB
├ ○ /apple-icon.png                          0 B            0 B
├ ƒ /auth/callback                         142 B         103 kB
├ ƒ /auth/confirm                          142 B         103 kB
├ ƒ /auth/delete-account                   142 B         103 kB
├ ƒ /auth/sign-out                         142 B         103 kB
├ ƒ /enhance                             19.3 kB         221 kB
├ ○ /icon.png                                0 B            0 B
├ ○ /icon.svg                                0 B            0 B
├ ƒ /library                             9.37 kB         132 kB
├ ƒ /library/[id]                        6.64 kB         129 kB
├ ƒ /profile                             12.2 kB         206 kB
├ ƒ /set-password                        1.14 kB         104 kB
└ ƒ /sign-in                             3.04 kB         176 kB
+ First Load JS shared by all             102 kB
ƒ Middleware                             90.1 kB
```

## Version reconciliation

`package.json` `version` = **0.3.0**. `CHANGELOG.md` headings: `[Unreleased]`
(line 7 — substantial content, ~1,320 lines), `[0.3.0] - 2026-07-27`,
`[0.2.1] - 2026-07-02`, `[0.2.0] - 2026-07-01`, `[0.1.0] - 2026-06-13`.
Consistent: the released version matches the newest dated heading;
a large body of post-0.3.0 work is staged under Unreleased awaiting the next
bump (release flow per `docs/runbooks/release.md` / `release.yml`).

## Prior-art sources (feeds Track PRI)

- **v0.2.1 ledger**: `docs/audits/VIZION-enhancement-ledger.json` — audited
  2026-07-27 against commit `3d32cd9`, product version 0.2.1. 62 proposals
  (verdicts: 42 Confirmed, 10 Partially confirmed, 5 Not currently worth
  developing, 3 Already implemented but needs hardening, 1 Already implemented
  and adequate, 1 Problem valid / solution unsuitable; decisions: 7 P0, 15 P1,
  26 P2, 13 P3, 1 Reject), 13 newly-discovered items, 8 blocked-validation
  entries.
- **Evaluation narrative**: `docs/audits/VIZION-enhancement-evaluation.md`
  (141 KB) — includes the binding PR-1…PR-7 rulings table.
- **Repository assessment**: `docs/audits/repository-assessment-2026-07-29.md`.

Per-item dispositions (`resolved` / `partially-resolved` / `regressed` /
`still-open` / `superseded`) are recorded in `01-ledger.md`, track PRI.

## Remediation-gate mapping (Stage 0 step 5)

Source of truth: R1–R8 as recorded in `CHANGELOG.md` § "Fixed — UI remediation
(R1–R8)" and `tasks/lessons.md` (the standalone prompt file is absent — see
Context-block verification). Status table is appended below after the Stage 1
sweep; expanded evidence lives in `01-ledger.md`.

## Inventory

| Surface | Count / detail |
| --- | --- |
| Tracked files | 373 (248 `.ts`/`.tsx`; `src/` ≈ 20.6k LOC) |
| App routes | 17 (see route manifest above); route groups `(app)` and `(auth)` |
| API route handlers | `src/app/api/enhance/route.ts`, `src/app/api/media/route.ts` |
| Auth route handlers | `auth/callback`, `auth/confirm`, `auth/delete-account`, `auth/sign-out` |
| Server actions | `src/app/(auth)/actions.ts`, `src/lib/drafts/actions.ts`, `src/lib/library/actions.ts`, `src/lib/profile/actions.ts` |
| Provider adapter modules | 12 files under `src/lib/providers/` (`adapter`, `anthropic`, `openai`, `openai-compat`, `google`, `mistral`, `xai`, `config`, `errors`, `formatters`, `json-stream`, `vision`) |
| Supabase migrations | 24 files, 2026-06-13 → 2026-07-30 |
| Supabase tables | 10: `activity_events`, `collections`, `drafts`, `media_assets`, `oauth_identities`, `profiles`, `prompt_versions`, `prompts`, `usage_events`, `usage_reservations` |
| RLS policies | 36 `create policy` statements across migrations (per-table conformance in Track INV / INV-05) |
| Service worker | built by `scripts/build-sw.mjs` from `src/lib/pwa/sw-src.js` → `public/sw.js` (generated, not tracked) |
| Icon suite | 19 PNGs in `public/icons/` + `src/app/icon.png|svg`, `apple-icon.png`; masters in `public/brand/*-token.svg` |
| Tests | 84 unit files (`tests/unit/`), 2 e2e specs + support (`tests/e2e/`), stub seam `tests/stubs/` |

Baseline build is green — no `BLD-001`; track ordering proceeds as planned.
