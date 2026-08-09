# VIZION — Approval-gated UI & visual design audit (2026-08-09)

Read-only design audit under the approval-gated protocol: no visible change
ships without explicit owner approval, except disclosed **Confirmed Minor
Corrections (CMC)** meeting all ten exception criteria. This file is the audit
of record; the PR presenting it carries the approval request.

Method: baseline gates + a rendered production build against the e2e Supabase
stub (~90 screenshots: 4 routes × dark/light × 320/390/768/1280 + interaction
states), then an 18-agent fan-out — 8 dimension auditors + a ledger reconciler
in parallel, adversarial verification of every candidate against the living
canon (tokens.css · globals.css comments · ADRs 0003–0011 · `docs/audits/`
ledger · CHANGELOG owner directions), and a completeness critic. Every finding
below survived reproduction; already-adjudicated items were killed with cites.

## 1. Baseline and strongest existing qualities

**Gates (start of audit, no autofix):** lint 0 · typecheck 0 · unit 1254/1254
· production build clean. e2e was not runnable in this container (global-setup
requires WebKit, uninstallable here — documented in `tasks/lessons.md`; CI runs
both legs). **No pre-existing failures.** Working tree was clean; HEAD 9cc1ed3.

**Design DNA (preserved throughout):** dark-first Void/Chalk/Laser role system
with the ink split for light-theme text; the contrast law (laser is fill-only);
the glass family (translucent · solid · chrome bars · ambient scrim); the
NEBULA+ ambient composite; Bebas/Reddit Sans/JetBrains with mono scoped to
output; the pressable press system; dev-accent corner fields; side-anchored
picker cards; documented radius and z ladders.

**What the audit found healthy** (checked, not assumed — full lists in the
workflow record): mono scoping airtight incl. new streaming surfaces; the
Major-Third scale intact with only the two documented sub-scale registers;
`--ultra-ink` tri-block + contrast claims verified by measurement; A11Y-003
selected-ink present on ModeRig/Segmented/QuickChip/PromptDetail; the
focus-ring compose contract honored at 17 keyboard stops on /enhance in both
themes; no horizontal overflow on any route at 320–1280 with default content;
manifest/icon matrix/offline page/branded 404+error surfaces correct; footer
clearance over the bottom nav verified at four viewports (the at-rest
read-through is the deliberate translucent-chrome look); page titles correct on
every routed page except the two filed below; composer error state, drafts
view, collections sheet, and light-theme diff ink all clean under live
exercise.

## 2. Evidence and inspection limitations

- Rendered evidence is Chromium (headless, Playwright) against the stub — WebKit
  and real iOS were not inspectable; per `docs/runbooks/ios-verification.md` no
  iOS platform claim is asserted anywhere in this audit.
- Stub data is small and fixed; long-content cases were probed by DOM injection
  (measured, labeled as such in each finding).
- A real streaming run needs provider keys; the streaming card was audited from
  source + the composer error path live.
- 200 % text-scale probes used root-font-size scaling (the mechanism OS
  font-size settings use), not browser page zoom — stated where it matters.

## 3. Confirmed Minor Corrections — applied and disclosed

Each item was verified against all ten CMC criteria: objectively incorrect,
reproducible, intended result unambiguous from the repo's own rules/siblings,
zero design choice, localized, reversible, restores an existing intended rule,
validated immediately. All are in this PR; each is one revert away.

