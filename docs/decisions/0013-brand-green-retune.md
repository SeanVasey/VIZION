# 13. `--laser` follows the brand artwork, not the other way round

Date: 2026-08-10
Status: accepted (inverts the "art re-derives from tokens" lesson in
[`tasks/lessons.md`](../../tasks/lessons.md); no ADR superseded)

## Context

PR #104 imported an iOS 26 Liquid Glass icon set into `public/brand/` — a new
mark **and** a new green. PR #105 wired it through every favicon, PWA,
apple-touch and splash derivative, and through both in-app brand surfaces. That
left two greens live in the same header:

|                          | hex       | hue       | vs `--void` | vs light page |
| ------------------------ | --------- | --------- | ----------- | ------------- |
| `--laser` (design token) | `#b7ff3c` | 82.2°     | 15.76:1     | 1.06:1        |
| Liquid Glass artwork     | `#dffa04` | **66.6°** | 16.15:1     | 1.03:1        |

Measured off the rendered document, not inferred: `#B7FF3C` on the wordmark's
"IO" against `#CBE801`–`#D2EE02` across the header tile's gradient.

## The precedent this decision inverts

This drift has happened before, and `tasks/lessons.md` records both the incident
and the rule drawn from it:

> **The tile is a token consumer, not an independent palette.** The previous
> icon art was authored outside `src/styles/tokens.css` and drifted a full hue
> band from the brand accent: hue 64–74° greens (`#eaf72b`/`#aace04`/`#84ac00`)
> against `--laser: #b7ff3c` at hue 82°. […] **the icon must re-derive from the
> tokens, never approximate them.**

The #104 artwork at 66.6° lands **inside that same band**. On the letter of the
rule, the fix would be to re-anchor the artwork on `#b7ff3c`.

That rule is kept, with one boundary made explicit: **it governs derivative
artwork, not a brand refresh.** It was written when the icon was an
approximation of the brand and the tokens were the brand. #104 is not an
approximation — it is a designed identity, delivered as an Icon Composer set
with its own appearances, of which the green is a constituent. When the brand
itself moves, the token is the thing that has drifted.

Applying the old rule here would also have been self-defeating in practice.
`public/brand/` is protected source of truth, and its composed previews — one of
which `ScreenHeader` now serves directly — are `#dffa04`. Re-anchoring only the
generator's `LASER` constant would have left the header tile on the artwork
green and traded a visible divergence for a subtler one.

## Decision

`--laser` moves `#b7ff3c` → `#dffa04`. Three hand-tuned derivatives that encode
the old hue as literals move with it:

| Site                                               | From                       | To                        |
| -------------------------------------------------- | -------------------------- | ------------------------- |
| `tokens.css` `--laser`                             | `#b7ff3c`                  | `#dffa04`                 |
| `tokens.css` `--laser-glow`                        | `rgba(183, 255, 60, 0.25)` | `rgba(223, 250, 4, 0.25)` |
| `tokens.css` `--accent-ink` (light, **×2 blocks**) | `#3f6b00`                  | `#5b6600`                 |
| `AmbientNebula.tsx` `LASER_RGB` / `accentRgb`      | `"183, 255, 60"`           | `"223, 250, 4"`           |

`--accent-ink` is written twice on purpose: `tokens.css` defines the light theme
in both `:root[data-theme="light"]` and the verbatim
`@media (prefers-color-scheme: light) :root[data-theme="system"]` block. Writing
one and not the other leaves a system-light user on dark values — the hazard
documented at the top of `dev-accents.css`.

`AmbientNebula` carries the channels as literals because a canvas cannot read a
custom property. Leaving them behind would reproduce the original incident's
exact failure mode — art that never references the token file — relocated from
an SVG to a canvas.

## What does not move, and why that matters

**`--on-laser` is unchanged.** The §6 contrast law is _text on a `--laser` fill
is ALWAYS `--on-laser`_, and `--on-laser` `#0e1013` on the new Laser measures
**16.16:1** against the retired 15.77:1 — it goes up. (`--void` `#0f1012`, a
shade lighter, reads 16.15:1 against 15.76:1; the law is written on `--on-laser`,
so that is the figure that binds.) The law holds and every button, chip and FAB
keeps its ink. This retune touches hue, not the polarity the law rests on.

