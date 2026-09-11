# 18. One thinking ladder for every model, and a dial that reaches its ends

Date: 2026-09-11
Status: accepted (supersedes the per-target ladders of
[0012](./0012-hold-slider.md) §"detents" and [0014](./0014-dials.md) §1's
"the detent count adapts per model"; the gesture machinery, the capsule's
geometry, the halo and the exclusive claim are RETAINED)

## Context

Owner pass, 2026-09-11, on device and against a competing design review:

> "The auto thinking and effort level slider needs to be more intuitive. If
> you press and hold at the wrong spot on the screen, you start where you
> can't actually swipe left or right … the gradients should be seamless and
> smooth and dynamically moving and without little grey or purple blocks …
> make every model use a single or minimal unified way to negate small
> differences in things like reasoning level choices … [controls] need to
> actually work, consistently, and not hang around on the page when they
> should change if a mode is changed."

Alongside it: the whole roster had been re-verified 2026-08-08 and had
already drifted (Fable 5.1, Gemini 3.8 Flash, Grok 4.6, GLM-5.3 and GPT-6
Astra all shipped since), and three providers' untuned runs were the slowest
in the fleet for a reason the app had chosen for them.

Four distinct defects sat under those sentences, and this record takes them
one at a time because each has a different mechanism.

## Decision

### 1. One ladder: Auto · Low · Medium · High · Max, for every model

`TARGET_THINKING_LEVELS` — a per-target list of exactly the values each API
accepted — is gone. `THINKING_LADDER` is one four-stop list; the dial renders
it for every target; the store holds ONE `thinkingLevel` rather than a
per-target record; and the **adapter** translates the level onto its
provider's vocabulary through one table, `providerEffort`
(`src/lib/providers/errors.ts`).

The per-target design was honest to the wire and wrong for the hand. The same
gesture meant a different thing on every model; a level picked under Opus was
silently absent under Gemini; and under Auto the dial showed a ladder for the
PINNED model while routing ran a different one. Honesty to the wire is the
adapter's job — it is the only code that knows the provider's words — so the
translation moves there, with two rules pinned per provider in
`tests/unit/provider-effort.test.ts`:

- **Monotone.** A higher stop never sends a lower provider value.
- **Honest ends.** Low is the provider's cheapest word and Max its costliest,
  so the peak caption's "highest cost" is never a lie on a three-valued API.
  Where a provider has three words (DeepSeek, Kimi K3, GLM-5.3: `low · high ·
max`), Medium collapses onto `high` — their middle value and their default.
  Where it has no `xhigh` (Gemini), Max lands on `high`; where `xhigh` IS the
  top (Grok 4.6), Max lands there.

`minimal` and `xhigh` stay in the wire vocabulary (`THINKING_LEVELS`) so an
old draft, an old store or an old client never 400s; `normalizeThinkingLevel`
folds them onto Low and High, except on the three providers that serve
`xhigh` as a real tier, where it rides through. The route no longer has a
per-target 400 for a level "not available for this model" — a knob-less
target (Mistral, Sonar, Muse, MiniMax) is simply sent nothing, and the
composer shows no rail for it. Under Auto the rail always shows.

### 2. Auto is the APP's default, not the vendor's

Until now "Auto" sent nothing, and the vendor default applied: `high` on the
Claude 5 family and Grok, **`max` on Kimi K3 and GLM-5.3**. For "fix the
grammar in this paragraph" that is the slowest, costliest configuration the
API offers, chosen by omission. The route now resolves Auto with the same
tier split routing already uses (`classifyTier`): `medium` for the bounded
modes, `high` for structure-inventing ones or a long / media-bearing input.
Explicit dial choices are untouched. One classifier for both decisions, so
routing and depth cannot disagree about what kind of job this is.

### 3. Edge auto-step: the drag reaches every stop from wherever it began

The capsule opens centred on its pill and clamps into the margins; the
Thinking pill sits right of centre on a phone; drag gain is 1:1. So from Auto
— the leftmost stop — the thumb must travel the whole ladder to the RIGHT,
and the finger that pressed the pill has a thumb's width of screen to do it
in. Arithmetic on a 393px phone: capsule 113→333, finger at ~300, Auto's
centre at 135, so Max needs the finger at ~520. The complaint was a
measurement.

Two fixes were declined. Absolute mapping teleports the value to whatever
detent the clamp left under the finger on the first move (the failure
`dragOffset` exists to prevent). Anchoring the capsule under the finger is
0012 amendment 4's rejected "floaty" placement. The fix that keeps every
existing rule is the one every drag-and-drop and text-selection surface on
the platform already uses: **hold the pointer inside `EDGE_ZONE_PX` (28px) of
the visible region's side and the value steps one detent per `EDGE_STEP_MS`
(260ms) in that direction**, with the same haptic tick as a dragged step,
until the finger leaves the zone or the ladder ends. Placement is untouched,
gain is untouched, the latched phase (absolute, on the track) is untouched.
The offset is re-derived after every tick so the hand owns the thumb the
moment it leaves the zone. Pinned in `hold-slider.test.tsx`.

