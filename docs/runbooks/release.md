# Runbook — versioning & releases

How VIZ(IO)N versions are defined, surfaced in the UI, cut, and published.

## Policy

- **Semantic Versioning** ([semver.org](https://semver.org/spec/v2.0.0.html)),
  currently in the `0.x` pre-1.0 range: **minor** for a phase gate or a new
  user-facing capability, **patch** for fixes and UI polish. `1.0.0` lands when
  the v1.0 Hardening gate's acceptance criteria are met (CLAUDE.md §10).
- **Keep a Changelog** ([keepachangelog.com](https://keepachangelog.com/en/1.1.0/)):
  day-to-day work accumulates under `## [Unreleased]`; a release cuts that
  content into a dated `## [x.y.z]` section. Every released version has a
  matching `vx.y.z` git tag and a GitHub Release.

## Single source of truth

The version lives in **`package.json` only** — never hardcode it anywhere else.

```
package.json  "version"
      └─ next.config.ts   env: { NEXT_PUBLIC_APP_VERSION: pkg.version }   (build-time)
             └─ src/lib/version.ts   APP_VERSION
                    ├─ BrandPills   (sign-in gate `v0.2.1` pill)
                    └─ Footer       ("VIZ(IO)N v0.2.1 · Multi-Model Prompt Studio")
```

Bump the one number and every surface follows at the next build.

## Cutting a release

All in **one PR**, so `main` is never in a half-released state:

1. **Bump** — `npm version <x.y.z> --no-git-tag-version` (updates `package.json`
   + `package-lock.json`; the flag matters — tags are the workflow's job).
2. **Cut the changelog** — in `CHANGELOG.md`, rename `## [Unreleased]`'s content
   to `## [x.y.z] - YYYY-MM-DD`, leave a fresh empty `[Unreleased]` above it,
   and add the compare link at the bottom of the file.
3. **Verify** — the full gate (`lint → typecheck → test → e2e → build`), commit,
   push, PR, merge.

## What happens on merge

`.github/workflows/release.yml` runs on every push to `main` that touches
`package.json`:

1. Reads `version` from `package.json`.
2. If the `v<version>` tag **already exists**, exits quietly (idempotent — safe
   on lockfile-only or dependency-bump merges).
3. Otherwise extracts the `## [<version>]` section from `CHANGELOG.md` — and
   **fails loudly if the section is missing**, so a bump can't ship undocumented.
4. Creates the `v<version>` tag at the merge commit and publishes a GitHub
   Release titled `VIZ(IO)N v<version>` with the changelog section as notes.

No secrets are involved: the workflow uses the repo-scoped `github.token` with
`contents: write`.

## History / backfill

Tags `v0.1.0` (scaffold + P1 shell, 2026-06-13) and `v0.2.0` (2026-07-01) were
created retroactively on the commits that bumped those versions, so the
changelog's compare links resolve for the whole history. Releases from `0.2.1`
onward are produced by the workflow.
