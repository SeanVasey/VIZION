# VIZION audit capstone — Adjudication (the Gate)

Stage 1 is complete and read-only. Nothing below has been implemented.
**Awaiting rulings on the questions in §5 and an explicit `GO` before Stage 2.**

## 1. One-screen summary

**Baseline health: fully green.** Clean install, lint 0, typecheck 0, unit
976/976, e2e 27/27 (mobile-chrome), build clean, `npm audit` 0 vulnerabilities.
No S0 exists; nothing is broken in production terms. This is a disciplined,
well-tested codebase whose defects are drift and edge-cases, not rot.

**Invariants: 9 of 14 pass cleanly.** One fails, four are partial:

|                                                                                                                                               | Status   | One-line reason                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| INV-01 contract · INV-02 keys · INV-03 caps · INV-05 RLS · INV-09 icons · INV-10 manifest · INV-12 wordmark · INV-13 mesh · INV-14 PR rulings | **pass** | Evidence rows in `01-ledger.md`                                                      |
| INV-06 zero emoji                                                                                                                             | **fail** | 17 rendered UI sites use emoji-range glyphs as icons (`INV-002`)                     |
| INV-07 laser law                                                                                                                              | partial  | Text law holds everywhere; two laser _strokes_ render at 1.06:1 on light (`INV-001`) |
| INV-04 cost truth                                                                                                                             | partial  | No-usage fallback displays/ledgers ~4 chars/token estimates unmarked (`INV-005`)     |
| INV-08 brand separation                                                                                                                       | partial  | `SECURITY.md` routes reports to a vasey.audio address (`INV-003`)                    |
| INV-11 type roles                                                                                                                             | partial  | Footer version line is `font-mono` outside the output region (`INV-004`)             |

**Top five risks**

1. **CI executes nothing** (`PRI-002`, S1): `ci.yml` has zero completed runs
   ever — every quality gate in the repo's contract is enforced only on
   whichever machine remembers to run it.
2. **The offline save path can lie and lose work** (`SW-001` + `SW-002` +
   `SW-007`/`TYP-002` cluster, S1): enqueue failures are swallowed behind an
   unconditional "Queued — syncs when online", a pre-hydration save strands
   forever under `userId: ""`, and poison items retry silently for good — the
   exact iOS-eviction scenario §6 exists to protect.
3. **Storage quota is honor-system** (`MED-001` + `MED-002`, S2): direct
   uploads to `media/{uid}/` bypass the reserve flow entirely, and the bucket's
   real 25 MB limit contradicts the 50 MB every copy surface promises.
4. **Light theme breaks the product's own laws** (`INV-001`, `A11Y-003`, S1):
   the streaming progress sweep is invisible and selected-state fails the 3:1
   non-text floor — in the theme half of users see.
5. **The enhance route blocks its event loop** (`PRI-001`, S1): an unbounded
   O(n·m) word diff runs synchronously per request, worst case grown since the
   prior audit; a handful of large concurrent runs degrades every user.

**Single highest-leverage fix:** `PRI-002` — enable GitHub Actions (an
owner-only dashboard action per `docs/runbooks/ci-enablement.md`; zero code).
It converts the entire existing local gate, at once, into an enforced one.

## 2. Counts

153 findings (168 raw agent findings; 14 cross-track duplicates merged, 2
pass-evidence rows recorded separately, 1 lead-authored process entry). Every
S0/S1 candidate was adversarially verified: 16 CONFIRMED, 2 DOWNGRADED, plus
one lead-verified promotion (`INV-004`).

| Severity | Count |     | Fix class      | Count |
| -------- | ----- | --- | -------------- | ----- |
| S0       | 0     |     | AUTO-SAFE      | 27    |
| S1       | 13    |     | AUTO-REVIEW    | 56    |
| S2       | 52    |     | MANUAL-APPROVE | 54    |
| S3       | 88    |     | NEEDS-RULING   | 16    |

| Track    | INV | PRI | MOD | PRV | MED | LIB | SW  | SEC | DSN | A11Y | TYP | DEP | DEAD | PERF | DOC |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- | --- | --- | ---- | ---- | --- |
| Findings | 10  | 16  | 7   | 9   | 9   | 10  | 7   | 10  | 21  | 11   | 10  | 5   | 5    | 8    | 15  |

## 3. Regressions (Track PRI)

