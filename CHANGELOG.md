# Changelog

All notable changes to VIZ(IO)N are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — the `brace-expansion` override no longer breaks glob expansion

`overrides` had a single blanket `"brace-expansion": "^5.0.8"`, which forced v5
into `minimatch@3` — reached via `@eslint/config-array`, `@eslint/eslintrc`,
eslint and three of its plugins. v5's CJS entry exports an **object**
(`{ EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand }`) while minimatch@3 does
`require('brace-expansion')` and **calls the result**, so brace expansion through
minimatch@3 died with `TypeError: expand is not a function`.

That broke every braced glob reachable through minimatch@3 and went unnoticed
because nothing in the repo used one. The commit that added the override recorded
"5.0.8 still publishes a CJS require export, so minimatch@3 keeps working — the
path `npm run lint` exercises", which was verified against a config with no braced
pattern; the export exists but is not callable. An ESLint
`files: ["src/**/*.{ts,tsx}"]` is the first thing to hit it.

The override is now keyed per major — `brace-expansion@1` → `^1.1.17`,
`@2` → `^2.1.3`, `@5` → `^5.0.8` — so every consumer gets an API it can actually
call. Verified: `minimatch@3` loads its own nested `1.1.17`, and
`new Minimatch("src/**/*.{ts,tsx}").braceExpand()` returns
`["src/**/*.ts", "src/**/*.tsx"]`.

**Tradeoff, taken deliberately.** The advisory range is `<=5.0.7`, so there is no
patched 1.x or 2.x — the earlier commit was right about that. The full-tree
`npm audit` therefore reports 14 high entries again, every one in dev tooling (the
eslint chain and workbox-build), none in shipped code. CI gates
`npm audit --omit=dev --audit-level=high`, which stays at **0**, and the full-tree
step was already advisory-only (`|| true`). The alternative was keeping a silently
broken glob engine in exchange for a tidier report about packages that never
reach production.


### Added — lint now rejects class names Tailwind does not recognise

`eslint-plugin-tailwindcss`'s `no-custom-classname` is on for `src/`, with the
project's own ~35 component/utility classes whitelisted in `eslint.config.mjs`.

It exists because of a concrete miss: a botched patch left `itemsateems-center`
in a className, Tailwind emitted no rule for it, and the Save button silently lost
its vertical centering — while **lint, typecheck, 748 unit tests, the e2e suite
and the production build were all green**, because nothing in that gate asks
whether a utility exists. A review bot caught what five steps could not. Verified
by reintroducing the exact typo: `Classname 'itemsateems-center' is not a Tailwind
CSS class!`, via `npm run lint`, so it is genuinely in the gate.

Only that one rule is enabled. `classnames-order`, `enforces-shorthand` and the
rest are formatting opinions that would rewrite most of the codebase in one commit
and bury real defects in the churn.

Two constraints are now documented in `AGENTS.md`, both discovered the hard way:

- **No brace patterns in `eslint.config.mjs`.** `package.json` overrides
  `brace-expansion` to `^5` for security, but ESLint's `minimatch@3` expects `^1`
  and calls it as `expand(...)` — so any `files`/`ignores` entry containing
  `{a,b}` dies with `TypeError: expand is not a function` before a single file is
  linted. Every pre-existing pattern happens to be brace-free, which is the only
  reason this latent trap had never fired. Fixing it at the root would mean
  loosening a security override, which is an owner decision.
- **The plugin must stay on `3.x`** while Tailwind is on 3 (`4.x` peers on
  Tailwind 4), and `settings.tailwindcss.config` must be an ABSOLUTE path — the
  plugin resolves modules from `dirname(config)`, so a relative value fails with
  `Could not resolve tailwindcss`.

`npm audit` stays at 0 vulnerabilities with the new devDependency.


### Added — edit a saved draft in place

Each row in the Drafts view gains an Edit button that opens the draft's text in a
sheet and saves it back to the same row. Resuming a draft is a MOVE — it lands in
the composer and the server row is deleted — which is right for "carry on writing
this" and wrong for "fix a typo": that previously meant resume, edit, save again,
with a window where the draft existed nowhere but the device.

Body only, deliberately. Target model, mode and thinking level are the composer's
own controls; editing them from a list row would mean rebuilding the mode rig and
the target picker inside a sheet, and resuming is the better route. The sheet says
so rather than leaving it to be discovered. The title is re-derived from the new
first line, for the same reason it is derived on save — it is a view of the body,
not a second field to keep in sync.

Three things that would each have been a silent bug:

- **The editor is seeded from the FETCHED body, never the row's preview.** A card
  carries only the first 160 characters, so an editor seeded from it would have
  truncated the draft the moment the user saved. Save is disabled until the full
  body arrives, and a failed fetch shows the error instead of an empty textarea
  inviting the user to overwrite their draft with it. A unit test fails if the
  seed ever comes from the preview.
- **`updated_at` is set explicitly.** The column defaults to `now()` on INSERT
  only and there is no trigger, so an edited draft would otherwise keep its
  original timestamp and sink in a list ordered by `updated_at desc` — edited and
  apparently untouched.
- **Client-accumulated pages collapse after a save.** The same bump reorders the
  list, so the keyset cursor behind pages 2+ no longer describes that sequence;
  without resetting, the edited row could appear twice, pre-edit and post-edit,
  disagreeing with itself.

Pagination is suppressed while the post-save `router.refresh()` is in flight.
`refresh()` is called inside its own SYNCHRONOUS transition, because `startAction`
takes an async callback and React has left the transition scope by the time the
awaited work finishes — so a refresh issued there is attached to nothing and the
pending flag clears while the new props are still in flight. In that window
`cursor` falls back to the pre-edit `nextCursor` prop, and paging from it
re-creates exactly the skip the derivation was added to prevent. Gating on the
refresh transition is deadlock-free: React always settles a transition, whereas
waiting for a prop to actually change would hide "Load more" forever when an edit
happens not to move the page boundary.

Saving is conditioned on the version the editor was opened against, so the same
draft open in two tabs cannot have the stale one silently overwrite the newer
body. The precondition is the `updated_at` returned by the body FETCH, not the
list row's — the row can already be stale when the editor opens, and conditioning
on that would reject a save against a body the user never saw. Zero rows matched
is then ambiguous, so the failure path reads the row back and distinguishes
"changed somewhere else" (reopen for the newer version) from "no longer there".

Every server-action call in the view goes through a small `settle` helper. An
action returns `{ ok: false }` for errors it can describe but REJECTS when the
request itself fails, and an uncaught rejection inside a transition reaches the
route error boundary and unmounts the component — which for the edit sheet meant
the unsaved text was discarded by the very path meant to preserve it.

A row that no longer exists is reported as such rather than as success — RLS makes
"not yours" and "not there" indistinguishable, and both mean the edit did not
land. A failed save keeps the sheet open with the text intact, and no dismissal
path can close it mid-save.

The body rules are now shared between save and update, so an edit cannot accept
what a save rejects and surface as a raw constraint violation.


### Changed — one password rule, 12 characters with character classes

The account password minimum goes from 8 to **12**, and now also requires a
lowercase letter, an uppercase letter and a number. It governs SETTING or
CHANGING a password; existing passwords are untouched and keep working, so a rule
change locks nobody out.

`src/lib/auth/password.ts` is the single definition — `MIN_PASSWORD_LENGTH`,
`validatePassword()` and `PASSWORD_RULE_TEXT`. The rule had been the literal `8`
in four places (a `MIN_PASSWORD` const in `(auth)/actions.ts` plus three
`minLength={8}` attributes across `SetPasswordForm` and `SettingsPanel`), so
raising it meant finding all four and a miss would leave a form that accepts what
the server rejects. A unit test now fails if any call site hardcodes a length
again, or stops importing the shared module.

Both forms state the rule under the inputs instead of letting the user discover it
by rejection — `minLength` alone says nothing about character classes. The server
still validates independently: `minLength` is a convenience a client can decline
to honour.

Not DIY auth (§6): Supabase Auth still owns the credential, hashes it and issues
the session. This is input validation in front of `supabase.auth.updateUser`, the
same category as checking that the two fields match.

**Why classes, with a caveat.** The control that actually addresses credential
stuffing is Supabase's leaked-password check against HaveIBeenPwned, and it is
gated behind the Pro plan — this org is on Free, so it cannot be enabled. NIST SP
800-63B §5.1.1.2 recommends against mandatory composition rules and for a
breach-list check instead, so if this project moves to Pro, turning on "Prevent
the use of leaked passwords" in Auth → Providers → Email is strictly better than
the class checks and they can be relaxed. Recorded in the module's own comment so
the tradeoff is visible at the point of change.


### Added — account-backed drafts and a "New prompt" button

A floating + on Library and Settings takes you back to an empty composer. With
nothing in the composer it goes straight there; with a prompt in progress it asks
first, because the draft persists and starting fresh would otherwise destroy it.
Save keeps it in your account, Discard throws it away (undoably — unlike Save,
there is no server copy to fall back on), Cancel changes nothing.

Drafts are server state, in a new `public.drafts` table with owner-only RLS
(`drafts_<verb>_own`, shipped in the same migration per §6). `editorDraft` had
only ever been in localStorage, which §6 calls convenience-only and iOS ITP
evicts — a draft the user was told was "saved" has to survive eviction, a new
device and a reinstall. Its own relation rather than a `prompts.is_draft` flag:
every library read filters `prompts` on `deleted_at`/`archived_at` and nothing
else, so a flag would have leaked drafts into the library, the facet counts and
the activity feed until each was audited, and any future query would have to
remember. A separate relation cannot leak by omission.

Saved drafts appear under a Drafts view in the library (`/library?view=drafts`),
reusing the existing filter/URL/back-button plumbing, and they are **searchable**:
the view has its own search field and model chips. Search covers the body as well
as the title, because a draft's title is only its derived first line — title-only
search (what the prompts library does, where the user names the prompt) would miss
what the draft is actually about. `model` and `mode` narrow drafts too since both
are real columns; `tag` and `collection` are prompts-only and stay ignored rather
than being reinterpreted. The filter is re-sent with "Load more", so page 2 is
narrowed exactly like page 1. A draft captures the whole
composer state — body, target model, mode, thinking level — because resuming into
whichever model happened to be selected later would silently change what you get
back. Resuming is a **move**: the state is written into the composer and the
server row is deleted, so the same work never exists in two places. The body is
fetched before the delete, so a failed read loses nothing.

The local draft is cleared only after a save reports `ok`. A pending migration
(`unavailable`) counts as a failure for that purpose — clearing on a save that
did not happen would destroy exactly the work the user asked to keep.

`supabase/migrations/20260730000000_drafts.sql` has been applied to the hosted
project (2026-07-30). The client still degrades safely if it is ever missing: the
Drafts view says drafts aren't set up yet rather than "nothing saved" (a lie about
data the user may have) or an error (alarming about a system that is merely
incomplete), and the save path refuses and keeps the draft.


### Changed — the Enhance hero emblem becomes Horizon

The `PromptFlow` emblem repeated the `(│›◯)` mark about 200px below the same
mark in the header, and read as a third full-width band stacked under the top
bar and the mode rig. It is replaced by **Horizon**
(`src/components/editor/Horizon.tsx`): one edge-faded hairline (64% wide, capped
at 240px) with a single 5px node breathing at its centre on a 4.4s cycle.

Horizon first shipped with the emblem's exact footprint, to keep the swap free
of spacing changes. That footprint was sized for an SVG lockup, and once the
lockup was gone it read as roughly 1.5x too much air above the composer for a
hairline and a dot.

The band's height is entirely padding — the mark inside is a 1px rule and a 5px
node at every size — so it is now a flat `h-7` (28px) rather than
`min(width / 5, 64px)`. With the page's `py-5` above and its `-mb-3`-trimmed
`gap-8` below, clearance on each side of the rule goes from 52px to **34px**.
The rule and the node are untouched: the ask was less dead air, not a smaller
mark.

The aspect ratio went with it. It existed only to track the emblem's
`max-w-[320px]` viewBox so the band could not grow the header on narrow screens,
and nothing inside the band scales with width any more; 28px sits below the old
curve at every viewport, so that failure mode cannot recur.

It reuses `--accent-ink` rather than adding a token: that role already exists
and is theme-aware, so light mode keeps its darkened ink and no Laser lands on a
light surface (§6). Only `transform` and `opacity` animate, so the breathe stays
on the compositor; the node's base declarations double as its reduced-motion
rest state (`scale(1)` / `opacity: .9`), verified in both engines. The emblem's
`sr-only` orientation sentence moves up to `page.tsx`; Horizon itself is
`aria-hidden` with no role, text or tab stop.

### Added — end-to-end coverage of the app behind the auth gate

Every e2e spec could previously only reach `/sign-in`, because middleware
bounces everything else. The actual product — the bottom nav, the library,
Settings, every `loading.tsx` — had no end-to-end coverage at all, and specs
that wanted it synthesised markup and asserted against the stylesheet. That gap
had already cost something concrete: the nav shipped with no press scale while
its e2e spec stayed green, because the spec's hand-written probe had been
updated and the component had not.