### 4. The gradient is continuous and alive

- **The ramp has ONE stop per detent.** The 55% `TONE_HOLD` — each tone
  holding at full strength before blending — was built for the retired
  laser→ultra seam (2026-08-15 made the ramp monochrome below ultra). With
  nothing left to guard, what it produced was a plateau per detent, and a
  plateau's end is an edge: the "grey blocks". The browser now blends
  continuously from centre to centre.
- **The wash has no moving edge.** The 2026-08-15 flood slid a 300%-wide
  image with a transparent left and a solid right third across the fill — a
  travelling edge with a 26% fade is a purple block crossing the track. It is
  now an opacity fade-up plus an endless, alternating drift of a soft
  ultra → ultra-hi → ultra gradient, so the settled fill breathes rather than
  sits.
- **A sheen sweeps the fill at every stop** (`.hold-slider-sheen`): one
  faint, wide, chalk-based band drifting back and forth over the ramp. It is
  a separate layer, deliberately: the ramp's colours are the level's identity
  and stay pinned; the sheen is light passing over them. Same compositor
  mechanism and pause-list classification as the starfield; both stand-downs
  remove it.

### 5. The form does not strand its own controls

- A failed run's error line resets when the model, mode or routing changes —
  "Mistral request failed: 401" must not keep sitting under a composer now
  aimed at Opus.
- The prompt field sizes itself to its content between a 120px floor and a
  viewport cap (measured, not guessed; `field-sizing: content` is not on iOS
  Safari and the runbook forbids claiming it).
- The composer's action rail is `position: sticky` above the bottom nav, so a
  long draft never puts ENHANCE a screen below the field. That required the
  chassis to clip with `overflow-clip` rather than `overflow-hidden`: both
  clip to the corners, but `hidden` makes a scroll container, and a scroll
  container is what breaks sticky for everything inside it.
- A character budget against the route's own `MAX_INPUT_CHARS` appears at a
  third of the limit and disables the primary past it — the 413 the route
  would send, said first. ⌘/Ctrl+Enter runs the enhancement. Both are from
  the competing design review, adopted because they are function, not
  decoration; its "Build a brief" and "Focus" affordances were not.
- Condense's middle stop is "Compact", not "Balanced": Auto's routing
  preference one rail up already says "Balanced" about something else.

### 6. The roster moves to the vendors' current frontier

Read from each vendor's own page on 2026-09-11: Fable 5 → **Fable 5.1**,
Gemini 3.6 → **3.8 Flash**, Grok 4.5 → **4.6**, GLM-5.2 → **5.3** (enum
renames, one migration, `LEGACY_TARGET_IDS` re-keys stale stores), and
**GPT-6 Astra** joins above the 5.6 family. DeepSeek V4 Pro, Kimi K3 and
GLM-5.3 gain the thinking knob their APIs expose; Qwen's output ceiling
rises from 3.7's 8,192 to 32k under 3.8's published 131,072. Every provider's
HTTP failure now goes through `describeProviderFailure`, so a 401/403 names
the env var to replace instead of relaying "401 status code (no body)".

## Consequences

- `thinkingLevels` (per target) → `thinkingLevel` in the UI store, v7
  migration; drafts keep their `thinking_level` text column unchanged (the
  wire vocabulary did not shrink).
- The Thinking capsule is five stops on every model. The e2e assertion that
  counted six for Opus now counts five.
- `MAX_INPUT_CHARS` moved to `constants.ts` so the composer and the route
  count against the same number.
- Three-valued providers render Medium and High identically on the wire. The
  dial still shows both, because the ladder is the app's, and the honest
  alternative — a different ladder per provider — is the design this record
  retires.
- What e2e proves about the sticky rail and the auto-growing field is
  WebKitGTK layout, not iOS behaviour; `docs/runbooks/ios-verification.md`
  keeps the rule that a device pass is the only evidence for an iOS claim.

## Alternatives considered

- **Keep per-target ladders, hide the rail under Auto.** Removes the
  mismatch under Auto only; the switching-models mismatch and the 400 stay.
- **Per-provider gain in the drag.** Rejected by 0014 already (1:1 is the
  tactile truth of the design); a faster thumb also makes short ladders
  twitchy.
- **A permanently visible full-width track.** The owner's third option in
  0014 amendment 1, declined then on geometry; declined again here because
  the capsule design was explicitly kept ("a good start of the idea how it
  should look") and edge auto-step fixes the reach without a second control.
- **`in oklch` for the ramp.** Still rejected on the measured cross-engine
  hue disagreement for near-achromatic mixes.