**None.** All 83 prior-art items were dispositioned
(28 resolved, 18 partially-resolved, 33 still-open, 2 superseded, 2 n/a);
no previously-resolved item has come back. Two process anomalies worth naming,
neither a regression:

- `PRI-015`: EXP-03 (favorites/collections/templates) shipped in full against
  a recorded "not currently worth developing" verdict with no decision
  reversal on record — the work is good, the governance trail is missing.
- The v0.2.1 ledger's 7 P0 items are all resolved; of its 15 P1 items, 6
  remain open (`APPLE-01`, `PROD-04/05/06`, `A11Y-01` measurement, `GOV-01`) —
  carried into this ledger, not silently dropped.

## 4. MANUAL-APPROVE list (54) — recommendation each

Recommend **yes** unless noted. "W" = proposed wave.

| id       | W    | Item (short)                                              | Rec             | Why                                                                                         |
| -------- | ---- | --------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| INV-001  | W1   | Light-theme stroke tokens for progress sweep/shimmer      | yes             | Invariant; token + two consumers; visual delta is "becomes visible"                         |
| INV-002  | W1   | Replace 17 emoji glyphs with the SVG icon language        | yes             | Invariant fail; the icon components already exist for most shapes                           |
| INV-003  | W1   | Swap SECURITY.md contact off vasey.audio                  | yes             | Invariant; needs owner to name the address (suggest GitHub private vulnerability reporting) |
| INV-004  | W1   | Drop `font-mono` from footer version line                 | yes             | Invariant; keep `tabular-nums` in Reddit Sans                                               |
| INV-005  | W1   | Mark estimated cost as estimated end-to-end               | yes             | Invariant; "≈" in UI + `estimated` flag in ledger rows                                      |
| INV-008  | W5   | Fix wrong-timestamp cross-refs in applied migrations      | yes             | Comment-only edits; no schema change                                                        |
| INV-010  | —    | Recreate `vizion-brand-lockup.html`                       | **no**          | Component + spec text are canon; write the ADR instead (Q16 area)                           |
| PRI-001  | W2   | Bound/offload the O(n·m) server diff                      | yes             | Cap input pairs + early-exit; behavior-preserving for normal inputs                         |
| PRI-002  | W0\* | Enable GitHub Actions                                     | yes             | \*Owner dashboard action, not a commit; do first                                            |
| PRI-006  | —    | Build the semantic eval harness (PROD-04)                 | **defer**       | Feature-scale; goes to TODO as CORE/LATER                                                   |
| PRI-007  | W6   | Wire iOS splash links (APPLE-01, PR-5 media queries)      | yes             | Or delete the 518 KB of splash PNGs — pick in Q-area; wiring honors the P1 decision         |
| PRI-008  | W5   | Declare the six workbox-\* runtime deps                   | yes             | Same fix as DEP-001                                                                         |
| PRI-009  | W3   | Add axe + 320px viewport to e2e                           | yes             | Closes the "WCAG AA pass" claim gap                                                         |
| PRI-010  | W3   | Nonce the theme bootstrap; drop `unsafe-inline`           | yes             | Same fix as SEC-001                                                                         |
| PRI-014  | W3   | "≈" marker on composer token estimate                     | yes             | One-string change                                                                           |
| MOD-001  | W2   | Stop contradictory refine chips on shape-preserving modes | yes             | Suppress the chips or reconcile the instruction merge                                       |
| MOD-002  | —    | Five-mode text in locked spec vs six shipped              | **defer**       | Outcome of ruling Q2                                                                        |
| PRV-007  | W2   | Pin the three floating provider aliases                   | yes             | Dated ids; keeps cost table honest                                                          |
| PRV-008  | —    | Re-verify Kimi/MiniMax/GLM prices                         | **defer**       | Needs owner-verified published rates; mark provisional now                                  |
| MED-001  | W2   | Close the direct-upload quota bypass                      | yes             | Tighten storage INSERT policy to reserved paths / add DB-side check                         |
| LIB-001  | —    | Per-user growth caps for library/versions/drafts          | **defer**       | Product policy — owner sets numbers; TODO CORE/NEXT                                         |
| LIB-002  | W2   | Same-prompt + acyclicity guard on `parent_ver`            | yes             | Migration with trigger check; protects chain integrity                                      |
| LIB-004  | W2   | Unique index to kill duplicate-save race                  | yes             | `(owner_id, content_hash)` partial index + upsert handling                                  |
| LIB-009  | W2   | Collection delete must not bump `updated_at`              | yes             | Trigger tweak; stops silent reordering                                                      |
| SW-001   | W2   | Truthful outbox status (report enqueue failure)           | yes             | S1; UI copy change + error propagation                                                      |
| SW-007   | W2   | Poison-item retry cap with surfaced error                 | yes             | Pairs with TYP-002 ruling                                                                   |
| SEC-001  | W3   | CSP nonce (drop `unsafe-inline`)                          | yes             | = PRI-010                                                                                   |
| SEC-002  | W3   | Rate limits on non-model endpoints/actions                | yes             | Reuse existing limiter; auth + profile + library writes                                     |
| SEC-003  | W3   | Move refine `baseInput` out of the system role            | yes             | Delimited user-role content; prompt-injection surface shrink                                |
| SEC-010  | W3   | Origin check on destructive POSTs                         | yes             | Cheap defense-in-depth for delete-account/sign-out                                          |
| DSN-001  | W4   | KeyboardActionBar on the nav glass tier (mirrored)        | yes             | Restores tier semantics above the keyboard                                                  |
| DSN-002  | W4   | Media-qualified light/dark `themeColor` pair              | yes             | Carry-forward PWA-08                                                                        |
| DSN-003  | W4   | PressableButton in all sheet footers                      | yes             | One affordance for one visual problem                                                       |
| DSN-007  | W4   | Fix 320px ModeRig label overflow                          | yes             | Coordinates with ruling Q1                                                                  |
| DSN-011  | W4   | Introduce motion tokens (durations/easings)               | yes             | Tokens first, consumers second                                                              |
| DSN-012  | W4   | Resolve `--flare` "never a fill" vs delete swipe fill     | yes             | Recommend sanctioning the destructive fill and updating the token doc                       |
| DSN-016  | W4   | One token for floating bottom-edge offsets                | yes             | 8 vs 12px unification                                                                       |
| DSN-017  | W4   | Squircle radius onto the ladder (match 22% tile)          | yes             | One class change                                                                            |
| DSN-019  | —    | Two coexisting appearance controls (UX-08)                | **defer**       | Product call — owner picks header toggle or Settings only                                   |
| DSN-021  | W4   | Perceptible light-theme secondary-button feedback         | yes             | Explicit active styles instead of brightness()                                              |
| A11Y-001 | W3   | Forced-colors-visible focus indicator                     | yes             | S1; `outline: transparent` trick, no visual change in normal themes                         |
| A11Y-003 | W3   | Non-color selected cue at 3:1 in light theme              | yes             | S1; border/ink treatment on selected cells                                                  |
| A11Y-006 | W3   | Non-color cue for diff additions                          | yes             | Underline or +/- glyphs in the diff                                                         |
| A11Y-007 | W3   | Resting underline on footer links                         | yes             | Smallest possible visual delta                                                              |
| A11Y-010 | W3   | Un-dead the reduced-motion progress pulse                 | yes             | Specificity fix; honors documented intent                                                   |
| DEP-001  | W5   | Declare workbox runtime deps                              | yes             | = PRI-008                                                                                   |
| DEP-004  | —    | Deprecated transitive packages                            | **no**          | Not directly actionable; ride DEP-005 and upstream bumps                                    |
| DEP-005  | —    | openai v4 → current major                                 | **defer**       | Deliberate migration with full adapter regression, not a hygiene commit                     |
| DEAD-001 | —    | 12 unreferenced icon files                                | **no deletion** | Icons are protected and dispositive; fix is PERF-005's precache trim                        |
| DOC-003  | W5   | Fix CLAUDE.md §9 "edge DDoS posture" self-contradiction   | yes             | Aligns §9 with the corrected §7                                                             |
| DOC-009  | W5   | CLAUDE.md §4 understates what CI runs                     | yes             | Doc-only                                                                                    |
| DOC-012  | W5   | LICENSE vs README copyright holder                        | yes             | Owner confirms "Sean Vasey" or "VASEY/AI"; both files then agree                            |
| DOC-013  | —    | ~1,324-line Unreleased changelog                          | **defer**       | Recommend cutting v0.4.0 after Stage 2 lands; owner timing                                  |
| DOC-014  | W5   | docs/audit vs docs/audits split                           | yes             | Keep singular for this capstone, fold into plural at Stage 4                                |

