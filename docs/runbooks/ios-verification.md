# Runbook — what the `mobile-safari` e2e project can and cannot prove

## Why this exists

VIZION is an iOS-first PWA, so a large number of decisions in this codebase
rest on a claim about iOS Safari. Playwright's `mobile-safari` project looks
like the way to check them. It is not, and mistaking it for one has already
produced two wrong claims that shipped (`tasks/lessons.md`, 2026-07-28).

**Playwright's WebKit is WebKitGTK/WPE on Linux. It is not Mobile Safari.** It
shares the rendering engine, so it is genuine evidence about CSS. It does not
share iOS's platform layer, its input handling, or its capability surface — and
it diverges in **both** directions, which is what makes it dangerous: a missing
capability there does not mean iOS lacks it.

## Measured divergences (2026-07-28, WebKit 26.4 via Playwright 1.60)

Taken in an iPhone 14 Pro device context, on a confirmed secure context
(`isSecureContext === true`), against the app's own `/sign-in`.

| Capability                                                                       | Playwright WebKit                                                                                                                             | Real iOS Safari                                                                                                 | Consequence                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigator.storage`                                                              | **absent** (`'storage' in navigator === false`)                                                                                               | present since iOS 17 — WebKit grants `persist()` on heuristics that include _"opened as a Home Screen Web App"_ | A test asserting "WebKit has no Storage API" would encode a WebKitGTK fact as an iOS one, and would be exactly backwards about our primary surface                                                                                                                                                                                                          |
| `-webkit-touch-callout`                                                          | **unsupported**                                                                                                                               | supported (this is why the `@supports` hack works as an iOS filter)                                             | The `@supports` gate in `globals.css` can only ever be verified in the negative here                                                                                                                                                                                                                                                                        |
| `navigator.vibrate`                                                              | absent                                                                                                                                        | absent (MDN BCD: `safari`/`safari_ios` false)                                                                   | consistent — `lib/haptics.ts`'s HONEST SCOPE note stands                                                                                                                                                                                                                                                                                                    |
| Background Sync                                                                  | absent                                                                                                                                        | absent                                                                                                          | consistent — `OutboxFlusher`'s premise stands                                                                                                                                                                                                                                                                                                               |
| `:active` on touch                                                               | applies regardless of any document touch listener; `touchscreen.tap()` cannot hold a press                                                    | widely reported to require a document touch listener, all reporting 2011–2015                                   | unresolvable here; the app was changed so nothing depends on it                                                                                                                                                                                                                                                                                             |
| `-webkit-backdrop-filter` — the PROPERTY                                         | supported (Chromium: **not** supported)                                                                                                       | supported                                                                                                       | keep both prefixed and unprefixed declarations                                                                                                                                                                                                                                                                                                              |
| `backdrop-filter` — actually PAINTING (2026-08-11)                               | **never renders.** Plain, masked, or on a promoted `::before`; `filter: blur` works on the same page, so it is the compositor, not the syntax | renders                                                                                                         | the whole `.glass` family's blur is asserted here only by computed style, never by pixels; any decision that depends on the blur being VISIBLE — or on how it composites with something else — has to be measured in Chromium and then confirmed on a device                                                                                                |
| `prefers-color-scheme` INSIDE an SVG pulled in via `<img>` (2026-08-12)          | **not applied** — paints whatever the file's DEFAULT rules declare, under both schemes                                                        | n/a for the Home Screen: iOS does not select the linked SVG for the tile at all (settled 2026-08-13, below)     | Recorded as the measured divergence; nothing depends on it any more. `app-icon.svg` carried a light/dark swap with the dark colorway as the default (the branch a media-blind renderer paints had to be the one that could not degrade); since ADR-0017 it is one outlined colorway with no media query, and its e2e render assertion runs on both engines. |
| `inert`, `content-visibility`, `contain-intrinsic-size`, `color-mix`, `text-box` | all supported                                                                                                                                 | —                                                                                                               | safe to rely on                                                                                                                                                                                                                                                                                                                                             |

## The rule

**Use `mobile-safari` for the engine, never for the platform.**

Good uses — things where sharing the rendering engine is the whole point:

- cascade-layer resolution (`.glass:focus-visible`, `[data-scrolling] .fab-glass::before`)
- computed styles, `@supports` in the negative, prefixed-property need
- layout, safe-area, `dvh`, scroll behaviour

Bad uses — assert these and you are describing Linux, not iOS:

- "capability X is missing on iOS" from `typeof navigator.x === 'undefined'`
- anything about touch _input_ semantics: `:active` on tap, the synthetic-click
  sequence, long-press, the double-tap-zoom delay
- storage eviction, ITP, Home Screen web-app behaviour, the status bar

## Before writing an iOS claim into the codebase

1. **Try to measure it here first**, in both engines, and say which you used.
2. If it cannot be measured here, **check current documentation** — MDN BCD,
   the WebKit blog, Safari release notes — and cite it with a date. Note that
   most search results on iOS touch quirks are 2011–2015 and describe a browser
   that may no longer exist.
3. If it still cannot be established, **prefer removing the dependency to
   documenting the uncertainty.** That is what was done for `:active`: the app
   now uses state it sets itself, so the open question stopped mattering.
4. If the dependency must stay, label it in the comment with what was verified,
   what was not, and what would silently break — as
   `src/lib/pwa/register-sw.ts` and the `@supports` gate in `globals.css` now do.

## Re-running the divergence check

There is deliberately no committed spec for the table above: a test asserting
"WebKit lacks `navigator.storage`" would enshrine the very error this runbook
exists to prevent, and would fail as a _bug report_ the day WebKitGTK adds it.
Re-measure ad hoc when upgrading Playwright, with a scratch script:

```js
// node scratch.mjs — run from the repo root, app served on :3100
import { webkit, chromium, devices } from "playwright";
for (const [name, type] of [
  ["webkit", webkit],
  ["chromium", chromium],
]) {
  const b = await type.launch();
  const p = await (await b.newContext({ ...devices["iPhone 14 Pro"] })).newPage();
  await p.goto("http://127.0.0.1:3100/sign-in");
  console.log(
    name,
    await p.evaluate(() => ({
      secure: window.isSecureContext,
      storage: "storage" in navigator,
      touchCallout: CSS.supports("-webkit-touch-callout", "none"),
      vibrate: typeof navigator.vibrate,
      backdropPrefixed: CSS.supports("-webkit-backdrop-filter", "blur(1px)"),
    })),
  );
  await b.close();
}
```

Browsers are not installed in every container. `tests/e2e/global-setup.ts`
fails with the install command if one is missing; do not delete a project to
make that go away.

## Settled on device — the Home Screen tile (2026-08-12)

This was the longest-standing open question here, and it is now **closed by
measurement**: the owner photographed two installs of the app side by side, in
both appearances, on an iOS 26 device. Recorded here because the answer is the
opposite of what this runbook previously told the next reader to assume.

| Question                                                        | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does iOS read `<link rel="apple-touch-icon">` for the tile?     | **Yes, definitely.** One install carried the light colorway (Void ink on a Laser plate), and that artwork exists nowhere but `apple-touch-icon.png` — the manifest's `any` entries were transparent Laser glyphs.                                                                                                                                                                                                                                                          |
| Does iOS ALSO use the manifest `icons`, and at what precedence? | **Not established — do not read a "no" here.** The other install showed a Laser mark on black, which is `apple-touch-icon-dark.png` and the manifest's transparent glyph composited on black _rendered identically_. The photographs cannot separate them. An earlier revision of this row asserted "No, the manifest never reaches this surface"; that was an inference dressed as a measurement, and it was made against a build whose manifest contained no SVG at all. |
| Does iOS evaluate `media` on `apple-touch-icon`?                | **No.** `media` selects `apple-touch-startup-image` (which is why the splash links resolve per device) but not icons. Apple's "last one wins" is what applies.                                                                                                                                                                                                                                                                                                             |
| Does iOS re-resolve the tile when the appearance changes?       | **No.** It resolves ONCE, at capture, and freezes. Re-adding to the Home Screen is the only refresh.                                                                                                                                                                                                                                                                                                                                                                       |
| What does iOS do with a single tile under dark appearance?      | **Auto-darkens it.** On the light tile (Void ink on a Laser plate) that pulls the plate to near-black and leaves the mark an invisible emboss.                                                                                                                                                                                                                                                                                                                             |
| \1                                                              | What does iOS 26 do with the outlined tile (Laser plate, outlined mark) in dark appearance?                                                                                                                                                                                                                                                                                                                                                                                | **Separates it — measured 2026-09-04 (owner screenshots).** The plate is replaced by a dark gradient derived from the plate's colour (`#182110` → `#070B0E`); the mark is kept pixel for pixel, fill and outline. The first dark-appearance screenshot after adding still showed the green plate — the variant is produced after the fact, so a photo taken right after adding is provisional. |

