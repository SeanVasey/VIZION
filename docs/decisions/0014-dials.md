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