`tests/e2e/support/supabase-stub.mjs` is a dependency-free stub Supabase
implementing the slice the authed screens touch — the password grant, refresh,
`GET /auth/v1/user`, and enough PostgREST for `profiles` / `prompts` /
`prompt_versions` / `activity_events` / `collections` / `media_assets` /
`usage_events`. `playwright.config.ts` runs it and points
`NEXT_PUBLIC_SUPABASE_URL` at it, the same way it already flips
`VIZION_HTTP_ORIGIN`.

**Nothing in `src/` changed to make this work.** No `if (process.env.E2E)`
branch: CLAUDE.md §6 is explicit about Supabase Auth only, and a test-only auth
path is a production hole one config mistake away from being real — besides
which it would verify a code path users never execute. The specs sign in
through the real form and drive the real middleware, the real `@supabase/ssr`
clients and the real onboarding gate. The stub does **not** implement RLS and
says so: it answers as the owner, so nothing here is evidence about row-level
security.

New `tests/e2e/authed.spec.ts` covers the nav press affordance **on the shipped
element**, tab navigation and `aria-current`, the library rendering from the
server with `content-visibility` rows, glass standing its blur down over a real
list of cards, nav clearance vs `--bottom-nav-h`, and Settings. 27 e2e → 41,
across both engines.

Two guards, because both failure modes are silent:
`expectNoUnhandledStubRoutes` fails a spec if the stub was asked for a route it
does not implement (it caught `media_assets` immediately), and the stub records
a filter on a column no fixture row has — which is how `.is("archived_at",
null)` silently dropped every card and rendered "Nothing saved yet" as a
plausible pass.

### Fixed — CSP hardcoded the hosted Supabase domain

`connect-src` allowed `https://*.supabase.co` and nothing else, silently
assuming every deployment is a hosted project on Supabase's own domain. A
self-hosted instance or a custom domain is blocked with no server-side symptom
at all: the browser refuses the request, `signInWithPassword` never resolves,
and the app simply never signs anyone in. The e2e stub hit exactly this.

`cspDirectives(supabaseUrl)` now adds the configured origin to every directive
the wildcard already appears in (`connect-src`, `img-src`, `media-src`,
`form-action`), and takes the URL as an argument rather than reading
`process.env` internally — the same reason `buildSecurityHeaders(httpsOrigin)`
does, so the interesting variants are testable. A hosted project's policy is
byte-identical to before, a malformed URL is ignored rather than injected, and
only the origin is used, never a path or query.

The configured origin also gets its **WebSocket** form, which the first version
of this fix missed. supabase-js derives its Realtime endpoint by rewriting the
configured URL's protocol (`https:` → `wss:`), and CSP does not follow it there.
Measured in both engines, with a `connect-src 'self'`-only control to prove the
probe: a `https://host` source does **not** permit `wss://host`, and
`http://host` does **not** permit `ws://host`. So the fix as first written left
REST working and every Realtime channel refused, on exactly the deployments it
was written for. Nothing in `src/` opens a channel yet, which is why it was
invisible — and why the failure would otherwise have arrived with whichever
feature opened the first one. Only `connect-src` gets the socket origin: a
WebSocket is not an image, a media element or a form target.

A trap for anyone re-measuring this: only WebKit throws `SecurityError` from the
`WebSocket` constructor. Chromium returns an object and blocks asynchronously,
so judged on the constructor alone it looks permissive in all four cases — read
the `securitypolicyviolation` event instead.

### Fixed — the e2e stub Supabase carried state between runs

`playwright.config.ts` runs the stub with `reuseExistingServer` for every
non-CI run, so a stub left over from an earlier run handed the next one both its
mutated tables and its whole `unhandled` list — the process-lifetime,
append-only record `expectNoUnhandledStubRoutes` asserts is empty. One
unsupported request therefore failed that assertion in every clean run
afterwards, curable only by knowing to kill a background process nobody
remembers starting. `next build` prerendering against the stub can seed that
list too, before a single test runs.

The reset route existed, reseeded `tables` only — and nothing ever called it, so
it read as a safety net while being dead code. It now clears every piece of
mutable state the process owns, and `tests/e2e/global-setup.ts` invokes it once
per run (Playwright starts `webServer` plugins before `globalSetup`, so the stub
is listening by then; an unreachable stub is an error, never a silent skip).
Once per run and deliberately not per test: `fullyParallel` workers share the
one stub process, so a mid-run reset would wipe another worker's state. The
port and control endpoints now live in `tests/e2e/support/stub-control.ts`
rather than being hardcoded in three places.


### Documentation — audited every iOS/WebKit claim in the codebase

With WebKit installed, every `iOS` / `WebKit` / `Safari` claim in `src/` was
measured where measurable, in both engines, in a confirmed secure context.

Most held: `navigator.vibrate` and Background Sync really are absent (so
`lib/haptics.ts` and `OutboxFlusher` are right), and `inert`,
`content-visibility`, `contain-intrinsic-size`, `color-mix` and `text-box` are
all supported. Chromium notably does **not** support `-webkit-backdrop-filter`,
so both declarations stay.

Three claims were re-labelled:

- **`register-sw.ts` / `navigator.storage.persist()`.** `navigator.storage` is
  absent outright in Playwright's WebKit, which reads like the mitigation being
  a no-op on our primary platform. It is the opposite: Safari 17 / iOS 17
  support the Storage API in full, and WebKit grants `persist()` on heuristics
  that explicitly include *"opened as a Home Screen Web App"* — precisely this
  app's primary surface. The absence is a WebKitGTK gap. Documented as verified,
  and as permanently untestable here.
- **The `@supports (-webkit-touch-callout: none)` iOS gate.** Now labelled
  half-verified, with the untested half named: measured, it correctly does *not*
  leak the 16px floor onto desktop/Android (a `text-sm` input computes a true
  14px in both engines). That it fires *on iOS* cannot be tested from here at
  all — the property's absence off iOS is exactly what makes it a usable filter.
- **`touch-action: manipulation`.** Looks redundant since iOS 9.3, because
  `width=device-width` already removes the tap delay. It is not: that only
  applies at *initial scale*, and this app deliberately allows
  `maximumScale: 5` so a low-vision user can zoom. Without the rule, the ~350ms
  delay returns for that user and nobody else. Marked do-not-remove.

New `docs/runbooks/ios-verification.md` carries the measured divergence table
and the rule — use `mobile-safari` for the engine, never for the platform — and
CLAUDE.md §3 now states what a green e2e run does *not* mean. There is
deliberately no test for the table: a spec asserting "WebKit lacks
`navigator.storage`" would pin a Linux fact as an iOS requirement and fail as a
bug report the day WebKitGTK ships it.


### Fixed — the bottom nav's press feedback was too weak to see, and the app had no reason to be quick

**Feedback.** The nav's only press affordance was `active:scale-95` on a 150ms
transition — a ~5% shrink, with no colour or opacity channel, on a 64px bar
under a thumb covering most of it, and with the native tap highlight already
suppressed (`-webkit-tap-highlight-color: transparent`). `:active` also cannot
outlive pointer-up, so a 40ms tap got 40ms of feedback.

The nav now drives its own `[data-pressed]` state from pointer events: a 10%
scale that lands on the *press* with no transition and eases out on release, an
accent wash at full opacity, a haptic tick on touch/pen, and a 130ms minimum
hold so a fast tap still reads as one. Reduced motion drops the scale and keeps
the wash. None of it depends on `:active` firing.

**Nothing to be quick with.** No route had a `loading.tsx`, so a tab press
blocked on the destination's full server render — `auth.getUser()` plus two to
three Supabase queries — with the *old* screen still on-screen throughout. It
also meant automatic `<Link>` prefetch had nothing to warm, since a dynamic
route is only prefetched as far as its nearest loading boundary. All four app
routes now have one, so the new screen paints on the same frame as the press.
Prefetch is deliberately left at the default rather than forced to `true`:
these are dynamic routes and Next 15 defaults `staleTimes.dynamic` to `0`, so
a forced full prefetch would run every tab's queries on every page view and
then discard the result.

A pending tab also lights up as selected the moment it is tapped
(`useLinkStatus`), so the answer to "did that register?" no longer waits on the
network. `aria-current` stays on the route actually being displayed — a pending
tab is not the current page and must not tell a screen reader it is.

### Changed — scrolling

Frosted glass is expensive to *move*: every `.glass` panel makes the compositor
snapshot, blur and re-composite its backdrop once per frame, and a library
screen holds a dozen. Three changes, in descending order of effect:

- `ScrollStateManager` stamps `data-scrolling` on `<html>` for the duration of
  a scroll gesture (+140ms), and `.glass` drops its backdrop blur and grain for
  exactly that long. A backdrop sliding past at flick speed is already a blur.
  The two chrome bars keep theirs — `--chrome` is only ~0.42–0.45 opaque, so
  text passing under an unblurred header would be legible through it.
- Library rows carry `content-visibility: auto`, so off-screen rows skip
  layout, paint and their own backdrop blur. Scroll cost stops scaling with how
  many prompts are saved.
- `scroll-behavior: smooth` on `<html>` for in-page and programmatic scrolls,
  with the matching `data-scroll-behavior="smooth"` so Next keeps suppressing
  it around route-change scroll restoration.

`tests/unit/scroll-performance.test.ts` pins all of it, including the
invariant the first item depends on: no `position: fixed` element may live
inside a `.glass` subtree, or toggling `backdrop-filter` would re-anchor it
mid-scroll.

### Fixed — jsdom drops `pointerType`, so pointer-type branches were untested

jsdom ships no `PointerEvent` constructor, so Testing Library falls back to a
plain `Event` and silently discards every pointer-specific field. Any code
branching on `e.pointerType` — the nav's haptics, the library row's swipe claim
— was therefore asserting against `undefined` regardless of what the test
passed. `tests/setup.ts` now shims it over `MouseEvent`.

### Changed — `:active` is retired for touch feedback, app-wide

The nav's press affordance is now the app's only one. `usePressable` +
`.pressable` moved out of `nav/` into `components/ui/`, and the four remaining
`active:scale-95` controls — the header back chevron, the theme toggle, and the
two quick-copy buttons — go through `PressableLink` / `PressableButton`.

This is what actually closes the open iOS question, rather than answering it.
Every source on the subject reports that iOS ignores `:active` for touch unless
the document carries a touch listener, and that the documented workaround costs
you controls flashing active *while you scroll past them*. All of that
reporting predates current iOS, and it cannot be verified here — Playwright's
Linux WebKit applies `:active` either way and cannot hold a touch. So nothing
depends on it: state we set ourselves renders identically on every engine.

Two things `:active` could not do regardless, both now fixed everywhere rather
than just on the nav: it cannot outlive pointer-up (a 40ms tap bought 40ms of
feedback; there is now a 130ms floor), and it does not cancel when a press is
dragged off the control (`onPointerLeave` / `onPointerCancel` do).

Also folded in: `usePressable` now calls the existing `lib/haptics` `tap()`
instead of its own inline `navigator.vibrate`, and that module's doc comment no
longer names `active:scale-95` as the iOS fallback. `PressableButton` defaults
`type="button"` — these are icon buttons that happen to sit outside any form
today, which is not a thing to leave implicit.

`tests/unit/ui-contracts.test.ts` (renamed from `scroll-performance.test.ts`,
which no longer described it) fails the build if any `active:` variant returns,
if `.pressable` loses its zero-duration press, if a converted control stops
using its wrapper, or if `PressableButton` loses its type.

### Corrected — the iOS `:active` explanation above was mine, and it was wrong

The first version of this entry said WebKit applies `:active` only when the
document carries a touch listener, that this app had none, and that a passive
no-op `touchstart` listener was therefore what revived the nav's press
feedback. That framing was asserted from folklore and shipped in a commit
message, this changelog, `tasks/lessons.md` and a PR body before it was tested.

Tested, in a real WebKit: **React already registers `touchstart` on
`document`** — the App Router hydrates into `document`, so React's event
delegation attaches the whole touch family there on every page, always. With
the added listener mutated out, it is still present. The precondition the
explanation rested on was never unmet, so the listener could not have been
what fixed anything. It has been removed, and `InteractionManager` — which now
does only one thing — is renamed `ScrollStateManager`.

The e2e test written to guard the claim was removed too: it asserted a
`touchstart` registration that React satisfies by itself, so it passed with the
listener deleted. It was not a guard, it was a rubber stamp.

What remains unverified either way is whether iOS Safari's touch-`:active`
heuristic is still live in 2026. Playwright's Linux WebKit cannot answer it —
`:active` applies there with or without a document touch listener, and its
touchscreen API cannot hold a press — and no real iOS device was available.
The fix does not depend on the answer: `[data-pressed]` is explicit state and
works on every engine by construction.

### Fixed — WebKit e2e could never have passed, and said so the moment it ran

The `mobile-safari` Playwright project had never actually executed. Run it and
every page renders with **no CSS at all**: `upgrade-insecure-requests` in the
CSP rewrites every same-origin subresource to `https://127.0.0.1:3100`, the e2e
server speaks only http, and the stylesheet and fonts die in the TLS handshake.
Chromium hides this by exempting loopback from the upgrade. WebKit does not,
and the focus-ring spec — the one that exists to catch a missing focus ring —
duly reported one.

Production was never affected: it is https, where the directive is a no-op.
What was affected is everything served over plain http — the e2e server, and
`next dev` in real Safari.