**Caveat on every manifest-dependent row above (recorded 2026-09-04).** Until
that date the manifest link carried no `crossorigin="use-credentials"`, and a
manifest is fetched with credentials omitted by spec — so on a preview
deployment behind Vercel's cookie-based protection the page loaded and the
manifest fetch was redirected to Vercel's SSO page (a 302, measured on the #114
preview on 2026-09-04). Any observation made on a protected preview
before then about what iOS does WITH the manifest (row 2's precedence question
included) was made against a device that had no manifest at all. Row 2 stays
"not established"; re-measure it on a build that carries the credentialed link
before reading anything into it. Rows about `apple-touch-icon` and `media` are
unaffected — those links are read from the head, which the device did have.

The consequence: the complementary-query pair shipped in #108 could never have
worked. Its dark half was unreachable, and because the LIGHT tile was declared
last, "last one wins" resolved to the one artwork that iOS then destroys. That
is exactly the failure the owner reported.

**What ships now — ONE tile, the OUTLINED colorway (ADR-0017, 2026-09-04).**
iOS keeps exactly one image and freezes it at capture, so there is still one
link and no query
([ADR-0015](../decisions/0015-pinned-home-screen-tile.md) — the arrangement
half of it stands). What changed is the artwork behind the link
([ADR-0017](../decisions/0017-outlined-home-screen-icon.md)):