## 5. NEEDS-RULING (16) — direct questions

**Q1 — The mode selector (the five-cell/six-mode question, `MOD-005` + `DSN-007`).**
Shipped reality: `ModeRig` is ONE glass chassis with **six equal cells**
(`grid-cols-6`), lens-lock indicator width `100/6%`, translate `index×100%` —
the geometry is fully six-cell; no five-cell assumption survives in code. The
R5 record and the locked product spec say **five** (Polish arrived later, with
its own migration). At 320px, "Condense"/"Reformat" labels overflow ~5px.

- **(a) Bless six cells as canon** — update the spec text (with Q2), fix the
  320px overflow, add a cell-count-agnostic guard test. _(recommended — and
  per the adversarial verifier, largely a formalization: newer CHANGELOG
  entries already document the 5→6 transition ("now six equal cells"), so the
  contradiction lives only in the un-amended R5 record and the locked spec
  files)_
- (b) Return to five visible cells with an overflow affordance for the sixth —
  a redesign of a shipped, working control.
- (c) Defer; leave the spec contradiction standing.

**Q2 — The three "locked canon" root files (`DOC-005`, `MOD-002`).**
`VIZION FINAL PLAN v1.md`, `VIZION-product-spec.md`, `VIZION-style-guide.html`
describe the v1-era 3-model/5-mode product while CLAUDE.md names them
authoritative-and-locked. They now generate false audit signals every cycle.

