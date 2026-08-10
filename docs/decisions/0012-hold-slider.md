# 12. The hold-slider: a press-and-hold drag accelerator over a tap trigger

Date: 2026-08-09
Status: accepted (extends [0004](./0004-audit-design-rulings.md)'s slider
ruling, DSN-022); amended same day after the first on-device pass, and
2026-08-10 three times — presses inside an open sheet, the owner's
affordance pass, and the reference-geometry pass (fixed home · thumb ·
measured blur) — see below

## Context

Owner direction, with a reference recording of ChatGPT's iOS composer: its
reasoning-effort gauge expands under a press-and-hold into an inline capsule
track with detent dots and a live label, and the same unbroken gesture drags
between detents; release commits. VIZION's equivalents — the Thinking rail's
depth ladder and Auto-routing's budget preference — were tap-to-open sheets
only: complete and accessible, but two taps and a reorientation for what is,
on a phone, a one-thumb adjustment.

[0004] already ruled that a slider is a distinct control class, exempt from
the text-input recipe. That ruling covered _plain_ sliders (native ranges:
avatar zoom, the developer-accent dial). This decision covers a new member of
the class with a stricter shape: a **pointer-only accelerator layered over an
existing tap trigger**.

## Decision

`useHoldDrag` (`src/components/ui/use-hold-drag.ts`) +
`HoldSliderTrigger`/`HoldSliderOverlay` (`src/components/ui/HoldSlider.tsx`),
with these properties fixed:

- **Tap is untouched; hold is extra.** The wrapped pill keeps its
  `button`/`aria-haspopup` semantics and its sheet. The sheet is the single
  complete path — keyboard, screen reader, and discovery all live there —
  which is what satisfies WCAG 2.5.7's single-pointer alternative. The hold
  gesture is an accelerator in exactly the sense the library's swipe actions
  are: a faster route to a destination that exists without it.
- **The overlay is decoration, not a widget.** It renders `aria-hidden` with
  `pointer-events: none`, portalled to `<body>` (the composer chassis is
  `overflow-hidden` and would clip it). It is deliberately NOT
  `role="slider"`: it exists only mid-gesture and cannot take focus, and a
  slider role that no keyboard can ever reach would be a lie to the
  accessibility tree. The committed value is announced through an
  always-mounted polite live region, and the pill label remains the
  authoritative readout.
- **Two-phase axis claim.** At rest the wrapper claims
  `touch-action: pan-y pinch-zoom` (the lessons.md rule — never `none`);
  once the hold fires, the pointer is captured and a non-passive window
  `touchmove` preventDefault holds the line against a late vertical pan.
  Disabled wrappers make no claim at all. _(Superseded by the amendment
  below: the resting claim is now `pinch-zoom`.)_
- **Hold timing:** 300ms — above `usePressable`'s 130ms press floor so a
  decisive tap stays a tap, below the ~500ms system long-press so the iOS
  callout never races the overlay (callout and context menu are additionally
  suppressed, but only while a gesture is live).
- **Detents are 44px apart** (one touch target each), the selected detent is
  anchored under the finger at expansion, and geometry is a pure function of
  the pointer-down x — which is what makes the gesture unit-testable in a
  layoutless DOM. _(Superseded by the 2026-08-10 reference-geometry
  amendment: the track now expands in a fixed, viewport-centered home and
  geometry is pure with no pointer input; the drag mapping stays
  finger-relative.)_
- **Tone ramp** rides the detent, keyed to the level's identity, never its
  ladder position: `faint`/`silver` (muted mixes) → `laser` (fill-safe both
  themes) → `ultra` (the xhigh/max violet the depth meter already wears).
  The fill never carries ink; `--ultra-ink`'s role comment now records the
  text-free-fill allowance.
- **Mouse is included.** Desktop users get the same accelerator, and it is
  what lets Playwright drive the gesture in CI.

## Consequences

- The composer rails wire it around the existing pickers with zero new
  picker props, so the memo contracts (PERF-006) and the matched-pair
  trigger-class test keep holding.
- Haptic ticks ride detent changes on engines that implement vibration; on
  iOS they are a documented no-op and the visual fill snap is the feedback
  (the standing "never simulate" ruling).
- Hold behaviour on real iOS (callout suppression, mid-drag pointercancel)
  cannot be verified by the WebKitGTK e2e project — it is on the manual list
  in `docs/runbooks/ios-verification.md`.

## Amendment (2026-08-09): the pre-hold window

The first on-device pass failed the same day this landed: on an iPhone the
slider did not display at all — a press produced either nothing or the tap
sheet. Two independent defects lived in the PRE-HOLD window, the one phase
no suite exercised (the mouse e2e waits out the hold before moving; the
unit tests dispatch the events the implementation expects). Either alone
reads as a dead control; both are repaired:

1. **The slop rule discarded the reference gesture.** The recording this
   control is modeled on engages under press-and-slide — one unbroken
   motion, no stationary pause. The shipped rule classified >10px of
   pre-hold movement on _either_ axis as not-this-control and quietly
   swallowed the press (no overlay, and deliberately no sheet). Repair:
   pre-hold movement past slop now **activates** the track when x-dominant
   — the slide _is_ the gesture, on the axis the wrapper always reserved —
   and stands down only when y-dominant (scroll intent, unchanged).