`upgrade-insecure-requests` and HSTS are now emitted only for an https origin
(`buildSecurityHeaders(httpsOrigin)`), decided at build time; the sole opt-out
is `VIZION_HTTP_ORIGIN=1`, which `playwright.config.ts` sets for its http
server. Production's headers are byte-identical to before.

Next's per-request `has`/`missing` conditions were the obvious mechanism. They
are not used because they would make production's posture depend on the proxy
always sending `x-forwarded-proto`, which nothing here can verify — preview
deployments sit behind Vercel's SSO edge, which substitutes its own CSP. A
build-time input is checkable against the compiled manifest.

### Corrected — `has`/`missing` do work; the claim that they don't was mine

The note above originally said Next's `has`/`missing` conditions compile into
`routes-manifest.json` and are then not enforced at runtime. That is false, and
it was asserted in a commit message, this changelog, a runbook and the config
before being re-tested. Re-run cleanly, they behave exactly as documented: no
`x-probe` header → the rule is skipped; `x-probe: yes` → applied; `x-probe: no`
→ skipped. The original probe had been answered by a stale `next-server` still
holding the port, so it read the *previous* build's headers.

Nothing about the shipped behaviour changes — the build-time flag stays, for
the reason now stated above rather than the one originally given.

### Added — the media the quota meter counts is now visible, and openable

Settings → Data & privacy showed a storage meter over a list of picture-frame
emoji and truncated UUIDs. It charged 18 MB of a 50 MB budget against files the
user had no way to look at, and named them things like
`32264e82-d153-46a3-…` — an identifier that identifies nothing to a human. If
we are going to show someone the bill, the list has to show what the bytes are.

- **Real thumbnails.** Image rows render the stored file. The `media` bucket is
  private, so the whole list is signed in one batch call and the thumbnails
  load lazily.
- **Every stored row opens.** Tapping a row opens the file itself in a sheet —
  image, video player, or audio player — with its type, size, and age, plus an
  "Open original" link for full size. Opening mints a **fresh** signed URL
  rather than reusing the list's, so a Settings page left open all afternoon
  still opens files.
- **Legacy rows get a human name.** Attachments stored before `original_name`
  existed now read `Image · 3 days ago` instead of a sliced UUID.
- **Rows whose upload never landed advertise no tap**, because there is nothing
  behind it — they stay visible and removable, as before, for quota honesty.
  A thumbnail that can't be signed degrades to the kind glyph; the list never
  fails over decoration.

### Fixed — the red on every library card was the delete button showing through

Both swipe-action panels were rendered permanently and only hidden from screen
readers, so the card's translucent glass let the green favourite bleed in from
the left and the red delete from the right — on every row, identically,
regardless of the model. It read as an error, or a prompt already queued for
deletion. It meant nothing. The panels now appear only while a row is actually
displaced, and only on the side being dragged.

Two things surfaced with it and are fixed here too:

- **Library cards had no keyboard focus indicator at all.** The row is
  `overflow-hidden` — load-bearing, or a swiped card runs past its own track —
  and that clips every outset shadow a descendant draws, which is what the
  focus ring is made of. The ring is now drawn inset on the card's overlay,
  where the clip cannot reach it. The e2e spec that pins focus rings never
  caught this because it can only reach the signed-out sign-in page.
- **The delete panel's ✕ failed AA on the light theme**, at 3.30:1. It now
  takes a `--on-flare` ink that flips with the theme, the way `--accent-ink`
  already solves the same problem for Laser.

### Added — every prompt now shows which developer's model made it

- **A coloured developer mark beside the model name.** Sixteen models across
  twelve developers, each in its own brand colour — the same glyph the picker
  uses, but rendered in the developer's colour rather than the app's one green.
  That green moves off the model label and the favourite star at the same time,
  so exactly one thing on the card is coloured and it is the thing that carries
  information.
- **A soft field of that colour on the card's trailing edge**, replacing the
  red. Ten of the twelve colours are sourced first-party; Z.ai's comes from its
  corporate sibling, and **xAI's is a deliberate neutral** — it publishes no
  chromatic identity at all, its own CSS declaring zero chroma, so rather than
  invent a hue the mark simply has none. Both say so in the token file rather
  than passing as sourced facts. The neutral runs at full contrast, not a muted
  one: this app says "disabled" with opacity on a still-coloured control, and
  an unrecognised model renders no mark at all, so a colourless mark can't be
  mistaken for either.
- The field steps aside while a row is swiped, so the one moment a red delete
  panel meets that edge, the action colour is the only colour there. It also
  answers to **Reduced effects**; the mark deliberately does not, because a
  comfort toggle should never amputate an identity channel.

`--dev-peak` in `src/styles/dev-accents.css` is the one dial: turn it down for a
whisper, up for a statement. `docs/decisions/0003-developer-accents.md` records
why the palette is what it is.

### Changed — one contributor doc gained, two stale claims removed

- **`AGENTS.md`** joins the required files: environment and runtime notes for
  agents, deferring to `CLAUDE.md` for everything about the product so the two
  can't disagree. It arrived from a Cursor Cloud pass and is landed corrected —
  it had claimed one tracked migration where there are ten, named three
  provider keys where there are twelve, and pointed at an "update script" this
  repo doesn't have. What it got right is what makes it worth keeping: the
  whole gate runs with no secrets because the Supabase middleware fails closed,
  Chromium is the reliable e2e leg, and `supabase/migrations/` is a stack of
  increments rather than a schema — so a bare local Supabase lacks the core
  tables.
- **The local-dev runbook stopped blaming the network for font failures.** The
  families have been vendored as woff2 under `src/app/fonts/` since P1, so the
  build makes no font request; the troubleshooting entry still described the
  behaviour from before that.

### Added — the app can pick the model, and the modes stopped overlapping

- **Auto routing.** VIZ(IO)N picks the model per run from a documented table,
  chosen by how much *judgement* the mode needs rather than how much text it
  moves: the shape-preserving modes can't restructure, so a fast model reaches
  their ceiling, while Expand, Reformat and Adapt invent structure and take the
  frontier tier. Long input or an attachment escalates. The result says which
  model it chose, and the library records that one — not a fallback nobody
  picked.
- **A grouped model picker**, replacing the flat native list on both surfaces
  that choose a model. Sixteen models under twelve developer headings, with
  each developer's mark on its own rows instead of stranded on the control's
  edge. The library's filter chips group the same way, and a model retired from
  the roster keeps its chip so its saved prompts stay findable.
- **Reformat now names the shape** — JSON, Markdown, Steps, Few-shot, or XML —
  which is what finally separates it from Adapt: Reformat is about *shape*,
  Adapt about the engine's *idiom*. Leave it unset for the old behaviour.
- **Condense and Expand got a depth dial**, with each mode's own words
  (Tight/Balanced/Essential · Focused/Thorough/Comprehensive) because the
  aggressive end of one is the smallest output and of the other the largest.
- **Clarify can ask.** When a request is genuinely ambiguous it returns its
  best enhancement *and* up to three questions. Answering re-runs the original
  with your answers, once, and says plainly that it's another billed run.
- **Send a prompt in from a URL** — `?draft=` — which is what makes a Siri
  Shortcut or the iOS share sheet work (`docs/runbooks/shortcuts.md` has the
  recipe). It never overwrites a draft in progress: it offers in a banner that
  waits as long as you need, and the replacement is undoable.

### Fixed — two controls that weren't what they looked like

- **Pinch-zoom works on the composer again.** A `touch-action` rule on the
  editor surface silently disabled zoom on the app's main text area while
  buying nothing — pull-to-refresh was already handled by the overscroll rule
  beside it. Zoom is how you read your own prompt when you need it larger.
- **Share is only offered where it exists.** Without a share sheet it used to
  fall through to a plain copy — a second Copy button, one row away, with the
  confirmation flashing on the wrong one.

### Fixed — the keyboard no longer hides the primary action

On iOS the software keyboard covers the bottom of the page without
resizing the layout viewport, so the composer's rail — and **ENHANCE** with
it — sat behind the keyboard exactly while you were typing into the field
above it. Running a prompt meant dismissing the keyboard first.

- A compact bar (token count + ENHANCE) now rides above the keyboard while
  the composer has focus, positioned by a newly measured **visual-viewport
  inset** rather than the layout bottom edge — the correction for the
  documented floating-chrome behaviour. It never collides with the bottom
  nav, which hides under the same signal.
- On a long result, **Copy** and **Use as draft** stick to the bottom of the
  screen once the real action row scrolls away, and retract when it returns
  — so the two primary actions are never three screens up. Short results
  are untouched.

### Changed — the app reads as glass, and stops jump-cutting