| ID | P | What was restored | Evidence | Validation |
| --- | --- | --- | --- | --- |
| CMC-01 | P1 | `selected-ink` added to the four active-laser groups A11Y-003 missed (LibraryFilterSheet chips · DraftsToolbar chip · GenerateSheet engine picker · AttachmentTray role rows) | Ledger A11Y-003 disposition claims "every active Laser fill"; grep showed exactly these four `aria-pressed` groups without it; identical sibling recipe (QuickChip) one layer up is the template | Live computed `box-shadow` now `inset …accent-ink` on every active chip; light-theme screenshot |
| CMC-02 | P1 | `.selected-ink:focus-visible` composes `var(--focus-ring)` first (+ corrected the inverted comment) | The utility layer silently replaced the base focus ring — focused active controls showed **no focus indicator** (dark) / were identical to rest (light); violates globals.css's own compose contract, same repair as `.glass`/`.fab-glass` | Focused active cell now computes ring + ink in both themes; probed |
| CMC-03 | P2 | Auto-provenance meta line renders as one inline text run beside the icon (was two side-by-side wrapped columns with interleaved reading order) | Flex parent blockified the new Auto span into its own column (reproduced at 390/320 with control); intent recorded at the site; pre-Auto structure = the control | Build + structure now matches the verified control (icon sole flex sibling) |
| CMC-04 | P2 | `break-words` on the four sans/display surfaces rendering user/model text (PromptDetail h2 · library card title · rationale · assumptions) | Unbroken 60–120-char titles (a pasted-URL title is the documented `deriveTitle` case) panned the whole page at 320–390 and painted through the model chip — against the repo's own pinned no-horizontal-scroll rule and the card comment's "nothing is lost — it reflows"; 13 sibling mono sites already carry it | Injected 120-char token: page pan 0, no clip; probed both routes |
| CMC-05 | P2 | Sheet footer bottom padding floor `pb-[max(0.75rem,env(safe-area-inset-bottom))]` (was `py-3 pb-safe`) | `.pb-safe`'s bare `env()` silently displaced the declared 12 px to **0** on every zero-inset device (measured); the `max()` floor idiom exists in the same component at :428 with the same 0.75 rem | Computed footer padding now 12 px top and bottom |
| CMC-06 | P3 | ModeRig's sub-360 shrink reaches the label (tier tracking carried onto the span whose own `tracking-wide` overrode it) | DSN-007's recorded resolution ("labels stop overflowing at 320") was disproven by measurement — Condense/Reformat 51/49 px in 46 px cells, rendering "CondenseReformat" | All six labels now fit at 320 (max 43 ≤ 46); measured + screenshot |
| CMC-07 | P3 | `<Footer inset />` on the library query-failure branch | Both sibling branches of the same route end with it; Footer's contract comment says "every app surface"; the ledger's R7 verification never covered this branch | Source mirrors siblings (branch not renderable without forcing a query failure) |
| CMC-08 | P3 | `metadata.title = "Not found"` on the root 404 | The only routed surface leaving the root default title; every sibling titles itself; template appends "· VIZION" | Live: tab now reads "Not found · VIZION" |
| CMC-09 | P3 | error.tsx heading `<p>` → `<h1>` (same classes) | The boundary replaces everything under the root layout, so a crash document had **no heading at all**; ScreenHeader records the "every screen gets an h1" rule; visually identical (preflight resets headings, classes govern) | Build + classes unchanged; zero visual delta by construction |
| CMC-10 | P3 | Docs-only factual corrections: `GPT-5.6 Sol/Luna/Terra` → `Sol/Terra/Luna` in README/CLAUDE.md/architecture.md/providers.md (the tier-swap changelog claims the prose was updated); README "32-file" → "33-file" matrix; stale "(v0.2.0)" comment now flags the pending recapture | CHANGELOG [Unreleased] + constants.ts:73-78 give the authoritative order; generate-icons.mjs writes 33 files | grep clean |

**Attempted and reverted:** the sr-only "centre" → "center" copy fix
(AvatarCropper) turned a pinned unit test red — the test asserts the British
string verbatim, so the intended result is not unambiguous from repo evidence
and the item fails CMC criterion 3. Reverted to green; filed as VAR-20.

Post-batch gate: lint 0 · typecheck 0 · unit 1254/1254 · build clean.

## 4. Approval-required proposals (VAR)

No item below is implemented. Rendered evidence unless marked *(source)*.
Rollback for every item is a single revert; none touches backend behavior.

### P2