- **(a) Reclassify as historical** (move under `docs/history/`), and write an
  ADR naming the living canon (code + CHANGELOG + tokens.css + this ledger).
  _(recommended)_
- (b) Rewrite all three to current truth (large, ongoing maintenance).
- (c) Leave as-is.

**Q3 — Media size limit (`MED-002`).** Bucket enforces 25 MB; app copy,
`media_reserve`, and admission all say 50 MB. Which number is the product?

- **(a) Raise the bucket to 50 MB** to match every promise made to the user.
  _(recommended)_
- (b) Lower app copy/checks to 25 MB.

**Q4 — Refinement knobs (`MOD-003`).** Refine passes silently drop the format
and length knobs a user explicitly chose for the original run.

- **(a) Persist the knobs through refinement.** _(recommended)_
- (b) Document the latitude as intended behavior.

**Q5 — Duplicate detection scope (`LIB-010`).** `content_hash` excludes
`target_model`, so the same prompt saved for a different destination model is
treated as a duplicate.

- **(a) Include the target in the hash** — per-destination versions become
  distinct. _(recommended)_
- (b) Keep cross-target dedup as intended.

**Q6 — Icon stroke weight (`DSN-004`).** Style-guide canon is 1.5px/24grid;
1.75 and 2 ship at 14 sites (effective 1.17–1.75px after scaling).

- (a) Normalize everything to 1.5.
- **(b) Bless per-size optical weights and write the scale into the style
  guide.** _(recommended — the drift reads deliberate)_

**Q7 — Input recipes (`DSN-015`).** Three divergent single-line input styles
coexist (glass/xl/16px · surface/lg/14px · bare).

- (a) One canonical recipe everywhere.
- **(b) Two-tier system (primary editor vs in-sheet fields), documented.**
  _(recommended)_

**Q8 — AvatarCropper viewfinder mask (`DSN-020`).** The only hardcoded rgba
box-shadow in components.

- **(a) Tokenize into the scrim system.** _(recommended, trivial)_
- (b) Leave as a specialized exception, commented.

**Q9 — Destructive-action recovery (`A11Y-011`).** Only a 6-second toast Undo
stands between the user and permanent deletion (WCAG 2.2.1 concern).

- **(a) Persistent recovery** — archived/trash state with restore, Undo becomes
  a shortcut. _(recommended)_
- (b) Adjustable/longer toast timing only.
- (c) Accept the risk, record a WONTFIX.

**Q10 — Outbox payload trust (`TYP-002`, pairs `SW-007`).** Replayed offline
payloads are cast, not validated; malformed items retry silently forever.

- **(a) Runtime-validate on replay + poison-item queue with surfaced error.**
  _(recommended)_
- (b) Leave as-is.

**Q11 — TypeScript strictness (`TYP-007`).** Two flags are free or near-free
(`noImplicitOverride`, `noFallthroughCasesInSwitch`-class); one is a ~30-error
migration (`noUncheckedIndexedAccess`).

- **(a) Enable the free ones now; schedule the big one.** _(recommended)_
- (b) Leave all off.

**Q12 — `test:int` (`DEAD-002`).** The script targets a directory that does
not exist and exits 1; AGENTS.md documents it as real.

