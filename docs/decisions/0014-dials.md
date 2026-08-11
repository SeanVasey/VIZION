# 14. Dials: the slider is the control, not an accelerator over one

Date: 2026-08-11
Status: accepted (supersedes the interaction model of
[0012](./0012-hold-slider.md) — the gesture machinery, the focus pair, the
exclusive claim and the whole edge-case ledger it accumulated over
twenty-two review passes are RETAINED and still live in
`use-hold-drag.ts`; what changes is what the control IS)

## Context

[0012] built a press-and-hold drag **accelerator** layered over two tap
triggers. The bet it made was explicit: "Tap is untouched; hold is extra…
The sheet is the single complete path — keyboard, screen reader, and
discovery all live there — which is what satisfies WCAG 2.5.7's
single-pointer alternative."

Three things went wrong with that bet in practice, and the owner's
2026-08-11 pass named all three:

1. **The pills lied about themselves.** Both wore a disclosure chevron.
   Target's was honest — it opens a list of sixteen models. Thinking's was
   not: behind it sat a five-row radio sheet standing in for a ladder, which
   is a slider wearing a menu's clothes. _"I would prefer they not appear as
   dropdowns unless they actually utilize one like the model selector."_
2. **The capsule landed nowhere in particular.** [0012]'s amendment 4 fixed
   the home at the viewport's centre, correcting a first cut that anchored
   under the fingertip. That fixed the floatiness but left the capsule
   visually unattached to the thing it was adjusting. _"…always sprouts out
   from the same fixed button point."_
3. **The budget dial was in the wrong room.** It hung off the composer's
   Target pill, gated on Auto already being on, and its capsule opened over
   the composer — while the thing it configures (Auto routing) is chosen
   inside the Target sheet. _"…underneath the auto selection for model auto
   tuning… within the model selection pane that slides out from the right."_

Owner reference: a screen recording of ChatGPT's effort slider — a capsule
with detent dots, a white thumb on the fill's leading edge, a gradient that
animates once it reaches the top stop, a starfield drifting inside the fill,
a dotted ring bursting off the thumb on arrival, and a caption that swaps to
a cost warning with a shimmer running across it.

## Decision

### 1. The pill IS the slider

`ThinkingDial` replaces `ThinkingPicker`, and the depth sheet is deleted. The
trigger declares `role="slider"` with `aria-valuemin`/`max`/`now`/`valuetext`
and owns the WAI-ARIA arrow-key ladder at rest.

The retired sheet was carrying two loads, and the slider role carries both
better:

- **WCAG 2.1.1 (keyboard).** The sheet put the ladder behind a dialog. Arrow
  keys put it on the control. Strictly less work for the same reach.
- **WCAG 2.5.7 (dragging movements).** The sheet was the no-drag route.
  The LATCHED phase is now: one tap opens the capsule and leaves it up,
  a second tap picks the stop under the finger. No drag anywhere on the path.

Target keeps its chevron and its sheet, because it genuinely opens a list.
That is the rule going forward: **a control looks like a dropdown only if it
is one.** `PickerChevron` is Target's alone.

### 2. The capsule's home is its trigger

`computeTrackGeometry` centres the capsule on the trigger's rect, both axes,
then clamps it into the visible region's margins.

This supersedes [0012] amendment 4's viewport-centred home, and it is worth
being precise about what that amendment was actually defending, because the
property survives untouched: **placement must not depend on where the press
landed.** A button is a fixed point; a fingertip is not. Anchoring to the
button satisfies that requirement exactly as well as anchoring to the
viewport did, and additionally connects the capsule to the control.

The clamp is not a caveat, it is the mechanism. A trigger near a viewport
edge — the budget dial, inset in a side sheet — would otherwise open a
capsule half off-screen, and a detent outside the region is a value no
pointer can travel to. Where the clamp binds, the capsule is pinned to the
margin instead of centred; on a 390px phone, Opus's six-stop ladder makes a
264px capsule and the clamp binds every time. Deterministic either way, which
is what "the same fixed point" has to mean.