- **Glass has depth**: the backdrop blur is now saturated (colour behind a
  real pane intensifies, it doesn't just go soft), panels catch an inner
  top-edge sheen, and a fine grain keeps large surfaces from reading as flat
  plastic. All three are tokens, so both themes stay honest — and the grain
  answers to **Reduced effects**, enforced by a new contract test that
  enumerates every ambient layer behind that switch.
- **The glass sheen never costs a focus ring.** `.glass` sits on buttons,
  links and inputs; a panel shadow on those would have replaced the Laser
  focus ring outright, and several of them suppress the outline too — so a
  keyboard user would have had no focus indicator at all. The ring is now a
  composable token and glass surfaces draw both.
- **A running ENHANCE shows a spinner** beside its label. The label change is
  load-bearing: reduced-motion freezes the ring, so the meaning lives in the
  text.
- **No flash between streaming and result.** That gap was real, not a
  transition artifact — the stream cleared before the result was set, leaving
  one frame with neither surface mounted.
- **Removals now look like removals.** The enhance diff had no red anywhere;
  the treatment the library's version compare already used moves into the
  shared segment renderer so the two can't drift. The Enhanced card stays
  clean — it shows the result, not the proof.
- **The original always starts collapsed**, and loading states are shaped
  placeholders instead of the word "Loading…".

### Added — templates, swipe, and a friendlier generation prompt

- **Starter templates** for the blank page, offered only while the draft is
  empty so they can never overwrite work. Each seeds the editor and the mode
  that suits it.
- **Swipe a library card** — right to favorite, left to delete (with the same
  Undo the ⋯ menu gives). The gesture yields to vertical scrolling and the ⋯
  menu stays the keyboard-reachable path.
- **The generation prompt is highlighted** — engine flags, field labels, and
  hex colours (with swatches) picked out of the monospace — and copies three
  ways: as-is, **Plain** (engine syntax stripped — Midjourney's `--flags` and
  the motion engines' `[tag]` alike, for chat boxes), or **JSON**.
- **One clipboard path** across the app: every copy now reports a blocked
  clipboard instead of two sheets silently swallowing the failure, and fires
  a haptic tick where the platform has one (Android; iOS has no Vibration
  API, so it is a no-op there and is never faked with animation).

### Added — paste and drop

The placeholder invited a paste that nothing intercepted, and the hidden
file input was the only way to attach media.

- **Paste text** inserts normally; **paste a screenshot** attaches it.
- **Drag files** onto the composer (Files.app on iPadOS, desktop) with a
  "Drop to attach" hint; dragged text is ignored rather than swallowed.
- An empty, focused draft offers **Paste from clipboard**, hidden entirely
  where the browser can't read it, with a plain error when a read is denied.
  On iOS the system's own Paste confirmation stands — it isn't routed around.

Every path attaches through the same intake as the attach button, so the
first-run privacy disclosure still gates uploads.

## [0.3.0] - 2026-07-27

### Fixed — enhance runs no longer die over a salvageable envelope

A production Sonnet 5 run failed with "The model response was missing the
expected fields." while a complete output sat in the partial card: the model
returned a valid JSON envelope whose `rationale` wasn't a plain string, and
the parser treated every such drift as fatal. Anthropic targets are the only
ones with no API-level JSON enforcement, so the prose contract is the whole
defense there.

- **Tolerant parsing.** Only a missing/non-string `output` fails a run now.
  Markdown fences and surrounding prose are stripped before parsing; the
  rationale is coerced from alias keys (`reasoning`/`explanation`/`notes`)
  and array shapes, defaulting to empty instead of throwing. The contract
  wording pins "a single plain string, never an array or object" and
  re-asserts the envelope for refinement passes.
- **Salvage layer.** Every provider stream now reports its stop/finish
  reason. When the envelope tail is malformed but the output string
  demonstrably completed (the scanner saw its closing quote), the run is
  recovered — complete output, empty rationale, a visible "explanation was
  cut off" note, and a `salvaged` flag counted in server logs. A truncated
  run with a length stop reason now says "The model hit its length limit"
  instead of "non-JSON response".
- **Anthropic headroom.** The unset-effort (Auto) path carried the tightest
  output ceiling in the fleet (16k) while Claude 5 thinks by default and
  bills thinking against it — the ladder is now 32k for everything below
  xhigh/max (64k).
- **Recovery actions.** The partial-output card gains Copy (with the
  clipboard-blocked toast) and Use as draft; a failed refine no longer
  stacks three surfaces — the previous result stays and the partial card
  yields to it. The "What changed" card renders only when a rationale
  exists.

### Added — Collections (deferred item, now landing)

Per-user folders for the library. A `collections` table (owner-only RLS from
creation) plus a nullable `prompts.collection_id` (deleting a collection
releases its prompts, never deletes them). The filter sheet's reserved
section becomes real — collections with counts and an Any chip, hidden until
one exists. Cards show their collection in the meta line, and the card
actions sheet gains "Move to collection…" opening the management surface:
move/remove, inline create, rename, and delete (with "prompts inside are
kept" stated on the confirm). Filtering rides the same URL contract
(`collection` param, uuid-shape validated) and keyset pagination.

### Added — Account deletion (deferred item, now landing)

Data & privacy's seam becomes a destructive row behind a typed-DELETE
confirmation. The flow is a native form POST to `/auth/delete-account`:
storage objects are swept (they don't cascade), then the auth user is
deleted, cascading every user-keyed row (verified against the live schema).
The service-role key gets its first and only consumer — `server-only`,
per-request construction, session verified first, nothing request-controlled
reaches admin calls — and while `SUPABASE_SERVICE_ROLE_KEY` is unset in the
deployment env the flow fails closed with a plain-language banner.

### Added — CI enablement diagnostics

`ci.yml` gains `workflow_dispatch` and `docs/runbooks/ci-enablement.md`
documents the owner-only fixes (Actions policy / spending limit) for the
observed zero-runs-ever state, plus the deferred first-Actions-secrets step
for wiring `check:db-enum` into CI.

### Changed — Profile is now Settings, with one persistence model

The screen was preferences and account management, not a profile — it now
says so (tab, header, and title read **Settings**; the `/profile` route is
unchanged). Information architecture: **Identity · Account · Defaults ·
Appearance · Data & privacy · About**. Account deletion is deferred (owner
decision) — the Data & privacy section leaves a clean seam.

- **One persistence path.** Every durable setting writes through a shared
  `useSettingWrite` hook over server actions, with optimistic apply,
  rollback on failure, and **status rendered next to the control that
  changed** ("Saving… / Saved ✓ / error") — replacing the old three-idiom
  split (batched identity save · immediate action · raw fire-and-forget
  theme write, which surfaced no errors at all).
- **Identity is form-commit done right**: visible input boundaries, live
  display-name validation (3–24 lowercase chars), and **Save disabled until
  dirty AND valid** (it used to be always-armed and re-submit identical
  values).
- **Email is a distinct verified workflow** — read-only display + a
  "Change email" sheet that states the confirmation contract, a pending
  chip for an unconfirmed `new_email` with Resend, and no more
  partial-commit (names saved, email failed) inside one batched save.
- **Data & privacy**: the stored-media manager mounted unconditionally
  (no quota gate), clear-local-draft with Undo, a written retention story,
  and **Export my data** (profile + prompts + versions + media metadata as
  JSON).
- **Appearance** gains a **Reduced effects** toggle — a device-local switch
  that silences the ambient mesh/aurora/shimmer layers independently of the
  OS reduced-motion preference.
- **About**: single-sourced version, acknowledgements, license pointers.

### Fixed — revise integrity + prompt-detail scale

- **Revise seeds from the current OUTPUT** — the editor previously started
  from the current version's original *input*, so "revise" silently re-ran
  the original instead of iterating on the result.
- **Save persists the request snapshot** (the composer's R8 pattern,
  mirrored): submitting captures `{input, mode, target}`; editing the draft
  or flipping a mode pill after the run can no longer relabel the stored
  version, and the preview labels the mismatch — *"Result from previous
  settings — re-enhance to match your edits."*
- **Lazy version bodies** — the detail page ships version metadata plus only
  the default compare pair's bodies; other versions load on demand. A
  50-version prompt no longer downloads 50 full input/output/rationale
  bodies to show two.
- **Bounded, memoized diff** — the O(n·m) word-diff was recomputed on every
  keystroke in the revise textarea with no size limit; it is now memoized on
  the compared bodies and bounded at 2,000 tokens/side (over-budget pairs
  show the selected version plain with a "too long to diff" note).

### Added — card actions, duplicate detection, and undoable delete

- **Rename, favorite, archive, delete** — every card gets a ⋯ action sheet
  (a sibling of the link, so no interactive nesting). Titles were immutable
  first-line derivations; they can now be renamed (and new saves default to
  the model's semantic `title` from the envelope before falling back to the
  derivation).
- **Delete is soft + undoable** everywhere users delete day-to-day: the card
  sheet and the prompt detail both soft-delete with an Undo toast, replacing
  the blocking `confirm()` + irreversible cascade. Permanent delete survives
  only for archived prompts, behind a ConfirmSheet.
- **Exact-duplicate detection at save** — saving content that already exists
  (same input+output+mode, by content hash) offers *"Already in your library
  as '…'"* with **Open** and **Save as new version** instead of minting a
  second identical card; appending an identical version to a prompt is
  refused. Saves now also maintain the card's `preview` and `current_mode`
  (and restore re-derives them).

### Changed — library: saved work leads; filters are summoned; queries scale

The sixteen-model chip wall (the full global roster rendered above the first
prompt, filtering an already-fully-downloaded list) is gone:

- **Search field + one Filter button.** The button (with an active-count
  badge) opens a bottom sheet: View (All/Favorites/Archived) · Model —
  **only models actually present in the library, with counts** · Mode · Tag
  · Sort (edited/created/title). Exactly two quick chips (Recent, Favorites)
  live outside the sheet. A reserved Collections section sits behind a
  ready-flag (deferred by owner decision).
- **Server-side filtering + keyset cursor pagination** driven by URL
  searchParams (shareable, back-button-friendly): 30 cards per page with
  "Load more", replacing load-every-prompt.
- **Database-side version counts** via the embedded
  `prompt_versions!prompt_id(count)` aggregate — the old one-row-per-version
  transfer (1,000 rows to count 100 integers) is deleted.
- **Recognition-first cards**: title, mode, model, a two-line output
  preview, favorite star, and human time — **"Now" / "1 min ago" /
  "Yesterday"**, killing the "0m" the 45–59-second window used to render.
- Search is honest about scope ("looks at titles"); empty-with-filters and
  truly-empty states are distinct.

### Added — library organization schema (migration)

`supabase/migrations/20260727130000_library_organization.sql`
(**applied to the hosted project 2026-07-27**, advisors clean):

- `prompts` gains `favorite`, `archived_at`, `deleted_at` (soft delete),
  `preview` (current output's first 200 chars for cards), and
  `current_mode` — backfilled from each prompt's current version.
- `prompt_versions` gains `content_hash` (sha256 over
  input∥US∥output∥US∥mode) for exact-duplicate detection, backfilled for
  every existing version; the Node helper (`src/lib/library/hash.ts`) is
  pinned byte-for-byte against a live DB digest fixture.
- Keyset-pagination index on `(user_id, updated_at desc, id desc) where
  deleted_at is null`, plus a hash index.
- The schema preflight now probes all six new columns. The generated-types
  mirror also restores the FK `Relationships` entries (needed by the
  upcoming embedded version-count query).

### Changed — media moved into the composer as a role-based attachment tray

The below-the-fold "Media reference" studio (with its own competing prompt
textarea, auto-inferred generation destinations, and a storage manager that
only appeared near 80% of quota) is gone. In its place:

- **A compact attachment tray inside the composer** — thumbnail, sanitized
  original file name, per-kind processing line, storage note, analysis
  status, and a remove control per attachment. Subject/composition/palette/
  lighting diagnostics live behind a "Details" sheet, never above the
  primary result.
- **Explicit attachment roles** — Reference (default: visual context for the
  text task, flowing into the enhance request as bounded, fenced context
  blocks), Extract text (faithful transcription with an editable insert),
  Describe (editable description insert), Style reference (style-only read +
  insert), and Generate similar. **"Generate" is never inferred from a
  file's mere presence** — attaching a screenshot as evidence no longer
  produces a Midjourney prompt.
- **An explicit engine picker** for Generate similar — Midjourney, Runway,
  **Sora and Kling (previously defined but unreachable)**, and the audio
  spec are all selectable, with the per-kind default merely preselected.
- **Honest capability labels** — "First-frame visual reference" for video,
  "Audio file metadata only" for audio; the attach hint says exactly what
  each kind contributes (the old copy claimed "Photos are analyzed" while
  accepting all three).
- **Privacy before upload** — a first-attach disclosure covers storage,
  model processing, cost-cap billing, and retention, and offers **"Analyze
  without keeping"**: an ephemeral path that never uploads (the vision proxy
  takes a data URL). The storage default is a visible tray toggle.
- **The media manager is always available** — mounted unconditionally in the
  upcoming Settings → Data & privacy and surfaced in the tray as the budget
  tightens, showing original names, a byte meter at any usage level, and
  "incomplete upload" badges for reservation rows whose object never
  arrived.

### Added — media provenance columns + atomic server-side quota (migration)

`supabase/migrations/20260727120000_media_roles_and_reservation.sql`
(**applied to the hosted project 2026-07-27**, advisors clean):

- `media_assets` gains `original_name`, `mime_type`, `role`
  (reference/extract/describe/style/generate) and `status`
  (pending/ready/failed) — additive, no enum surgery, no deploy-order hazard.
- **`media_reserve()`** — the atomic quota gate. The 50 MB limit was a pure
  client-side check the browser could simply bypass (it writes straight to
  Storage); now the client must reserve a `pending` row first, and
  reservations serialize per user on a transaction-scoped advisory lock.
  SECURITY INVOKER (RLS applies), `search_path` pinned, EXECUTE revoked from
  anon.
- New pure pipeline core (`src/lib/media/pipeline.ts`): reserve → upload →
  ready, with every failure direction landing safe — an upload failure
  deletes (or visibly fails) the pending row instead of orphaning an
  invisible storage object, and asset removal converges on retry instead of
  stranding rows. Fully unit-tested over injected deps.
- `npm run check:db-enum` now also probes the migrated columns and the
  `media_reserve` RPC through PostgREST — the same committed-but-unapplied
  drift class the enum probe already catches.

### Changed — mobile-first result view: Enhanced leads, Compare is a sheet

The transformation diff made the improved prompt the *last* thing you reached:
Original card first, no way to adopt the result, diagnostics inline. Rebuilt:

- **Enhanced first**, with **Copy** (primary) and **Use as draft** directly
  beneath it. Use as draft replaces the composer draft (undoable via toast)
  and scrolls back to the editor.
- **Original collapses by default** for long prompts (> 400 chars of diff
  input) behind a "Show original (N words)" toggle.
- **Compare is a bottom sheet** — the full two-pane diff read moved there,
  keeping the inline cards clean.
- **Assumptions and destination-specific changes render separately** from the
  rationale (from the new envelope fields). For the shape-preserving modes
  (Clarify/Polish) the view now states honestly that no destination-specific
  formatting was applied — the target only ran the rewrite.
- **Copy failure is surfaced** as an error toast (result view and prompt
  detail) instead of silently doing nothing.

### Added — refinement chips: Make shorter · More detail · Keep my tone

One-tap follow-up passes on a finished result, seeded from the **current
output** (per-change decisions included). "Keep my tone" sends the author's
original as reference material. A refine run is a normal billed run (same
rate limit + cost cap); the diff after a refine reads previous result →
refined result, while saves and exports keep the author's original input as
provenance. The `/api/enhance` contract gains an optional validated
`refine: { kind, baseInput? }`.

### Added — per-change accept/reject for Polish

Polish results now list every change as a reviewable hunk (adjacent
removed+added runs, whitespace-bridged) with Keep/Revert toggles plus
Keep all / Revert all. The Enhanced card re-renders from the decisions, and
Copy, Use as draft, Save, Share, and every export consume the
decision-applied text. Reconstruction is exact by construction (unit-tested
invariants: nothing rejected ⇒ the model output; everything rejected ⇒ the
original).

### Changed — "N changes" now counts changed sections

The result header's counter counted merged diff *segments*: one replaced
phrase (a removed run + an added run) read as "2 changes", and a single large
insertion as "1 change" — neither matched what a user calls an edit. The new
`countChangedSections` counts a run of adjacent non-equal segments once
(whitespace between them doesn't split a run; whitespace-only churn counts
zero), and the copy now reads **"N changed sections"** — honest about what is
being counted. Applied to both the live result view and version compare.

### Added — the enhance envelope can carry assumptions, target notes, and a title

`{output, rationale}` gains three OPTIONAL fields, parsed tolerantly (junk
shapes are dropped, never fatal; older/disobedient models can't fail a run):

- `assumptions` — up to six short lines on gaps the model filled, for the
  result view to surface separately from the rationale.
- `targetNotes` — one sentence naming destination-specific changes.
- `title` — a ≤60-char semantic name that will seed library titles.

The contract text now also pins `"output"` as the FIRST field — the streaming
scanner decodes it incrementally, so ordering only affects streaming latency,
never parsing. The SSE `done` event passes the new fields through untouched.

### Changed — Reset demoted to a tertiary Clear with Undo

RESET sat beside ENHANCE as an identical filled-Laser pill — a button that
destroys a pasted draft (and aborts an in-flight paid run) looked exactly as
recommended as the primary action. Now:

- **ENHANCE is the only filled primary in the composer.** Clear is a quiet
  text/icon action (44 pt hit area via `.tap-44`).
- **Clearing is recoverable.** A non-empty draft (or a finished result)
  clears immediately with a toast whose **Undo** restores both — the result
  now lives in a composer-held snapshot instead of the mutation cache, which
  is what makes restoring it possible.
- **Clearing mid-run asks first.** A ConfirmSheet ("Stop this run?") gates
  aborting an in-flight enhancement, since that cancels a billed request.

This supersedes the 2026-07 owner direction that Reset mirror the submit
button's style — the UX audit's finding (equal visual weight makes a
destructive action read as recommended) won out; noted in `tasks/lessons.md`.

### Changed — the "Target" mode is now "Adapt"; the mode helper is plain text

- **"Target" → "Adapt" (label only).** The sixth mode's display name no longer
  collides with the target-model picker or read as jargon. The persisted id
  stays `target` (it lives in the `enhance_mode` DB enum, localStorage, the
  offline outbox, and the `/api/enhance` contract — an enum rename is a
  migration-class change with a deploy-order hazard this rename deliberately
  avoids). A new `MODE_LABEL` map is the single sanctioned way to render a
  stored mode id; saved version history now renders labels ("Adapt") instead
  of raw ids ("target"), and the markdown export heading follows. The JSON
  export keeps the raw id (machine artifact).
- **Mode helper text instead of an explanation card.** The always-present onyx
  strip under the mode grid (fixed to the tallest of six display-caps blurbs,
  with a tracking caret) is now one line of quiet secondary text. Same
  zero-layout-shift technique (all six blurbs stacked in one grid cell), a
  fraction of the visual weight, no permanent card.

### Added — Sheet, Toast, and ConfirmSheet UI primitives

The app's first shared overlay primitives (`src/components/ui/`), seeding the
UX-audit remediation:

- **`Sheet`** — a bottom sheet portaled to `<body>` (the frosted chrome bars
  are containing blocks for fixed descendants, so overlays must escape them),
  with focus trap + restore, Escape/scrim dismiss, body scroll lock,
  safe-area padding, and a reduced-motion-safe entry animation.
- **`Toast`** (+ `useToast`) — one transient toast at a time with an optional
  action button (the Undo pattern), anchored above the bottom nav via the
  shared `--bottom-nav-h` token.
- **`ConfirmSheet`** — the sheet-based replacement for `window.confirm` on
  destructive actions; first consumer of the previously unused
  `.btn-secondary`.

### Fixed — the bottom nav detached from the screen edge on iOS

On iOS the fixed bottom nav could float mid-screen — no longer flush with the
bottom edge — and sit on top of the footer. Two WebKit behaviors, two fixes:

- **`backdrop-filter` on a `position: fixed` bar breaks async scrolling.**
  WebKit repaints the frosted bar out of step with the scroll, detaching it
  from the viewport edge. The chrome tint + blur now live on a `::before`
  layer inside the bar (`.glass-nav` / `.glass-chrome`), and the bars are
  promoted to their own composited layer (`transform: translateZ(0)` +
  `will-change: transform`) — the bar itself stays a plain fixed element that
  WebKit keeps glued to the edge, and the blur stops re-rasterizing on every
  scroll frame (a paint-cost win on top of the fix).
- **The software keyboard doesn't resize iOS's layout viewport.** With the
  keyboard open, "fixed to bottom" means "fixed behind the keyboard", and
  scrolling re-anchors the bar mid-screen over the content being edited. The
  nav now slides off-screen while the keyboard is up (and back when it
  closes), driven by a visual-viewport heuristic:
  `src/lib/pwa/keyboard.ts` (pure, unit-tested — pinch-zoom is excluded via
  `visualViewport.scale`) + `src/components/nav/use-keyboard-visible.ts`
  (`useSyncExternalStore` over `visualViewport` resizes). While hidden the
  bar is `inert`, so it drops out of the a11y tree and tab order.

### Fixed — iOS focus auto-zoom on sub-16px form controls

iOS Safari zooms the whole page when a focused control's computed font-size is
under 16px — and rarely zooms back out. Eight controls were affected, including
the app's single most-used one (the prompt textarea) and both composer selects.
One base-layer rule now pins `input`/`select`/`textarea` to
`font-size: max(1rem, 1em)` **on iOS only** (scoped via
`@supports (-webkit-touch-callout: none)`), so desktop and Android keep the
designed 12–14px sizes and future controls can't reintroduce the bug.

### Changed — iOS touch polish

- `-webkit-tap-highlight-color: transparent` on the root — the grey iOS tap
  flash is gone; `active:scale` / token color states carry the feedback.
- `touch-action: manipulation` on links, buttons, and form controls removes
  Safari's ~300ms double-tap-zoom wait, so taps commit immediately.
- Buttons are non-selectable (`user-select: none` in the base layer, plus
  `select-none` on the nav tab labels) — a long-press presses or cancels
  instead of popping the text-selection loupe.
- **44pt touch targets** on the stragglers, without changing the locked pill
  visuals: a new `.tap-44` utility (an invisible hit-area-extending pseudo)
  covers the library filter chips, the prompt-detail revise chips, and the
  tag-remove ✕; the media stored-asset delete grows to `h-11 w-11`; the
  version-compare and default-model selects get `min-h-[44px]`; the avatar
  zoom slider's hit box grows from 4px to 44px (negative margins keep the row
  visually unchanged).
- **Avatar-crop modal**: the scrim now scrolls (`overflow-y-auto` +
  `overscroll-contain`, so short landscape viewports can always reach
  Cancel / Use photo), and pads with `max(1.5rem, env(safe-area-inset-*))` on
  all four sides.
- **Stored-media delete asks first** — removing a stored file is permanent
  (storage object + DB row), so it now runs behind the same `confirm` gate as
  prompt delete.
- **Mobile keyboard hints**: the handle and tag inputs stop iOS capitalizing /
  autocorrecting values that persist verbatim (`autoCapitalize="none"`,
  `autoCorrect="off"`, `spellCheck={false}`); the library search shows a
  Search return key and dismisses the keyboard on return (filtering is live —
  there is nothing to submit).
- **ModeRig help-strip caret** now glides via `transform` on a full-width rail
  instead of animating `left` (which forced layout every frame), matching the
  lens-lock indicator's compositor-only idiom.

### Changed — docs & metadata readiness

- The PWA manifest and root metadata descriptions drop the stale six-name
  model list for the current "sixteen target models from twelve AI
  developers" wording (README's phrasing).
- `NEXT_PUBLIC_SITE_URL` removed from `.env.example` and the auth-setup
  runbook — nothing reads it (redirects use `window.location.origin`).
- `docs/runbooks/local-dev.md` now states CI's actual Node version (22).

### Added — a per-model thinking selector in the composer

The composer gains a **Thinking** rail for targets whose provider takes a
per-request reasoning-depth option — the in-app equivalent of the
Intelligence/Speed pickers in vendors' own apps, built on the real API
parameters instead of their marketing labels:

- **Fable 5 · Opus 5 · Sonnet 5** → `output_config.effort`
  (Low · Medium · High · Extra High · Max)
- **GPT-5.6 Sol / Luna / Terra** → `reasoning_effort` (Low · Medium · High)
- **Gemini 3.6 Flash** → `generationConfig.thinkingConfig.thinkingLevel`
  (Minimal · Low · Medium · High)
- **Grok 4.5** → `reasoning_effort` (Low · Medium · High)

"Auto" (the default) sends nothing and leaves the provider's own default in
place; the choice persists per target. The other eight targets expose no
per-request knob, so they show no selector. Server-side, the route validates
the level against `TARGET_THINKING_LEVELS` (400 on anything else) and threads
it through a new `ProviderRequestOptions` argument — the fan-out map is now
typed `Record<Provider, ProviderStream>`, so the eight knob-less adapters keep
their three-parameter signatures untouched. Because thinking bills as output
tokens against the output cap, the Anthropic and Google adapters raise their
output ceilings at the deep levels (a truncated stream is a parse failure, not
a short answer) — and deep levels reach the daily cost cap sooner.

### Changed — Google's slot moves to Gemini 3.6 Flash

**Gemini 3.5 Flash** becomes **Gemini 3.6 Flash** (`gemini_3_5_thinking` →
`gemini_3_6_flash`) — GA since 2026-07-21, faster and stronger on agentic and
multimodal work. Still sixteen models from twelve developers.

One entry, deliberately: Gemini 3.x has no separate thinking model ID — what
the Gemini app calls "Thinking" and "Fast" is this one model at different
`thinkingLevel` values, which the new selector now exposes directly. There is
no `gemini-3.6-thinking` string anywhere (an invented one would 404 every
call, and `/api/media` would read the 404 as a config error and silently fall
back to another provider).

- Pricing defaults move to **$1.50 / $7.50** per 1M tokens (from
  $0.30 / $1.20). **Deploy note:** clear or update any `MODEL_GEMINI` and
  `PRICE_GEMINI_*` overrides in the Vercel project env — a stale model string
  silently keeps calling 3.5, and stale prices under-count the daily cost cap
  6× on output.
- Migration `20260726120000_gemini_3_6_flash.sql` renames the enum value
  (existing rows carry over; this id has now been renamed twice, so both
  legacy keys map to it). Apply before deploying, then
  `npm run check:db-enum -- --strict`. UI-store persist version bumped to 5;
  persisted thinking selections are re-keyed across renames and stale ones
  dropped.

Gemini 3.1 Pro was evaluated and left out: it is Preview-only and sits in a
different cost class ($2.00 / $12.00 per 1M).

### Fixed — four model targets failed every database write (`model_target` enum drift)

`20260726000000_kimi_k3_minimax_m3_gpt_tiers.sql` was committed but never
applied to the hosted project, leaving its `model_target` enum at fourteen
labels while the app offered sixteen. Selecting **GPT-5.6 Terra**, **GPT-5.6
Luna**, **Kimi K3**, or **MiniMax M3** failed every write with Postgres `22P02`:
_Save to library_ surfaced `invalid input value for enum model_target:
"gpt_5_6_terra"` verbatim, and — less visibly — the `usage_events` write failed
too, so spend on those four models never counted against the daily cost cap.

- **Migration applied**; the hosted enum now carries all sixteen labels. The two
  `RENAME VALUE`s (`kimi_k2_6` → `kimi_k3`, `minimax_m2_7` → `minimax_m3`)
  matched zero existing rows, so no data changed.
- **`tests/unit/model-target-enum.test.ts`** replays every `ALTER TYPE
  model_target` statement in `supabase/migrations/` onto the pre-repo baseline
  and pins the result against the roster, the generated types union, and
  `LEGACY_TARGET_IDS`. Removing the migration file turns three assertions red,
  naming the four ids — the drift is no longer green-on-CI.
- **`npm run check:db-enum`** (`scripts/check-model-enum.mjs`) probes the
  **hosted** enum read-only over PostgREST, the one half no unit test can see.
  Release-time step; `--strict` makes absent credentials fatal.
- **Enum failures no longer leak Postgres internals.** `describeWriteError`
  turns a 22P02 into "GPT-5.6 Terra isn't available on the server yet — pick
  another model and try again", and `writeErrorLogLine` labels the server-side
  ledger failure `SCHEMA DRIFT` instead of a generic write error.
- **`LEGACY_TARGET_IDS` moved to `src/lib/constants.ts`** (from a closure inside
  the UI store) so the rename history sits with the roster and can be tested.
- **`docs/runbooks/migrations.md`** documents apply → regenerate types → verify,
  and is referenced from the release runbook's verify step.

### Security — dependency audit back to zero (was 1 critical · 7 high · 3 moderate)

`npm audit` reports **0 vulnerabilities** on both the full tree and the
production tree (`--omit=dev`), which is the gating CI step.

- **Next.js 15.5.19 → 15.5.21** clears eight advisories, all of which touch
  code we ship: SSRF in rewrites and in Server Actions, cache confusion of
  response bodies, an unbounded Server Action payload on the Edge runtime,
  DoS in the App Router and in the Image Optimization API, and unauthenticated
  disclosure of internal Server Function endpoints. In-range for `^15.1.3`, so
  no framework migration — the declared floor moves to `^15.5.21` so a fresh
  resolve can't land below the fix.
- **The one critical was `vitest` (< 3.2.6, arbitrary file read/execute via
  the UI server), fixed by 2.1.9 → 4.1.10**, which also clears the `vite`
  `server.fs.deny` bypass, its path traversal, and the `vite-node` /
  `@vitest/mocker` cascade. `vite ^7.3.6` is now an explicit devDependency
  (vitest 4 makes it a peer) and `@vitejs/plugin-react` moves 4.3.4 → 5.2.0
  for vite 7. `vitest.config.ts` needed no changes.
- **`esbuild` 0.24.2 → 0.28.1** (dev-server request advisory) and **`sharp`
  0.33.5 → 0.35.3** (four inherited libvips CVEs). `postcss` → `^8.5.23`
  (source-map path traversal, arbitrary file read, stringify XSS).
- **`overrides` added for five transitive pins with no direct upgrade path:**
  `postcss` and `sharp` (Next pins `postcss@8.4.31` exactly and `sharp@^0.34.3`
  as an optional dep, both vulnerable — the override dedupes each to one
  patched copy), plus `js-yaml@^4.3.0`, `fast-uri@^3.1.4`, and
  `brace-expansion@^5.0.8`. The last one is the interesting case: the
  unbounded-expansion OOM advisory covers **everything ≤ 5.0.7**, so the 1.x
  and 2.x lines have no patched release, and that single package was the root
  cause of fourteen reported entries cascading up through `minimatch` →
  `@eslint/config-array` / `@eslint/eslintrc` → `eslint` → `eslint-config-next`
  and its plugins, and through `filelist` → `jake` → `ejs` →
  `@trickfilm400/rollup-plugin-off-main-thread` → `workbox-build`.

No application code changed. Verified beyond the standard gate: the icon
matrix was regenerated under sharp 0.35 and is **pixel-identical** to the
committed PNGs (raw-buffer compare, max channel delta 0 — only PNG container
bytes differ, so the shipped assets are left untouched), and the service
worker still precaches its 21 entries under esbuild 0.28.

### Changed — GPT-5.6 Luna + Terra join; Kimi and MiniMax move to K3 / M3 (sixteen models, twelve developers)

- **GPT-5.6 Luna and GPT-5.6 Terra join OpenAI's slot** alongside Sol — the
  family's balanced mid tier (`gpt-5.6-luna`, $1.00/$4.00 per MTok defaults)
  and fast tier (`gpt-5.6-terra`, $0.20/$0.80), env-overridable via
  `MODEL_GPT_LUNA` / `MODEL_GPT_TERRA` and `PRICE_GPT_LUNA_*` /
  `PRICE_GPT_TERRA_*`. Both stream through the existing OpenAI path and
  provider key, and both are vision-capable.
- **Kimi K2.6 → Kimi K3** (`kimi-k3`) and **MiniMax M2.7 → MiniMax M3**
  (`MiniMax-M3`) — each vendor's newest flagship, launch price defaults
  carried forward from the outgoing models. DB enum values renamed in place
  (`supabase/migrations/20260726000000_kimi_k3_minimax_m3_gpt_tiers.sql` —
  existing prompt versions, usage events, and profile defaults follow
  automatically), and persisted `kimi_k2_6` / `minimax_m2_7` picker
  selections migrate on load (UI-store v4).

### Changed — Enhance hero goes symmetric; lighter light-mode chrome; truer developer marks

- **The Enhance hero is now a symmetric emblem:** the right-hand Laser lines
  are mirrored onto the left of the (│›◯) aperture (replacing the dashed
  Silver squiggles), the wings sit slightly translucent, and a slow staggered
  shimmer joins the halo's breathe for gentle motion — all collapsed to a
  static glow under reduced motion.
- **Light-mode top/bottom bars read as glass, not solid white:** the light
  `--chrome` alpha drops 0.60 → 0.42 so graphics flowing underneath show
  through the frosted blur.
- **Developer marks:** Moonshot's slot shows the Kimi "K" product mark (Simple
  Icons `kimi`) instead of the corporate Moonshot logo. Meta's slot keeps the
  official Meta infinity mark (thesvg.org `meta/mono.svg`) — a twin-spark
  glyph was tried in place of it and reverted, since the marks identify the
  developer ("Meta AI"), not the model in the slot. Both render in
  `currentColor`, so they take the theme accent (`--accent-ink`: Laser on
  dark, deep green on light) — or `--on-laser` when the mark sits on a Laser
  fill.

### Changed — Meta's slot moves to Muse Spark 1.1; Z.ai's GLM-5.2 joins (fourteen models, twelve developers)

- **Llama 4 Maverick → Muse Spark 1.1.** Meta retired the open-weights Llama
  line from its developer platform; the roster's Meta slot now targets
  **Muse Spark 1.1** (Meta Superintelligence Labs) on the OpenAI-compatible
  **Meta Model API** (`api.meta.ai`, `muse-spark-1.1`, $1.25/$4.25 per MTok
  defaults). The DB enum value is renamed in place
  (`supabase/migrations/20260725000000_muse_spark_and_glm.sql` — existing
  prompt versions, usage events, and profile defaults follow automatically),
  and a persisted `llama_4_maverick` picker selection migrates on load
  (UI-store v3). Muse Spark is multimodal, so it keeps Meta's place in the
  vision fallback chain.
- **Env cutover:** `LLAMA_API_KEY` / `MODEL_LLAMA` / `PRICE_LLAMA_*` are
  replaced by `META_API_KEY` / `MODEL_MUSE` / `PRICE_MUSE_*`. **Rename the
  Vercel env var** — until `META_API_KEY` (a Meta Model API key) is set, the
  Meta target returns 503 "not configured" while the rest keep working.
- **GLM-5.2 joins as a new developer (Z.ai).** Z.ai's frontier flagship
  (`glm-5.2`, 1M context) streams through the shared OpenAI-compatible
  factory against `api.z.ai`; needs `ZAI_API_KEY`. List rates were
  unpublished at launch, so the cost-cap defaults are the GLM-5 reference
  rates ($1.00/$3.20) — override `PRICE_GLM_*` when published. The flagship
  is text-only (Z.ai's vision model is a separate SKU), so media analysis
  routes it to the vision fallback chain, and the Z.ai mark (Simple Icons
  `zdotai`) joins the developer-mark set.

### Changed — the Enhance hero calms to a single glow

- **The guidance sentence above the mode rig is now a decorative "prompt
  optics" hero** (`PromptFlow`): raw Silver signal lines enter the brand
  (│›◯) aperture and leave as clean, ordered Laser lines; the sentence
  survives as screen-reader-only text. Deliberately quiet — after a busier
  first cut, the marching dashes and the traveling pulse are gone; the
  aperture halo's slow ~6s breathe is the hero's only motion (a static
  glow under reduced motion).
- **Mode-rig color returns to spec:** cell labels stay Silver (Chalk on
  hover) with only the inactive ICONS in the theme-aware green; the help
  pill's per-mode blurb is now green display caps (`--accent-ink`, AA on
  Onyx in both themes).
- **True optical centering in the pills.** A new `.cap-trim` utility
  (`text-box: trim-both cap alphabetic`) centers the glyphs — not the
  font's ascent/descent headroom — in the mode cells and the help pill
  (progressive: engines without `text-box` support keep plain line-box
  centering).

### Changed — the roster grows from six to thirteen: Opus 5, Sonnet 5, and six new developers

- **Opus 4.8 → Opus 5.** The Anthropic Opus target now points at
  `claude-opus-5` (same $5/$25 per-MTok pricing). The DB enum value is renamed
  in place (`supabase/migrations/20260724000000_expand_model_roster.sql` —
  existing prompt versions, usage events, and profile defaults follow
  automatically), and a persisted `opus_4_8` picker selection migrates to
  `opus_5` on load (UI-store v2).
- **Sonnet 5 joins** as the third Anthropic target (`claude-sonnet-5`,
  $3/$15) — served by the existing `ANTHROPIC_API_KEY`.
- **Six frontier models from six new developers:** DeepSeek V4
  (`deepseek-chat`) · Llama 4 Maverick (Meta Llama API) · MiniMax M2.7 ·
  Kimi K2.6 (Moonshot AI) · Sonar Pro (Perplexity) · Qwen3.7 Max (Alibaba,
  `qwen-max`). All six speak the OpenAI wire shape and stream through one new
  shared factory (`src/lib/providers/openai-compat.ts`) — including a
  cross-chunk `<think>…</think>` filter for MiniMax's interleaved reasoning,
  which would otherwise corrupt the JSON envelope. Each provider needs its own
  server-side key (`DEEPSEEK_API_KEY` · `LLAMA_API_KEY` · `MINIMAX_API_KEY` ·
  `MOONSHOT_API_KEY` · `PERPLEXITY_API_KEY` · `DASHSCOPE_API_KEY`); a target
  whose key is unset returns 503 "not configured" while the rest keep working.
- **Media analysis knows which flagships can see.** Text-only flagships
  (DeepSeek V4, MiniMax M2.7, Qwen3.7 Max) route image analysis straight to
  the vision fallback chain instead of failing; the chain itself gains
  Llama 4 Maverick, Kimi K2.6, and Sonar Pro as last resorts after the
  original five.
- Per-target prompt conventions, developer marks (monochrome single-path,
  Simple Icons), model picker grouping, `.env.example`, and the provider/media
  runbooks all extend to the new roster.

### Changed — the media generation studio is model-aware

- The green generation-**engine** chip (Midjourney / Runway / Sora / Kling /
  Audio spec) is replaced by a **model-aware attribution badge** showing the
  developer mark + the model that actually analyzed the reference (e.g.
  "Analyzed by Opus 4.8", fallback-aware), or "Analyzed on-device". The
  engine the prompt is formatted for now follows the per-kind default and is
  named on the generation-prompt header ("Generation prompt · Midjourney"),
  so that information isn't lost — at the cost of picking between the three
  video engines from this screen.

### Fixed — the ambient background finally renders (it was built, never visible)

- **The R4 ambient layer — neural-mesh canvas, aurora blooms, gradient
  ground — was fully occluded in both themes since P1.** Two opaque fills
  painted over the fixed `-z-10` background layer: the shell wrapper's
  `bg-bg` and, decisively, the `body` gradient (a body background paints
  *above* negative-z-index fixed layers; only the root element's background
  sits beneath them). The 30fps canvas was animating invisibly on every
  screen. Both fills are gone — `html`'s token background still guards
  overscroll — and the frosted header/nav chrome now actually reveals the
  glow it was designed around. Verified by screenshot in both themes.
- **The mesh is now theme-aware and stable.** Node/link colors resolve from
  `--silver`/`--accent-ink` (so the field is legible on the light canvas and
  never paints raw Laser on light), re-resolve when `[data-theme]` flips,
  survive viewport-chrome resizes without re-scattering (iOS URL-bar
  collapse, Android keyboard), and honour `prefers-reduced-motion` changes
  live instead of only at mount.

### Fixed — correctness across the enhance, media, and provider layers

- **The result tree now reads the submitted mode/target, not the live
  selection.** Flipping the mode grid or target select after a run mislabeled
  the save payload, the exports, and the developer chip.
- **A client abort mid-stream no longer leaks spend past the daily cap.**
  OpenAI-compatible providers only report usage in the final chunk; the
  enhance route now estimates from streamed characters (~4 chars/token) when
  a run dies before that, and both model routes log a failed ledger write.
- **Gemini thinking tokens are billed as output** — `thoughtsTokenCount` now
  counts toward the cost cap on the enhance and vision paths.
- **A missing provider key 503s before the stream starts** (the documented
  contract) instead of being discovered mid-SSE; every provider preserves the
  upstream HTTP status on errors; all five providers now cap output tokens
  (16k, matching Anthropic) and the OpenAI-compatible vision path enforces
  JSON mode + a 1k output cap like its siblings.
- **The Midjourney `--ar` follows the reference image's real dimensions**
  (nearest standard ratio; 16:9 stays the no-dims default), and the on-device
  audio probe no longer leaks a whole-file object URL per attachment.
- **The 1px Laser focus ring never rendered** — Tailwind's universal
  `--tw-shadow: 0 0 #0000` default made the `var()` fallback dead on every
  element. The ring is now literal; keyboard focus finally shows the
  spec's crisp Laser edge everywhere.
- **The service worker no longer caches Supabase `/auth/v1` responses** (the
  "enhance" runtime route could never match its own POST-only endpoints — its
  sole live effect was caching session PII), the dead `/api/library` route
  config is gone, the page-HTML cache is purged whenever the auth gate shows
  (no more previous-session HTML after sign-out), concurrent outbox flushes
  can no longer duplicate saves, and long-lived standalone sessions check for
  SW updates on foreground.
- **Light theme details:** the browser/status-bar tint now matches the light
  canvas (`#EEF0F4`), and the footer's Laser hairline + brand-pill dot use
  `--accent-ink` so they no longer vanish on light (contrast law §6).

### Added — features that existed server-side but had no UI

- **Password sign-in.** The set-password onboarding created a durable
  email+password credential that could never be used — the gate now has a
  quiet "Have a password?" toggle (spec §3.2/A4: email+password is the
  durable credential, magic link the convenience).
- **Tag editing.** `updateTagsAction` + `parseTags` existed since P4 with no
  UI, leaving the library tag filter permanently empty — the prompt detail
  screen now has an inline tag editor (add via Enter/comma, remove per chip).
- **Storage management.** The 50 MB quota's "storage full — remove media to
  continue" was a dead end with no removal affordance anywhere; the media
  studio now lists stored assets (with delete) as the budget tightens, and
  vision spend shows the same amber daily-cap warning as the composer.
- **Branded 404 / error screens** (`not-found.tsx`, `error.tsx`) replace
  Next's unstyled defaults inside the locked shell; a back chevron on the
  prompt-detail header replaces the missing standalone-PWA way back; the
  detail screen gained a copy affordance for the current version; "shared"
  and "profile_updated" activity events (enum values with no emitter) are now
  logged; restore events carry the prompt title so the feed stops dangling
  "Restored a version of".
- **Resilience details:** the sign-in form recovers from bfcache restores
  (backing out of OAuth no longer strands every control disabled), the
  "check your email" card has a "use a different email" escape, the
  set-password gate has a sign-out escape, auth error slugs render as human
  copy, media saves queue to the offline outbox like prompt saves, partial
  streamed output survives a mid-run failure as a copyable card, and the
  avatar cropper surfaces decode/crop failures instead of hanging on
  "Loading…".

### Changed — small modern touches within the locked design

- Buttons ease (`filter` 120ms) with hover states on all three primitives
  (disabled-guarded); chrome icon buttons and nav tabs give `active:scale-95`
  press feedback; the mode help pill fades in; the streaming caret blinks;
  text selection and scrollbars are tokenized; headings/copy use
  `text-balance`/`text-pretty`; numeric readouts use tabular numerals
  everywhere; composer CTAs are true 44px tap targets (as are footer
  monograms and detail-screen controls); the mode rig is an honest
  `radiogroup` with full arrow-key/roving-tabindex support; ThemeSegmented
  drops its false radio semantics; live regions announce step changes only
  (never per-token counts); the diff input card now dims removed tokens per
  the diff contract; `STREAM_STEPS.parsing` is finally emitted; the stale
  three-model copy in the app metadata + manifest names the six-target
  roster; the offline fallback follows the OS theme, pads safe areas, and
  self-recovers when connectivity returns.

### Fixed — a rejected provider key no longer kills photo analysis

- **Media analysis now survives a provider key the vendor rejects.** Uploading
  a photo could fail with `Vision request failed: 401 You have insufficient
  permissions for this operation.` when the selected model's server-side API
  key lacked access to the vision endpoint — the raw provider error was shown
  and analysis dropped all the way to on-device palette detection. `/api/media`
  now treats config-shaped failures (missing key, 401/403 key permissions,
  404 unknown model string) as retryable and runs the vision pass once on the
  first *other* configured provider (Opus first) before degrading. Usage is
  logged and the chip credited against the model that actually analyzed, and
  the card notes the substitution ("Fable 5 couldn't analyze this image — used
  Opus 4.8 instead."). When no provider can run vision, the surfaced error now
  names the fix (check the key's permissions) instead of only echoing the
  provider. Runbooks document the key-permission requirement and
  troubleshooting.

- **`bg-hair` now exists.** The `hair` token lived only under
  `extend.borderColor`/`boxShadow`, so `bg-hair` generated no CSS and every
  hairline it painted was invisible: the sign-in "or" divider, the profile
  field dividers, and the footer monogram separator. It is now a first-class
  `theme.colors` entry.
- **Slash-opacity on the var()-based tokens is gone.** Tailwind 3.4 drops the
  entire utility when an opacity modifier is applied to an unparseable color,
  so `bg-void/80` (avatar-crop modal scrim — rendered fully transparent),
  `bg-void/60` (transformation-diff input card fill), `ring-chalk/40` (crop
  mask ring — fell back to Tailwind's default blue), `text-flare/70` (removed
  diff tokens — lost their Flare tint), and `text-silver/70` all produced no
  CSS. Backgrounds/ring now use explicit `color-mix(...)` arbitrary values
  (still theme-swapped via the vars); the two text cases use `opacity-70`.

### Added — developer marks on the model roster

- **Every target model now shows its developer's mark** — monochrome SVGs
  sourced from thesvg.org (open source) and optimized with SVGO, drawn with
  `currentColor` in the theme-aware accent ink (Laser in dark, deep green in
  light, AA in both). The mark appears on the Enhance target picker and the
  Profile default-model picker (left edge of the select), on the Library
  model-filter chips, and beside the usage readout on each result.

### Added — multi-photo queue, integrated into the composer column

- **Attach several files at once** — each gets its own card (thumbnail, name,
  size) with a staged Laser progress bar ("Uploading… / Analyzing with
  {model}…"), then its visual description, usage chip, and Insert/Copy
  actions. Files process sequentially (kinder to the rate limiter, cost cap,
  and mobile radio); the 50 MB quota is enforced across the whole selection
  before anything uploads.
- **The media studio now reads as part of the composer column** — the hard
  hairline divider is gone, a hint line ties it to the prompt box above, and
  the attach control is a dashed glass tile. The generation studio (engine
  chips · base prompt · save) tracks the most recently analyzed reference.

### Added — photo analysis by the selected model, with a description box

- **Media analysis now runs on the model selected in the composer** (all six
  targets, dispatched per provider) instead of always Opus, and the model
  returns a required prose **visual description** alongside the detected
  attributes. A new "Visual description" content box shows it with a
  per-analysis usage quick view (developer mark, model, tokens in→out, cost —
  the media route now returns usage to the client and logs the actual target).
- **"Insert into prompt"** drops the description straight into the prompt box
  above (appended after a blank line when a draft exists) and confirms with a
  ✓ state; Copy remains for external use. If the selected model can't analyze
  images, the on-device fallback degrades gracefully with a note.

### Added — live streaming enhancement

- **Enhanced text now streams token-by-token into the result surface** — the
  `/api/enhance` route returns a Server-Sent-Events stream (status ladder →
  deltas → usage → done) instead of one buffered JSON blob, while the
  `{output, rationale}` model contract and every auth/rate/cost gate stay
  exactly as they were (gate failures remain plain JSON with real statuses).
- **A Laser progress bar with the current processing step** (Queued → Reaching
  the model… → Generating… → Building the diff…) and a **live usage quick
  view** (tokens in→out and running cost, authoritative from each provider's
  stream usage reporting) sits above the streaming output. Honors
  `prefers-reduced-motion` with a static pulse.
- **RESET now cancels an in-flight run** (the stream aborts server-side and
  whatever usage accrued still reaches the cost ledger — even on disconnect).

### Added — Mistral Large 3 target

- **The roster grows to six with Mistral Large 3** (Mistral's current flagship,
  `mistral-large-latest`, $2/$6 per MTok defaults — both env-overridable via
  `MODEL_MISTRAL` / `PRICE_MISTRAL_*`). Mistral's API is OpenAI-compatible, so
  the adapter mirrors the Grok pattern with no new dependency.
- **Deploy notes:** apply the `add_mistral_large_3` enum migration *before*
  deploying (safe direction — old code never writes the value), and add
  `MISTRAL_API_KEY` to the Vercel project env; until set, the target returns
  503 "not configured" while the other five keep working.

### Changed — roster ordered by developer

- **Models are grouped by developer, best model first within each group**:
  Anthropic (Fable 5, Opus 4.8) and OpenAI (GPT-5.6 Sol) always lead, then the
  remaining developers alphabetically — Google (Gemini 3.5 Thinking), xAI
  (Grok 4.5). The order is locked by a unit test against `DEVELOPER_ORDER`.

### Added — guidance strip + mode help pill

- **A two-line guidance strip now sits directly below the header** on the
  Enhance screen, explaining what the app does and pointing at the six modes.
- **Hovering, focusing, or tapping a mode shows a help pill** under the mode
  rig — one shared `role="tooltip"` glass pill whose caret tracks the described
  cell; it hides on leave/blur/Escape (and auto-hides after a beat on tap).
  The previously unused `MODE_BLURB` copy was rewritten in plain language and
  wired to the pill via `aria-describedby`.

### Changed — five target models

- **The roster grows from three to five:** Opus 4.8 · **GPT-5.6 Sol** (renamed
  from GPT-5.5) · **Fable 5** (new, Anthropic) · **Gemini 3.5 Thinking**
  (renamed from Gemini Pro 3.1) · **Grok 4.5** (new — xAI, a new provider).
  The `model_target` enum migration renames values in place, so existing
  library entries relabel automatically; stale localStorage IDs migrate on
  first load.
- **Deploy note:** the Grok 4.5 target needs `XAI_API_KEY` in the Vercel
  project env; until set it returns 503 "not configured" while the other four
  targets keep working.

## [0.2.1] - 2026-07-02

### Added — one-tap copy on the Enhanced output card

- **A copy icon now sits directly on the "Enhanced" card header**, next to the
  change count, so the enhanced prompt can be copied the moment it renders —
  no scrolling to the action row. It's a 44px tap target that flips to a Laser
  check while the copy is confirmed, and it shares the confirmation state with
  the action-row **Copy** button (which remains for discoverability).

### Changed — Reset now mirrors the ENHANCE button

- **The composer's reset control is now styled identically to the submit
  button** — the same Laser-fill pill, height, and typography as **► ENHANCE**
  (`↺ RESET`), per product direction. This supersedes the interim icon-only
  circle and the secondary surface-fill pill it briefly became.

### Added — versioning is now released, tagged, and automated

- **The changelog is now actually versioned.** Everything previously piled under
  `[Unreleased]` has been cut into real releases (`0.1.0`, `0.2.0`, and this
  `0.2.1`) with dates and compare links, matching the `package.json` bumps that
  shipped them.
- **New Release workflow** (`.github/workflows/release.yml`): on every push to
  `main` that changes `package.json`, it reads the version and — if the
  `v<version>` tag doesn't exist yet — creates the tag and publishes a GitHub
  Release whose notes are extracted from this changelog's matching section.
- **Versioning runbook** (`docs/runbooks/release.md`): the semver policy, the
  single-source version wiring (`package.json` → `NEXT_PUBLIC_APP_VERSION` →
  UI pills/footer), and the release checklist (bump + changelog cut in one PR;
  the workflow tags and publishes on merge).

### Fixed — enhanced output no longer renders as a role-scripted system prompt

- **The `output` field is now contractually the prompt itself.** For the
  restructuring modes (Expand / Condense / Reformat / Target), the target idioms in
  `buildSystemPrompt` — "explicit system/user separation" (Opus), "developer/system/
  user role framing" (GPT) — read as an instruction to *script roles*, so the model
  returned a role-labelled system prompt (`System: … / User message to respond to:
  "…" / Task: …`) instead of an improved version of the user's prompt. Every mode ×
  target now carries an explicit `OUTPUT_CONTRACT` (the output is the single,
  paste-ready message in the author's voice — never role labels, never a persona
  spec, never the input quoted as a message to answer), and the target conventions
  were reworded to keep their structural idioms (XML sections, output-format specs)
  without the role-framing triggers. Unit-tested across all six modes and all three
  targets.

## [0.2.0] - 2026-07-01

### Changed — docs, release version, and a real README preview

- **App version bumped to `0.2.0`.** Surfaced automatically wherever the build injects
  `NEXT_PUBLIC_APP_VERSION` (`pkg.version` in `next.config.ts`) — the sign-in gate's
  version pill and the footer now read `v0.2.0`.
- **README hero is now a real capture, not a placeholder.** Replaced the placeholder SVG
  with `docs/preview.png` — a production-build screenshot of the shipped sign-in gate
  (aperture glyph, wordmark, VASEY/AI + version pills, the three Supabase auth methods,
  branded footer) — and removed the now-unused `docs/hero-placeholder.svg`.
- **README + docs reflect six modes.** Updated the mode list, the "six enhancement
  modes" copy, and the v0.3 status row (`5 modes` → `6 modes`); added a **Modes** section
  to `docs/runbooks/providers.md` documenting all six and the `SHAPE_PRESERVING`
  (Clarify / Polish) format-preservation behavior.

### Added — Polish mode (corrections-only enhancement)

- **New sixth enhancement mode, `polish`.** It keeps the input as close to the original
  as possible while fixing spelling, grammar, and punctuation and making only the
  smallest wording / word-order changes needed for the prompt to read clearly. It never
  adds, removes, reorders, or elaborates on ideas, and never restructures prose into
  lists or sections. Sits next to Clarify in the mode rig (now six equal cells).
- **DB:** requires the `polish` value on the `enhance_mode` enum — see
  `supabase/migrations/20260701000000_add_polish_enhance_mode.sql`. Apply before deploy.

### Fixed — Clarify no longer reshapes prose into bullet lists / markdown

- **Shape-preserving modes now keep the author's format.** `buildSystemPrompt` was
  injecting the target engine's structural idioms (Opus → XML-tagged sections, GPT →
  JSON / structured-output, Gemini → multimodal "parts") for *every* mode. For Clarify
  — whose job is to sharpen intent, not restructure — this pushed the model to rebuild a
  plain prose prompt into headings and bullet points. Clarify and Polish now receive an
  explicit format-preservation directive instead of the target idioms, so prose stays
  prose unless the input was already structured.

### Fixed — footer no longer collides with the fixed bottom nav

- **Footer is now guaranteed to clear the bottom nav.** The branded footer lives in
  normal scroll flow at the end of each page while the nav is `position: fixed` at the
  viewport bottom, so the nav floated *over* the footer — trapping the VM / V·AI
  monograms behind it and pushing the copyright lines out below it. Prior patches
  reserved a hardcoded `80px` of bottom padding that wasn't tied to the nav's real
  rendered height (`min-h-[56px]` + `py-2` + `pb-safe`), so the reserve could
  under-shoot the nav and let the footer slip under it.
- **Single source of truth for the nav height.** Introduced `--bottom-nav-h` (`4rem`,
  == 64px at the default root size, in rem so the bar scales with the user's font
  setting alongside its rem-sized icons and labels). The nav sizes its tap targets to
  it (`min-h-[var(--bottom-nav-h)]`) and the scroll region reserves
  `calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 1.5rem)`, so the reserved
  clearance always tracks the nav by construction — the two can never drift out of
  sync the way the fixed guess could.
- **Reservation is scoped to where the nav actually renders.** A shared
  `showsBottomNav(pathname)` predicate now drives both the nav's visibility and the
  scroll reservation, so the auth gate / onboarding screens (which hide the nav) no
  longer strand ~64px of empty space beneath the footer.

### Changed — nav chrome & glyph balance

- **Top header now reads as a floating sheet.** `.glass-chrome` drops its hairline
  border and sharp corners in favour of softly rounded *bottom* corners (20px) and a
  gentle downward shadow — the vertical mirror of the bottom nav, so both bars share
  the same borderless frosted-glass treatment instead of the header showing a bright
  contrasting edge.
- **Hero glyph rescaled for balance.** The refreshed mark fills its viewBox far more
  tightly than the old square art, so the sign-in hero glyph rendered oversized at
  `w-[260px]`. Reduced to `w-[176px]` (native aspect preserved) so it sits in
  proportion with the wordmark and the rest of the page.

### Changed — refreshed app icon & glyph

- **New master brand artwork.** Replaced both source SVGs in `public/brand/` with
  improved designs: `vizion-icon-token.svg` is now a glossy black squircle with a
  lime-green glowing border framing the aperture glyph, and `vizion-mark-token.svg`
  is the refined glyph alone (chrome parentheses around a neon bar, chevron and
  split ring, with dot accents and lens flares) on a transparent ground.
- **Whole matrix re-derived.** Ran `npm run generate:icons` so all 32 outputs —
  the transparent `any` PWA icons, maskable tiles, `apple-touch-icon`, favicons,
  iOS splashes, and the App Router `icon.svg`/`icon.png`/`apple-icon.png` — now
  reflect the new design. The iOS Add-to-Home-Screen tile and PWA install icon
  pick up the new look with no further changes.
- **Login hero sized to the glyph.** `AuthHero` now renders the wide glyph
  (1872×1084) at its native aspect ratio instead of forcing a 150×150 square.

### Fixed — avatar, composer & ambient polish

- **Profile avatar now renders.** Root cause was the Tailwind config defining
  `theme.spacing` at the top level, which *replaced* the scale and pruned
  `h-24`/`w-24` (and `h-11`, `h-9`, every fractional step) — so the 96px avatar
  button generated no size and collapsed to a dot. Moved the var-based 8-pt keys
  into `theme.extend.spacing` (identical px values) to restore the full scale.
  Additionally allowed the OAuth avatar CDNs (`lh3.googleusercontent.com`,
  `avatars.githubusercontent.com`) in both the CSP `img-src` and next/image
  `remotePatterns`, and added a name-monogram fallback with `onError` recovery so
  an expired provider URL no longer leaves an empty circle.

### Changed — integrated composer & ambient glow

- **Unified Enhance composer.** The target-model picker is nested into the
  composer's rounded top rail (as an `appearance-none` dropdown with a chevron),
  and a reset (↺) control plus the **► ENHANCE** action sit in the rounded bottom
  rail beside the token/media readouts — so every control lives inside one
  rounded-rectangle surface, with a Laser `focus-within` edge-glow.
- **Ambient aurora behind translucent chrome.** Added drifting Laser glow blooms
  (CSS, paused under reduced-motion) to the neural-mesh background and a new
  `--chrome` token + `.glass-chrome` so the header and bottom nav are more
  translucent and reveal the glow beneath. Canvas specks are slightly brighter
  with a soft halo on the Laser nodes.

### Fixed — UI remediation (R1–R8): restore the locked VIZION spec

- **Brand wiring (R1):** the squircle `vizion-icon-token.svg` now sits left of the
  wordmark in the top bar; the transparent `vizion-mark-token.svg` is the centered
  login hero. New `BrandPills` (VASEY/AI + live `v{version}` read from
  `package.json` via `NEXT_PUBLIC_APP_VERSION`, never hardcoded).
- **Type system (R2):** Bebas Neue / Reddit Sans / JetBrains Mono are now
  self-hosted via `next/font/local` (vendored OFL woff2 in `src/app/fonts/`).
  JetBrains Mono is scoped to the enhanced-prompt **output/result region only**;
  every other surface — including the prompt input editor — is Reddit Sans
  (guarded by `tests/unit/type-scoping.test.ts`). The wordmark is now plain
  `VIZION` (IO in accent), with the bracket/chevron motif left to the mark/icon.
- **Light/dark & contrast (R3):** role-mapped tokens for both themes;
  `--chalk`/`--silver` swap per theme. Added `--on-laser` (constant dark ink on
  laser fills) and theme-aware `--accent-ink`/light `--flare` so laser/error are
  never used as low-contrast text on light. Every text/bg pair passes WCAG AA in
  both themes.
- **Glass + background (R4):** an ambient neural-mesh `<canvas>`
  (`NeuralMeshBackground`) decoupled from React, capped ~30fps, particle count
  scaled to viewport, fully paused on `document.hidden`, with a static-gradient
  fallback under `prefers-reduced-motion`. Glass stays on floating elements only;
  the active result surface gets a top-edge laser shimmer.
- **Mode instrument & balance (R5):** the five modes are now one glass chassis
  (`ModeRig`) with a sliding laser lens-lock indicator, symmetric at 360/390/430px.
  The target-model picker is a centered content-width pill; full width is reserved
  for the Enhance CTA and the mode grid. Unified `.btn-laser`/`.btn-secondary`/
  `.btn-destructive` system.
- **Auth & profile (R6):** branded OAuth marks (multicolor Google G, theme-aware
  GitHub) via `ProviderIcon`, capped/centered. The profile shows the auth provider
  as its branded mark ("Connected with GitHub"); sign-out is a capped destructive
  button.
- **Footer (R7):** canonical `Footer` on login + profile — "VASEY/AI Presents" /
  Vasey Multimedia, dynamic year, version pill, safe-area aware. VM + V/AI
  monograms render behind `BRAND_MONOGRAMS_READY` (typographic fallback until
  Sean's real files land) with `filter:invert(1)` theming.
- **iOS & performance (R8):** library rows memoized; the media studio is a
  route-level dynamic import; the result tree reads the *submitted* input so typing
  never re-renders it; canvas paused offscreen.

### Changed — Brand icons

- Replaced the placeholder aperture glyph across the full icon/splash matrix with
  the master brand artwork. Two hand-authored SVGs now live in `public/brand/`:
  `vizion-icon-token.svg` (the branded Void plate + glow border) and
  `vizion-mark-token.svg` (the aperture mark on a transparent ground).
- `scripts/generate-icons.mjs` now rasterizes those master SVGs instead of the
  removed `scripts/lib/glyph.mjs` placeholder builder: the transparent "any"
  matrix and iOS splashes use the mark; apple-touch, favicons, and the App
  Router `icon.png`/`apple-icon.png` use the opaque plate; maskable tiles center
  the mark in the safe zone on a full-bleed Void canvas.
- Added `src/app/icon.svg` (the master tile) so modern browsers get a scalable
  favicon, with `icon.png` as the raster fallback.

### Added — v1.0 Hardening (P6)

- **Content-Security-Policy** + the full security-header set in `next.config.ts`
  (`default-src 'self'`, Supabase-scoped `connect/img/media`, `frame-ancestors`/
  `object-src`/`base-uri` locked; HSTS, nosniff, `X-Frame-Options: DENY`).
- **Rate limit on every model route**: an in-memory burst limiter
  (`src/lib/security/rate-limit.ts`) layered in front of the DB cost/rate cap.
- **iOS storage-eviction recovery**: an IndexedDB **offline outbox**
  (`src/lib/pwa/outbox.ts`) that queues failed mutations (e.g. Save) and replays
  them via `OutboxFlusher` on `online` / `visibilitychange` (no Background Sync
  on iOS); `navigator.storage.persist()` requested on SW registration.
- **Accessibility (WCAG AA)**: skip-to-content link, `prefers-reduced-motion`
  handling, focusable main landmark; existing visible focus ring + labels.
- Security/hardening checklist + backup-restore runbook (`docs/runbooks/hardening.md`).
- Tests: rate-limiter + outbox-flush (unit); CSP header + skip link (e2e).

### Added — v0.5 Media prompts (P5)

- `MediaAsset` is first-class (A5): a `media_assets` table (RLS owner-only from
  creation) + a private `media` Storage bucket with owner-scoped policies.
- Attach an image / video / audio reference in the Enhance studio; it uploads to
  the owner's prefix and records the asset.
- **Extraction pipeline behind a flag** (`NEXT_PUBLIC_MEDIA_EXTRACTION`, default
  `proxy`): vision via the model proxy (`/api/media`, Anthropic, cost-capped) with
  an **on-device fallback** (canvas palette + dimensions, audio duration) — the
  locked open question resolved as *proxy + on-device fallback*.
- **Generation-syntax formatters** (pure, unit-tested): Midjourney image-ref
  (`--ar/--v/--iw`), Runway/Sora/Kling motion phrasing, and an audio spec — fold
  the detected attributes into a generation-ready prompt that can be copied/saved.
- Storage budget with an **Amber** warning near quota (50 MB).

### Added — v0.4 Library & versioning (P4)

- Schema (RLS owner-only from creation): `prompts`, immutable `prompt_versions`
  (no update/delete policy → snapshots), and `activity_events`. `Prompt.current_ver`
  points at the active version; versions chain via `parent_ver`.
- Save flow: an enhancement saves a `Prompt` + first `PromptVersion`
  (Save-to-library on the diff). Revise → re-enhance → append a new version.
- Prompt detail (`/library/[id]`): version history, **diff any two versions**
  (reusing the word-diff), one-tap **restore** (sets `current_ver`), and delete.
- Library browser: search + tag + model filter over saved prompts; the **activity
  feed** (created · enhanced · saved · shared · restored) tied to the profile.
- Pure helpers (`deriveTitle`, `parseTags`, `filterPrompts`, `relativeTime`) with
  unit tests.

### Added — v0.3 Enhance core (P3)

- Provider adapter (`enhance(input, mode, target)`) fanning out to per-target
  implementations: Anthropic/Opus (official SDK), OpenAI/GPT (SDK), Google/Gemini
  (REST). Model strings are env-overridable config (D9); keys are server-side only.
- Per-target idiomatic formatters (Opus XML/CoT · GPT roles/JSON · Gemini
  parts/system-instruction) and the five modes (clarify · expand · condense ·
  reformat · target).
- `/api/enhance` route: auth-required, with a per-user **rate limit + daily cost
  cap** enforced server-side before any model call (backed by a `usage_events`
  ledger with RLS + a `usage_window` aggregate).
- The **transformation diff** — input on the Void end, enhanced output on the
  Chalk end, changed tokens lit in Laser, with a plain-language rationale —
  plus copy / share / export (Markdown · JSON · text) and an Amber cap warning.
- Tests: word-diff, formatters/parse, cost + exporters (unit); enhance-API 401
  (e2e). Pure word-level LCS diff lives in `src/lib/enhance/diff.ts`.

### Added — v0.2 Auth & profile (P2)

- Supabase Auth wired end-to-end: magic link + GitHub + Google on the sign-in gate, with
  OAuth/PKCE (`/auth/callback`) and email-OTP (`/auth/confirm`) route handlers and
  sign-out.
- Session middleware (`src/middleware.ts`) refreshes the JWT and gates every route to the
  sign-in page when signed out (server is the source of truth).
- Database (applied to the live project): `profiles` + `oauth_identities` with **RLS
  owner-only policies from creation**, an auto-profile trigger on signup, an `updated_at`
  trigger, and a `password_set` flag. Security advisors: clean.
- Avatars: Supabase Storage bucket (public read, owner-scoped writes) + a dependency-free
  client-side square→circular **avatar cropper**.
- Profile screen with real data — editable full name, display name, email (re-verify),
  default model, and theme; preferences sync to the account and hydrate on load.
- Magic-link → set-password onboarding (D15/A4), enforced by the `(app)` layout.
- Routes reorganised into an authenticated `(app)` group; offline shell decoupled from
  auth (static `offline.html` fallback). Tests: onboarding gate (unit), auth-gate +
  PWA/offline (e2e). Docs: `docs/runbooks/auth-setup.md`.

## [0.1.0] - 2026-06-13

### Added — v0.1 Shell (Phase 0 + P1)

- Repo scaffold: Standard `CLAUDE.md` v2.0, configs (TypeScript strict, Tailwind +
  CSS-var tokens, ESLint, Prettier, EditorConfig), `.env.example` (keys only),
  `SECURITY.md`, `docs/` (architecture + decision log + runbook), `tasks/lessons.md`,
  `.github/workflows/ci.yml` (lint · typecheck · test · build · npm audit).
- Design tokens: the seven locked roles + Amber, with dark/light/system theming.
- Typography via `next/font` — Bebas Neue (display) · Reddit Sans (body) · JetBrains
  Mono (utility).
- PWA shell: `manifest.webmanifest` (`any` + `maskable`, transparent-PNG matrix),
  hand-authored Workbox service worker (SWR shell · network-first enhance/auth ·
  cache-fallback library) with an offline fallback, iOS splash placeholders.
- Safe-area **v2 luminance-polarity template** wiring status-bar tint + nav contrast.
- 3-tab bottom nav (Enhance · Library · Profile) and the Enhance composer shell
  (mode chips · mono editor · target club rack · ENHANCE CTA).
- Auth gate stub (brand + value prop + three method buttons; Supabase wiring in P2).
- Tests: Vitest unit (safe-area math, contrast guardrails, UI store) and Playwright
  e2e (shell render, nav, theme, manifest, SW, offline shell).

[Unreleased]: https://github.com/SeanVasey/vizion/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/SeanVasey/vizion/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/SeanVasey/vizion/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SeanVasey/vizion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SeanVasey/vizion/releases/tag/v0.1.0
