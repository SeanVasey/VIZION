# VIZION icon repair: current contract and isolated acceptance

Status: implementation and targeted asset/browser checks available; the full
application gate and physical iOS Home Screen acceptance must be recorded
separately. No iPhone result is implied by this document.

## Current decision

Keep exactly one explicit Apple touch PNG: the INVERTED tile — a flat plate
shaded from Laser toward Void (`installedColorway().plate`, 0.55 of the way)
and the canonical symbol filled with the flat Laser token, with no outline.
iOS derives Dark appearance from this PNG by segmenting a foreground from the
plate and keeping it. Owner screenshots 2026-08-11 (flat Void mark: plate
swapped, mark kept), 2026-09-05 morning (Laser-filled outlined mark on a
Laser plate: no swap, tile only dimmed) and 2026-09-05 later (mark shaded
darker than the plate: plate swapped, mark kept) establish that iOS keeps
exactly the mark pixels whose colour is distinct from the plate. Inverting
makes the kept mark the full Laser token on iOS's near-black plate (≈16:1)
and reads at ≈4:1 on the shaded plate in Light; the outline that carried
Light contrast on a Laser plate is no longer needed on installed tiles and
stays only on the transparent `any` matrix. Do not replace the tile with a
permanently dark one. Preserve the master path, transform, fill rule,
transparent foreground exports and Android maskable safe area. The adaptive
SVG never reaches the iPhone Home Screen while the Apple link exists.

WebKit's documented explicit Apple-touch precedence is the conservative
production contract [1, 2]. The PNG is not a fallback subordinate to the first
manifest SVG. Safari 26 adds SVG icon support [3]; that announcement does not
establish live reevaluation of SVG CSS in an installed Home Screen icon.
Test that question separately with the diagnostic below.

A presentation `fill` attribute has specificity zero [4]. The generated SVG's
plate now has a token-derived lime presentation fill, while the class rule
continues to supply the dark background. Never replace this with an inline
style. A stylesheet-stripped fixture proves fallback rendering only; it does
not claim that iOS strips this stylesheet.

The Apple link carries a content version: `next.config.ts` hashes the PNG at
build and `layout.tsx` renders `/icons/apple-touch-icon.png?v=<md5 prefix>`.
The file, its name, the manifest and the header rules are unchanged; the
query exists because a phone that fetched the tile under the earlier
day-fresh policy kept serving it to the Add-to-Home-Screen sheet after the
origin had moved on (measured 2026-09-05), and `must-revalidate` cannot evict
a copy that is already cached. A regenerated tile is a new URL to Safari's
HTTP cache and to the service worker's runtime image cache alike. It is not a
`media` query and does not select a source.

`next.config.ts` retains general asset caching but makes two exact, later
exceptions: `/icons/app-icon.svg` and `/icons/apple-touch-icon.png` receive
`public, max-age=0, must-revalidate`. Next's last matching header wins [7]. This
allows revalidation of subsequent HTTP responses. It does not evict old
responses still fresh under the prior policy, bypass a service worker, or
replace an installed icon capture. Production manifest identity, references,
authentication, CSP, service-worker behavior and storage are unchanged.

## Historical evidence, not universal laws

ADR-0015's permanently dark artwork is superseded. ADR-0017's outlined artwork
is preserved. Their historical observations were reported for particular
builds/installations, not independently reproduced by this repair.
Claims that all iOS versions freeze icons forever, always apply last-link
selection, never select SVG, or always preserve every foreground pixel are
not acceptance guarantees. Some past manifest tests were invalidated by
preview authentication. Keep the reports as history but do not use them to
close source-selection questions on a new build.

The older iOS runbook's general distinction between Linux WebKit and the iOS
platform remains valid. Its contradictory icon-selection conclusions are
superseded by this narrower contract. An icon's browser-rendered background,
favicon, installation source and OS-generated appearance are four different
observations. `purpose: maskable` specifies cropping/safe area, not editable
native layers; `monochrome` cannot retain this two-color contrast design [5].

## Code verification

Use the repository's pinned lockfile and documented Node version. Do not
update dependencies to run this repair.

```sh
npm ci
npm run generate:icons
node scripts/verify-icon-repair.mjs
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run format:check
```

Run generation again and compare hashes for every generated output. Only
`public/icons/app-icon.svg` should differ from this repair's baseline, and
second-run output must match first-run output. Keep a separate report when a
newer HEAD legitimately changes inputs. Do not reset to the reference commit.