| ID | Location | Evidence | Proposed visible change | Benefit | Surfaces | Risk | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VAR-01 | ModeRig.tsx:121,129 | At 200 % text-only scale (root 32 px) every cell clips its label mid-glyph: "Clarif / Polish / xpan / nden / form / Adapt" (measured; screenshots). DSN-007/Q1 ruled the 320-px default-scale case only | **(a)** let labels wrap so cells grow taller under large root fonts *(recommended)*, or **(b)** ellipsize | Large-text users keep readable mode names (WCAG 1.4.4-adjacent) | /enhance, both themes | Low; default 16 px rendering must stay byte-identical (pinned by measurement) | Re-probe at root 32 px: no clip; default-scale screenshot diff = 0 |
| VAR-02 | layout.tsx:28 + ThemeManager.tsx:50–81 | When the resolved scheme is light, TWO contradictory `apple-mobile-web-app-status-bar-style` metas coexist — stale `black-translucent` last (3/3 live runs; theme-color pair handled correctly) | **(a)** drop the static `statusBarStyle` and let ThemeManager own the single tag *(recommended)*, or **(b)** drop the runtime mutation | Deterministic iOS status-bar polarity per the safe-area v2 guardrail | Installed-PWA chrome | iOS launch-time value unverifiable here (ios-verification.md) — say so in the commit | SSR + hydrated DOM show exactly one tag; unit pin |
| VAR-03 | ADR-0004 Q7 vs 12 field sites | The two-tier input recipe and shipped fields disagree: the composer textarea (the named tier-1 exemplar) computes 14 px; rename/collection inputs wear tier-1 glass/16 px; /library's two search fields differ in recipe on one screen (measured) | **(a)** amend Q7 to the de-facto rule + convert the few stragglers *(recommended)*, or **(b)** restyle fields to the ADR text. Composer chassis material is owner-directed (only the size half is in play) | One documented input system that matches shipped reality | Composer, library, sheets, settings | Medium — several fields shift 14↔16 px; needs the Q7 amendment written | Per-field computed style vs the amended table |
| VAR-04 | library/[id]/page.tsx:26–41 *(source + rendered analogue)* | Both queries destructure only `data`: a transient query error renders 404 for an existing prompt, or a false "0 versions" history with a silently no-op copy button | Check `error` and render the library list's established can't-load treatment | Transient failures stop masquerading as data loss | /library/[id] | Low; presentation-only branch | Stub-forced failure renders the error card, not 404/empty |
| VAR-D1 | docs/preview.png + README:30–31 | The README hero still shows the retired aperture art, v0.2.1 pill, VIZ(IO)N spelling, and mono footer — four settled-canon changes behind | Regenerate per the recorded recipe (lessons.md: production build, /sign-in, mobile, dark) + update alt text | The repo's front door shows the shipped product | README only (not the app) | None to the app | Visual diff of the new capture vs live gate |

### P3