**The developer-accent corridor survives — measured, not assumed.**
[0003](./0003-developer-accents.md) sets a semantic-clearance floor of **20
ΔE2000 to `--laser`** for every accent, so the twelve accents _are_ bound to
this token. `tests/unit/developer-accents.test.ts` does not encode that floor —
it binds luminance against the card fills and ΔE2000 _between_ accents — so a
green unit suite is not evidence here and the clearance was recomputed directly.
(The CIEDE2000 implementation used was self-checked against 0011's published
`--dev-openai` ↔ `--laser` figure of 66.7 and reproduced it exactly.)

| accent     | vs `#b7ff3c` | vs `#dffa04` | Δ    |
| ---------- | ------------ | ------------ | ---- |
| anthropic  | 52.2         | 48.9         | −3.3 |
| openai     | 66.7         | 63.4         | −3.3 |
| deepseek   | 67.9         | 75.1         | +7.2 |
| **google** | 33.4         | **37.0**     | +3.6 |
| meta       | 71.5         | 75.1         | +3.7 |
| minimax    | 75.2         | 70.9         | −4.3 |
| mistral    | 52.2         | 46.5         | −5.8 |
| moonshot   | 60.4         | 61.9         | +1.5 |
| perplexity | 48.3         | 50.4         | +2.0 |
| qwen       | 84.2         | 81.3         | −2.9 |
| zai        | 67.7         | 70.4         | +2.7 |
| xai        | 46.5         | 47.5         | +1.1 |

All twelve clear the floor of 20; the tightest is google at **37.0**, still
nearly double it. 0003's other floors hold too — `--flare` dark 65.1 and light
70.0 (floor 18), `--amber` 24.0 and `--pulse` 27.2 (floor 15). The twelve
accents and [0011](./0011-openai-maroon.md)'s sanctioned exception are therefore
unaffected, and `developer-accents.test.ts` passes unmodified.

0011's own evidence table records `--laser #b7ff3c` at the value current when it
was written. It is left as-is: an ADR is a dated record, and rewriting its
measurements would falsify it. This decision supersedes the value.

**`scripts/generate-icons.mjs` now derives rather than restates.** Its `LASER`
was a literal that happened to equal both the artwork and, after this decision,
the token — correct by both measures without changing. That is precisely the
condition this repo has been burned by before: agreement with `tokens.css` that
nothing enforces, holding right up until someone retunes one and not the other.
The script therefore reads `--laser` and `--void` out of `src/styles/tokens.css`
(first match, i.e. the dark block — an app icon has no theme, it has an
appearance). Regenerating after the change produced **byte-identical output
across all 33 files**, which is the evidence that the derivatives already
matched; the edit converts that from coincidence into construction.

## `#5b6600` is derived, not picked

`--accent-ink` exists because Laser as _text_ on a light surface is the 1.09:1
contrast FAIL; the light theme substitutes a deep same-hue tone. Moving the hue
without re-deriving that tone would leave the light theme on an 82° green while
everything else reads 66.6°.

`#5b6600` is the same construction at the new hue — 66.6°, saturation 100%,
lightness tuned to hold the corridor _position_, not merely to pass:

| Light backdrop | `#3f6b00` (retired) | `#5b6600`  |
| -------------- | ------------------- | ---------- |
| page           | 5.55:1              | **5.50:1** |
| glass          | 6.18:1              | **6.12:1** |
| surface        | 6.06:1              | **6.06:1** |

Every value clears AA (4.5:1), and the token sits where it sat — inside the
corridor `--amber-ink` (5.6/6.2/6.2) and `--flare` (5.6) already occupy, so the
light palette's internal balance is preserved rather than merely re-passed.

## Consequences

- One brand green across artwork, icons, and UI. The header tile and the
  wordmark's "IO" are the same hue for the first time.
- Blast radius is every accent surface — buttons, focus rings, the wordmark,
  the NEBULA+ canvas, diff highlights. Cosmetic, no logic, one revert to undo.
- No automated test asserts rendered colour, so the load-bearing check is
  visual: both themes rendered and pixel-sampled, including a system-light user
  with no `data-theme` set.
- Fixture hexes are **not** design tokens. `tests/unit/media-{highlight,context}.test.ts`
  and `media.test.ts` carry `#b7ff3c` as sample palette text inside generated
  prompts, and as raw RGB pixel bytes for an extraction test. They are arbitrary
  input and were deliberately left alone; a blanket replace would corrupt them.
- If a future icon set is a _derivative_ rather than a refresh, the
  `lessons.md` rule applies unchanged and the art re-derives from these tokens.
