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

| Capability | Playwright WebKit | Real iOS Safari | Consequence |
| --- | --- | --- | --- |
| `navigator.storage` | **absent** (`'storage' in navigator === false`) | present since iOS 17 — WebKit grants `persist()` on heuristics that include *"opened as a Home Screen Web App"* | A test asserting "WebKit has no Storage API" would encode a WebKitGTK fact as an iOS one, and would be exactly backwards about our primary surface |
| `-webkit-touch-callout` | **unsupported** | supported (this is why the `@supports` hack works as an iOS filter) | The `@supports` gate in `globals.css` can only ever be verified in the negative here |
| `navigator.vibrate` | absent | absent (MDN BCD: `safari`/`safari_ios` false) | consistent — `lib/haptics.ts`'s HONEST SCOPE note stands |
| Background Sync | absent | absent | consistent — `OutboxFlusher`'s premise stands |
| `:active` on touch | applies regardless of any document touch listener; `touchscreen.tap()` cannot hold a press | widely reported to require a document touch listener, all reporting 2011–2015 | unresolvable here; the app was changed so nothing depends on it |
| `-webkit-backdrop-filter` | supported (Chromium: **not** supported) | supported | keep both prefixed and unprefixed declarations |
| `inert`, `content-visibility`, `contain-intrinsic-size`, `color-mix`, `text-box` | all supported | — | safe to rely on |

## The rule

**Use `mobile-safari` for the engine, never for the platform.**

Good uses — things where sharing the rendering engine is the whole point:

- cascade-layer resolution (`.glass:focus-visible`, `[data-scrolling] .fab-glass::before`)
- computed styles, `@supports` in the negative, prefixed-property need
- layout, safe-area, `dvh`, scroll behaviour

Bad uses — assert these and you are describing Linux, not iOS:

- "capability X is missing on iOS" from `typeof navigator.x === 'undefined'`
- anything about touch *input* semantics: `:active` on tap, the synthetic-click
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
exists to prevent, and would fail as a *bug report* the day WebKitGTK adds it.
Re-measure ad hoc when upgrading Playwright, with a scratch script:

```js
// node scratch.mjs — run from the repo root, app served on :3100
import { webkit, chromium, devices } from "playwright";
for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const b = await type.launch();
  const p = await (await b.newContext({ ...devices["iPhone 14 Pro"] })).newPage();
  await p.goto("http://127.0.0.1:3100/sign-in");
  console.log(name, await p.evaluate(() => ({
    secure: window.isSecureContext,
    storage: "storage" in navigator,
    touchCallout: CSS.supports("-webkit-touch-callout", "none"),
    vibrate: typeof navigator.vibrate,
    backdropPrefixed: CSS.supports("-webkit-backdrop-filter", "blur(1px)"),
  })));
  await b.close();
}
```

Browsers are not installed in every container. `tests/e2e/global-setup.ts`
fails with the install command if one is missing; do not delete a project to
make that go away.

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
  reproduce it, since it turns on WebKit's *async* scrolling. Treat the
  architecture as load-bearing and do not "simplify" it without a device.
- the hold-slider's long-press behaviour (ADR-0012): that the 300ms hold +
  `-webkit-touch-callout: none` actually beats the system callout/loupe on
  the composer pills, and that the active-phase `touchmove` preventDefault
  holds a mid-drag vertical wander against a `pointercancel`. The e2e drag
  spec is mouse-driven by design — it says nothing about iOS touch. If the
  callout fires anyway, the revert path is graceful (the gesture cancels,
  nothing commits), so the failure mode is a missing accelerator, not a
  broken control.

A single pass on a physical iPhone, in the installed PWA, would close all five.
