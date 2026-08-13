# 15. The Home Screen tile is pinned dark, and stops trying to follow the appearance

Date: 2026-08-13
Status: accepted (closes the arrangements shipped in #108 and #111)

## Context

The owner's requirement was a single icon that shows the **Laser plate with the
Void mark in light appearance and the exact inverse in dark** — the behaviour a
native app gets for free. Three arrangements were built to deliver it. All three
shipped a visibly broken icon.

Two device passes on iOS 26 settled every mechanism question, and the full result
table lives in [the iOS runbook](../runbooks/ios-verification.md):

| Question                                                  | Answer                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Which channel decides the tile?                           | `<link rel="apple-touch-icon">`, read from the head at capture.                                   |
| Does iOS evaluate `media` on icons?                       | **No.** It does on `apple-touch-startup-image`; Apple's "last one wins" is what applies to icons. |
| Does iOS re-resolve on appearance change?                 | **No.** Frozen at "Add to Home Screen"; delete-and-re-add is the only refresh.                    |
| Does iOS select the linked/manifest SVG for the tile?     | **No** (2026-08-13).                                                                              |
| What happens to a captured light tile in dark appearance? | **Auto-darkened** — the Laser plate crushes toward the Void mark and leaves an invisible emboss.  |

## The constraint that binds

**iOS keeps exactly one image, chosen once, and never looks again.** A native
target declares a _layered_ icon (Icon Composer / asset catalog) and the system
composes light, dark and tinted from those layers at display time. A web clip
declares a single flat image. That is not a gap in our markup — it is the
difference between the two delivery formats, and no manifest field, `link rel`,
or web standard closes it. Apple's own forum threads asking for a web-clip
equivalent ([761615], [787919], [801448]) are unanswered across two OS majors.

Every arrangement we shipped was a bet that some part of that was untrue:

1. **#108 — a complementary `media` pair, light declared last.** Bet that iOS
   evaluates `media` on icons. It does not, so "last one wins" resolved to light
   every time and iOS darkened it into the emboss. The dark half was unreachable.
2. **#111 — the pair reordered dark-last, plus a client-side matcher** that
   rewrote the href to match the live `prefers-color-scheme`. This one _worked_:
   the capture matched the appearance at install. But matching only chooses
   **which** failure a user gets — a light-mode install still degrades the moment
   the phone switches to dark, because the tile is frozen.
3. **#111 — a self-inverting SVG** as a Home Screen route. Bet that iOS selects
   the linked/manifest SVG. It does not.

The common shape: each assumed iOS would re-resolve or select something. It never
does.

## Decision

**One `apple-touch-icon` link, unconditional, carrying the dark colorway.**

Auto-darkening artwork that is already dark is a no-op, so the dark tile is the
only colorway legible under _every_ appearance — and since the user cannot be
relied on to install in any particular one, "legible under every appearance" is
the only property worth optimising for. The matcher and the light 180 px tile are
deleted; a `media` query on a single link would be decoration implying a
selection that never happens.

The same rule is applied one level down, to `app-icon.svg`: its **default** rules
are now the dark colorway with light as the `@media` override, because a renderer
that ignores the query paints the default, and the default must be the branch
that cannot degrade.

## Consequences

**Accepted cost — the Laser plate never appears on the Home Screen.** It remains
the house colorway everywhere it works: the favicons and `favicon.ico`, the
maskable/Android tiles, and the `og:image` share tile.

**What improves.** No install can land on the broken tile, in any appearance, at
any install time. The install-time coin-flip is gone, and with it a client
component, a unit suite, an e2e test and a 180 px asset — roughly 60 lines of
machinery whose only remaining effect would have been to _un-pin_ the tile.

**What is given up.** Users who installed before this change keep whatever tile
they captured; iOS caches web-clip icons aggressively and only delete-and-re-add
refreshes one. `app-icon.svg` still inverts for the browser tab and non-iOS
installs, so on a media-blind rasteriser the Android/desktop `any` icon may show
the Void plate while the maskable launcher tile shows the Laser one — cosmetic,
and only on that class of renderer.

**If this is ever revisited**, the only route to genuine light/dark/tinted
swapping is a native target with a layered Icon Composer icon (Capacitor,
PWABuilder, or a hand-rolled wrapper). That is a different project — App Store
account, build pipeline, release process — not a change to this one.

[761615]: https://developer.apple.com/forums/thread/761615
[787919]: https://developer.apple.com/forums/thread/787919
[801448]: https://developer.apple.com/forums/thread/801448