| ID | Location | Evidence → proposed change |
| --- | --- | --- |
| VAR-05 | MediaManager.tsx:196–201 | Storage byte meter is a laser fill measuring 1.06–1.18:1 on light surfaces (measured) → mirror INV-001: `accent-ink` fill on light (option: record as deliberate; the meter is aria-hidden with an adjacent text readout) |
| VAR-06 | fonts/index.ts:28,37–38 | RedditSans-700 (18 KB) preloaded on every route yet no rule uses weight 700 (live `document.fonts` probe); two JetBrains weights vendored-inert → drop unused weights + guard test, or record the keep |
| VAR-07 | StreamingResult.tsx:114–115 | Only `rounded-md` skeletons in the app (primitive + every loading.tsx use `rounded`) → align to `rounded` |
| VAR-08 | SettingsPanel.tsx:93–94,270–289 | Stored display name violating the slug rule renders the error state on pristine load (stub-realistic; server action never enforces the rule) → dirty-gate the error styling; optionally mirror the regex server-side |
| VAR-09 | enhance/profile/library loading.tsx | Skeletons drifted from the layouts they mirror (composer went solid-chassis-with-nested-CTA after the skeleton's last touch; library skeleton omits the always-rendered quick-chip row ⇒ ~64 px shift) → redraw three placeholders |
| VAR-10 | LibraryBrowser:503 · CollectionSheet:173 · EnhanceComposer:572 | Three Unicode glyphs (⌦ ⌫ ⌸) in SVG-icon company — one file renders the same "Delete permanently" action both ways → three new `Glyph` marks per the Q6 optical rule |
| VAR-11 | LibraryBrowser vs DraftsList/Toolbar | Sibling views diverge on load-more recipe+geometry, filtered-empty pattern (card vs bare line), and search-commit affordance → pick one arm per pair (wording differences are settled — excluded) |
| VAR-12 | 17 btn-laser call sites | Disabled dim splits 8× `opacity-50` vs 9× `opacity-60` (SettingsPanel carries both) → one `.btn-laser:disabled` rule + drop per-site utilities (owner picks the value) |
| VAR-13 | PromptDetail.tsx:443 | Identical pending label "Enhancing…" renders with a spinner at both composer CTAs but bare here → add the spinner span (or record the rule) |
| VAR-14 | NewPromptFab.tsx:140 | FAB anchors to the viewport corner while every other floating surface anchors to the app column — 248 px into empty canvas at 1280 (measured) → anchor to the column edge (or record the corner convention). PWA-07 (desktop layout) stays deferred — this is only internal consistency |
| VAR-15 | generate-icons.mjs:179–184 | icon.svg generated + served but never referenced by any emitted link (SSR head verified) → numbered-icon convention so the scalable favicon ships, or stop copying it |
| VAR-16 | library/[id]/page.tsx:7 | Every prompt tab reads "Prompt · VIZION" (and "Prompt" over 404 content) → `generateMetadata` with the prompt title; also cures the 404-title contradiction |
| VAR-17 | PromptDetail.tsx:441–443,475 | "► Re-enhance" sentence case beside the recorded "► ENHANCE" canon; two divergent copies of the not-configured error string → pick casing; hoist one string |
| VAR-18 | Footer.tsx:52 vs :113 | Same brand cast two ways: aria-label "Vasey Multimedia" vs visible "VASEY Multimedia" → owner brand-casing call (note: all-caps aria-labels risk letter-by-letter SR announcement) |
| VAR-19 | Footer.tsx:102,105 | The app's only `text-[11px]` px-unit type; the same register is `text-[0.6875rem]` at all five sibling sites → normalize to rem (identical at default size; scales with user font prefs) |
| VAR-20 | AvatarCropper.tsx:285 | Lone British "centre" in accessible copy (sr-only); unit test pins the string → change copy + test together |
| VAR-21 | PromptDetail.tsx:271–297 | Compare rail (selects + readout, no wrap) pans the page at 320 with a version history (measured) → let the rail wrap, or stack the readout below ~360 px |
| VAR-22 | segments.tsx:51–67 | Word replacements render fused — "AnnounceWrite", "yourtweet" (LCS matches the space as equal) → display-only thin gap between opposite-op neighbors |
| VAR-23 | PromptDetail.tsx:464–468 | All mutations funnel errors to one line ~700 px below the History/tag triggers — a failed Restore can error entirely off-screen → adjacent error slots or the error-tone toast |

## 5. Observation-only (OBS)

- **OBS-1** BrandPills is the sole 10 px-caps label outside the 0.18 em
  micro-caps register — may be legitimately exempt as a brand element (like the
  footer's 0.25 em line); align or record.
- **OBS-2** The FAB transiently covers the Connection row's value on /profile
  at rest — the frosted-lens float-over-content behavior is recorded as
  deliberate in globals.css; no action proposed.
- **OBS-3** Server action `updateProfileAction` trims but never enforces the
  display-name slug rule (robustness note attached to VAR-08; non-visual).
- Known-open items referenced, not re-raised: DSN-019 (two appearance
  controls, owner-deferred) · PWA-07 (desktop workspace layout, deferred) ·
  PRI-002 (enable GitHub Actions — owner dashboard action).

## 6. Validation plan for approved work

Per approved batch: full gate (lint · typecheck · unit · build) + the
verification recipe named in each row above (computed-style probes, viewport
matrices 320/390/768/1280, both themes, keyboard walks, reduced-motion where
touched) + before/after screenshots at matching conditions + a diff review for
scope drift. Baselines are the ~90 captures from this audit. Nothing merges
red; iOS-dependent items (VAR-02) ship with the ios-verification.md caveat
recorded.

## 7. Approval request

Reply with item IDs, e.g. *"Approve VAR-01, VAR-04, VAR-D1"* · *"Approve all
P2"* · *"Reject VAR-12; revise VAR-03 using option (b)"*. The ten CMCs above
are already in this PR — flag any to revert. Nothing else ships without your
word.

---

# Part 2 — Implementation report (2026-08-09, post-approval)

Owner approval: **"Approve all listed VAR items"** — VAR-01…VAR-23 + VAR-D1.
All 24 are implemented across seven commits (waves B1–B7 + this docs wave),
each gated (lint 0 · typecheck 0 · unit green · build clean) before commit.
Where an item offered bounded options, the choice made is recorded below.

## Dispositions

| ID | Disposition | Choice made / validation |
| --- | --- | --- |
| VAR-01 | done | Labels wrap via `overflow-wrap:anywhere` on the rig label span (break-word does not lower flex min-content — measured); at 200% root scale all six labels render fully, cells grow 56→100px; default scale single-line, unclipped |
| VAR-02 | done | Option (a), extended: `metadata.appleWebApp` removed entirely — even without `statusBarStyle` it made React own and re-insert a status-bar tag (measured both ways); capable/title metas hand-written; live probes 3/3 per scheme show exactly one tag with resolved polarity. iOS launch-time caveat recorded (ios-verification.md) |
| VAR-03 | done | Option (a): ADR-0004 Q7 amended to the de-facto rule; composer/revise/generation textareas → `text-base`, drafts search → the library search recipe |
| VAR-04 | done | Both detail queries check `error` and render the library's can't-load card; head query shared via React `cache()` |
| VAR-05 | done | Meter fills use `bg-accent`/`bg-amber-ink` (dark unchanged; light gains 5.5:1-class boundaries) |
| VAR-06 | done | RedditSans-700 + JetBrains 500/700 dropped; `font-weights.test.ts` pins vendored ⊆ used in both directions |
| VAR-07 | done | `rounded-md` → `rounded` (the primitive's radius) |
| VAR-08 | done | Error treatment dirty-gated; slug rule also enforced in `updateProfileAction` |
| VAR-09 | done | Enhance skeleton = one solid chassis with rails/editor/tray/CTA; library gains the quick-chip row + card anatomy; settings centers the avatar hero; the library comment's absolute claim scoped honestly |
| VAR-10 | done | Archived-view delete uses the trash view's `XMark`; new `FolderMinusMark` + `ClipboardMark` glyphs; U+2300-block scan (⌁ allowlisted) added to ui-contracts |
| VAR-11 | done | Load more → `btn-secondary` centered (the recorded balance rule); filtered-empty → quiet status line in both views (cards reserved for true-empty; recorded wording kept); prompts search gains the drafts toolbar's visible Search button |
| VAR-12 | done | `.btn-laser:disabled { opacity: 0.6 }` (the flagship CTAs' value); 17 per-site utilities removed; ui-contracts bans recurrence |
| VAR-13 | done | Spinner added to the Re-enhance pending state, matching the two sibling CTAs |
| VAR-14 | done | `right: max(1rem, calc((100vw - 640px)/2 + 1rem))` — 16px inside the column at 1280 (measured), phones unchanged |
| VAR-15 | done | Numbered convention (`icon0.svg` + `icon1.png`); SSR head emits both links, SVG first (verified) |
| VAR-16 | done | `generateMetadata` with the prompt's title; missing id 404s from metadata, curing the contradictory tab |
| VAR-17 | done | "► RE-ENHANCE"; one exported `NOT_CONFIGURED_MESSAGE` renders on both surfaces |
| VAR-18 | done | Option (b): aria-label → "VASEY Multimedia" (zero visible change; matches the sibling VASEY/AI label treatment) |
| VAR-19 | done | `text-[0.6875rem]` ×2 (identical at default root; scales with user font preference) |
| VAR-20 | done | "center" in copy + the pinned test string, one commit |
| VAR-21 | done | `flex-wrap` on the compare rail; readout drops to its own line (probe: wraps, no page pan) |
| VAR-22 | done | Thin `mr-[0.25ch]` between opposite-op diff neighbours (presentation only) |
| VAR-23 | done | Per-section error slots: tags at top, restore/version-load beside History, revise/save/delete keep the original line |
| VAR-D1 | done | `docs/preview.png` recaptured per the recorded recipe from the shipped v0.3.0 build (same 1179×2739 frame); README comment + alt updated |

## Validation performed

Per batch: full gate (lint · typecheck · unit · production build). Rendered:
live computed-style probes and screenshots against the running production
build (stub Supabase) at 320/390/1280, dark + light, for VAR-01 (200% root
scale), VAR-02 (3× runs per scheme), VAR-05, VAR-12, VAR-14, VAR-15, VAR-21
(byte-copied-markup probe; live version rows aren't seedable in this stub),
plus the CMC validations in Part 1. Not renderable here: a real streaming
run (provider keys), WebKit/real iOS (environment; caveats recorded), forced
query failures for VAR-04/CMC-07 (source mirrors the sibling branches).

Tests: two intent-preserving assertion updates (drafts filtered-empty line
form; icon-alpha path to the numbered icon) and one string pin updated with
its copy (VAR-20), each in the same commit as its change. New guards:
`.btn-laser:disabled` + per-site-dim ban, U+2300-block scan, font-weight
vendored⊆used suite. Suite grew 1254 → 1260, all green.

## Remaining risks / unverified

- iOS launch-time status-bar behavior without a static tag (VAR-02) — not
  verifiable in this environment; flagged for the next on-device pass.
- The composer textarea's 14→16px raises its rendered line length on
  desktop; measured fine at 320–1280, but worth an on-device glance.
- OBS-1 (BrandPills tracking), OBS-2 (FAB/Connection overlap) remain
  observations only; DSN-019, PWA-07, PRI-002 stay with their owners.

No unapproved visible change shipped: every visible delta traces to a
listed CMC or an approved VAR item above.
