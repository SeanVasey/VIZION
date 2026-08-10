# 12. The hold-slider: a press-and-hold drag accelerator over a tap trigger

Date: 2026-08-09
Status: accepted (extends [0004](./0004-audit-design-rulings.md)'s slider
ruling, DSN-022); amended same day after the first on-device pass, and
2026-08-10 six times — presses inside an open sheet, the owner's
affordance pass, the reference-geometry pass (fixed home · thumb ·
measured blur), the single-gesture claim, the backdrop inventory, and
input modality under the gesture — see below

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
   the home is the visible region's center, always. One bound is
   accepted deliberately (fifth review pass): single-GESTURE reach from
   a given press point is limited by the screen edge — true of every
   fixed-gain drag including the original anchor-under-finger placement
   on an unzoomed phone and the reference control itself. The answer is
   composition, not variable gain: release re-anchors, so the next hold
   starts from the new selection with fresh travel room (any value is at
   most two centered gestures away), and the sheet stays the complete
   single-tap path. Per-side gain normalization was declined — it
   decouples the finger from the thumb and makes the two directions
   drag at different speeds, trading the control's 1:1 feel for a
   single-gesture guarantee it never promised.
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
   The sixth review pass caught the claim's gap: the ambient field
   (NEBULA+ canvas at 30fps, bloom drifts) kept animating BENEATH the
   filter, so the backdrop re-filtered per frame regardless of the layer
   being static. Repair adopted: a live gesture stamps
   `data-hold-gesture` on `<html>` (set in activate, removed in
   teardown), which the nebula's existing run-gate consults — the canvas
   freezes holding its last frame, the blooms pause via
   `animation-play-state`, and the one-time-filter claim becomes true by
   construction. The probe's numbers were measured WITH the field
   animating, so they stand as the worst case; the pause only improves
   on them. The world stopping under focus is also the reference
   recording's own look.

## Amendment (2026-08-10): the single-gesture claim