The new unit wrapper runs geometry, alpha, safe-area, fallback-pixel,
reference and diagnostic checks. The browser tests exercise actual CSS light
and dark at 60, 120 and 180 pixels, compare eroded opaque foreground pixels,
and use a missing-attribute negative control. Their shared helpers can run
with a Playwright Page independently of the application server. This does
not replace the repository's full gate.

`icon-install-inputs.spec.ts` checks server-rendered and hydrated metadata,
manifest identity, all declared icon bytes/MIME/dimensions and the two exact
cache exceptions against the actual test server. Run it on a complete build;
source inspection alone does not establish those response headers.

## Build and serve a separate diagnostic

```sh
# Choose a NEW directory whose parent exists, outside this checkout.
node scripts/icon-diagnostic.mjs build ../vizion-icon-probe-NEW
node scripts/icon-diagnostic.mjs serve ../vizion-icon-probe-NEW
```

The build command records the current Git base and actual working-tree asset
hashes. It refuses repository output or an existing destination. It writes no
production file. The local server binds `127.0.0.1:4173`; it is for local
inspection, not an already published iPhone preview.

For an iPhone, publish only that static directory to a new, unused, authorized
HTTPS preview origin. Use an existing permitted static-preview workflow, set
the framework to static/Other, no build command, and serve the directory as
the root. Never publish it below the production origin or inside `public/`.
Keep deployment protection enabled where required. Authenticate in Safari
first; the manifest links and preflight use credentials. An HTTP 200 login
page is not a manifest. The included standalone `vercel.json` supplies
no-store and security headers for this diagnostic only; it is not a change
to the application's deployment configuration.

The preflight checks no existing service worker, missing implicit root icons,
manifest JSON/identity and exact asset hashes. It never clears storage or
unregisters a worker. Check the preview configuration also has no root
Apple-touch wildcard files, no inherited app metadata and no SPA catch-all
rewrite. A failed isolation preflight blocks interpretation, not merely
installation. Do not remove security to make it pass.

Three separately named installations:

| Test     | Offered source                                                      | Distinguishing observation                                     |
| -------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| A PNG    | Explicit unchanged outlined Apple PNG; manifest offers the same PNG | Whether OS treatment keeps the approved symbol readable        |
| B SVG    | One manifest SVG, no Apple link or alternative manifest icon        | Lower-left square is light CSS; lower-right circle is dark CSS |
| C SOURCE | Apple PNG and manifest SVG                                          | Top rectangle is PNG; top circle is SVG                        |

Markers are diagnostic sibling elements, not master-logo edits. The harness
records base SHA, working-tree version, hashes and expected source. The
preview images are browser rendering only. Network requests corroborate but
do not prove selection. A failed SVG-only installation stays recorded as
unsupported; do not quietly add a fallback that makes the experiment ambiguous.

## One physical-device checklist

Record exact iOS build, test version, install time/appearance, current Home
Screen setting and a screenshot. Test normal Light, normal Dark and Auto
separately from Clear and Tinted [6]. The app's theme setting is not the
Home Screen appearance setting.

For each candidate, first install under Light and observe Light and Dark.
Then make a separate dark-installed test instance and observe Dark and Light.
Record immediate and later observations without inventing a required waiting
interval. Include the SVG branch/source markers when present. The pass
requires the same geometry, the shaded green plate with a bright Laser mark
in Light, and on the observed dark plate a visibly kept Laser mark — not a
dimmed tile and not a frozen wrong background.
Do not promise exact colors produced by the OS or behavior on untested builds.

Keep production installed while testing. Before a production removal/re-add,
confirm export/sync of local-only data; do not clear Safari website data as a
routine step. Only promote a source-selection change after device evidence
and the full repo gate. No merge or production deployment is authorized by
this runbook. Report unresolved acceptance as pending, not impossible.

## Primary references and scope

Checked September 4, 2026. Historical publication date is not a guarantee
about every later iOS build; new reproducible platform evidence may supersede
historical behavior.

1. WebKit, Safari 15.4, March 14, 2022: manifest icon selection.
   https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/
2. WebKit, iOS/iPadOS 16.4 beta, February 16, 2023: explicit Apple-touch precedence.
   https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
3. WebKit, Safari 26.0: SVG icon support, not a live Home Screen CSS guarantee.
   https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
4. W3C SVG 2, styling, presentation attributes and specificity.
   https://www.w3.org/TR/SVG2/styling.html#PresentationAttributes
5. W3C Web Application Manifest: icon purposes and maskable safe area.
   https://www.w3.org/TR/appmanifest/
6. Apple iPhone User Guide: Home Screen customization.
   https://support.apple.com/guide/iphone/customize-apps-and-widgets-on-the-home-screen-iph385473442/ios
7. Next.js headers documentation: matching rules and header overrides.
   https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
