# 17. The installed icon is outlined, so no treatment of its plate can hide it

Date: 2026-09-04
Status: accepted, confirmed on device 2026-09-04 (supersedes the artwork half of [ADR-0015](./0015-pinned-home-screen-tile.md); its arrangement half stands; Amendment 1 records the measurement and a withdrawn change; Amendment 2 restores the scalable icon's dark appearance; Amendment 3 flattens the plate)

## Current scope correction: September 4 repair

The outlined artwork remains approved. The title's universal guarantee is not
a device acceptance result for every OS treatment. Historical device reports
below are retained as reports, not independently reproduced measurements.

Amendment 2's PNG-as-fallback explanation is superseded: WebKit documents an
explicit Apple touch icon taking precedence over manifest icons. An adaptive
SVG on disk or first in an array does not prove that it was installed, or
that iOS reevaluates its CSS. The presentation fill now supplies a deterministic
lime fallback and remains overridable by the dark CSS class. The production
Apple PNG and logo geometry are unchanged. The full application gate and
physical-device acceptance remain separate requirements. The
[current repair contract](../runbooks/icon-install-repair.md) governs new work;
the isolated A/B/C diagnostic distinguishes the still-open mechanisms.

Amendment 4 (2026-09-05): the claim that iOS kept the Laser-filled outlined
mark in Dark was not a recorded device result and is false (owner
screenshots: no plate swap, tile dimmed). The mark is now filled darker
than the plate so iOS's automatic dark treatment can segment and keep it.
Geometry, stroke and plate are unchanged.

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

## Amendment 1 (2026-09-04) — measured on device, and a change withdrawn

**Measured.** The owner installed this tile and photographed it in both
appearances. Light: as authored (plate sampled `#C4F53C` top → `#A8DA16`
bottom, the mark's fill `#CAF840`, its outline `#010701`). Dark: iOS
_separated_ the tile — the plate replaced by a dark gradient derived from the
plate's own colour (`#182110` top → `#070B0E` bottom), the mark kept pixel for
pixel, fill `#CAF742` and outline `#020902`. That is this ADR's requirement met
exactly: on the green plate the outline carries the mark; on the dark one the
fill does.

**Mechanism, for the record.** iOS 18 and later build a dark icon for an app
that ships none by separating the image into a background and a foreground,
replacing the background with a dark gradient and keeping the foreground
(IconServices; Gui Rambo's analysis as reported by 9to5Mac, 2024-07-15). The
flat Void-on-Laser tile of ADR-0015's era was separated the same way and lost
only because the foreground it kept was black. "Auto-darkening" was the wrong
word for it throughout.

**A change withdrawn.** An earlier screenshot of the same install, taken in
dark appearance shortly after adding, showed the plate still green — the dark
variant had not yet been produced (iOS generates it after the fact; the exact
trigger is not established). That screenshot was read as "iOS does not
separate a gradient plate", and #116 flattened the plate and paled the fill to
make separation more likely. The later screenshot shows the original artwork
separated perfectly, so #116 is reverted and the artwork of this ADR stands as
written. The lesson is in `tasks/lessons.md`: one screenshot of a freshly added
web clip is not a measurement of its dark variant.

## Amendment 2 (2026-09-04) — the scalable icon carries both appearances again

**Owner direction.** The dark plate must not depend on iOS producing a variant
after the fact; the owner has seen the SVG route deliver it and asked for it
back. #114 had flattened `app-icon.svg` to one colorway on the reasoning that
the outline made the swap unnecessary — true for legibility, irrelevant to the
plate's colour, which is what the owner wants to follow the appearance.

**Change.** `app-icon.svg` — the manifest's first icon and the first
`rel="icon"` — carries both appearances: the plate is a class whose fill swaps
from the Laser ramp to a Void plate under `prefers-color-scheme: dark`, and the
mark is the outlined mark in both, unchanged. The default rules are the LIGHT
appearance, the reverse of ADR-0015's rule and for a reason that changed with
the artwork: a media-blind renderer that captures the green tile hands iOS's
own dark pass a plate it separates with the mark kept, while a captured dark
tile would stay dark in light appearance. The PNG apple-touch tile is unchanged
and stays linked as the fallback for anything that does not take the SVG.

**Why this can work where ADR-0015 said it could not.** ADR-0015's "iOS does
not select the manifest SVG" was measured on a preview whose manifest was
unreadable — the credential-less fetch fixed in #114 — so the device never had
a manifest to select from. Safari 26 documents SVG icons "everyplace there are
icons", the Home Screen included, and that manifest icons are used. Whether
iOS re-renders the SVG when the appearance changes, or captures it once per
install, is the open device check in the runbook; either way the plate a
light-appearance install captures is the green one, which iOS's dark pass
handles.

## Amendment 3 (2026-09-04) — the plate goes flat; the mark keeps its fill

**Owner reference.** Two more screenshots of the #105-era tile — flat Laser
plate, flat black mark: light `#BEF51E`, and in dark appearance the plate
swapped for iOS's own neutral dark plate, `#101113`, with the black mark kept
(and invisible). That swap is the target treatment; only the mark needed to
survive it, which the outlined mark does.

**Measured, from the #114 dark screenshot.** iOS kept the mark's fill all the
way down the ramp to the tip, where the fill equals the plate colour
(`#C4FB26` kept on a plate replaced beside it) — the foreground is kept as a
region, not keyed out by colour. The enclosed plate areas inside the ring were
dimmed to dark olive (`#414D25`) rather than replaced, and the outer plate,
being a gradient, was darkened with a green tint (`#182110` → `#070B0E`) rather
than swapped for the neutral dark. The flat #105 plate got the clean swap.

**Change.** The plate is **flat Laser** on every installed surface — the PNG
tiles and the SVG's light branch — and the mark is unchanged: the Laser ramp
fill (0.30 toward white at the top, the token at the bottom) and the Void
stroke. No pale fill this time: the measurement above shows the fill survives
with its base on the token. The SVG's dark branch stays a Void plate.

**Verify on device.** Delete and re-add in light appearance, switch to dark:
the expected result is the neutral dark plate with the green mark on it,
whether iOS reads the SVG's dark branch or swaps the flat PNG plate itself.

## Amendment 5 (2026-09-05) — inverted: shaded plate, flat Laser mark, no outline

**Owner reference.** Two screenshots of the Amendment-4 tile (Laser plate,
mark shaded toward Void, Void outline) installed via the versioned link: Light
showed the tile as authored; Dark showed iOS's near-black plate with the
shaded mark and its outline kept. The mechanism from Amendment 4 is confirmed:
iOS keeps the mark pixels whose colour is distinct from the flat plate.

**Decision.** With the mark kept by colour, the outline is no longer the
carrier of Light contrast and reads as clutter in Dark, where it sits on a
near-black plate. The installed tiles are therefore INVERTED: the plate is
Laser shaded 0.55 toward Void (`#627B1B` from the current tokens) and the mark
is the flat Laser token, with no stroke. iOS keeps the full-Laser mark on its
own dark plate (≈16:1); in Light the Laser mark reads on the shaded green
plate at ≈4:1. 0.35 was rejected (≈2.2:1 in Light, tone on tone at 60 px) and
0.70 (≈6.6:1) because the plate turned olive; the owner chose 0.55 from a
side-by-side render. The plate stays flat (Amendment 3). The transparent `any`
matrix keeps the outlined mark, now Laser-filled, because a launcher paints
its own ground behind it. Favicons and splash screens are unchanged. This
title's "outlined" now describes the `any` matrix only.

**Verify on device.** Delete and re-add in Light: the sheet preview shows a
bright Laser mark on a deep green plate; switch to Dark: the same mark on
iOS's near-black plate, with a clean edge.

## Amendment 6 (2026-09-05) — the plate is the light theme's `--accent-ink`

**Owner reference.** The Amendment-5 tile on device, side by side with the
in-app header mark in the light theme: two deep greens that were close but not
the same (`#627B1B`, an ad-hoc 0.55 mix toward Void, against `#526810`, the
token the mark paints with `currentColor` on light surfaces).

**Decision.** The plate IS the light theme's `--accent-ink`, read from the
`:root[data-theme="light"]` block of `tokens.css` by `lightToken()` in the
generator. Nothing about the tile is a free parameter any more: the mark is
`--laser`, the plate is `--accent-ink` (light), the dark plate is `--void`.
Retune any of them and the tile follows. Contrast in Light rises to ≈5.3:1;
Dark is unchanged (the full-Laser mark on iOS's near-black plate). The
Amendment-5 fraction is removed rather than kept as a fallback.

**Verify on device.** Re-add: the sheet preview shows the Laser mark on the
same green as the header mark in the light theme.