The seventh review pass (Codex, PR #103) pressed on the focus pair's
multiplicity: the two composer rails sit adjacent and both can be enabled,
so two fingers could run two gestures at once — stacked blur/scrim pairs,
crossed capsules, and one shared `data-hold-gesture` attribute torn down by
whichever gesture ended FIRST, thawing the ambient field beneath the
survivor's still-live blur. Of the review's two offered repairs —
reference-count the shared attribute, or prevent concurrency — counting
would have bookkept a state with no design meaning: two full-viewport focus
layers stacked over one composer is a nonsense frame however correctly its
attribute survives. Adopted instead: a module-level exclusive claim
(`gestureOwner` in `use-hold-drag.ts`), taken at pointer-down, released
wherever the press record dies (up, cancel, unmount). While any
hold-slider's press is live, a second pill's press is refused at admission
— no press record, no hold timer — and falls through as the plain tap it
would otherwise be _(superseded by the input-modality amendment below:
the fall-through reopened the sheet-under-capsule state on hybrid inputs,
so the refused pill is now inert for the claim's lifetime)_. The
unit suite pins the refusal, the attribute surviving the refused finger's
lift, and the claim's release on commit and on unmount.

The eleventh pass (with the Vercel agent reviewer flagging the same
defect independently) fixed the one path where "released wherever the
press record dies" was not actually true in a real browser: Escape
mid-drag. `teardown()` released pointer capture while the press record
deliberately stayed alive for the eventual lift — but mid-drag the
pointer sits over the track's center, far from the pill, so once capture
was gone the lift was hit-tested elsewhere, never reached `onPointerUp`,
and press and claim leaked app-wide until remount (after the tenth pass,
that also meant every wrapped pill's click was consumed forever). The
press-leak half predated the claim — the claim globalized it, and the
click consumption weaponized it. Repair at the root: capture's lifetime
is the PRESS's, not the overlay's — teardown no longer releases it, the
captured stream routes the far-away lift back to the hook, and no
explicit release is needed anywhere because pointerup/pointercancel
auto-release capture per spec and unmount disconnects the element. jsdom
hid this for four passes: it has no capture routing, so the unit suite's
Escape lift always "landed" on the pill — the pin is e2e in both real
engines (red pre-fix), driving the lift 150px from the pill and
asserting the world lives on.

The twelfth pass closed the pre-hold mirror of the same leak class: a
mouse is not implicitly captured, so a press starting near the pill's
edge can leave the wrapper inside the slop window — every later move and
the lift itself dispatch elsewhere, and the hold timer fired on the
stale press: a phantom capsule, freeze, and input shield with no pointer
down, and the claim held until remount. This is the window BEFORE the
one the 2026-07 stand-down fix covered (its capture arms only at
y-dominant classification, which requires seeing a move). Repair: a
window-scoped pointerup/pointercancel net armed for exactly the press's
lifetime — the wrapper's handlers run first, so the net acts only on
lifts the wrapper never saw, and an outside lift synthesizes no click in
the wrapper's subtree, so nothing needs suppressing. Capturing the mouse
at admission (the review's other branch) was declined: it would change
edge-press semantics — a drag-away would engage or commit where today
nothing happens — trading a leak fix for undecided design surface.
Pinned red→green in unit (the net is a plain window listener, so jsdom
can express this one) and e2e in both engines (press 2px inside the
edge, jump out in one move, release far away, wait out HOLD_MS — no
phantom, and a fresh hold engages).

## Amendment (2026-08-10): the backdrop inventory

The eighth review pass (Codex, PR #103) audited what the sixth pass's
world-pause actually covered and found the freeze incomplete twice over:
the Horizon's idle breathe kept animating beneath the blur, and the rails
deliberately stay enabled while a run is in flight (dialing the NEXT run),
so a mid-stream hold put the blur over a surface repainting with every
arriving token — sweep, beacon, caret, spinner, counters, the text itself.
Either way the "filtered once" claim failed again, by content this time
rather than by layer.

The repair splits by what the moving thing IS. Ornament pauses: the
Horizon's breathe joins the blooms under `[data-hold-gesture]`
(`animation-play-state`), completing the idle inventory — at rest, nothing
beneath the blur moves. Content stands the blur down: a token stream
cannot honestly hold still, and freezing its DISPLAY to protect a filter
would invert the priorities — so `HoldSliderTrigger` takes a declared
`dynamicBackdrop`, the composer passes it while a run is in flight
(`isPending || stream.active`, covering first runs, refines, and the
handoff frame), and the overlay ships the dim alone for that gesture —
the reduced-effects presentation, already designed and already shipped.
Pinned in unit (dim-only overlay under `dynamicBackdrop` and mid-flight
at the composer, gesture semantics untouched) and e2e (the Horizon's
computed play-state paused mid-gesture, running again on release).

## Amendment (2026-08-10): input modality under the gesture

The ninth review pass (Codex, PR #103) found the fifth amendment's tap
fall-through half was a mis-transcription of the reference semantic: on a
hybrid-input device, a second pointer's press mid-gesture was refused at
admission but its synthesized CLICK still fired, opening the other
picker's sheet (z-70) under the live capsule (z-85) — the exact
sheet-mid-gesture state the admission guard exists to make impossible,
now recreated from the other direction. At rest a refused press has no
one to defer to, so a fall-through tap was the honest reading; mid-claim
it never was — the reference control goes fully modal under a drag.

Two enforcers, matching the review's two offered repairs. The hook
consumes the click: `onClickCapture` eats any click while a FOREIGN claim
is live — no new state, covers both wrapped pills for the claim's whole
lifetime (the 300ms pre-hold window included) and a keyboard-activated
pill mid-drag. The focus pair becomes the input shield: blur and dim flip
to `pointer-events: auto`, so during the ACTIVE phase a second pointer
anywhere in the viewport dies on the pair — non-wrapped triggers (the
Format pill, the submit button, the nav) included. The gesture itself
cannot be stolen: its pointer is captured at activation (implicitly for
touch), and captured streams bypass hit-testing. The dim mounts in every
presentation, so the shield holds under stand-downs and `dynamicBackdrop`
alike.

One residual window was accepted and recorded here: a NON-wrapped
trigger tapped by a second finger inside another pill's 300ms pre-hold
window (before the shield mounts) could still open its sheet, and the
capsule then drew over it — priced as a two-finger race whose closure
"would take a DOM-wide dialog probe at activation, a coupling this
control does not want." _(Superseded by the thirteenth pass, below: the
review re-raised it with the repair reframed as "cancel activation when
another interaction wins," and `role="dialog"` is a web-platform
semantic, not the internal coupling that decline priced in — the
residual is now closed.)_ Pinned in unit (consumed click mid-active and
pre-hold, twin harness; the composer's Target pill inert while a Thinking
capsule is up, working again on release) and e2e (a trial click on the
other pill fails Playwright's receives-events actionability check while
the capsule is up — real hit-testing, which jsdom cannot exercise).

The tenth pass closed the consumption's last carve-out: the ninth ate
clicks only under a FOREIGN claim, which exempted the owner's own pill —
and there a click can only be a second input device (a mouse click
landing inside a touch press's 300ms pre-hold window, Enter activating
the still-focused pill mid-drag), which opened the pill's OWN sheet under
the arriving capsule. The condition collapsed to the simpler, stronger
form: consume while ANY claim is live, no identity check at all. The
plain tap survives by protocol order, not by exemption — pointer-up
releases the claim synchronously before the browser dispatches the
click, so a legitimate tap's click always arrives with no claim held.
Unit-pinned: the owning pill's click consumed pre-hold and mid-drag, the
gesture unbroken through both, and the ordinary tap untouched at rest.

The thirteenth pass closed the modality's last two hybrid holes. First,
the residual this amendment had accepted: the review re-raised it with a
cheaper repair — "cancel activation when another interaction wins" — and
the decline was re-priced and reversed. `activate()` now probes for an
open dialog (`role="dialog"`, honoring the accessibility tree: an
exiting sheet under an aria-hidden wrapper counts as closed, since it is
inert and vanishing) and stands down exactly like a y-dominant scroll —
cancelled, captured so the lift routes back, click swallowed, the sheet
untouched. The sheet is the senior surface from both directions now: no
gesture begins over one (admission guard), and none completes onto one
(activation probe). Second, an ordering hole in the refusal itself: the
claim alone could not carry a refusal to its end — if the owning gesture
released before the refused pointer lifted, both the claim and the
refused pill's suppressClick were clear at click time, and the press
documented as refused whole opened its sheet after all. A per-instance
`refusedPress` marker now survives the owner's release and dies with the
refused stream's own click (or is superseded by the next pointer-down on
that wrapper). The marker is deliberately NOT set for same-wrapper
refusals: both streams share one wrapper there, and a boolean cannot
tell the refused stream's click from the live press's legitimate one —
the mid-claim consumption already covers that case, and its post-claim
tail cannot recreate the sheet-under-capsule state (no capsule is live).
Pinned in unit, all red pre-fix: the refused-then-orphaned click
consumed with the fresh tap working after; the synthetic-dialog
stand-down with the world unfrozen and the lift swallowed; and at the
composer, the template sheet opened by a second device mid-press staying
open and untouched while the capsule never mounts.

The fourteenth pass closed the keyboard channel and a marker-staleness
edge. The focus pair shields POINTERS — `pointer-events` never touches
key dispatch — so a background control left keyboard-focused (or tabbed
to mid-drag) still activated on Enter/Space and opened its sheet under
the live capsule. While the capsule is up, activation keys now die at
the window's capture phase, keydown and keyup both (native buttons
activate Space on keyup); Escape stays the one designed key, and at rest
every key passes untouched. Each input channel needs its own gate: the
shield covers hit-testing, the claim covers wrapped-pill clicks, the
key swallow covers focus-driven activation — synthesized assistive-tech
clicks on background controls mid-drag remain out of scope, since a
hold-drag is a pointer gesture an AT user is not simultaneously
performing, and the sheet stays their complete path. In the same round
the Vercel agent reviewer caught a staleness edge in the thirteenth
pass's refusal marker: a refused pointer that releases OUTSIDE the
wrapper never sends the click the marker waits for, and the stale
marker ate the pill's next keyboard or programmatic click — an
activation a keyboard user must never lose. The marker now carries an
end-watch: the window hears the refused stream end anywhere, and the
marker clears one task later — outliving exactly the one same-task
click the lift can still deliver (the settle() ordering trick), pinned
red→green in unit alongside the key swallow, and in a Chromium touch
e2e (a focused template button, Enter under a live capsule).

## Amendment (2026-08-10): the modality audit — the matrix, closed

After the fourteenth review pass — the eighth consecutive finding in the
same class — the owner directed that the remaining cells be enumerated
and closed proactively rather than surrendered to passes fifteen through
N. The audit below is that enumeration: every phase of the press × every
input channel, each cell carrying its enforcing mechanism or its recorded
acceptance. Three cells were still open and are closed in the same
commit:

1. **Concealment** — the one ending no pointer or key event can report.
   An alt-tab, OS app switch, or locked phone mid-gesture delivers
   nothing to this document; the mouse releases in another window, the
   up never dispatches here, and press, claim, capsule, and world-freeze
   would all sit leaked in a background tab — the passes-11/12 leak
   class through the only channel with no event to net. Window `blur`
   and `visibilitychange`→hidden now ride each press like the pointer
   net and are treated exactly as pointercancel: revert, never commit —
   and the concealed stream, abandoned rather than finished, hands its
   trailing click to the refused-stream machinery (the lift can land on
   the pill minutes later, far outside settle()'s same-task window;
   fifteenth pass, alongside closing the modifier exemption on the
   activation keys, which still ran a focused button's native activation
   under Ctrl/Meta). The conceal watch itself carries an expiry
   (sixteenth pass — the expiry lesson, violated by its own reuse): a
   pointer released in another application never reports its end, so
   foreground return clears the marker — the revert is long visible by
   then, and the pill's first keyboard activation after refocus must
   land.
2. **The key list was itself a hole.** The fourteenth pass swallowed
   Enter and Space — an enumeration. Arrows, PageUp/Down, Home and End
   scroll the document beneath the frozen world; Tab wanders focus.
   While the capsule is up, EVERY unmodified key except Escape now dies
   at the window's capture phase; modifier chords belong to the browser
   and pass.
3. **Wheel.** Touch panning was blocked; a wheel or trackpad could still
   glide the page under the capsule. Blocked in the active phase, the
   same shape as the touchmove claim.

The matrix, as now enforced (phases: REST · PRE-HOLD, pointer-down to
classification · ACTIVE, capsule up · TAIL, cancelled press awaiting its
lift · SETTLE, the post-lift task):

| Channel                          | Pre-hold                                                | Active                                                                   | Tail                              |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| Own pointer stream               | slop/axis rules + hold timer                            | capture; x-only drag                                                     | capture retained; lift ends all   |
| 2nd pointer, same wrapper        | refused (`press.current`); click dies via claim         | + shield                                                                 | same                              |
| 2nd pointer, other wrapper       | refused (claim); marker + end-watch outlive the owner   | + shield                                                                 | same                              |
| 2nd pointer, non-wrapped control | free until activation → dialog probe stands down        | shield                                                                   | free (world visually at rest)     |
| Keyboard                         | free (probe covers the sheet outcome at activation)     | unmodified keys die; Enter/Space die under any modifiers; Escape reverts | free                              |
| Scroll (touch / wheel / keys)    | `touch-action: pinch-zoom`                              | touchmove + wheel blocks + key swallow                                   | touch-action persists             |
| Lift/end delivery                | wrapper handlers + window net + concealment revert      | + capture                                                                | capture + net + concealment       |
| Sheets                           | cannot start a gesture (admission); probe at activation | cannot open (shield + keys)                                              | may open — legitimate, no capsule |
| World motion                     | live                                                    | frozen ornaments; blur stands down mid-stream                            | live                              |

At REST every channel is untouched, and in SETTLE only the one same-task
click is suppressed (suppressClick / the refusal marker). Recorded
acceptances, deliberate and bounded: assistive-tech-synthesized clicks
on non-wrapped controls mid-drag (a hold-drag is a pointer gesture an AT
user is not simultaneously performing; the sheet remains the complete
path); mid-gesture geometry drift — a layout shift under the dim-only
stream presentation, or pinch/rotate mid-drag — because geometry is
deliberately static for the gesture and release re-anchors, with every
lift caught wherever it lands; and the same-wrapper post-claim click
tail (no capsule is live by then, so the guarded invariant cannot be
violated). Any future finding in this control should first be located
in this table — either a cell's mechanism is wrong (fix the mechanism)
or a channel or phase is missing from the table (extend the table);
cells are no longer discovered one review at a time.
