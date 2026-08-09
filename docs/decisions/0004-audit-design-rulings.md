# 4. Design rulings from the 2026-08-01 audit

Date: 2026-08-01
Status: accepted

## Context

The repo audit capstone (`docs/audits/`) raised several design-fidelity
questions where shipped code and the locked style canon disagreed, and asked
for a ruling rather than a unilateral fix. The owner accepted the adjudication
recommendations (PR #72 gate). This record fixes those decisions so the next
audit cycle stops re-raising them.

## Decisions

### Q1 — The mode selector is six equal cells (`MOD-005` / `DSN-007`)

`ModeRig` is one glass chassis with **six equal cells** (`grid` columns
derived from `MODES.length`). The R5 remediation record and the v1-era spec
say five; Polish arrived later with its own migration and the CHANGELOG
already documents the 5→6 transition. **Six cells is canon.** The 320px label
overflow ("Condense"/"Reformat") is fixed by shrinking the label a step below
360px (`max-[359px]:text-[0.625rem]`) rather than redesigning a working
control. The grid and indicator geometry now derive from `MODES.length`, so a
future seventh mode reflows instead of overflowing.

### Q6 — Icon stroke weights are per-size optical, not a flat 1.5px (`DSN-004`)

Style-guide canon reads "1.5px on a 24px grid", but icons ship at nominal
1.5 / 1.75 / 2 stroke widths, yielding **effective** 1.17–1.75px after scaling
to their rendered box. This reads as deliberate optical correction (a 14px
icon needs a heavier nominal stroke to hold the same visual weight as a 24px
one), not drift. **Blessed as an optical-weight scale**: the canon is the
*effective* ~1.5px at the rendered size, and the shared `Glyph` primitive
(`src/components/ui/glyphs.tsx`) uses 1.5px on its 24px viewBox as the
reference. New icons follow the effective-weight rule, not a literal nominal
1.5.

### Q7 + Q18 — Two-tier input recipe (`DSN-015` / `DSN-022`)

Single-line text inputs use **two documented recipes**, not one:

- **Primary editor** — the composer prompt input and the sign-in fields:
  `glass`, `text-base` (16px, the iOS no-zoom floor), generous padding.
- **In-sheet fields** — rename, collection name, and similar: `surface`,
  `text-sm`, tighter padding, sitting inside an already-elevated sheet.

The owner console's native range input (Q18/`DSN-022`) is a third, distinct
control class (a slider, not a text field) and is exempt from the text-input
recipe; it is tinted with `--accent-ink`.

**Amended 2026-08-09 (audit VAR-03, owner-approved).** The shipped fields had
diverged from the tier assignment above — the named tier-1 exemplar (the
composer textarea) wore `text-sm`, while the named tier-2 examples (rename,
collection name) wore glass/`text-base` — so the recorded rule is restated to
match the de-facto system the code actually follows:

- **Floating / primary work surfaces** — the composer textarea, the library
  and drafts search fields, sheet fields (rename, collection name, confirm
  phrase, clarify answers, generation base prompt), and the sign-in fields:
  `glass` (or transparent inside a glass/solid chassis), `text-base` (16px,
  the iOS no-zoom floor), `rounded-xl`.
- **Settings / utility forms** — the Settings identity fields and similar
  labeled form rows: `surface`, `text-sm`, `rounded-lg`, tighter padding.

Converted to conform in the same change: the composer textarea, the drafts
search (which now matches the library search beside it), the revise textarea,
and the generation base prompt (`text-sm` → `text-base`; drafts search also
`surface/rounded-lg` → `glass/rounded-xl`).

### Q8 — The AvatarCropper viewfinder mask is tokenized (`DSN-020`)

The only hardcoded `rgba` box-shadow in components is replaced with a
`--scrim-heavy` token (a Void-based color-mix that inverts with the theme),
folding the viewfinder dim into the scrim system alongside `--scrim-panel`.

### DSN-012 — `--flare` may fill the destructive swipe panel

`tokens.css` described `--flare` as "never a fill". The library delete-swipe
panel fills with `bg-flare` and pairs it with an `--on-flare` ink verified at
≥5.7:1 in both themes. That is a **sanctioned exception**: a full-bleed
destructive affordance where the fill *is* the signal. The rule stands
everywhere else (flare is text/border only); the one destructive-fill site is
documented at its call site.

## Consequences

- The DSN token layer gains motion (`--motion-*`, `--ease-out`), clearance
  (`--float-gap`), and scrim (`--scrim-panel`, `--scrim-heavy`) tokens in
  `globals.css` (not the LOCKED `tokens.css`).
- The v1-era locked canon files that still describe a five-mode / three-model
  product are reclassified as historical under a separate decision (Q2); the
  living canon is code + CHANGELOG + `tokens.css` + the audit ledger.
- Deferred, by owner call: the two coexisting appearance controls (`DSN-019` /
  UX-08) stay as-is pending a product decision on header-toggle vs Settings.