- `metadata.icons.apple` is **one unconditional link** at
  `/icons/apple-touch-icon.png` — a Laser plate under the mark FILLED in Laser
  and STROKED in Void, a slight top-lit gradient on both. No `media`: iOS does
  not evaluate it on icons, so a query would imply a selection that never
  happens. With one link, "last one wins" is a tautology and there is no order
  left to get wrong.
- The tile no longer has to be dark to survive. The dark tile was legible under
  every treatment because darkening dark artwork is a no-op — and it cost the
  brand green the Home Screen. The outlined mark carries its own contrast: on
  the Laser plate the Void outline reads; on a plate iOS has darkened or
  replaced, the Laser fill reads.
- `/icons/app-icon.svg` is the outlined tile as vector in BOTH appearances
  (ADR-0017 amendment 2): the plate follows `prefers-color-scheme` — the Laser
  ramp in light, Void in dark — and the mark is the outlined mark in both.
  Default LIGHT: a media-blind renderer captures the green tile, which iOS's
  dark pass separates; a captured dark tile would stay dark in light. It is the
  manifest's first icon, and Safari 26 uses manifest icons, SVG included, for
  the Home Screen — the declarative route to a dark plate. The PNG tile stays
  as the fallback.

**OPEN — needs a device (2026-09-04, the SVG route).** Row 6's "iOS does not
select the manifest SVG" was measured without a manifest (the caveat above);
it needs re-measuring on production or a post-#114 preview. Two installs:
(1) add in LIGHT appearance, toggle dark — a Void plate means the SVG's dark
branch was honoured live; a green plate that later goes dark-gradient means
the after-the-fact variant of a captured raster; (2) add in DARK appearance,
toggle light — a green plate means live SVG; a dark plate means a captured
render. Photograph all four states and record which surface iOS read.

**MEASURED 2026-09-04 — the outlined tile, both appearances (owner
screenshots).** Light: as authored. Dark: iOS separated the tile — the plate
replaced by a dark gradient derived from the plate's colour (`#182110` →
`#070B0E`), the mark kept pixel for pixel (fill `#CAF742`, outline `#020902`).
An earlier dark-appearance screenshot of the same install showed the plate
still green: the dark variant is produced after the fact, not at capture, and
the exact trigger (time, a Home Screen re-render, the icon-style setting) is
not established — so a dark-appearance photo taken right after adding is not
yet a measurement. #116 read that first photo as "not separated", flattened
the plate and paled the fill, and was reverted once the second photo arrived.
The artwork of ADR-0017 stands. Existing installs keep the tile they captured;
delete-and-re-add is the only refresh.

**Superseded, and recorded because each one shipped the bug** — three
arrangements preceded this, all trying to make the tile follow the appearance:

1. _(#108)_ a complementary `media` pair, light declared last. `media` is not
   evaluated on icons, so this resolved to light every time and iOS darkened it.
2. _(#111)_ the same pair reordered dark-last, plus `AppleTouchIcon.tsx`, a
   client component that rewrote the href per appearance. This worked — it made
   the capture match the appearance at install — but matching only chooses WHICH
   failure a user gets: a light-mode install still degrades the moment the phone
   goes dark.
3. _(#111)_ the self-inverting SVG as a Home Screen route. Not selected by iOS.

The pattern across all three: every one bet that iOS would re-resolve or select
something. It never does. **Do not add a second `apple-touch-icon` link, a
`media` query, or a JS matcher.**

**CLOSED 2026-08-13 — NEGATIVE.** The open question this section used to carry
(whether iOS applies `prefers-color-scheme` when rasterizing a linked SVG icon)
was settled by the device pass described in row 6: it does not select the file at
all, so the question of how it would render it never arises. The residual that
motivated the matcher — "an install captured in light mode and later viewed in
dark shows iOS's auto-darkened Laser plate" — was closed by pinning the tile
dark, so that no install could capture the Laser plate. (Since 2026-09-04 an
install captures the Laser plate again, deliberately: the outlined mark on it
does not depend on the plate for contrast — ADR-0017, and the OPEN item above.) Apple's dark-icon model (transparent background + foreground, system
supplies the #313131→#141414 gradient) reaches native apps via Icon Composer and
has no web-clip equivalent; a PWA declares a single image where a native target
declares layers.

**Do not reach for `BASE` in `scripts/generate-icons.mjs` for any of this.** An
earlier revision of this runbook said to flip it to `"dark"`, and that was wrong:
`BASE` governs the scheme-agnostic favicons and maskable tiles, and flipping it
would put the LIGHT colorway in the file named `-dark` (Codex review, #108). The
one tile is pinned to a fixed scheme name, so a `BASE` flip cannot invert it.

## What still needs a real device

The open questions. The first is no longer depended on; the rest are:

- whether iOS still ignores `:active` for touch without a document touch
  listener (and whether the documented workaround still causes controls to
  flash active during scroll)
- whether `persist()` is actually granted for this app once installed
- the `@supports (-webkit-touch-callout: none)` gate firing, and the 16px
  focus-zoom behaviour it guards against
- the `backdrop-filter`-on-a-fixed-bar detachment that `.glass-chrome` /
  `.glass-nav` are architected around (blur on a `::before`, bar promoted to
  its own layer). That one was found empirically on device — the bottom nav
  floated mid-screen over the footer — and headless WebKit is unlikely to
  reproduce it, since it turns on WebKit's _async_ scrolling. Treat the
  architecture as load-bearing and do not "simplify" it without a device.
- the hold-slider's long-press behaviour (ADR-0012, amended 2026-08-09
  after the first on-device pass failed — the pre-hold window was open to
  a UA pan-steal and the slop rule discarded the press-and-slide gesture).
  The pre-hold window is now pinned under real synthesized touch in
  Chromium (`authed.spec.ts` "under touch", CDP-only: press-and-slide
  engages, a stationary hold expands, a tap latches the capsule), and the
  resting `touch-action: pinch-zoom` denies the UA the pre-hold pan-cancel
  by construction. What still needs the device is the WebKit/iOS half: that
  `-webkit-touch-callout: none` plus the global button `user-select: none`
  actually beat the ~500ms system callout/loupe on the composer pills, and
  that the active-phase `touchmove` preventDefault holds a mid-drag
  vertical wander against a `pointercancel`. If they fire anyway, the
  revert path is graceful (the gesture cancels, nothing commits), so the
  failure mode is a missing accelerator, not a broken control.
- **the LATCHED phase under iOS touch (ADR-0014, new 2026-08-11 —
  unverified on device).** A tap now opens a capsule that OUTLIVES the
  finger, and the interactions that follow land on a portalled overlay
  rather than on the pill the tap started from. Three things to watch,
  none of which Chromium's CDP synthesis or WebKitGTK can answer: (1) that
  the callout/loupe timer does not fire on the pill during the tap that
  latches — the tap is short, so this should be strictly easier than the
  hold path, but it is a different code path; (2) that scrubbing the open
  track works, i.e. `touch-action: pinch-zoom` on the overlay is honoured
  and iOS does not treat a drag beginning on a `position: fixed` portalled
  element as a page pan; and (3) that the outside-tap dismiss lands on the
  scrim rather than being eaten as a "dismiss the keyboard" gesture when
  the composer's textarea is focused. Failure mode here is NOT graceful in
  the way the accelerator's is: the dial has no sheet behind it any more,
  so a latched capsule that cannot be scrubbed or dismissed leaves the
  pointer user with only the drag path. Check this one first.

- **the capsule's HALO — the masked blur and the frosted capsule (ADR-0014
  amendment 1, new 2026-08-11 — unverified on device).** The halo's soft
  edge is `mask-image` over a `backdrop-filter`, the app's first use of a
  mask anywhere, and the capsule sits on a second `backdrop-filter` that
  samples the halo's output. Chromium renders both as intended (measured by
  render). This engine cannot check either, for the reason now in the table
  above: it paints no `backdrop-filter` at all, so there is nothing for a
  mask to gate and nothing for the frost to sample. Two questions for a
  device: whether Safari gates the filter with the mask, and whether
  stacking a filtered capsule over a filtered halo composites or flattens.
  The failure mode is graceful by construction and that is deliberate —
  the localization lives in the blur ELEMENT'S BOX, not in the mask, so an
  iOS that ignores the mask still gets a local halo with a harder edge, and
  an iOS that drops the filter gets the dim alone. Neither is the
  full-viewport wash the amendment exists to remove. Do not "simplify" the
  box down to `inset-0` on the grounds that the mask handles it.

A single pass on a physical iPhone, in the installed PWA, would close every
one of these.
