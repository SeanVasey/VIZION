# 3. Per-developer colour on library cards

Date: 2026-07-28
Status: accepted

## Context

Every library card rendered an identical wash — olive bleeding in from the left
edge, muddy red from the right — regardless of which model produced the prompt.
The red read as an error or a pending deletion. It meant nothing.

It was a bug. Both swipe-action panels (`bg-laser` favourite on the left,
`bg-flare` delete on the right, 84px each) were rendered permanently in
`LibraryBrowser.tsx`; only `aria-hidden` toggled with the swipe state. The card
sitting on top of them is `.glass`, which transmits 28% in dark, so both panels
showed straight through at rest. Constant, and model-independent, because
nothing about it was derived from the model.

The remedy asked for was to put each model developer's own brand colour on the
card's right side, and a small coloured mark beside the model name — turning a
false signal into a true one.

## Decision

Two carriers, and only two: a **positive 16px developer-coloured glyph** beside
the model label, and a **soft developer-coloured field** anchored to the card's
top-right corner. No identity spine, no coloured tile behind the glyph.

### The palette is an additive layer

`src/styles/dev-accents.css` is new and `src/styles/tokens.css` has an empty
diff. The tokens file declares itself LOCKED, and it defines the light theme
twice — once for an explicit choice and once for the system-preference path —
so anything written into it has to be written into both blocks or system-light
users silently inherit dark values. Keeping the twelve accents out of it
contains that hazard and removes the "did you edit the locked tokens?" question
entirely.

### One hex per developer, in both themes

Each accent is used against three surfaces: the dark card (`--glass` over
`--void`, and again over the aurora-lit ground, the darker of which binds), the
light card, and — for the mark — the card surface itself. Solving 3:1 against
the aurora-lit dark card and 3:1 against the light card simultaneously puts
relative luminance in a corridor that lies *between* the two card fills. Every
accent sits in that corridor, which is why one value is correct in both themes
and why none of the twelve appears in a light block. A test fails if a light
override is added, because adding one destroys the property the palette was
derived to have.

### Where the colours come from, and where one does not

Ten are sourced first-party and drift only as far as a measured collision
forces. Two are weaker and say so in their token comment:

- **Z.ai** takes Zhipu's blue — the corporate sibling. Z.ai's own site CSS is
  black throughout and its published mark colour is `#2d2d2d`, unusable on
  Void. Right entity, sibling source.
- **xAI** is **neutral, and it is the only entry that is.** Grok's production
  CSS declares `oklch(11.57% 0 none)` — chroma literally zero — its favicon is
  `#050505`, and the Simple Icons dataset carries no xAI entry at all. There is
  no chromatic identity to source, so the accent renders that fact rather than
  papering over it: a cool graphite matching the house neutrals. It first
  shipped as an assigned hue chosen by rule, which had the effect of making the
  one unsourced entry the most assertive mark in the list; the neutral is both
  more honest and more brand-accurate, since xAI's mark is black-and-white by
  intent.

  It is deliberately a **full-contrast** neutral — 3.38:1 against the
  aurora-lit dark card, 3.65:1 against the light card, mid-pack among the
  eleven sourced accents — because the risk with a lone grey among colours is
  that it reads as a *state*. It cannot here: this app expresses "disabled"
  as `disabled:opacity-*` on a still-coloured control, and a model id the build
  does not recognise renders no mark at all, so there is no missing-data
  appearance for it to be mistaken for.

Five brands — Anthropic, OpenAI, xAI, Moonshot, Z.ai — publish black or
near-black as their primary. A literal "use the brand colour" build would have
given five cards no visible accent and seven a vivid one, which is a different
kind of meaningless, not a fix.

### Semantic clearance is scoped to this route

The floors used (20 ΔE2000 to `--laser`, 18 to both `--flare` values, 15 to
`--amber` and `--pulse`) were set by measured **co-presence on the library
list**, where `--flare` appears only as an alert paragraph and as the delete
swipe panel, and `--amber` and `--pulse` do not appear at all. Anthropic's clay
is the tightest: its hue is held at its published value and its *chroma* is cut
instead, because at clay's hue no higher chroma clears `--flare` at any
luminance in the corridor. Mistral wins the one full-chroma warm slot on a
measured tiebreak — it reaches it at zero cost from its own published flame
ramp, where Anthropic would need a large rotation.

**Rendering `--dev-*` anywhere else makes `--amber` and `--pulse` co-present and
the clearances must be re-derived first.**

### The field's horizontal reach is a construction, not a taste

An accent-coloured glyph sitting inside its own tint fails WCAG 1.4.11 at a
tint of only about 8%. The mark is safe because the field's alpha is identically
zero at every x past 48px — which is exactly the gutter the card's `pr-12`
already reserves free of all content. `--dev-rx` and that `pr-12` are a **pair**,
pinned together by a test: raising one without the other silently puts the mark
inside its own colour. Vertical reach is a percentage rather than a length,
because card height varies with the preview (which is nullable) and with title
wrapping — a fixed radius would make how much colour a card carries a function
of how long its preview happens to be.

### The field is constant; it is not gated on what else is on screen

Eight cards from the same model get eight identical fields. That was raised as
a repeat of the original complaint and is not: what was wrong before was a
*false* signal — a destructive colour asserting "delete" on rows nobody was
deleting. A developer-derived field is constant because the data is constant,
which is a true statement. The alternative — damp the field when every visible
card shares a developer — was rejected outright: scroll one more card in and
every edge brightens, filter down and the page dims. Any treatment whose
strength depends on what else happens to be on screen *is* a state signal, which
is the class of bug being removed.

### One overlay carries the field and the focus ring

`.dev-edge` is a sibling of the card's `<a>`, not a child. The row is
`overflow-hidden` — load-bearing, since without it a swiped card runs 84px past
its own track — and `overflow: hidden` clips every **outset** box-shadow a
descendant draws. The card had therefore had **no visible keyboard focus
indicator at all**, a live WCAG 2.4.7 failure predating this change, which the
e2e focus-ring spec could not catch because it can only reach the signed-out
`/sign-in` route. An inset ring on this overlay survives the clip, and it must
be a sibling because an inset shadow paints *below* its own element's
descendants — a ring drawn inside the card would sit under the card's text.

The field is gated off while a row is displaced (`data-swiping`), so during the
one moment a full-strength `--flare` panel abuts the trailing edge, the action
colour is the only chromatic signal there. The gate moves `--dev-peak`, never
`opacity`: opacity would take the focus ring with it, and a row can be
keyboard-focused and then swiped by the same hybrid-input user.

## Consequences

- `--dev-peak` is the single aesthetic knob. No hex, contrast figure, semantic
  clearance or the focus ring depends on it.
- Every contrast figure here is derived against the **composited** card fill
  under the aurora, not a flat token. A change to `--glass`'s opacity, to
  `--void`, or to the card background invalidates all twelve values. That
  dependency is invisible from the tokens themselves, which is why it is
  recorded here.
- The mark is deliberately *not* gated by Reduced effects; the field is. An
  unrelated comfort toggle must never be able to amputate an identity channel.
- The library filter chips keep the single-colour mark. Their active state is a
  `bg-laser` pill, against which the palette measures around 3.2:1 — camouflage.