The three spacing modes (full / compressed / span-only) are unchanged.
Span-only keeps the region-centred span: below that floor there is no room
left to honour an anchor, and reachability wins.

### 3. The budget dial moves into the Target sheet

It sits directly under the Auto card it tunes, as `AutoTuningDial` — same
control class as Thinking's, three stops, Budget → Balanced → Quality. It
replaces the `Segmented` that was there. Three equal cells said "pick one";
a dial's growing fill says what is actually true, which is that this is a
ramp from cheap to strong.

Two consequences:

- **The activation guard is rescoped.** [0012] stood a gesture down over any
  open `role="dialog"`. That rule assumed no slider could ever legitimately
  live inside one. It now stands down only over a dialog that does **not
  contain** the trigger — "a sheet is open" and "a sheet is in front of me"
  stopped being the same statement. Every foreign sheet is still senior.
- **Committing no longer closes the sheet.** A segment tap was a discrete
  choice that ended the interaction. A dial is adjusted and looked at, and
  closing the pane out from under a drag threw away the result just dialled
  in. Committing still turns Auto ON, which is the shortcut the Segmented was.
  This one had a tail: `useRovingRadios` initialised its tab stop once, which
  was sound only because every selection in this sheet used to close it — the
  hook said so in its own header. Turning Auto on from the dial checks the
  Auto radio from OUTSIDE the group without moving focus, so with the sheet
  staying open the tab stop stayed stranded on the previously selected model
  and Tab re-entered the group on an unchecked row. The tab stop now follows
  the checked index (Codex review, PR #109). Anything else that changes this
  group's selection without closing it inherits the same requirement.

The composer's Target pill therefore hosts no slider at all. It still names
the live preference — "Auto · Balanced" — so what the dial sets stays visible
at rest.

### 4. The capsule's presentation

Borrowed from the reference recording; rendered in this app's own tokens.

- **The ramp.** One gradient laid across the whole track, revealed by the
  fill's width. Two properties have to hold simultaneously and only this
  construction gives both: the pixels already painted must not move or re-hue
  when the value changes (which rules out a gradient anchored to the growing
  fill box — it restretches every step), and a level's colour is its IDENTITY
  rather than its ladder position (the DepthGlyph rule: "High" is laser on
  Grok's three-step ladder and on Fable's five-step one — which rules out a
  fixed ramp the detents merely sample). So the ramp is **built from the
  detents**: each stop's tone colour pinned at that detent's own centre.
- **The starfield.** Four radial gradients on a repeating 96×48 tile,
  translated one tile width. No image, no canvas, nothing for the CSP to
  allow. It is deliberately NOT in `[data-hold-gesture]`'s pause list —
  pausing the thing the gesture exists to show would be self-defeating, and
  the focus blur already stands down over any backdrop that cannot hold
  still (`dynamicBackdrop`).
- **The peak.** At the ladder's top stop only: a violet surge sweeps the
  fill, a dotted ring bursts off the thumb, and a caption states the cost —
  "Deepest reasoning — slowest, highest cost" / "Strongest models — spends
  your cap faster". Only the top stop earns one, so it reads as a consequence
  and not a nag. It is the one thing the words "Max" and "Quality" do not say.
- **The shimmer is contrast-safe by construction.** The caption animates a
  gradient between `--ultra-ink` and a new `--ultra-ink-hi`, which moves AWAY
  from the surface in each theme — lighter on dark, darker on light. A
  highlight that merely brightened would have raised contrast on dark and
  dropped it below AA on light: the laser-on-light failure class, one hue
  over. Both ends clear AA on all three surfaces in both themes, so every
  frame of the sweep does. Pinned in `tests/unit/a11y.test.ts`, including the
  direction rule itself.

Every effect stands down under `prefers-reduced-motion` and the app's own
`[data-reduced-effects]` knob. Burst and starfield are removed outright
rather than frozen — a static starfield is speckle, not texture.

### 5. A how-to line

The redesign trades a legible lie (a chevron over no dropdown) for an
invisible truth (a grip over a slider). One muted sentence under the Thinking
rail names both ways in, and retires itself the first time any dial commits a
value — a hint proven unnecessary should not survive to be read twice. The
explicit "Got it" writes the same `dialTipSeen` flag.

## Consequences

- The Thinking sheet, `ThinkingPicker`, and the `Segmented` inside the Target
  sheet are gone. `Segmented` itself remains — the Shape and Length rails
  still use it, and they are genuinely unordered choices.
- Latched state holds the app-wide exclusive claim for its whole life, so
  concealment (window blur, tab hide) has to close it by OPEN STATE rather
  than by finding a press record. A capsule left up in a backgrounded tab
  would freeze the world behind it — the same leak class [0012]'s modality
  audit chased through every other channel.
- Escape now `stopPropagation`s. A latched capsule can be open inside a
  Sheet, whose panel closes on a bubbled Escape; one Escape must dismiss one
  surface, the one in front.
- **Pinch-zoom survives a latched capsule, and it took TWO fixes.** The
  active-phase `touchmove` block is right for a drag — it stops a late pan
  stealing the captured pointer, and it lasts exactly as long as the press.
  The latched phase inverts that lifetime, so the same blanket block disabled
  zoom for as long as the capsule was up, in an app that preserves native
  zoom on purpose. Multi-touch is exempt while latched; one finger stays
  blocked, because the world under the capsule still must not glide. The
  track's own `touch-action` was the second half and is easy to miss: it is
  resolved at gesture start on the element the touch began on, which is
  strictly earlier than any handler, so a pinch starting ON the capsule was
  still refused until that value went from `none` to `pinch-zoom`. A
  JS-side exemption cannot rescue a CSS-side denial.
- **The dial spans a scrolling pane, so it hands back the vertical axis.**
  [0012]'s resting `touch-action: pinch-zoom` denies every single-finger pan,
  which is right for a content-width pill in a rail (the cost is a
  thumb-sized dead spot) and wrong for a full-width control across an
  `overflow-y-auto` list of sixteen models — that is a scroll trap, and the
  same shape the library's swipe rows have always answered with `pan-y`.
  `scrollableHost` carries that exemption per instance; horizontal stays the
  gesture's. The cost is 0012's measured one — a pre-hold vertical drift lets
  the UA cancel the press, so a HOLD needs a steadier finger here — and it is
  bounded, because on this surface the tap is the primary path and a tap does
  not move.
- The click-consumption that rode on the Target pill's wrapper went away with
  that wrapper. What holds the "no sheet under a live capsule" line is what
  always did the physical work: a viewport-covering, pointer-interactive
  shield above the sheet tier, plus the window key-swallow for the one
  channel hit-testing cannot cover. Both are pinned in
  `tests/unit/thinking-rail.test.tsx` and, for real hit-testing, in the e2e
  suite.
- WebKitGTK e2e coverage says nothing about iOS. The latched phase's touch
  semantics — a tap that opens a capsule the finger has already left, and
  whether iOS's callout timer races it — are on the manual list in
  `docs/runbooks/ios-verification.md`.

## Amendment 1 — the button says slider, the backdrop stays local

Date: 2026-08-11 (same day; the owner's second pass on the shipped result)

Two things were kept and two rejected. The gesture, the geometry, the shield,
the latched phase and the capsule's internals are all untouched.

### The resting affordance is a MINIATURE of the track (supersedes §4's grip)

_"I want the button to be obvious with indications to press or an animation to
press and hold to drag and slide it or a permanently visible slider."_

The grip ticks were right about what to avoid and wrong about what to offer.
[0012]'s reasoning — not dots (a text ellipsis at that size), not a chevron (a
promise of a dropdown) — still holds; what it never established is that a grip
says SLIDER. It says grippable. So `HoldSliderHint` is now a short rail filled
to the current level in that level's own tone, with a thumb on the fill's
leading edge: the owner's third option at pill scale, the control showing the
thing it becomes. It reads `TONE_COLOR`, the same map the capsule's ramp is
built from, so the pill and the track can never disagree about a level.

A genuinely full-size rail on the composer was the alternative and is declined
on geometry, not taste: Opus's six-stop ladder is 264px of a 390px viewport,
which forces the rail to a second row and pushes the Target pill off its line.

The owner's middle option is folded in rather than dropped — a ring pulses off
the mini thumb until the first commit, gated on the same `dialTipSeen` flag as
§5's how-to line, so the moving hint and the written one retire together.

Two numbers in that hint are load-bearing, and both were found by looking at a
render rather than by a test, which is why they now have one. The thumb is
TALLER than its rail, and its travel is INSET from both ends. A knob of the
rail's own height sitting flush against the rail's end is a toggle switch, and
the bottom of the Thinking ladder is "Auto" — the value every new device opens
on. The first cut shipped a switch in the off position.

### The focus pair is a HALO, not a wash (supersedes §4's full-viewport pair)

_"the entire screen shouldn't white out to only show the slider when it's
held. It should popup and blur out the direct area underneath it and that
blurring fades into the area … that becomes clear again."_

The dim was `color-mix(in srgb, var(--void) 62%, transparent)` over `fixed
inset-0`. On the light theme `--void` is `#eef0f4`, so that is 62% of a
near-white across the whole viewport — the complaint is a measurement, not a
preference. The treatment is now an ellipse centred on the capsule that falls
off to untouched screen.

The two layers localize from OPPOSITE ENDS, and that asymmetry is the decision:

- The DIM keeps its viewport-covering box, because that box is the input
  shield [0012]'s ninth pass added and the outside-tap dismiss target. It
  localizes in its PAINT — a radial gradient — and a background never affects
  hit-testing, so the shield is bit-for-bit what it was.
- The BLUR localizes in its BOX, sized to the halo, and only SOFTENS that box's
  edge with a mask.

That split is what makes the mask non-load-bearing, and it is the whole reason
the split exists. Measured 2026-08-11: Chromium gates a `backdrop-filter` with
`mask-image` exactly as intended. WebKitGTK could not answer the question,
because that build paints no `backdrop-filter` whatsoever — plain, masked, or
on a promoted `::before` — while `filter: blur` works on the same page. So the
suite's second engine is silent here, real Safari is unmeasured, and the whole
`.glass` family's blur turns out to have only ever been asserted there by
computed style. Every rung of the ladder is acceptable: mask honoured → soft
halo; mask dropped → hard-edged but still LOCAL halo, seamed by the dim's
slightly wider ellipse; filter dropped → the dim alone, which is already what
both stand-downs ship. None of them is the wash that was rejected.

**The halo's reach and density are MEASURED, and the first cut of them was too
timid.** The owner's third pass asked for exactly that: _"the radius of blurring
and the glass effect … needs to extend further … to completely obscure the
underneath text and shapes or icons of the button and the surrounding areas of
the prompt input area."_ Twelve parameterizations were rendered against the real
app and scored by the HIGH-PASS energy of each screen band relative to the same
band with no capsule open — a stand-in for "is there readable text here" that
plain variance gets backwards, because a large blur smears bright content around
and raises variance without making anything legible. Three results, none of them
guessable from the CSS:

1. **The mask's plateau is the lever, not the blur radius.** blur(38px) at an
   84% plateau obscures materially better than blur(54px) at 78% — the coach
   line goes 0.06 vs 0.16, the first prompt line 0.04 vs 0.14. Chromium appears
   to trade filter quality for area as the element and the radius grow, so past
   a point a bigger blur on a bigger box buys a coarser result. Widen the opaque
   core before reaching for the radius, and re-measure.
2. **X wants to be larger than the viewport, and that is not waste.** The capsule
   clamps right-of-centre on a phone (x=245 of 393), so an ellipse sized to it
   falls off soonest on the LEFT and left the left column of the prompt readable.
   X is set so the plateau still spans the full width from that off-centre origin.
3. **The Y ceiling is the chrome bars, and it binds.** The first cut of this pass
   used 209 and the e2e invariant caught the box overlapping the bottom nav by
   4px. 196 leaves ~9px of clearance and measures indistinguishably. That
   assertion is now stated against the real bars rather than as a fraction of the
   viewport, because the moment the halo reaches one, localization stops being a
   property of the box and starts depending on the mask — the one property that
   cannot be verified on WebKit.
4. **An absolute reach is only local relative to a REGION, so it has to be
   clamped** (Codex review, PR #110). 196px per side was measured on a 393×660
   phone; this repo also supports 320×640, where the fixed nav sits higher, and
   pinch zoom can shrink the visible region to a fraction of the layout viewport
   — a case the control already takes seriously, since `computeTrackGeometry`
   places the capsule inside `visualViewport` for exactly that reason. The halo
   was ignoring the same constraint. `HoldActive` now carries the region's
   vertical extent, sampled in the same breath as the geometry, and the halo's
   half-height is capped at the distance to the nearer region edge less an
   allowance for the chrome inside it.

   The clamp's SHAPE was itself wrong on the first attempt, and the new 320×640
   e2e test is what said so — it caught a fraction-based cap overrunning the nav
   by 11px. Clearing a fixed-height bar requires `half ≤ room − bar`; the
   fraction that satisfies that depends on `room`, so no single fraction holds
   as the region shrinks, and it fails hardest exactly where the clamp matters
   most. A subtraction generalizes; a ratio tuned to one viewport does not.
   The cost is that a `ui/` primitive now carries one number about the app's
   chrome — accepted, because the alternative (measuring the bars from inside
   the primitive) couples far worse, and three viewport sizes of e2e coverage
   turn a retuned bar into a failing test rather than a silent overrun.

**One asymmetry is accepted and named.** The dim is `--void`-based so it inverts
with the theme, and on light `--void` is a near-white: measured, the light veil
moves the page ground 238 → 239, i.e. essentially nothing, and the Laser
"Clarify" chip 214 → **222** — it gets brighter under focus while its neighbours
recede. A dark veil on the light theme was built and measured as the fix. It was
rejected on the evidence: it obscures LESS (prompt line 4 at 0.22 vs 0.18, the
mode rail 0.44 vs 0.37) and it renders as a murky grey cloud whose ellipse is
visible as a shape — against a brief whose words are "a smooth and clean
appearance of a popup". On light the obscuring is carried by the blur, and the
dim's job there is depth rather than dimming. The active mode chip not receding
is the residue; the capsule still dominates the frame at these values.

### The capsule reads as a pane, not a chip

_"the popup with the blurred background and the slider has glass backgrounds
super opaque blurring the content and also shadows dropping over at the edge
blurs to give it style."_

`.hold-slider-glass` is a tier of its own rather than a new general member of
the glass family, because this is the one surface in the app that floats over
a blur of its own making: the halo paints at z-84 and the capsule at z-85, so
the frost samples an already-blurred backdrop. It goes on the round box INSIDE
the track, never the track itself — the track is `position: fixed`, which is
the iOS async-scrolling trap the chrome bars and the FAB already dodge.
`.hold-slider-lift` composes the drop shadow OVER `--glass-sheen` rather than
replacing it, since `box-shadow` is one property and the level chip also wears
`.glass-solid`.

The peak caption gained a chip too. As bare text it was legible only because
the old backdrop flattened everything behind it; over a local halo it landed
directly on the coach line under the rail and the two sentences interleaved.

## Alternatives considered

- **Keep the sheet, drop only the chevron.** Cheapest, and it was offered.
  Rejected by the owner: "there should only be the dynamic slider". It also
  leaves the deeper problem — a ladder behind a dialog is the wrong shape
  regardless of what the trigger looks like.
- **`<input type="range">`.** Inside the iOS 16px focus-zoom rule's scope
  (`input, select, textarea`), which is the exact trap that made Thinking a
  button in the first place, and unstylable to this design without fighting
  three engines' shadow DOMs.
- **The reference's blue→violet nebula throughout.** Offered and declined in
  favour of the brand ramp: blue is not in the token set, and the fill would
  have stopped agreeing with the level colour-coding the app already uses.
  The motion and texture are borrowed; the palette is VIZION's.
- **Right-edge alignment instead of centre-then-clamp.** Would read more
  literally as "growing out of the pill" where the clamp binds. Rejected as
  a second placement rule for the same control: centre-then-clamp is one
  rule, and on the surfaces that exist the two produce nearly the same box.
