# 17. The installed icon is outlined, so no treatment of its plate can hide it

Date: 2026-09-04
Status: accepted, amended 2026-09-04 (supersedes the artwork half of [ADR-0015](./0015-pinned-home-screen-tile.md); its arrangement half stands; Amendment 1 below flattens the plate and lightens the fill)

## Context

ADR-0015 settled how iOS handles a web clip's icon, by measurement: it reads
`apple-touch-icon` from the head once, ignores `media` on icons, freezes what it
captured, and auto-darkens that frozen tile under dark appearance. Nothing
re-resolves it. The decision that followed was to ship **one tile, pinned to the
dark colorway** (Void plate, Laser mark), because darkening artwork that is
already dark is a no-op — and the accepted cost was that the brand green never
reached the Home Screen.

That cost was the wrong one to accept. Both flat colorways make the same bet in
opposite directions: each relies on its plate for contrast, so each is legible on
exactly one ground. Void ink on a Laser plate dies when iOS crushes the plate
toward the ink. The Laser mark on a Void plate survives every treatment, but only
by giving up the plate the brand is built on.

The owner's brief (2026-09-04) reframes the problem instead of picking a side of
it: make the mark carry its own contrast, so that the plate can be the brand
green **and** whatever an OS does to that plate cannot take the mark with it.

## Decision

> **Amended 2026-09-04 — see Amendment 1.** The plate is now flat (no ramp) and
> the fill is a lighter lime ramp rather than Laser; the outline and the
> arrangement are as written here.

Every installed surface — the apple-touch tile, the maskable tiles, the
transparent `any` matrix and the scalable `app-icon.svg` — carries one
**outlined** colorway:

- a **Laser plate**, with a slight top-lit linear gradient (a tenth toward white
  at the top, a tenth toward black at the bottom);
- the mark **filled in Laser**, with its own slightly stronger top-lit ramp so it
  reads as a raised shape sitting in the light rather than a cut-out of the plate;
- the mark **stroked in Void**, the stroke painted _under_ the fill so the fill
  keeps its full geometry and only the outer half of the stroke shows — a
  30-unit outline on the 1024 glyph, ~4 px on the 180 px apple-touch tile.

Two carriers, so two grounds:

| What the OS does to the plate          | What carries the mark                                     |
| -------------------------------------- | --------------------------------------------------------- |
| keeps it (the Laser plate)             | the Void outline                                          |
| replaces or crushes it toward dark     | the Laser fill                                            |
| dims everything uniformly              | both — the outline stays far darker than the dimmed green |
| flattens it to grey and tints (Tinted) | the outline's luminance edge                              |

Everything ADR-0015 measured about the **arrangement** stands unchanged: there
is still exactly one `apple-touch-icon` link, unconditional, with no `media`
attribute and no JS matcher, because iOS still freezes one capture. What changed
is the artwork behind that link, and consequently its name: the file is now
`apple-touch-icon.png`, with no appearance suffix, because the outlined
colorway is neither light nor dark and a file named `-dark` that carries a Laser
plate is exactly the confusion the earlier naming saga existed to prevent.

`app-icon.svg` drops its `prefers-color-scheme` swap and its "default to the
dark branch" rule. Both existed to keep the mark legible on whichever plate the
appearance chose; the outline makes the plate irrelevant to legibility, so the
mechanism has nothing left to do and one colorway is simpler.

The favicons and `favicon.ico` keep the flat house colorway (Void ink on a Laser
plate). At 16–48 px a 4 px outline is sub-pixel, the flat mark is the crisper
rendition of the same identity there, and the tab is not an install surface. The
splash screens keep the dark colorway: a launch screen on a known ground, not an
icon on an unknown one. The `og:image` share tile is untouched.

## What is and is not verified

- **Measured here:** the artwork renders as specified in sharp/librsvg, Chromium
  and WebKitGTK (unit pixel tests on every installed tile; e2e render of the
  scalable icon on both engines, identical under both schemes). A uniform
  0.35× dim of the tile — a stand-in for "auto-darkened" — still shows the
  outline clearly against the darkened plate.
- **Not measured:** how iOS 26's darkening actually treats this artwork on a
  device. The design is built to be legible under every treatment listed above,
  which is the whole reason for it, but per
  [the iOS runbook](../runbooks/ios-verification.md) that is a claim for a device
  pass to confirm, not for this document to assert. Delete-and-re-add is the
  only way an existing install picks the new tile up.

## Consequences

**What improves.** The brand green is back on the Home Screen, the tile no longer
needs to be the dark colorway to survive, and the `any` matrix — which a launcher
composites over a ground we do not control — is legible on light launchers for
the first time (a bare Laser glyph on white was ~1.3:1). Every surface a launcher
might pick, from the apple-touch tile to a manifest PNG to the SVG, now shows the
same design, so whichever one a given OS reads, the result is the same.

**What is given up.** The flat, unstroked mark is no longer what installs; it
remains the in-app mark (`BrandMark`), the favicon, the splash and the share
tile. The outlined mark is a heavier drawing, and at the 0.58 maskable fraction
the outline closes the mark's interior gaps into lines rather than slivers of
plate — intended, and visible.

**If the device pass disagrees** — if iOS 26 does something to the plate that
defeats both carriers — the answer is still not a second link, a `media` query
or a matcher. Those are settled. It would be a different drawing.

## Amendment 1 (2026-09-04) — the plate goes flat, the fill goes light

**Measured.** The owner installed the tile above and switched the phone to
dark appearance (screenshot, 2026-09-04). iOS left it alone: the plate sampled
`#C7F53C` / `#BCE92E` / `#AADB18` against an authored `#CEFD40` → `#B3E422`
(within ~5%), the outline `#030700`, the label "VIZION". Legible — and not what
the owner asked for, which is the dark tile iOS had produced from the earlier
_flat_ artwork: the plate swapped for the system's dark gradient, the mark
kept. That tile failed only because the mark it kept was black.

**Mechanism.** iOS 18 and later generate a dark icon for any app that does not
ship one, web clips included, by _separating_ the icon into a background and a
foreground: the background is replaced with the system's dark gradient; the
foreground is either tinted with the old background colour or left as-is; and
when separation fails its thresholds the icon is merely dimmed a little
(IconServices — Gui Rambo's analysis, as reported by 9to5Mac, 2024-07-15). Both
device passes fit: the flat Void-on-Laser tile was separated (plate → dark,
black mark left as-is → the emboss), and the gradient-plated outlined tile was
not (left within ~5% of authored).

**Change.** The plate is **flat Laser** — one colour, corner to corner, the
shape the separation step recognises. The mark's fill is a lime ramp, 0.55 →
0.40 of the way from Laser to white, which stays at least 80 RGB units from the
plate at every stop, so a background pass that keys on colour cannot take the
fill along with the plate. What survives on the dark ground is the fill, so
the fill must not be the plate's colour. The Void outline is unchanged. In a
simulated keyed replacement at tolerance 70 the whole mark survived; a fill
whose bottom stop sat 61 units from the plate lost its lower half.

What each treatment now yields:

| iOS's treatment of the tile                             | What carries the mark                      |
| ------------------------------------------------------- | ------------------------------------------ |
| left alone                                              | the Void outline, and the fill's lightness |
| separated, foreground left as-is                        | a pale lime mark on the dark gradient      |
| separated, foreground tinted with the background colour | a Laser mark on the dark gradient          |
| dimmed                                                  | the outline on dark olive                  |

**Not yet measured:** this tile on a device. The check is the same one-step
re-add, and the expected dark-appearance result is a pale lime mark on the
system's dark gradient.