- **(a) Delete the script + doc line** (no integration tier is planned).
  _(recommended unless you intend one)_
- (b) Create `tests/integration/` and wire it into CI.

**Q13 — Target decomposition (`PRI-011`, PR-7-gated PROD-01).** The overloaded
"target" id still selects optimizer, destination idiom, and pricing at once.
PR-7 requires explicit approval before any taxonomy change.

- (a) Approve decomposition now (XL effort).
- **(b) Not now — respect PR-7, keep on the backlog with its evidence.**
  _(recommended)_

**Q14 — R8's media-studio dynamic import (`PRI-016`).** The recorded
mechanism no longer exists; media components ship statically.

- **(a) Restore route-level splitting as part of PERF wave (pairs
  `PERF-001`).** _(recommended)_
- (b) Accept static shipping and amend the R8 record.

**Q15 — README phase table (`DOC-007`).** Phases "v0.4 Library" and "v0.5
Media" are marked done but no such releases exist (both shipped inside
0.2.x/0.3.0).

- **(a) Reword phases as feature-milestones, decoupled from version numbers.**
  _(recommended)_
- (b) Leave as aspirational numbering.

**Q16 — Audit branch name (`DOC-015`).** Capstone says `audit/2026-08-01`;
the session mandate fixes `claude/vizion-audit-capstone-dcxs77`.

- **(a) Accept the mandated branch for this audit.** _(recommended)_
- (b) Mirror to `audit/2026-08-01` after the Gate.

## 6. Proposed wave plan (post-GO)

- **W0 Stabilize** — empty: no S0 exists. Parallel owner action: enable
  GitHub Actions (`PRI-002`) via the dashboard per `ci-enablement.md`.
- **W1 Invariants** — `INV-001`…`INV-005` (the five violations), plus the
  AUTO-SAFE guard hardening that keeps them fixed (`INV-006`, `INV-007`,
  `INV-009`). Nothing cosmetic ships before this.
- **W2 Correctness** — S1/S2 in MOD/PRV/MED/LIB/SW: `MOD-001`, `MOD-004`,
  `PRV-001/002/003`, `MED-001/003/004/005`, `LIB-002/003/004/009`,
  `SW-001/002/007`, `PRI-001`, plus ruling outcomes Q3–Q5, Q10.
- **W3 Hardening** — SEC (`SEC-001`…`SEC-010`) and A11Y
  (`A11Y-001`…`A11Y-010`), `PRI-009/010/014`.
- **W4 Fidelity** — approved DSN work, tokens centralized first
  (`DSN-005/009/010/011/013/014/018`), consumers second
  (`DSN-001/002/003/007/016/017/021`), with before/after described per delta.
- **W5 Hygiene** — Stage 3 deletion protocol (`DEAD-003/004/005`, debris from
  DOC), dependency work (`DEP-001/002/003`), doc corrections
  (`DOC-001/002/003/006/008/009/010/011/012/014`, `MED-007`, `SW-003/004`).
- **W6 Performance** — `PERF-001`…`PERF-008` with measured before/after,
  `PRI-007` splash wiring if approved.

Rules as written in the capstone: full gate before every commit; failed
verification reverts the fix; ~30-line overrun triggers re-adjudication;
dispositions updated as work lands.

## 7. Addendum — 2026-08-01 (post-Gate, PR #73)

Owner-directed work merged outside the Gate (Gemini CRLF fix + owner console)
surfaced four ledger entries (`01-ledger.md` addendum): `PRV-010` is already
**resolved** in PR #73; the three below join the review queue:

- **A11Y-012** (S2, AUTO-REVIEW): the pre-existing reduced-effects switch has
  no accessible name — one-attribute fix, recommend **yes**, W3.
- **Q17 / SEC-011** (NEEDS-RULING): closed access blocks the shell, signups,
  and all provider spend, but existing sessions can still reach their own
  RLS-scoped data via server actions. (a) Accept as designed — it is a
  spend/registration control, and the closed screen says "your data is safe"
  _(recommended)_; (b) extend the check into every server action.
- **Q18 / DSN-022** (NEEDS-RULING): the owner console ships the app's first
  native range input (accent-ink tinted). Fold into Q7's input-recipe ruling.

---

**Stop. Awaiting rulings on Q1–Q16 (+ Q17–Q18 above), MANUAL-APPROVE
confirmations/overrides, and an explicit `GO`.**