2. **`pan-y` granted the UA the means to kill the press.** `touch-action`
   is consulted once, at gesture start (the two-phase-claim lesson), so the
   resting value is the pre-hold window's only defense — and `pan-y
pinch-zoom` left the UA free to read a pre-hold vertical drift as a pan
   and end the press with `pointercancel` (MDN documents `pointercancel`
   firing once the pointer starts manipulating the viewport). Repair: the
   resting claim narrows to **`pinch-zoom`** — zoom stays native (the WCAG
   guard in zoom-and-share), while single-finger pans starting on the two
   composer pills belong to the gesture. The library's swipe rows rightly
   keep `pan-y`: a full-width list row IS the scroll surface; a ~44px pill
   is not. `none` stays banned.

Verified under real synthesized touch in Chromium (CDP drives the actual
gesture recognizer: touch-action consultation, pointer derivation, click
synthesis): press-and-slide engages and commits, a stationary hold expands,
a quick tap still opens the sheet — `tests/e2e/authed.spec.ts` "under
touch", Chromium-only. Which of the two defects the owner's device hit is
not established and does not need to be; real-iOS confirmation of the
repaired gesture stays on the manual list in
`docs/runbooks/ios-verification.md`.

## Amendment (2026-08-10): presses inside the open sheet

The overlay's z-[85] rationale asserted "a Sheet can never be open
mid-gesture" — true of gestures, but nothing enforced it for PRESSES.
`HoldSliderTrigger` wraps the whole picker, pill and body-portalled Sheet
alike, and React re-dispatches portal children's events up the COMPONENT
tree: with the Target sheet open (Auto on), holding its Auto card, a
routing segment, a model row, or the scrim engaged the slider — capsule
drawn across the open sheet, an uninvited commit on release, the row's tap
swallowed by the trailing-click suppression, sheet scrolling pinned by the
active-phase touchmove preventDefault. (The Thinking rail, enabled
unconditionally, was the worse half.) Repair: `useHoldDrag` starts a
gesture only when the pointer-down target is a DOM descendant of the
wrapper (`e.currentTarget.contains(e.target)`) — containment is the exact
discriminator, since portalled children are React-tree but not DOM-tree
descendants, and every legitimate press targets the pill, which is one.
Every entry path keys off that single admission, so one guard closes all
of them. The Sheet itself is unchanged: stopping pointer propagation in
the app's one dialog primitive would mute presses for every ancestor of
every sheet — too broad a lever for a contract that belongs to the gesture
hook.

## Amendment (2026-08-10): the owner's affordance pass

Two of this decision's accepted trades were revisited on owner direction
("thought through with consideration to user experience and aesthetic
quality"), both resolved with FORM, never a new hue (tokens stay locked;
the `--dev-*` corridor stays library-list-only per [0003]):

1. **The gesture is no longer invisible at rest.** Acceptance shipped the
   sheet as the only discoverable path. Now `HoldSliderHint` — three slim
   vertical ticks, the grip vocabulary the Sheet's grab rail already
   speaks — sits at the trailing edge of a slider-wrapped pill, rendered
   by the pickers behind an opt-in `holdHint` prop that mirrors the
   slider's `enabled` exactly (Target hints only under Auto; Settings'
   picker, which has no slider, never hints). aria-hidden decoration: the
   label stays the readout, the sheet stays the accessible path. (The
   first cut drew three DOTS; at hint scale a dot row reads as a text
   ellipsis — a "more" menu promise, the wrong affordance — so the second
   owner round replaced it with ticks.)
2. **The two stacked capsules stopped dressing alike.** Budget and
   Thinking both drew equal dots, distinguishable mid-drag only by count.
   The overlay now takes `detentMarker`: the Thinking rail passes `bar`
   and its capsule draws ascending ticks — the DepthGlyph meter's
   vocabulary, so mid-drag it reads as the meter expanded (a LADDER) —
   while budget keeps equal `dot`s (equal choices; the fill width is the
   spend readout, [0004]'s "fill width does the disambiguating" ruling
   untouched). Bar height rides the detent's ladder POSITION while the
   fill's color stays keyed to the level's IDENTITY — shape says higher,
   color says which tier; the DepthGlyph split of duties.

The owner's second round ("not as clean as it could be") tightened the
capsule's own presentation, all three repairs form-only:

- **The live readout rides a glass-solid chip**, not bare text. The
  overlay floats over whatever the composer has at that y, so an unbacked
  line collided with the neighbouring rail's label instead of reading as
  UI; the chip puts the tone ink on the track's own designed ground in
  both themes.
- **The wrapped pill conceals while its capsule is up** (opacity, layout
  held, `.hold-slider-conceal` with the standard two motion stand-downs):
  the capsule visually REPLACES the control — the reference behaviour —
  where before a track narrower than the pill (budget's three detents)
  left the pill's tail peeking out beside it.
- **Reached dots go transparent under the fill** — dark dots swimming in
  the laser fill read as sediment, and the fill edge already marks the
  position. They stay in the DOM so detent-id hooks never depend on drag
  position. Reached BARS stay visible: a meter is made of its filled
  bars.

A third round (owner annotation: the readout "duplicating" the model name
beside the Target pill, and a request for a focus treatment) reshaped the
gesture into a focus state:

- **A dim scrim rides the capsule** (`z-[84]`, under the `z-[85]` track;
  mounts and unmounts with the overlay). While a capsule is up the whole
  composer drops back, so the eye holds only the track, the level chip,
  and its tone; release returns the picked state instantly. It is a color
  fade on `--void`, DELIBERATELY never a `backdrop-filter` blur: a
  viewport-scale filter live during a pointer gesture is the exact
  input-queueing regression the bloom bake removed the day before
  ("Taps respond immediately", 2026-08-09) — the dim buys the focus
  without re-pricing pointermove.
- **The chip's readout is the level alone** ("Max", "Quality"). This
  deliberately narrows the acceptance-era "model-qualified live label"
  (CHANGELOG: "Opus 5 · Extra High") for the VISUAL readout only: with
  Auto routing, the thing being changed is the effort, never the model,
  and the model/mode context is already on screen one rail up — printing
  it in the chip stacked "Opus 5" beside "Opus 5". The commit
  announcement keeps the full sentence (`liveLabel` is now announce-only)
  — ears get the context, eyes get the level.

## Amendment (2026-08-10): the reference geometry — fixed home, thumb, measured blur

The owner supplied a screen recording of the reference control itself
(ChatGPT iOS — the same recording lineage this ADR started from) with the
direction "fixed, focused": the capsule must expand in the SAME place every
time, carry a moving thumb, and drop the world behind it out of focus.
Three changes, superseding two acceptance-era choices:

1. **Fixed home supersedes anchor-under-finger.** `computeTrackGeometry`
   no longer takes the pointer x or the selected index: the home is the
   viewport's center (the shell is a centered `max-w-screen-sm` column, so
   viewport center IS the composer's) on the gesturing rail's row, with the
   original left-wins EDGE_MARGIN clamp. Anchor-under-finger optimized the
   hand's reach but landed the capsule wherever the press happened to be —
   measured against the reference it read as floaty, and predictability
   won. The finger still maps RELATIVELY (dragOffset anchors the selected
   detent to the press x), which is why the entire drag/commit suite
   survived the migration untouched. Review refinements (Codex, PR #103,
   two passes): the center and clamp use the VISUAL viewport
   (`visualViewport` offset/width, layout-viewport fallback) — this
   control deliberately preserves native pinch zoom, and a fixed-position
   capsule centered on the layout viewport can open entirely outside a
   zoomed-in user's view; and when zoom leaves that region NARROWER than
   the full-spacing track, the detent spacing COMPRESSES — still
   centered, still static for the gesture, every detent reachable (a
   placement frozen around the selected detent kept the spawn visible
   but let the drag walk the thumb out of the region; and zoom
   multiplies physical travel, so compressed detents cost no precision).
   Below MIN_DETENT_SPACING_PX the geometry stops reserving the
   capsule's chrome entirely: the rounded ends and margins may overflow
   the region (the overlay is pointer-transparent decoration) while the
   detent CENTERS compress into the region minus CENTER_INSET_PX — the
   fourth review pass showed any placement that hides a center makes
   that value unreachable, since the pointer cannot travel past the
   region's edge. Placement never depends on the selection in any mode;
   the home is the visible region's center, always.
2. **A thumb rides the fill's leading edge** (`data-hold-slider-thumb`,
   28px, glass ground + hair ring, core disc tone-colored by the same
   FILL_CLASS ramp — text-free fills only). Position now reads as an
   OBJECT at a place, the reference's grammar; the fill below it keeps
   carrying VIZION's color story. It glides with the fill's own eased
   snap (`.hold-slider-thumb`, both stand-downs collapse to instant).
3. **The focus scrim gained its blur half — measured, not assumed.** A
   static `backdrop-filter: blur(14px)` layer mounts under the dim; the
   dim above it carries the entrance fade so the filter layer NEVER
   animates. That distinction is the whole 2026-08-09 bloom lesson: the
   input-queueing regression was a filter re-priced every frame on an
   animating layer; a static backdrop is filtered once. Probe (the bloom
   investigation's Event-Timing methodology; Chromium, 4× CPU throttle,
   pointer stream mid-drag, A/B via a backdrop-filter:none override):
   blur ON p50 16.4ms / p95 17.3ms / max 17.8ms input delay; control OFF
   run p50 34.3ms — both far inside the 50ms budget, the inversion is
   run-to-run variance at n=8 per arm, and the conclusion is "no
   measurable queueing", not "blur is faster". Both stand-downs drop the
   blur entirely (dim-only — the previously shipped presentation).
   WebKitGTK cannot answer the iOS half; blur cost and gesture feel on a
   real device stay on `docs/runbooks/ios-verification.md`'s manual list.
