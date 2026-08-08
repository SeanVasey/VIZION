# 11. OpenAI takes a maroon, below the accent corridor

Date: 2026-08-08
Status: accepted (amends [0003](./0003-developer-accents.md) and
[0010](./0010-google-green-openai-reassignment.md))

## Context

Owner direction, from an on-device review of the library list: `--dev-openai`
reads as pink and should be a maroon.

Under [0010] OpenAI wore `#cf70ba`, a magenta at OKLCH h336 **assigned by rule**
rather than sourced — OpenAI publishes no chromatic identity (openai.com's brand
palette is black and white, and the historic `#10a37f` was ceded with the green
when Google took it). The assignment rule filled the widest open hue gap. It is
a defensible rule and it produced a pink, which is the complaint.

Nothing about 0003's method is in question. What this decision changes is one
of 0003's *constraints*, and only for this token, so it is written down rather
than absorbed.

## The constraint that binds, and why

A maroon is dark. The surface it sits on is dark. Those are in direct conflict,
and the conflict is physical, not procedural:

| candidate | contrast on the aurora-lit dark card `#2E352D` |
|---|---|
| `#800000` (true maroon) | **1.15:1** |
| `#8b1a1a` | 1.36:1 |
| `#902b2b` | 1.54:1 |
| `#a02c2c` | 1.74:1 |

At those values the 16px mark is not "below AA" — it is invisible. This is the
reason 0003's corridor has a *lower* bound at all: an accent must be lighter
than the card it renders on. So "maroon" here can only mean *the darkest red
that still reads*, and the decision is where to stop.

A second constraint caps chroma rather than lightness. `--dev-minimax`
(`#c85975`) is a rose occupying the same lightness tier; at maroon's hue, adding
chroma closes the gap to MiniMax, not to `--flare`. That is why the value is
muted at C\* 29.6 — the same trade 0003 already made for Anthropic's clay
("its hue is held at its published value and its *chroma* is cut instead").

Searching the full sRGB cube under 0003's floors, the deepest fully-compliant
red is `#a06f72` (L\* 51.9, C\* 20.8) — sitting exactly on the corridor floor at
3.01:1. It reads as oxblood, not maroon. Getting an actual maroon requires
crossing the floor, which is the decision below.

## Decision

### `--dev-openai: #9c595d` — assigned maroon, one hex, below the corridor floor

rgb(156, 89, 93) · CIELAB L\* 45.6 · C\* 29.6 · h 19° · OKLCH L 0.5421 C 0.088
h 17° · relative luminance **Y 0.1500**.

**Every ΔE2000 floor from 0003 still passes, with room:**

| against | measured | floor |
|---|---|---|
| `--laser` `#b7ff3c` | 66.7 | 20 |
| `--flare` dark `#ff5247` | 21.0 | 18 |
| `--flare` light `#c81d10` | **18.1** | 18 |
| `--amber` `#ffc24b` | 44.9 | 15 |
| `--pulse` `#3dd68c` | 63.4 | 15 |

Nearest live accents: minimax 10.6, anthropic 13.6 — minimax matching the
palette's tightest standing pair (10.6, deepseek↔meta) rather than undercutting
it. Distance from the retired magenta is 23.1, so the two cannot be confused.
`chromaSpread` is 67, far clear of the `< 24` neutral threshold, so xAI remains
the only neutral.

**The departure.** Y 0.1500 is below the corridor's 0.1995 floor. Measured
contrast for the 16px mark:

| surface | contrast | target |
|---|---|---|
| aurora-lit dark card `#2E352D` | **2.41:1** | 3:1 |
| plain dark card `#23252A` | 2.92:1 | 3:1 |
| light card `#FCFCFD` | 5.12:1 | 3:1 ✓ |

Light is *better* than the magenta it replaces (3.07:1). Only the dark side is
relaxed, and only on the aurora-lit composite; against the plain dark card it is
2.92:1, within rounding of the target.

**Why that is acceptable here.** The mark is **redundant**. The model's name is
rendered as text immediately beside it on the same row, so the mark is not a
graphical object required to understand the content — WCAG 1.4.11 does not bind
it. Nothing in the app is conveyed by this colour alone: filtering, sorting and
identification all work from the text label, and a model id the build does not
recognise renders no mark at all. The colour is recognition support, not
information.

This is deliberately narrow. It relaxes a *contrast target* on one decorative
glyph. It does **not** touch the semantic ΔE floors, which are what stop an
accent reading as "error" or "pending delete" — the false-signal bug that 0003
exists to fix. Those all still pass.

### The exception is pinned, not just documented

`tests/unit/developer-accents.test.ts` previously ran its corridor assertion
against `xai` only, so an out-of-corridor accent would have shipped silently.
A test now asserts that **exactly one** accent sits below the floor and that it
is `openai`. A second one fails the build. The comment header in
`src/styles/dev-accents.css` states the exception rather than continuing to
claim every accent is in the band.

## Consequences

- OpenAI's mark is dimmer than the other eleven on the dark theme. That is the
  accepted cost of the direction; it is a recognition cue with a text label
  beside it, not a state or a control.
- 0010's per-token figures for `openai` are superseded. Its `google` decision,
  and every construction, floor and method in 0003, are untouched and were
  re-verified against the new value.
- The palette no longer has the property that "one hex per developer" and "3:1
  on both composited card fills" hold *simultaneously for all twelve*. The
  one-hex property still holds for all twelve; the contrast property now holds
  for eleven. Any future accent must satisfy both — this is an exception granted
  on the redundancy argument, not a new baseline.
- If OpenAI ever publishes a chromatic identity, re-derive from it and retire
  the assignment entirely.
