# Changelog

All notable changes to VIZION are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — model pricing catches up with the vendors' August pages

Every one of the sixteen price rows was re-verified against its vendor's own
pricing page on 2026-08-08, and each `TARGETS` entry now carries a
`pricesVerifiedAt` stamp (META-01, the lightweight form — presence and format
are test-pinned, age deliberately is not). Eight rows moved:

- **GPT-5.6 Sol** output was 2× under the published rate ($15 → $30/1M).
- **GPT-5.6 Terra and Luna had their tier roles swapped** — Terra is OpenAI's
  balanced mid tier ($2/$12, was $0.2/$0.8) and Luna the small tier
  ($0.2/$1.2 after OpenAI's July 30 cut, was $1/$4). The roster order, tier
  comments, and target-idiom prose now say so too.
- **Mistral Large 3** dropped to $0.5/$1.5 (the old $2/$6 was Large 2.1's) —
  and the deliberately floating `mistral-large-latest` is finally **pinned to
  `mistral-large-2512`**, now that Mistral publishes the versioned id
  (PRV-007 closed).
- **Kimi K3**'s placeholder was ~5× under the real list price ($3/$15) and
  **GLM-5.2**'s reference rate rose to $1.4/$4.4 — the last provisional rows
  from PRV-008, now vendor-published.
- **Grok 4.5** dropped to $2/$6 and **Qwen3.8 Max** rose to $2/$6 (the
  Singapore/International region's rate; other regions run ~18% cheaper).

Unchanged but now verified: Fable 5, Opus 5, Sonnet 5 (the standard $3/$15 —
the intro $2/$10 expires 2026-08-31, and overcounting for three weeks beats
undercounting forever), DeepSeek V4 (an official increase is pending),
Gemini 3.6 Flash, Muse Spark 1.1, MiniMax M3 (a "permanent 50% off" list
basis), and Sonar Pro (whose per-request search fee stays an accepted,
documented undercount).

**A price change is a cost-cap change — check the deployed `PRICE_*`
overrides in Vercel**: a stale override silently miscounts the daily cap. And
new with this cycle, **`PRICE_*` values also feed Auto's cost ranking**, so a
stale override now skews which model Auto picks, not just the cap math.

### Condense stops wearing Expand's icon

The two modes have rendered one glyph since mode icons first shipped:
`ModeRig`'s Condense path was Expand's four outer corner brackets with each
subpath's draw direction reversed. The intent comments said "arrows out" vs
"arrows in" — but a stroke has no visible direction, so both cases rasterized
to the identical maximize mark and the label was the only differentiator.
Condense now differs in geometry, not draw order: its elbows sit on the inner
box with legs reaching the frame — the standard minimize counterpart to
Expand's maximize — legible as "inward" at the rig's 20px render size.

### The axe specs stop racing the footer's entrance

Verifying the above surfaced a latent flake: the a11y specs inject axe as soon
as the page's heading exists, which can land inside the footer's rise-and-fade
(0.8s delay + 0.8s ramp, fill `both`). A scan in that window measures the
mid-fade translucent silver against the canvas — 4.35:1 on a pair that rests
at 5.99:1 — and fails as a "serious" contrast violation that machine timing
alone decides. `analyze()` now waits for every finite animation to finish
before injecting axe; the infinite ambient blooms are exempt, since waiting on
them would never return. The audit therefore always measures the settled page.

### The re-cut brand art now reaches returning devices

The header was still painting the pre-re-cut app icon a day after the new
artwork shipped. The masters deliberately keep their filenames when the art
changes (`tasks/lessons.md`: swap the content, not the names) — but a stable
name meets two stale-while-revalidate layers in front of the live DOM. The
`/brand/:path*` HTTP policy serves a cached copy for a day, then a stale one
for up to a week while revalidating; the service worker's
StaleWhileRevalidate image route sits on top, answers from its own copy
first, and its background refetch reads the still-fresh HTTP cache rather
than the network. Same URL + new bytes therefore converges only after both
layers age out — days, and unpredictable per device.

The two live-DOM references (`ScreenHeader`'s squircle, `AuthHero`'s mark)
now import their URLs from `src/lib/brand-assets.ts`, which appends a
`?v=<BRAND_ASSET_VERSION>` query. Changed art gets a changed URL — a cold
key in the browser and SW caches at once — with no filename churn anywhere
in the icon pipeline. The version bumps in the same commit as any
`public/brand/` master change; `next/image` strips the query before its
`.svg` check, so the SVGs keep their unoptimized passthrough.

### The ambient blooms return to full strength

The ×0.7 dim on the four NEBULA+ bloom peaks (the previous owner tune) is
reverted on owner direction: peaks return to the full locked-table values in
all three theme blocks (dark 16%/14%/0.11/9%; light and system-light
22%/0.17/0.14/13%). The particle-core `CORE_BOOST` from the same tuning
commit stays — only the blooms were re-tuned.

### The provider time budget becomes one wall, and stops being re-armed per layer

Closing the last three review findings on the streaming work below, and — more
importantly — the reason there were six rounds of them.

The budget is a single wall spanning the whole invocation: route preflight,
connect, headers, and the streamed body, sized under `maxDuration` so the
route's spend-settling `finally` always runs. It was written as a **duration**
(`PROVIDER_TOTAL_MS`) applied independently wherever a timer was needed, and
every layer that armed its own full-length one put two budgets in **series**.
Each review round moved the timer one layer outward — preflight, then the
header wait, then the stream body, then the SDK client's `timeout` — and each
time the layer below went on arming a fresh 285s, because the constant stayed
importable and `timeout: PROVIDER_TOTAL_MS` still type-checked and still read
plausibly. Two budgets that each read 285s do not sum to 285s.

So the fix is not another relocation. Below the route there is no duration left
to relocate: `providerDeadline()` converts the constant to an absolute wall in
exactly one place, and `providerBudget(provider, opts.deadline)` hands each
adapter that wall plus `remainingMs()` of it. Every downstream timer — the SDK
clients' connect-and-headers `timeout`, the idle wall, the total wall, Gemini's
`AbortController` — is now cut from the remainder.

- **The SDK `timeout` no longer gets its own window.** It bounds the header
  wait, which is time the same wall already counts; it is now `timeoutMs`, not
  the constant.
- **`google.ts` reads the deadline it was handed.** The one hand-rolled `fetch`
  adapter had been threaded `opts.deadline` and never read it, so Gemini kept
  arming a fresh 285s regardless of how long preflight took. It was the last
  holdout for exactly the reason it was easy to miss: it is not shaped like the
  SDK adapters, so the rollout-by-analogy skipped it.
- **A spent budget refuses the request instead of aborting it.** An aborted call
  can still be billed once the provider starts generating, so a wall exhausted
  during preflight now fails with a 504 *before* the connection opens.
- **The guard test no longer pins the defect.** `provider-policy.test.ts`
  asserted `timeout: PROVIDER_TOTAL_MS` — the exact line under review — so the
  suite was defending the bug and every fix had to fight it. It now asserts the
  property, and a repo-wide test fails the build if any file outside
  `config.ts`/`idle-timeout.ts` imports the constant at all. Both guards were
  mutation-tested by re-introducing each defect.

The changelog's migration reference is corrected to `20260808021953`, the
version that actually shipped.

### Long streams are no longer cut off at ~55s, and a truncated run keeps its output

A healthy long generation was being killed mid-stream and billed anyway.

The killer was the enhance route's `maxDuration = 60`: the platform terminated
the whole function while the model was still producing. At typical rates that
capped output around 2,000–4,000 tokens against the 16,000–64,000 the adapters
request — the clock, not `max_tokens`, was the real ceiling — and the route's
`finally` block then estimated the partial at ~4 chars/token and settled the
ledger, so the user paid for an answer they could not keep. The window is now
300s.

The adapters' own budget had to be rebuilt around a correction, recorded here
because the intuitive reading is wrong and this repo briefly shipped it. The
SDK `timeout` option is **not** a whole-request deadline: in both vendored SDKs
the timer is armed around `fetch()` and cleared when that promise settles
(`openai/src/core.ts:597-602`, `@anthropic-ai/sdk/src/client.ts:729-733`), and
a streaming `fetch()` resolves at the **response headers**. It bounds
connect-and-headers and nothing after; once the first byte lands the SDK stops
bounding the stream at all. So the retired `PROVIDER_TIMEOUT_MS = 55_000` never
truncated a body mid-read, and a total budget cannot be expressed as an SDK
`timeout` either — that timer is long gone by the time the body streams.

Both budgets are therefore enforced in application code. `PROVIDER_IDLE_MS`
(60s) measures time since the **last token**, so a stream that keeps producing
is never interrupted however long it runs, while genuine silence dies fast.
`PROVIDER_TOTAL_MS` (285s) is an **absolute wall** taken once at route entry
(see the section above) that deliberately does not reset on a chunk — without
it a continuously productive
stream had no bound at all and would be killed by the platform, skipping the
`finally` block and stranding the spend hold (PRV-002). Both are
env-overridable, and a test pins `PROVIDER_TOTAL_MS < maxDuration` because they
are a pair.

`withIdleTimeout` holds the one implementation for the five SDK adapters;
`google.ts`, a raw fetch with no SDK to wrap, carries the same policy by hand
with an `AbortController` whose total timer stays armed across the body read
and whose idle timer is re-armed per chunk. Cancellation goes through the SDK's
own abort handle rather than `iterator.return()`, because both SDKs expose an
async generator and that protocol queues `return()` behind a pending `next()` —
of which there is always one at idle-out. Aborting first settles the read, lets
the queued cleanup run, and releases a connection that would otherwise keep
streaming tokens nobody reads and keep billing for them.

`/api/media` deliberately keeps a flat whole-request deadline under its own
`MEDIA_TIMEOUT_MS`: it is a bounded one-shot analysis under a `maxDuration=60`
route, where the failure above cannot occur. It gets its own constant so a value
sized for bounded calls can never again govern unbounded streaming ones.

Two consequences of the same "don't waste what was paid for" principle:

- **A length-stop keeps its partial.** Hitting the output ceiling mid-envelope
  used to throw, discarding every token that had streamed. It now returns the
  partial flagged `truncated`, which is deliberately **not** `salvaged` — salvage
  means "complete output, lost rationale" and promises a whole prompt, so the two
  carry different copy. A truncated run says plainly that the prompt is
  incomplete and why it is being kept. Nothing usable streamed still errors.
- **The live token counter no longer freezes at 1.** Anthropic reports
  `output_tokens` at `message_start` as a header snapshot — literally 1–4 — and
  sends the real cumulative count only in the terminal frame. The client latched
  that first frame as authoritative and disabled its own estimator, pinning the
  readout at `1213→1 tok · $0.0037` for the whole visible run, so an expensive
  run never looked expensive while it was running. Mid-stream usage frames are
  now a floor rather than a freeze, and the counters are monotonic by
  construction; the `usageAuthoritative` flag that caused it is gone rather than
  left permanently false.

### OpenAI's library accent is a maroon, the one exception to the accent corridor

Owner direction: `--dev-openai` read as pink. It moves from the assigned h336
magenta `#cf70ba` to `#9c595d`.

Every ΔE2000 floor from [0003](docs/decisions/0003-developer-accents.md) still passes — laser 66.7, **flare 21.0/18.1**
against a floor of 18, amber 44.9, pulse 63.4 — so no semantic clearance is
amended and the accent still cannot be misread as "error" or "pending delete".
Nearest live accent is minimax at 10.6, matching the palette's tightest standing
pair rather than undercutting it.

What does change is the luminance corridor's lower bound. A true maroon cannot
work here at any chroma, and not because of a rule: `#800000` measures **1.15:1**
against the aurora-lit dark card, i.e. invisible. An accent has to be lighter
than the card it sits on, which is why the corridor has a floor at all. The
deepest fully-compliant red, `#a06f72`, reads as oxblood rather than maroon, so
the value ships below the floor at Y 0.1500 — **2.41:1** on the aurora-lit dark
card (2.92:1 on the plain dark card; 5.12:1 on the light card, better than the
magenta it replaces). Justified because the mark is redundant: the model name is
text immediately beside it, so it is not a graphical object required to
understand content under WCAG 1.4.11. [0011](docs/decisions/0011-openai-maroon.md) records the derivation, and a test
now asserts that **exactly one** accent sits below the floor and that it is
`openai` — the corridor was previously only ever asserted for xAI, so a second
one would have shipped unnoticed.

### Qwen moves to Qwen3.8 Max

`qwen3_7_max` → `qwen3_8_max`, wire id `qwen3.8-max`, with the
`model_target` enum renamed in migration `20260808021953` (existing rows migrate
by OID) and a `LEGACY_TARGET_IDS` entry so a stale persisted selection resolves
instead of 400ing. The thinking ladder is unchanged — "Max" is Alibaba's model
tier, not a reasoning depth.

Qwen's 8192 output ceiling is unchanged but now `MAX_TOKENS_QWEN`-overridable.
It is the tightest in the fleet and the `max` thinking budget consumes half of
it, so Qwen truncates sooner than any other target; it is not raised on a guess
because a value outside DashScope's published range 400s on every call, trading
an occasional truncation for total failure.

### The streaming card has one moving light, not two

`.stream-live::after` — an accent light travelling the card's top edge — ran the
same `@keyframes stream-sweep`, at the same 1.4s, with the same gradient and glow
as the progress bar a few pixels below it. One signal drawn twice, which read as
two competing indicators. The edge light is removed and the bar stays: it also
carries the `role="status" aria-live="polite"` step label ("Reaching the
model…"), which the edge light did not. Reduced-effects users already ran
bar-only, so this converges the two rendering paths rather than adding a third.
The static `.result-shimmer::before` hairline underneath is untouched.

### The ambient blooms stop overrunning a phone screen

The four NEBULA+ blooms were sized, positioned and animated in
`vmax`, which resolves to the larger of viewport width or height. On
the 1280×800 landscape reference that behaves exactly like `vw`, so
the design read correctly there and only there: on a portrait phone
the same numbers pinned to the height axis instead, and bloom B
rendered at 173% of the viewport width — a wash over the whole screen
rather than a drifting glow. Each bloom now takes its diameter from
`min(Nvw, Mvh)` with M = N × 1.6, the reference's own aspect ratio,
which reproduces the original pixel geometry exactly at 1280×800,
restores the intended 70/80/46/38% footprint on portrait, and caps
the inverse case as well — a short landscape phone, where `vmax`
already equalled `vw` and a plain unit swap would have changed
nothing. Offsets and keyframe drift ride a per-bloom `--bloom-d`
custom property at their original ratio to the diameter, so they
scale with the clamped size instead of drifting out of proportion.
Bloom C keeps its `30vw`/`36vh` position, which was already
axis-correct.

The mode-description caption gains `.ambient-scrim`, a new fill-only
surface. It was the one piece of on-screen text with no tier between
it and the ambient layer, and a bloom drifting behind light-theme
`--silver` left it at 4.83:1 — over the AA bar, but with little room
for a second overlapping bloom or a passing mote. The scrim is the
DSN-010 `--scrim-panel` wash and nothing else: no hairline, no sheen,
no grain, no blur, because the glass tiers would have made a one-line
caption read as a third stacked card beneath the mode rail. It
measures 5.51:1 light and 9.22:1 dark, and being `--void`-based it
inverts with the theme without a tri-block.

### The NEBULA+ glow steps down and the particles step up

Owner tune after seeing the composite in production: the top/bottom
glow read ~30% too strong, and the drifting motes too faint. The four
bloom peak alphas drop ×0.7 in both themes (dark A/B/C/D now 11.2% ·
9.8% · 0.077 · 6.3%; light 15.4% · 0.119 · 0.098 · 9.1%), and the
particle core dots gain a ×1.2 boost applied before the light-theme
multiplier so its clamps still bound. Halos, the ground vignette, and
every behavioural invariant (30fps gate, pause, theme reactivity, no
raw Laser on light) are untouched.

### The I›O mark is re-cut with solid chevron and ring wedges

Corrected masters replace the first I›O cut: the chevron and the two
split-ring halves are now closed, filled paths — the chevron a mitered
polygon, each ring half a tapered wedge between a 379 px outer and a
232 px inner arc — instead of stroked lines with butt caps, so the
mark's terminals render as drawn geometry rather than stroke
artifacts. Palette and tile chrome are unchanged. The glyph's viewBox
tightens from 1560×987 (1.581:1) to 1565×996 (1.571:1), so the AuthHero
image narrows to 160px wide to hold its 102px rendered height; the
maskable 0.68 factor still lands the art's corners at ≈0.40 × size, so
it stays. The full 33-file icon + splash matrix is regenerated from the
corrected masters.

### The ambient background is the NEBULA+ composite

The R4 neural mesh — linked nodes on a single canvas under two Laser
auroras — retires in favour of the approved NEBULA+ ambient system
(`AmbientNebula`): a static theme-derived ground vignette (an accent
wash from the top, a silver wash from the bottom), four blurred
colour blooms drifting on CSS keyframes alone (42/54/66/34s alternate
loops), and a three-tier parallax particle field — far, mid and near
motes that pulse, wrap at the viewport margins, and scale to viewport
area with no ceiling now that the mesh's O(n²) link pass is gone. The
first nine particles glow accent; the light theme multiplies alphas
×2.2 (clamped) and swaps the motes to the NEBULA+ charcoal.

The performance architecture carries over unchanged: one canvas, a
30fps frame-delta gate, a full stop — not a CSS hide — while the tab
is hidden or Reduced effects is on, and live theme re-resolution off
the tokens with no remount. Accents ride `--accent-ink`, so no layer
can paint raw Laser on a light surface. Two deliberate behaviour
changes: under `prefers-reduced-motion` the ground vignette now
stands alone (the old system kept frozen auroras visible), and the
ground no longer paints a solid Void gradient — `html`'s `var(--bg)`
carries the solid, as it already did beneath everything. Where the
NEBULA+ parameter table and `tokens.css` disagreed, the tokens won
and the substitutions are noted in the component: dark motes
`185, 188, 197` and light accents `63, 107, 0`.

### The name is written VIZION everywhere — the parentheses retire with the old art

With the icon re-cut to the bare I›O mark, the parenthesized wordmark
spelling no longer has an aperture to echo, so every reference in the
tree — UI copy and metadata, the manifest and offline page, provider
system prompts, source comments, README, docs, workflows — now writes
the name plainly as VIZION. The rendered `Wordmark` component was
already parenthesis-free; this aligns the written form with it. The
three v1 planning documents under `docs/history/` keep the original
spelling verbatim: they document the aperture rationale itself, and
their README now says so.

### The app icon is the I›O mark, re-anchored on the laser tokens

The brand artwork is re-cut down to its core: the chrome parentheses,
the four hairline arcs, the six dot accents and the two lens-flare
stars are gone, leaving the bar → chevron → split-ring mark alone. The
palette is now derived from `src/styles/tokens.css` rather than
approximated beside it — the old art's hue 64–74° greens are corrected
to `--laser: #b7ff3c` (hue 82°) with the `#ceff7a → #b7ff3c → #81cc00`
gradient, and the tile background ramp sits on the neutral tokens
(`--onyx` → `--lift` → `--void-2`). The mark now occupies 72% of the
tile width. Both master SVGs live in `public/brand/` and the full
33-file icon + splash matrix is regenerated from them.

Because the glyph's aspect changed from 1872×1084 (1.727:1) to
1560×987 (1.581:1), two consumers needed retuning: the maskable
safe-zone factor drops from 0.78 to 0.68 so the art's corners stay
inside Android's 0.40 × size mask circle, and the AuthHero `<Image>`
narrows to 161px wide to preserve the 102px rendered height tuned
against the wordmark. ScreenHeader's 36px tile rounds at 8px instead
of `rounded-xl`, matching the squircle's own corner radius at that
size and keeping the glow border unclipped.

### A finished enhancement survives leaving the Enhance screen

Owner report: run an enhancement, visit Library or Profile without saving
or copying it, come back — the result is gone, and the tokens it cost are
washed. The result lived in `EnhanceComposer` component state, so App
Router navigation unmounted the route and destroyed it; the draft
survived (it lives in the persisted UI store), which made the loss read
as a bug rather than a rule. The submitted-snapshot + result view now
lives in a dedicated persisted store (`vizion.enhance-view.v1` — separate
from the UI store on purpose: that store re-serializes on every draft
keystroke, and a result is orders of magnitude larger than every
preference combined), so a finished run survives in-app navigation, a
reload, and an iOS PWA relaunch — subject to the limits of any local
cache (§6: iOS can evict site storage, and quota/private-mode writes
fail silent-but-safe). Server-side persistence of the unsaved run is the
follow-up that closes that last gap; this change closes the everyday
one. Every consumer of the view is unchanged
— R8 submitted-snapshot reads, undoable Clear, refines, Clarify answers,
saves and exports all sit on the same object, now durable. Persisted
state is validated on every rehydrate and dropped if the model roster
renamed under it (a stale target would 400 the next refine); the store
skips module-init hydration so the server-rendered HTML never diverges,
with ProfileHydrator doing the once-per-load rehydrate — after the
account check, so on a shared device another account's result is wiped
before it can ever render, the `editorDraft` rule extended. A run still
in flight during navigation is out of scope here: the stream aborts on
unmount as designed, and keeping it alive is its own piece of work.

Polish's per-change revert decisions ride along (a Codex review catch on
the PR): they were component state inside the diff, so with the result
now surviving navigation a remount would have silently forgotten which
edits were reverted and shipped the model's fully-accepted output to
Copy/Use/Save/Share/export. The revert set persists inside the view
object — it is meaningless apart from this result's diff, and a new run
replaces both together — seeded back into the diff on mount and
reported out on every change. Two more review catches hardened the
seams: the diff's reset-on-new-result effect gates on the result
reference changing rather than a first-run flag (StrictMode's dev
double-invoke flipped the flag and wiped the seed — Vercel bot), and
the persisted envelope now carries its owning account, checked on every
load — the one-time account-change wipe couldn't stop a previous
account's still-open tab from re-writing its view afterwards (Codex).

### The tray's Originals dial is a pill again

On-device feedback: the bare 10px "Originals stored" text read as a
caption, not a control — nothing about it said tappable. It now wears
the app chip recipe (glass fill, rounded-full, text-xs — the
LibraryFilterSheet/DraftsToolbar quiet arm) with an 8px state dot:
pulse-filled while originals are stored, hollow while not kept, so the
state never rides on color alone. This reverses the earlier "one step
smaller and quieter" ruling from the attach-rail pass; the half that
survives is the reason it was made quiet — the dial still never takes a
laser fill, because a standing preference must not compete with Attach
or ENHANCE beside it. `aria-pressed` and the "Originals …" accessible
name are unchanged, so the privacy sheet's pointer to "the tray's
'Originals' toggle" stays truthful.

### Streaming output is a live console card

On-device report: the token stream read as bland and hard to interpret —
a bare glass card with a floating progress bar above it and a stock
pulsing `▍`. The in-flight surface is now one cohesive card: a breathing
beacon beside a STREAMING caption (the finished card's exact header
geometry, so it morphs into "Enhanced" in place), the token ticker on
the right, the slim sweep track and aria-live step line under the
header, newly-arrived text materializing through a keyed opacity fade, a
designed 2px accent caret, a travelling top-edge light while tokens
arrive, and a skeleton wait-state before the first token. Wrapper and
mono body classes stay byte-identical to TransformationDiff's, so the
handoff never reflows. Closes ledger UX-03 — the card scrolls itself
into view on run start (smooth, or instant under reduced motion) with a
scroll margin clearing the sticky header; the growing tail is
deliberately not followed — and PRI-013 — the visible `⌁ 5→9` cluster is
decorative in both StreamProgress and the new ticker, while an sr-only
"N tokens in, M out" phrase keeps the relationship audible (per a Codex
review pass). Reduced motion collapses every new animation to its static
base and swaps the edge light to the sweep's sanctioned slow pulse;
Reduced effects removes the edge light entirely (gate test extended).
Horizon's reserved in-flight `data-state` hook stays deliberately unlit:
stream state lives client-side under a server-rendered Horizon, and the
reduced-effects gate's specificity dance would have to grow in lockstep
— deferred rather than half-shipped.

### Thinking depth rows carry a filled meter, violet above High

On-device request: in the Thinking depth sheet only Auto carried the
rising-bars mark, so the ladder read as bare text with no scannable
weight. The meter is now ALSO a readout — deliberately reversing
`DepthGlyph`'s recorded "static by design… not a readout" ruling; the
label stays authoritative, the meter now agrees with it. Sheet rows and
the rail trigger fill bars to the chosen effort (Minimal 0 · Low 1 ·
Medium 2 · High 3; unfilled bars stay faint at 0.28), keyed to the level
id so the same id renders identically on every model's ladder. The two
tiers above High (Extra High · Max) trade Silver for a new ultra-violet
ink, and Max's tall bar overshoots the meter's top line — effort past
the marked scale. The owner picked the ChatGPT-electric family
(`#ab68ff`); dark is tuned to `#b47aff` because the raw pick measures
4.499:1 on the composited glass card — a hair under the 4.5:1 text bar —
and light is `#7c3aed` (every theme/surface combo clears text AA).
`--ultra-ink` lives in globals.css (tokens.css is LOCKED), declared for
dark + both light paths with a Tailwind `ultra` ink role; the
3-declaration shape and the contrast floor are pinned in
tests/unit/a11y.test.ts.

### Google's library accent is green; OpenAI's is a new magenta

Owner direction from an on-device review: green reads as Google's
association, not OpenAI's — so `--dev-google` is now green, and
`--dev-openai` moves to a colour nothing else in the accent list uses.
Both values were re-derived under the 0003 method (luminance corridor,
ΔE2000 floors, tiered lightness), not eyeballed:

- **Google `#219042`** anchors on the green of Google's published logo
  palette (`#34a853`) with the hue *held* (drift +0.01) — the collision
  with `--pulse`, the app's success green, is solved by moving to the
  darker lightness tier instead of drifting the hue (ΔE2000 20.5 against
  a floor of 15). The retired Gemini-mark violet leaves the roster.
- **OpenAI `#cf70ba`** is *assigned, not sourced* — with the green ceded,
  openai.com's palette (black/white) leaves nothing to anchor, and
  neutrality stays reserved for xAI. The hue fills the widest gap the
  roster leaves open, biased away from the retired violet so it reads as
  its own identity. The token comment states the sourcing fact plainly,
  as xAI's does.

Every floor, both card contrasts (3.09:1/3.99:1 and 4.02:1/3.07:1), and
the single-neutral test hold for both values; decision record in
`docs/decisions/0010-google-green-openai-reassignment.md`.

### Picker sheet rows carry real vertical padding

On-device report: in the Thinking depth sheet, the Auto card's text sat
flush against the card's top and bottom borders. The sheet rows sized
themselves with `min-h-[44px]` alone and had no vertical padding — which
reads as padded only while a row's content is a single 20px line. Auto's
wrapping description grew the row past the floor, and what looked like
padding turned out to be leftover min-height. Rows in both picker sheets
(Thinking and Target — the pair must match) now carry `py-3`: single-line
rows render pixel-identical (one 20px line + 24px padding is exactly the
44px floor), and rows that wrap keep a real 12px inset.

### Model/Thinking pickers anchor beside their triggers; sheets drag to close

On-device report: both composer pickers (Target model, Thinking depth)
opened as bottom sheets a full viewport away from the mid-screen pills that
summon them, and the sheet's grab handle was decorative — it promised a
drag-down dismiss it couldn't perform. Three changes to the `Sheet`
primitive, none of which alter its dialog contract (portal, focus trap,
Escape, scrim click, scroll lock):

- **`anchor="side"`.** A second anchor renders the panel as a card
  vertically centered against the right edge of the app column — beside the
  composer rail on any viewport — sliding in from that edge
  (`.sheet-in-side`). Both pickers adopt it; every other sheet keeps the
  bottom anchor unchanged.
- **The grab handle works.** The handle strip carries pointer handlers:
  drag past a distance threshold (or flick) to dismiss, short drags spring
  back, sub-slop presses stay taps so the header's X still clicks. The
  handle's orientation now states the true gesture — horizontal pill on top
  of a bottom sheet (drag down), vertical pill on the side card's leading
  edge (drag out). Drag is scoped to the handle strip so it can never fight
  the option list's own scroll.
- **Closing animates.** Sheets play a short exit (reverse of their entry;
  a drag-dismiss instead finishes its throw from wherever the finger left
  it) before unmounting. The exiting node is aria-hidden and pointer-inert
  from the first closed frame — focus restore, scroll unlock, and every
  role query see the close as instant, and the global reduced-motion
  collapse snaps the exit to immediate.

`sheet.test.tsx` pins all three (drag past threshold closes, short drag
springs back, tap stays a tap, side card keeps the dialog contract, exit
leaves the a11y tree at once).

Follow-up device report on the entry below: with the stand-down's fill swap
live, every `.glass` panel on the library and settings screens visibly
changed grey the moment a flick started. Root cause is two-state rendering
itself — each panel's resting appearance (72%/82% tint, blurred and
saturated, over the aurora-lit ground) varies with what sits behind it, so
**no** single scroll-time appearance can match all panels: blur-off read as
see-through (first report), the opaque swap reads as a grey shift (this
one). The `[data-scrolling] .glass` rule is removed outright — panels now
keep their backdrop-filter, grain and fill in motion and render identically
scrolling or still, in both themes (the light-mode question answers itself:
there is no scroll-time restyle left to differ). The FAB keeps its
stand-down: it is fixed over the list (the strongest per-frame cost) and its
82%-Laser fill makes the swap genuinely invisible — the same screenshots
that showed the panels shifting show the FAB identical. `ui-contracts`
now bans a `[data-scrolling] .glass` rule and pins the gate's allowlist to
the FAB alone; both e2e scroll specs assert a real panel computes the same
blur + fill mid-scroll as at rest. The per-frame blur cost this re-accepts
has never been measured as jank on the target device, while both stand-down
generations drew appearance reports within a day — if jank is ever
measured, the fix is non-visual optimization, never a scroll-time restyle
(rationale recorded in the globals.css scroll-gate comment).

### On-device report fixes (composer translucency · settings · Gemini)

Five issues reported from a production device, four repaired in code and the
fifth diagnosed to deployment config:

- **Composer no longer lets the page read through it.** The chassis moves
  from `.glass` to a new opaque `.glass-solid` tier (same hairline, sheen,
  grain; fill is the new `--glass-still` — the glass tint pre-composited
  over the page ground, `color-mix` over `--onyx`/`--void`, declared for
  dark + both light paths). The translucent tier could not keep the promise
  on the app's primary work surface: bright ambient-mesh nodes bled through
  72% alpha even blurred, and during the scroll stand-down the tint alone
  hid nothing. The stand-down itself is fixed for **every** glass panel:
  `[data-scrolling] .glass` now swaps to the `--glass-still` fill while the
  blur is down, so mid-flick panels hold their color instead of going
  see-through (the rule's old "not perceptible" premise was measured false
  on device). `.glass-solid` answers to Reduced effects like its parent
  tier; `reduced-effects.test.ts` now pins that.
- **"Try a template" no longer wears Gemini's silhouette.** The button's
  `SparkMark` (a filled concave four-point star) was visually the Gemini
  developer mark from the Target rail; it is replaced by `TemplateMark`, a
  stroke-style framed template card, so no developer identity is spent on an
  unrelated affordance.
- **Owner console moved below the sections every account has.** It rendered
  between Appearance and Data & privacy, splitting the ordinary settings
  order with an administrative group only the owner sees; it now sits after
  Data & privacy (whose stored-media manager it follows), before About.
- **Stored developer-accent strength actually renders now.** dev-accents.css
  derives `--dev-peak` AT `:root`, but the authed layout carried the stored
  `--dev-peak-user` on a wrapper div — invisible to a `var()` substituted at
  `:root`, so the saved strength (the "60%" label) never changed the cards
  after a load; only the slider's live preview (inline on `<html>`) worked.
  The layout now server-renders `:root{--dev-peak-user:N%}` via
  `devAccentCss()` (clamped to the CHECK bounds before interpolation;
  unit-tested), and dev-accents.css documents the `:root` requirement.
- **Gemini "Your project has been denied access. Please contact support."**
  Diagnosed, not a code defect: that text is Google's own 403 body relayed
  verbatim — Google refusing the Cloud project behind the deployed
  `GOOGLE_API_KEY`, not a model or adapter limitation (endpoint, request
  shape, and the `gemini-3.6-flash` id verified current). Remediation is
  key rotation in the Vercel env — procedure added to
  `docs/runbooks/providers.md` ("Gemini key/project refusals"). The adapter
  now appends the remediation hint to 401/403 messages and warn-logs the
  upstream status server-side, so the next refusal shows up in Vercel
  runtime logs (this one was visible only in the failing client).

### Production verification fixes (post-deploy sweep of 28314e4)

A live audit of the deployed production site (HTTP/PWA sweep, real
mobile-browser pass, hosted-DB health, repo↔prod consistency) confirmed the
audit remediation is serving correctly — nonce CSP, cache tiers, icon matrix,
fail-closed APIs, RLS — and surfaced four fixable divergences, all repaired
here:

- **Offline auto-recovery was dead in production (S2).** Vercel's
  `cleanUrls: true` 308-redirects `/offline.html` to `/offline`, a path
  neither the middleware matcher nor `next.config.ts`'s header rule knew, so
  the document (and the SW-precached copy) shipped with the per-request
  *nonce* CSP while its inline reload script carried no nonce — blocked in
  every browser, on the exact page whose job is to reload when connectivity
  returns. The recovery script is now the external `/offline.js` (valid under
  `script-src 'self'` in **every** policy variant, and precached with the
  page); the matcher excludes `/offline`; a mirrored static-CSP header rule
  covers the clean URL. With no inline script left in any static asset, the
  static fallback CSP drops `'unsafe-inline'` for scripts entirely — a strict
  tightening of SEC-001.
- **Browser-chrome tint wrong when the stored theme opposes the OS scheme.**
  `ThemeManager.setMeta()` rewrote only the *first* `theme-color` meta (the
  dark-media one of the DSN-002 media-qualified pair), so e.g. theme=dark on a
  light-OS device kept the light tag authoritative and tinted `#EEF0F4` over a
  dark page. It now writes the resolved surface color to every tag in the
  pair (`tests/unit/theme-meta.test.tsx` pins all four scenarios).
- **Legacy `/favicon.ico` 404 and `/robots.txt` auth-redirect.**
  `generate-icons.mjs` now assembles `public/favicon.ico` (PNG-in-ICO from the
  existing 16/32/48 favicons); `public/robots.txt` exists (`Disallow: /api/`);
  both paths are middleware-excluded. The offline page also declares the
  precached `icon-192.png` as its icon so its tab icon resolves offline.
- **`bg:paused`/`bg:resumed` breadcrumbs no longer ship to production
  consoles.** They were `console.warn`, which `removeConsole` deliberately
  keeps; as visibility-change diagnostics they are `console.debug` — present
  in dev, stripped from production.

Operational, recorded here because the repo is the canon: the three audit-wave
migrations were applied to the hosted project under MCP-generated versions
(`20260801184843/191808/214653`); the remote `schema_migrations` ledger has
been repaired to the repo's versions (`20260801190000/200000/210000`) so CLI
migration tooling agrees with the repo again. Still open on the GitHub side
(owner actions, unchanged from the adjudication): enable GitHub Actions
(`docs/runbooks/ci-enablement.md`), then backfill the `v0.3.0` tag/Release via
`release.yml`.

### Post-review fixes (PR #75 code review)

Three correctness follow-ups on the wave work, each with a test:

- **Media quota (P1, extends `MED-001`).** `media_reserve` enforces the 50 MB
  per-user quota against the client-*declared* byte count, and `media_commit`
  corrected each row to its measured size without re-checking the aggregate — so
  reserving many 1-byte declarations, uploading 50 MB into each, then committing
  bypassed the ceiling. A new migration re-validates the *measured* aggregate at
  commit under the same per-user advisory lock `media_reserve` takes, failing
  closed over quota, so committed storage can never exceed it.
- **Fallback cost attribution (P2).** In `/api/media`, a vision fallback that
  reported usage and then threw was priced at the *original* target's rates and
  ledgered under the wrong model (the active-target assignment sat after the
  retry `await`). The target is now set before the retry, so the outer catch
  bills the fallback leg correctly.
- **Offline outbox parking (P2).** The `save-prompt` handler classified every
  non-success as a permanent `failed`, so a batch of >30 queued saves — where
  the 31st+ trip the per-user write limiter — parked the overflow permanently
  after three flushes even though the window clears in under a minute.
  `savePromptAction` now marks rate-limit and expired-session rejections
  `retryable`, and the handler maps those to the existing `transient` outcome
  (kept queued, never parked); validation and persistent write errors stay
  bounded-then-parked.

### Performance — audit Stage 2, Wave 6: bundle, render, and cache work (measured)

Wave 6 clears the PERF track plus `PRI-007` and ruling **Q14**. No behaviour
changes — the numbers below are from the build route table and the SW precache
log.

Bundle:

- **PERF-001 / Q14 (`PRI-016`).** The browser Supabase client now loads through
  a dynamic import (`src/lib/supabase/lazy-client.ts`) in the interaction-only
  consumers (AttachmentTray, SettingsPanel, MediaManager), so `@supabase/*`
  (~62 kB gz) leaves the first load: **/enhance 223 → 158 kB**, **/profile
  208 → 143 kB**. `/sign-in` keeps it (auth needs it immediately). This is the
  route-level split R8's since-removed media-studio dynamic import was meant to
  provide.
- **PERF-005 (also `DEAD-001`).** The service worker precache is narrowed to the
  icons the offline experience uses (192/256/384/512 + maskable +
  apple-touch): **320.8 KiB/21 entries → 155.1 KiB/9 entries**. icon-1024, the
  favicons, and the intermediate iOS sizes are still served on demand and
  runtime-cached — no download on install for assets no offline path needs.
- **PERF-007.** The mono family is `preload: false` — its three weights (~65 kB)
  load on demand when an output region first renders, not preloaded on the auth
  pages that never show them.

Render:

- **PERF-002.** The neural-mesh rAF loop now stops when reduced-effects is on
  (gated on `data-reduced-effects` through the existing observer), instead of
  running the full simulation into a CSS-hidden canvas at 30fps.
- **PERF-003.** `TransformationDiff` is memoized and the composer's
  use/refine/answer handlers are `useCallback`s (draft read via `getState`,
  mutation via the stable `mutate`), so typing with a result mounted no longer
  reconciles the whole diff tree.
- **PERF-006.** `TargetPicker` · `ThinkingPicker` · `AttachmentTray` ·
  `KeyboardActionBar` are memoized with stable callbacks, so an SSE flush
  reconciles only the streaming card, not the whole composer subtree.
- **PERF-004.** `LibraryBrowser`'s swipe handlers (and their shared
  `refreshAfterMutation`) are `useCallback`s, so the memoized `PromptRow` holds
  and a search keystroke no longer re-renders every accumulated row.

Cache + platform:

- **PERF-008.** `/icons`, `/splash`, and `/brand` get
  `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` — a
  revalidating long cache (not `immutable`: the brand masters regenerate in
  place, so a re-brand must not be stranded for a year).
- **PRI-007 (`APPLE-01`).** The ten iOS launch images are wired as
  `apple-touch-startup-image` links, one per device class, with
  device-width/height + `-webkit-device-pixel-ratio` + orientation media queries
  (the pixel-ratio clause disambiguates the two 414×896 devices). The 528 KB
  splash set is no longer dead weight.

### Hygiene — audit Stage 2, Wave 5: dead code, dependencies, docs, and rulings Q2/Q11/Q12/Q15

Wave 5 clears the DEAD / DEP / DOC tracks (plus `INV-008`, `MED-007`,
`SW-003/004`) and lands the remaining hygiene rulings. No runtime behaviour
changes — this wave is code hygiene, dependency accuracy, and documentation
truth.

Dead surface:

- **DEAD-004.** The `export` keyword is dropped from 14 grep-verified
  module-internal symbols (6 values + 8 types across 10 files) — compile-time
  surface only, no runtime change.
- **DEAD-002 (ruling Q12).** The broken `test:int` script (targeted a
  non-existent `tests/integration/`) is removed from `package.json` and
  `AGENTS.md`; no integration tier is planned.
- **DEAD-005 / DEAD-001.** The 8 generated Supabase type aliases are recorded as
  accepted scaffolding (hand-editing fights the generator); the 12 unreferenced
  `public/icons/` files are left for Wave 6's precache trim (they are a
  protected, dispositive path — `PERF-005`, not a deletion).

Dependencies:

- **DEP-001 / PRI-008.** The six `workbox-*` runtime packages
  (`core/precaching/routing/strategies/expiration/cacheable-response`) are now
  declared as direct devDependencies at `^7.4.1` instead of relying on
  `workbox-build`'s transitive hoist.
- **DEP-002.** The stale `GHSA-mh99-v99m-4gvg` exemption and its source-level
  verifier are removed from `scripts/check-audit.mjs` (now zero-exemption); the
  advisory is no longer reported and the per-major `brace-expansion` overrides
  stay as defensive floors. `AGENTS.md` rewritten to match.
- **DEP-003.** `engines.node` tightened to `^20.19.0 || >=22.12.0` (the vite 7
  intersection), so the declared floor matches the toolchain. `DEP-004`
  (deprecated transitives, no advisory) and `DEP-005` (openai v4→current, an
  API-breaking migration) are recorded as tracked debt.

Docs:

- **Ruling Q2 (`DOC-005` / `MOD-002`), [ADR-0005](docs/decisions/0005-living-canon.md).**
  The three v1-era canon files (`VIZION FINAL PLAN v1.md`,
  `VIZION-product-spec.md`, `VIZION-style-guide.html`) moved to `docs/history/`
  and are reclassified as historical. The **living canon** is code + CHANGELOG +
  `tokens.css` + the audit ledger. `CLAUDE.md` §1, `docs/architecture.md`, and
  ADR-0001 references updated; source `§`-citations remain valid.
- **`DOC-008`.** The four undocumented decisions since ADR-0003 get records:
  [0006](docs/decisions/0006-tolerant-envelope-salvage.md) (envelope salvage),
  [0007](docs/decisions/0007-collections.md) (collections),
  [0008](docs/decisions/0008-service-role-account-deletion.md) (service-role
  deletion), [0009](docs/decisions/0009-atomic-spend-reservations.md) (atomic
  spend reservations).
- **`DOC-004`.** The vendored OFL fonts ship their license: `src/app/fonts/OFL.txt`
  carries the full SIL OFL 1.1 text and per-family copyright notices, pointed at
  from `LICENSE`, `README`, and `fonts/index.ts`.
- **`DOC-001/002/003/006/009/010/011/012`, ruling Q15 (`DOC-007`).** README
  route handlers corrected Edge→Node and the SW-strategy line to reality; README
  phases relabeled as feature milestones (no phantom v0.4/v0.5 tags); the
  copyright holder aligned to `LICENSE`; `CLAUDE.md` §4/§9 and `SECURITY.md`
  (all 12 provider keys), `architecture.md` (4 missing entities), and
  `local-dev.md` (icons are brand-derived, not placeholders) brought current.
- **`INV-008`, `MED-007`, `SW-003/004`.** The stale migration timestamp
  cross-references are mapped in `docs/runbooks/migrations.md` (applied
  migrations are append-only); the audio generation spec and the service-worker
  comments (`register-sw.ts`, `sw-src.js`, `build-sw.mjs`) now describe the
  shipped NetworkOnly behaviour.

Strictness (**ruling Q11**, `TYP-007`): `tsconfig` enables
`noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters`
alongside the already-on `noUncheckedIndexedAccess` and `noImplicitOverride` —
the whole scheduled strictness set is green. `DOC-014` resolves the `DOC-XXX`
placeholder; the `docs/audit`→`docs/audits` fold is deferred to finalize.

### Design — audit Stage 2, Wave 4: token centralization, consumers, and design rulings

Wave 4 clears the DSN track and records the design rulings Q1/Q6/Q7/Q8 in
[ADR-0004](docs/decisions/0004-audit-design-rulings.md).

Tokens first (in `globals.css`, not the LOCKED `tokens.css`):

- Motion scale (`--motion-quick/--motion-slide/--ease-out`, DSN-011), a single
  floating-clearance token (`--float-gap`, DSN-016 — the sticky bar, toast,
  and FAB had drifted to 8 vs 12px), and shared scrims (`--scrim-panel`,
  `--scrim-heavy`, DSN-010/020).
- `tailwind.config` focus-glow reads `var(--laser-glow)` (DSN-005); the
  contrast-guard citation points at the real test (DSN-013); dead entries
  (`backdropBlur.glass`, `boxShadow.hair`, `backgroundColor.glass`,
  `colors.void-2/lift`) removed (DEAD-003).

Consumers:

- KeyboardActionBar wears the bottom-anchored nav tier, not the top chrome
  (DSN-001); a media-qualified light/dark `themeColor` pair (DSN-002); the
  ModeRig grid + skeleton derive from `MODES.length` (DSN-006/008); the 320px
  label overflow is fixed (DSN-007); `--scrim-heavy` tokenizes the avatar mask
  (DSN-020); the squircle radius joins the ladder (DSN-017); light-theme
  secondary-button feedback is perceptible (DSN-021); PressableButton on the
  primary media-sheet footer CTAs (DSN-003).

Rulings (ADR-0004): **Q1** — six ModeRig cells are canon; **Q6** — icon stroke
weights are per-size optical (effective ~1.5px); **Q7** — a documented
two-tier input recipe; **Q8** — the avatar mask is tokenized; **DSN-012** —
the destructive swipe-panel `--flare` fill is a sanctioned exception. The
z-index ladder is documented in `docs/architecture.md` (DSN-018). Deferred by
owner call: the two coexisting appearance controls (DSN-019).

### Security + Accessibility — audit Stage 2, Wave 3

Wave 3 clears the SEC and A11Y tracks plus `PRI-009/010/014` and lands ruling
Q9. No new runtime dependencies.

Security:

- **CSP is nonce-based (SEC-001 / PRI-010).** The middleware mints a
  per-request nonce and emits the document CSP with
  `script-src 'self' 'nonce-…'` — `'unsafe-inline'` is gone for scripts. The
  theme bootstrap and Next's inline scripts carry the nonce; `offline.html`
  and `sw.js` (which the middleware can't nonce) keep a static policy. The
  `connect-src`/`img-src` Supabase wildcard is narrowed to the exact
  configured project origin, closing the attacker-registered-project exfil
  channel. The CSP builder moved to `src/lib/security/csp.ts`.
- **Rate limits on all endpoints (SEC-002).** Every mutating server action
  (auth, profile, library, drafts) is burst-guarded; the unauthenticated auth
  callback/confirm GETs are IP-guarded; account deletion is rate-limited. The
  durable cross-instance limits stay on the model routes' `spend_reserve`.
- **SEC-003.** Refinement context (the tone original, the Q&A block) moved out
  of the privileged system prompt into the fenced user message — client text
  can no longer countermand the envelope contract from the system role.
- **SEC-004..010.** Keyset cursors are UUID-pinned and fully quoted before
  interpolation; raw PostgREST error text is laundered from the pagination
  actions; `avatar_url` is server-side allowlisted; the
  `<attached-references>` fence neutralizes embedded tags; the drafts page
  action gained an explicit auth gate; the in-memory limiter sweeps expired
  windows; sign-out and delete-account refuse cross-origin POSTs.

Accessibility (the "WCAG AA pass" claim is now measured — `PRI-009`):

- **Forced-colors focus (A11Y-001):** a transparent outline paints as
  CanvasText where box-shadow is suppressed.
- **Picker keyboard contract (A11Y-002):** TargetPicker/ThinkingPicker get
  roving tabindex + arrow keys via a shared hook.
- **Light-theme selected state (A11Y-003):** a shared inset accent-ink ring
  gives every active Laser fill a non-color channel at ≥3:1.
- **Announcements (A11Y-004/005):** permanently-mounted `aria-live` regions
  carry toast text and the enhance-completion message, so neither is inserted
  already-populated (unreliable) or unmounts into silence.
- **Non-color cues (A11Y-006/007):** diff additions get an underline mirroring
  the removed side's strike; footer/Settings inline links get a resting
  underline.
- **Headings (A11Y-008/009):** the sign-in gate gets its `h1`; Settings steps
  `h1→h2`.
- **A11Y-010/012:** the reduced-motion progress pulse actually runs; the
  reduced-effects switch has an accessible name.
- **Q9 (A11Y-011):** a persistent **Recently deleted** library view with
  Restore and confirmed permanent delete — the 6-second toast Undo is now a
  shortcut, not the only recovery path.
- A new axe-core e2e spec asserts zero serious/critical WCAG violations on the
  gate and composer, plus no horizontal scroll at 320px.

`PRI-014`: the composer token readout renders `≈N tokens` — an estimate,
visibly distinct from the result line's authoritative provider counts.

### Fixed — audit Stage 2, Wave 2: correctness across the model, media, library, and offline paths

Wave 2 clears the S1/S2 correctness findings (tracks MOD/PRV/MED/LIB/SW plus
`PRI-001`) and lands rulings Q3–Q5 and Q10. One migration
(`20260801200000_library_media_correctness.sql`, **applied to the hosted
project**) carries the server-side halves.

Model path:

- **PRI-001.** `/api/enhance` diffs through `boundedDiffWords` — the unbounded
  O(n·m) LCS on a 20k-char input × 64k-token output was ~10⁹ table cells,
  enough to OOM the invocation mid-stream and skip the spend settle. Over
  budget ⇒ `diff: null`; the result view shows plain text with a "too long to
  diff" note and hides Compare.
- **MOD-001.** "Make shorter"/"More detail" refine instructions now carry an
  explicit supersedence clause, and the shape-preserving `OUTPUT SHAPE`
  rule cedes its *length* clause to those passes — the default-mode refine no
  longer composes a prompt whose last CRITICAL rule countermands the clicked
  action.
- **Q4 (MOD-003).** A run's format/length knobs are snapshotted with the
  submission and re-sent on every refine and answered pass — an explicitly
  chosen shape no longer silently regains "whichever fits" latitude.
- **MOD-004.** `check:db-enum` probes the hosted `enhance_mode` enum for
  `polish` — the committed-but-unapplied drift class the script exists for.
- **MOD-006/MOD-007.** The abort-path token estimate includes the system
  prompt + fenced context; the envelope scanner's seek tail survives
  whitespace-padded keys split across chunks.
- **PRV-001.** Auto no longer 400s a valid composer state: an out-of-ladder
  thinking level on an auto-routed request is advisory and dropped.
- **PRV-002.** One provider connection policy: 55s timeout / 0 retries on
  every SDK client and both raw Gemini fetches — a hung provider can no
  longer outlive `maxDuration` and strand the spend hold, and no invisible
  retry can double-bill upstream.
- **PRV-003.** Billed-but-invisible reasoning (stripped `<think>` spans,
  `reasoning_content` deltas) now reaches the no-usage fallback estimate as
  a floor — the daily cap stops undercounting exactly the runs that think
  hardest.
- **PRV-005/006/009.** Anthropic errors say "Anthropic" (not "Opus") for all
  three targets; the never-emitted `thinking` SSE event is documented
  reserved; OpenAI's completion ceiling doubles at high reasoning effort.
- **PRV-007.** DeepSeek and Qwen pinned to exact published ids
  (`deepseek-v4-pro` at the published $0.435/$0.87 rates, `qwen3.7-max`);
  `mistral-large-latest` deliberately still floats — Mistral publishes no
  exact id, and inventing one 404s every call. Pin levers + the provisional
  price rows (`PRV-008`) documented in `docs/runbooks/providers.md`.
  **Check the deployed `PRICE_DEEPSEEK_*` overrides** — a price change is a
  cost-cap change.

Media path:

- **MED-001.** The storage INSERT policy now requires a matching *pending*
  reservation, and the ready-flip is a new `media_commit` RPC that corrects
  `size_bytes` from the uploaded object's real storage metadata — the
  50 MB quota can no longer be bypassed by direct uploads or 1-byte
  declarations.
- **Q3 (MED-002).** The bucket limit is 50 MB, matching every promise the
  product makes (it was 25 MB, so every 25–50 MB upload died post-reservation
  with a raw storage error).
- **MED-003.** The client admits exactly the bucket's 11 MIME types
  (`MEDIA_ALLOWED_MIME`) — nothing reserves quota and then dies at the
  bucket; the explicit `accept` list also makes iOS transcode HEIC at the
  picker.
- **MED-004.** Failed vision calls that *reported* usage are settled, not
  released (per-leg rates; the failed first leg of a fallback run is summed
  in) — "failed calls are free" was how a flaky provider spent invisibly.
- **MED-005/006/009.** Upload-failure cleanup best-effort-removes the
  storage object before deleting the row; intent validation uses
  `Object.hasOwn`; `MAX_IMAGE_BYTES` documented as a non-Vercel backstop.
  The route finally has handler tests (`media-route.test.ts`, MED-008).

Library:

- **LIB-002.** `parent_ver` is trigger-guarded: same prompt only, never self.
- **LIB-003.** LibraryBrowser ports the DraftsList page-seam fix: mutations
  reset accumulated pages + the keyset cursor before refreshing, and cards
  dedupe by id — no more duplicated/permanently-skipped rows at page seams.
- **LIB-004.** The duplicate-save race is closed from both sides: a cross-tab
  Web Lock serializes outbox flushes, and `library_save_prompt` re-checks the
  content hash under a per-(owner, hash) advisory lock, converging concurrent
  identical saves on one card.
- **Q5 (LIB-010).** The duplicate-detection hash includes the target — the
  same content saved for a different destination model is a distinct prompt.
  SQL backfill included; the live-DB fixture is re-pinned.
- **LIB-005/006/009.** Facet queries use a stable most-recent slice; hard
  delete requires `archived_at` server-side, trash prompts refuse new
  versions/restores and 404 on the detail route; deleting a collection no
  longer bumps every released prompt to the top of Recent.

Offline outbox (SW-001/002/007, Q10):

- "Queued — syncs when online" is now the truth: the queue write's success is
  checked, a missing owner refuses to enqueue, and online server failures
  report errors instead of promising a sync.
- Replayed payloads are shape-validated; poison items park immediately,
  server-rejected items park after 3 confirmed attempts — parked items are
  kept (never deleted) and surfaced once via toast instead of retrying on
  every foreground event forever.

### Fixed — audit Stage 2, Wave 1: the five invariant violations (PR #72 gate, `GO` received)

The 2026-08-01 audit capstone (`docs/audits/`) found no S0 and five invariant
violations; the owner accepted every adjudication recommendation. Wave 1
clears the violations and hardens the guards that keep them cleared:

- **INV-001 (INV-07 laser law).** The streaming progress sweep and the result
  shimmer drew raw `--laser` strokes — 1.06:1 against the light page, an
  invisible progress indicator for light-theme users. Both gradients (and the
  sweep's glow, now a `color-mix` of the same ink) use `--accent-ink`: dark
  rendering is byte-identical (the ink resolves to Laser there), light renders
  at 5.55:1.
- **INV-002 (INV-06 zero emoji).** The 21 remaining rendered emoji-range
  glyphs (✓ ★ ✕ ✎ ⚠ ✦ across nine components) — POLISH-01's unfinished
  remainder — are replaced by a shared SVG glyph language
  (`src/components/ui/glyphs.tsx`: 24px grid, `currentColor`, 1.5px strokes,
  filled state-markers), including the two adjacent `▤`/`⌂` dingbats in the
  library action menu that sat outside the audit's scan ranges but are the
  same defect. Status text ("Copied", "Saved") stays text; only the marks
  became SVG.
- **INV-003 (INV-08 brand separation).** `SECURITY.md` no longer routes
  vulnerability reports to a VASEY.AUDIO mailbox — it points at GitHub private
  vulnerability reporting. **Owner action required:** enable *Private
  vulnerability reporting* under repo Settings → Advanced Security, or the
  report link 404s.
- **INV-004 (INV-11 type roles).** The footer version line drops `font-mono`
  for `font-body` (Reddit Sans keeps `tabular-nums` for steady digits) —
  JetBrains Mono is output-region only again.
- **INV-005 (INV-04 cost truth).** When a provider stream never reports usage,
  the ~4 chars/token fallback now travels as `usageEstimated` end-to-end: the
  result line and the attachment details sheet render `≈$…` instead of an
  exact figure, `/api/media` marks the absent-vision-usage default the same
  way, and `spend_settle` ledgers an `estimated` flag on the `usage_events`
  row (migration `20260801190000_usage_estimated_flag.sql`, **applied to the
  hosted project** — apply before deploying this code). The abort-path
  estimate settles as estimated too.

Guard hardening that keeps them fixed (audit `INV-006/007/009`):

- The mono type-scoping test is inverted: every `.tsx` under `src/components`
  and `src/app` is scanned (74 files, was a 24-file allowlist) and the pattern
  now catches the `font-mono` utility the old regex could not see; only the
  seven output-region files may carry mono.
- `src/lib/providers/config.ts` imports `server-only`, closing the one gap in
  the provider layer's build-time fence around `PROVIDER_KEY_ENV`.
- A new `icon-alpha` unit test (sharp) pins the icon contract: transparent
  corners on the 13-icon any-matrix, full opacity on
  maskable/apple-touch/favicon and the App Router icons — a regeneration that
  flattens the wrong set now fails the gate.

### Fixed — the database could not be rebuilt from the repository

Seven migrations — the entire P2–P5 base schema — were applied straight to the
hosted project and existed only in its migration ledger. `supabase/migrations/`
began at `alter type model_target add value`, on tables it never created:
`profiles`, `oauth_identities`, `usage_events`, `prompts`, `prompt_versions`,
`activity_events`, `media_assets`, five enums, both storage buckets and every
RLS policy on them. A fresh environment could not be built, and a lost project
could not be restored, from anything in git.

Nothing caught it, because every later migration applies fine on top of a schema
that is already there. The gap is invisible until the day someone needs it.

All seven are recovered **verbatim** — not reconstructed from the current schema.
`supabase_migrations.schema_migrations.statements` preserves the SQL as applied,
comments included, and each file is byte-identical to what the ledger holds
(md5, trailing whitespace trimmed).

Verified by replay rather than by inspection: `npm run db:verify` stands up a
throwaway PostgreSQL cluster, applies `scripts/pg-shim.sql` (the handful of
platform objects the migrations bind to — `auth.uid`, `auth.users`,
`storage.objects`/`buckets`/`foldername`, the `anon`/`authenticated` roles,
pgcrypto in `extensions`), and runs all 23 migrations in order from empty.
`scripts/pg-introspect.sql` then fingerprints the result per category, and the
same query run against production gives:

| category   |   n | replayed == hosted |
| ---------- | --: | ------------------ |
| bucket     |   2 | ✓                  |
| column     |  90 | ✓                  |
| constraint |  37 | ✓                  |
| enum       |   7 | ✓                  |
| exec-grant |  27 | ✓                  |
| function   |  11 | comments only      |
| grant      | 190 | ✓                  |
| index      |  25 | ✓                  |
| policy     |  34 | ✓                  |
| rls        |  12 | ✓                  |
| trigger    |   3 | ✓                  |

The one difference is two `--` comments in `library_add_version` and three in
`spend_reserve`: the apply path strips comments from function bodies, so the
hosted copies carry none. With comments removed both bodies hash identically to
the repo's — the schemas are the same schema.

The first cut of that fingerprint was blind to nine access-control facts, all of
them the kind a restore most needs checked: `pg_policies` was filtered to
`public`, which excluded the seven policies on `storage.objects` that scope
avatar and media uploads to their owner, and the EXECUTE-grant query inner-joined
`pg_roles`, which silently dropped `PUBLIC` (grantee OID 0 has no role row) — the
grantee that `revoke execute … from … public` on the SECURITY DEFINER routines
exists to remove. Bucket configuration was uncompared too, so a `media` bucket
restored public would have fingerprinted clean. All now included; all match.

Three more facts are recorded that no definition text carries, each of which
would otherwise let a materially different schema compare equal: a policy's
`permissive` flag (RESTRICTIVE composes with `AND`, so one flipped
`storage.objects` INSERT policy denies every upload with both predicates
unchanged), `pg_trigger.tgenabled` (`pg_get_triggerdef` reconstructs the same
`CREATE TRIGGER` whether or not it fires — a disabled
`enforce_prompt_current_version` lets `current_ver` point at another prompt's
version), and function ownership (on a SECURITY DEFINER routine the owner _is_
the privilege set the body runs with). Table ownership is compared for `public`
only: a table's owner bypasses its own RLS unless `FORCE` is set, but the
storage tables belong to `supabase_storage_admin` hosted and to the local
superuser under the shim, so comparing those would differ on every run and mean
nothing.

`tests/unit/model-target-enum.test.ts` loses its hand-written `BASELINE_LABELS`
constant. It existed only because the `create type model_target` was missing, so
the enum replay had to be told where it started instead of reading it — a wrong
starting point would have made every downstream assertion agree with itself. It
now parses the recovered migration, and fails loudly if the base schema ever
goes missing again.

### Fixed — `supabase db push` would have re-run sixteen migrations at production

Not one of the sixteen 2026-07 migrations carried the version the hosted ledger
recorded. They were named with hand-rounded timestamps (`20260730000000_drafts`)
while the ledger held the real apply time (`20260730012046`). The CLI matches on
those leading digits, so from the repo's side every one of them looked unapplied
— and a `supabase db push` would have tried to run them all again, `create table
public.collections` included, against the live database.

All sixteen now carry the ledger's version. The rename is order-preserving:
sorted by the ledger's real timestamps they fall in exactly the sequence the
hand-numbered files did, verified before the rename rather than assumed.

Five citations in `src/` and `scripts/` pointed at the old names — the filenames
carry the reasoning, so `spend.ts` explains the cost cap by naming the migration
that implements it. All updated, and `tests/unit/migrations.test.ts` now fails on
a citation that does not resolve, which a comment otherwise never could. Dated
records (CHANGELOG entries above, `docs/audits/`) keep the names the files had at
the time.

### Fixed — warning text and "Saved ✓" were invisible in the light theme

`--amber` and `--pulse` were declared once, in `:root`, and never overridden for
light. Both are saturated light-tone hues, so as **text** on the light canvas
they landed at **1.41:1** and **1.83:1** — the exact failure the contrast law
(§6) already forbids for `--laser`, reached by the same route. Everything that
warns the user rendered that way: the daily-cap notice, the media budget
readout, the attachment quota, the "storage is nearly full" line — and the only
confirmation that a setting saved.

They take the same fix `--laser` did. `--amber-ink` / `--pulse-ink` are the
text roles: aliased to the raw hue on dark, so **the dark theme is
byte-identical**, and a deep same-hue tone on light (5.4–6.2:1 across page,
glass and surface — the corridor `--accent-ink` and `--flare` already sit in).
`--amber` and `--pulse` stay the fills, which never had a problem: `bg-amber`
and `bg-pulse` carry `--on-laser` at 10:1+ in both themes, which is also why
darkening the tokens in place was not available.

Both light blocks are overridden, not just the explicit one — a token written
into `:root[data-theme="light"]` alone leaves system-light users on the dark
value.

### Fixed — six surfaces stacked opacity on text that had no headroom left

`--silver` and `--flare` are the muted and error roles: on the light canvas they
are already 5.99:1 and 5.64:1, a fraction over AA. A static `opacity-*` on top
spent that many times over, and it was on real content rather than decoration:

| Surface                       | Was            | Now                    |
| ----------------------------- | -------------- | ---------------------- |
| Removed text in every diff    | 2.98 / 3.59    | 4.79 / 5.64            |
| Footer copyright              | 4.26 / 2.58    | 10.03 / 5.99           |
| Footer version line           | 5.40 / 3.13    | 10.03 / 5.99           |
| Filter + drafts facet counts  | 3.86 / 2.71    | 8.09 / 6.68            |
| Media/attachment detail keys  | 4.73 / 3.33    | 8.09 / 6.68            |

(dark / light, on the surface each actually sits on.)

No value was reduced, because there isn't one that works: with `--flare` at
4.79:1 on dark glass, *any* alpha fails. `line-through` was always what said
"removed" — the fade only said it more quietly. The two brand monograms keep
their `opacity-45`: WCAG 1.4.11 exempts a logo or brand name from the 3:1
minimum, and each anchor carries its own `aria-label`.

The per-change review rows dimmed differently. `opacity-60` on the whole `<li>`
multiplied into every child — the struck original fell to **1.85:1**, and the
live Keep/Revert button was dimmed like a disabled control while being the row's
only action. The dim now lands on the one span it is about, the edit that will
not apply, where `--chalk` survives 60% at 5.91 / 4.95.

### Fixed — the edit icon's right edge deleted the draft

`.tap-44` centres a 44px pseudo on its element and bleeds 12px past every edge.
Its own comment records that adjacent extended areas overlap and the later
sibling wins — and the drafts row put two 20px icons 8px apart, both carrying
it. The hit areas overlapped by 16px, so the **rightmost 4px of the visible
pencil opened the delete confirmation**, and Edit's left bleed took the right
4px of the Resume button.

Real padding with an equal negative margin instead: a 28×44 hit box (clearing
WCAG 2.5.8's 24×24 outright) whose layout footprint is still exactly 20×20. The
two now meet at the midpoint of the gap rather than crossing it, and nothing
moved by a pixel.

### Fixed — the crop dialog was not the dialog it declared itself to be

`AvatarCropper` sets `aria-modal="true"`, which tells assistive tech the rest of
the page is not there. Nothing kept Tab inside it: past "Use photo" focus walked
into the settings form behind the scrim and kept going. On close, focus was lost
entirely — the host opens the cropper by clicking a `display:none` file input,
so there was nothing for the browser to return to.

It now traps Tab and hands focus back to the avatar button the user actually
pressed. Panning was also drag-only, which is no path at all for a keyboard
(2.1.1) and none for anyone who can tap but cannot sustain a drag (2.5.7):
arrow keys nudge the image the way the equivalent drag would, and a press that
never travelled centres the point it landed on. Dragging is unchanged.

Two details the trap has to get right, and initially didn't:

- **The dialog root is a leading boundary, not just `first`.** It holds focus on
  open and is `tabIndex={-1}`, so it never appears in the focusables list — and
  Shift+Tab, plausibly the first keystroke a keyboard user makes, walked
  straight out backwards.
- **The trigger is disabled while the upload runs.** "Use photo" sets
  `avatarBusy` and clears the file in one batch, so the button was already
  `disabled` when focus was handed back — and `focus()` on a disabled control
  is silently ignored, stranding focus on `<body>` for a network round trip.
  Restoration now waits for the control to come back, gives up after 10s, and
  stands down the moment the user puts focus somewhere themselves.

### Fixed — `Sheet` had the same leading-boundary gap, and could open unfocused

The app's primary modal overlay shared the trap bug above verbatim. It also
carried a second one: the focus effect is keyed on `open`, but the first render
returns `null` behind an SSR guard, so on that pass `panelRef` is still empty.
Every call site toggles closed → open, which re-runs the effect and hides it —
but a `Sheet` rendered open from its first render never received focus at all.
The effect is now gated on `mounted` as well, with both in the deps.

### Security — `brace-expansion` moves to the releases that enforce `maxLength`

The pinned 1.1.17 / 2.1.3 / 5.0.8 all accept and document a `maxLength` bound
and then fail to apply it on two paths: `expandSequence` was called without it
at all, and the recursive branch accumulated each alternative's results with
`values.push.apply(...)` and no check. 1.1.18 / 2.1.4 / 5.0.9 thread the bound
into the sequence expander and break out of a bounded loop on either limit.

**This does not change the audit report, and no exploit is claimed here.** The
advisory range is still `<=5.0.7`, which matches every 1.x and 2.x release
whatever it contains, so the full-tree count stays at 14 high — all dev-only
(the eslint chain and workbox-build). `npm audit --omit=dev --audit-level=high`,
which is what CI gates, stays at **0** before and after. Several inputs aimed at
the unbounded paths were bounded identically on old and new; the change rests on
the diff, not on a reproduction.

What it does fix is drift: the overrides were already caret ranges, so a fresh
`npm install` anywhere resolved to the newer patches while the lockfile pinned
CI and Vercel to the older ones. The override floors now name the patched
versions. Verified that the regression the earlier per-major keying was
introduced to fix stays fixed — `minimatch@3.1.5` loads its own nested 1.1.18
and `new Minimatch("src/**/*.{ts,tsx}").braceExpand()` still returns both
patterns.

### Fixed — two live regions announced nothing

A `role="status"` element that is inserted already carrying its message is not
reliably announced; a screen reader announces *changes* inside a region it is
already observing. Both of the affected regions were the only feedback their
surface gives — "Saved ✓" after a settings write, and the notice that you are
within 20% of the daily spend cap.

Both are now mounted whether or not they have anything to say. Idle carries
`sr-only` rather than an empty box: every call site sits in a `flex flex-col
gap-*`, where a permanently-present static child would add a gap to each row,
and an absolutely-positioned one is not a flex item.

### Security — server actions no longer rest the whole tenant boundary on RLS

Fourteen mutating server actions wrote with `.eq("id", …)` and nothing else, and
most never established who was calling at all. RLS was the only thing standing
between them and another account's row — and they are reachable by any
authenticated client, not just by the UI.

That is a single point of failure, not a defence: one dropped policy (a table
recreated during a schema change, an `alter table … disable row level security`
run during an incident) turns `deletePromptAction` into a cross-tenant delete,
and nothing in the suite would notice. Every mutation now also carries
`.eq("user_id", …)`, which costs one indexed column.

Two reads mattered as much as the writes, because they return content rather
than a boolean: `getDraftBodyAction` returns a draft's full text and
`getVersionBodyAction` a version's full input and output. Both are now
owner-scoped as well.

`setCollectionAction` gained a real check rather than a predicate: a foreign-key
constraint does **not** consult RLS, so a prompt could be filed into another
account's collection — the FK only asks whether the row exists. It would then
vanish from its owner's filters and belong to a collection they cannot see.

### Security — the authorization gate had no tests, and now has 22

`updateSession` gates every protected surface in the app and was covered by
nothing. A typo in `PUBLIC_PREFIXES` — `/lib` for `/library` — would expose the
library to anonymous users while lint, typecheck, the unit suite and the build
all stayed green.

`tests/unit/middleware-gate.test.ts` asserts the whole branch table: signed
out, signed in, and Supabase not configured, across API routes, protected
pages and public ones. It also pins the thing most likely to break silently —
public prefixes match on a **segment boundary**, so `/authors` is not made
public by `/auth`. That assertion was verified by injecting the bare
`startsWith` bug: it fails, and only it fails.

### Fixed — raw Postgres error text no longer reaches the user

`describeWriteError` defaulted to returning the database's own message, on the
reasoning that "RLS and constraint messages are useful as-is". They are, to an
operator reading a log; to a user they are a toast naming a policy. Postgres
text carries constraint, column, policy and function names, and
`docs/runbooks/migrations.md` already records this passthrough putting
`invalid input value for enum model_target: "gpt_5_6_terra"` in front of a user
— the incident that produced the enum branch, while the general leak stayed.

The default is now the caller's fallback. Known codes (`23505`, `23503`,
`23514`, `42501`) get a sentence someone can act on; everything else gets the
fallback, and the raw text goes to `writeErrorLogLine`, where an operator was
going to look anyway. Thirteen call sites that returned `error.message`
directly now route through it and log the original.

### Fixed — documentation that described a system that does not exist

`docs/architecture.md` still described `vizion-enhance` and `vizion-library`
service-worker caches, which have never existed in the code, and a failed
navigation being served "the precached `/` shell" rather than `/offline.html`.
Both it and `CLAUDE.md` §7 described the provider routes as running on **Edge**
and cited that as the DDoS posture; no route has ever declared
`runtime = "edge"`, and they cannot — they import provider SDKs behind
`server-only`. The service-worker table now matches `sw-src.js`, including why
navigations are `NetworkOnly` rather than unrouted.

### Fixed — a library save was four writes, and three of them could fail silently

Saving an enhancement wrote `prompts`, then `prompt_versions`, then the
`current_ver` pointer, then two `activity_events` — as four independent
statements, only the first two of which had their errors checked at all. A
failure after the first left a prompt with no version and a null pointer: a card
that renders an empty preview and opens to nothing. Worse, the content-hash
duplicate check then had nothing to match on, so the user's retry minted a
*second* orphan rather than being recognised as a repeat. A failure at the
pointer update left the newest version invisible while the UI reported success.

Both paths are now single `library_save_prompt` / `library_add_version` calls,
so the whole save commits or none of it does. `library_add_version` also takes a
row lock on the parent, so two concurrent appends cannot both claim the same
`parent_ver`. Both are SECURITY **INVOKER**: authorization stays in RLS where it
was, rather than moving into a function body.

Audited before applying: 40 prompts, 43 versions, **zero** orphans and zero
cross-prompt pointers — the hole was open but had not yet produced bad data, so
no backfill was needed.

### Fixed — `current_ver` could point at another prompt's version

`restoreVersionAction` looked a version up by id alone. A version id belonging to
a different prompt was accepted: the pointer crossed a prompt boundary while
`preview` silently kept the old text. The sibling `getVersionBodyAction` had
always carried the `prompt_id` predicate; this one hadn't.

The action now carries it and fails closed, and a trigger enforces the same rule
in the database — where a direct PostgREST write cannot route around it. It
fires only on `insert or update of current_ver`, so renames, tags, favourites
and soft deletes don't pay for the lookup.

### Security — a queued offline save could land in someone else's library

IndexedDB is scoped to the **origin**, not to a session, and the outbox replay
resolves the owner from whoever is signed in at flush time. On a shared device:
user A composes offline and the save queues; A signs out; B signs in; the
flusher fires on `visibilitychange` and writes A's prompt into **B's** library,
with B's authorship in the activity feed.

Queued items now record the account that created them and only that account
replays them. Items belonging to someone else — or to nobody, i.e. queued by a
build before this existed — are skipped and *kept*, not deleted: the owner may
sign back in on this device, and destroying unsaved work to tidy a queue is the
worse failure.

The same fix closes a separate bug in the same file: a save the server reports as
a duplicate returned `ok: false`, so the item was never removed. Every `online`
and every `visibilitychange` retried it, forever, and it could never succeed —
the duplicate check was what rejected it. A duplicate now counts as drained,
because the content already being in the library is the end state the replay was
trying to reach.

`editorDraft` leaked the same way through `localStorage`, which is also
origin-scoped. The persisted state now remembers which account it belongs to and
drops the draft when a different one signs in. A first load adopts the account
instead of clearing, so nobody loses a draft that is probably theirs.

### Security — the service worker cached authenticated page HTML

`/library`, `/library/[id]` and `/profile` are server-rendered with the account's
prompts, previews and email, and every navigation was written to `vizion-shell`
under StaleWhileRevalidate — a cache that is origin-wide, not account-scoped.
SWR serves the cached copy *first*, so after a session change a hard navigation
could paint the previous account's content before revalidation replaced it. The
purge on the auth gate was a mitigation, not a fix: it only fires on `/sign-in`,
after the leak window.

Navigations are now routed to **`NetworkOnly`** — not simply left unrouted,
which is the obvious-looking fix and is wrong. `setCatchHandler` only runs for a
request some Workbox route actually handled; a navigation matching no route
never enters Workbox, so offline it fails to the browser's own error page and
`/offline.html` is never served. Deleting the route removed offline navigation
entirely. `NetworkOnly` gives both halves: nothing is written to Cache Storage,
and the request stays inside Workbox so a failure reaches the fallback.

That regression was caught by `shell.spec.ts`'s offline test — the only spec in
the suite that drives the real service worker — after lint, typecheck, 852 unit
tests and the build were all green. **The reverted PR #62 made the identical
removal, with the same incorrect comment claiming the catch handler would still
cover it**, so it shipped the same broken offline fallback.

The unit test now asserts the routing, not just the absence of caching, so the
next attempt fails in milliseconds rather than after a full browser run. Two
traps are recorded in it: a blanket `not.toMatch(/request.mode === "navigate"/)`
over the whole file would delete the fallback (`setCatchHandler` tests the same
expression), and asserting only that navigations aren't cached misses that they
must still be routed.

### Security — concurrent requests could walk past the daily cost cap

Both model routes read a usage window, called a provider, and only then wrote
the ledger row. The whole provider call sits between the read and the write, so
every request that started inside that gap saw the same balance and passed. The
in-memory burst guard in front of it is per serverless instance and cannot
converge on a platform that spins a fresh instance per concurrent invocation.

Admission now happens in `spend_reserve`: the rate limit, the cap check and a
hold are taken together under one per-user advisory lock, so a concurrent
request sees the hold even though its ledger row does not exist yet. The run
then settles (recording the real cost and dropping the hold) or releases. Holds
older than five minutes are swept, so a killed function or a vanished client
cannot eat headroom until midnight.

**On the sizing, which is where the first attempt at this went wrong.** PR #62
reserved each request's theoretical worst case — the target's full output
ceiling at list price. Against the shipped $2.00/day cap that meant Fable 5 at
max effort reserved $3.20, more than the entire cap, so **every** request was
refused on an empty ledger, permanently; Opus 5 on Auto allowed two
enhancements a day. Measured against this project's real history the hold was
31x the largest request ever made (avg $0.014, p95 $0.052, max $0.102, and
$1.58 of spend across 109 events all time). That is why #62 was reverted.

The error was conceptual: a reservation is a **concurrency guard**, not a
worst-case bound. It only has to be large enough that parallel requests cannot
collectively overshoot. Sized as a worst case, the cap starts rejecting on the
reservation instead of on real spend.

So the hold is now derived from what the account actually spends — p95 of its
own recent events with 3x headroom — and then clamped to a tenth of the cap.
The clamp is the load-bearing part: it makes it structurally impossible for a
hold to approach the cap, whatever later happens to list prices, output
ceilings or the roster. On current data that is a $0.155 hold against a $2.00
cap. A brand-new account holds the $0.01 floor.

Admission also stays on committed spend (`today + pending >= cap`) rather than
`today + pending + this hold > cap`, which is the specific comparison that
refused the first request of the day.

Two further corrections to that design: `spend_settle` writes the ledger row
**unconditionally**, because a run slow enough to have been swept still spent
the money and a spend the cap cannot see is worse than a stale hold; and the
sizing lives in the database next to the account's history and the clamp, not
in application code. `tests/unit/spend-atomicity.test.ts` pins all four
decisions, and each assertion was checked to fail against the reverted version.

`usage_window()` is no longer called by the application. It is left in place for
now rather than dropped in the same change that stops using it.

### Security — the daily cost cap could be switched off from the browser

`usage_window()` derives `today_cost` from `sum(cost_usd)` over `usage_events`,
and both model routes admit a request only while that sum is under the cap. The
row feeding it was writable by the account it constrains: `authenticated` held
INSERT, `usage_insert_own` accepted any row whose `user_id` matched, and no
constraint bounded the amount. So a signed-in client holding the public anon key
could post one row with a negative `cost_usd`, drive `today_cost` permanently
below the cap, and spend without limit on the server's provider keys across all
twelve. Magic-link sign-in creates accounts by default (`shouldCreateUser`
defaults to `true`), so the prerequisite was an email address.

Audited before the fix: 109 rows, zero negatives — the hole was open, never
exploited.

Two independent controls now close it. `usage_events` carries a CHECK constraint
(`cost_usd`, `token_in`, `token_out` all `>= 0`), so a negative amount cannot
exist at any privilege level; and the routes write through `record_usage()`, a
SECURITY DEFINER function that takes the owner from the verified JWT and
re-validates the amounts, so the direct table grant can be withdrawn.

That withdrawal is a **second** migration
(`20260730210000_usage_ledger_revoke.sql`), held back until this release was
live: the previous build wrote the ledger with a direct INSERT, and revoking
the grant underneath it fails every write with 42501 — which the route swallows
into a `console.error` while still returning 200, so spend would stop being
counted and the cap would quietly stop working. It was applied to the hosted
project after the production deploy of this release, in that order. The rule
stays in that file's header for any environment replayed from scratch, and is
pinned by `tests/unit/usage-ledger.test.ts`.

`usage_events` is now reachable from a client for SELECT only — which is what
backs the composer's own cap readout. INSERT flows exclusively through
`record_usage()`; UPDATE and DELETE remain denied by the absence of any policy
*and* the absence of the grant. Verified against the live project under the
`authenticated` role with real JWT claims, every probe rolled back: direct
INSERT `DENIED (42501)`, `record_usage` allowed, `SELECT` allowed,
`usage_window` allowed, ledger unchanged at 109 rows.

Note for whoever re-lands the reverted atomic-spend work (#62): `spend_reserve`
reads the same `sum(cost_usd)`, so it would have inherited this hole. The
constraint is what makes that sum trustworthy.

### Fixed — the Thinking pill rendered two points larger than the Target pill above it

Both rails asked for `text-sm`. Only one got it. Thinking was a native
`<select>`, and `globals.css` floors `input, select, textarea` at 16px on iOS —
Safari zooms the page when a focused control computes under 16px and rarely
zooms back out — with `!important`, which out-specifies `text-sm`. So the
select's "Auto" rendered 16px directly beneath a 14px "Opus 5", in two rails
that are read as a pair.

The floor is invisible to CI by construction: it sits behind a
`-webkit-touch-callout` gate, which is an iOS-only filter precisely because the
property does not exist elsewhere (see `docs/runbooks/ios-verification.md`).

Thinking is now a trigger + sheet, the move `TargetPicker` already made for the
same reason — a `<button>` is outside the rule's scope entirely. Both triggers
take **one** class string (`RAIL_TRIGGER_CLASS`), so type size, padding, height
and hover treatment cannot drift apart again, and the sheet buys the room to say
what Auto actually does, which an `<option>` cannot. `tests/unit/thinking-rail.test.tsx`
pins the parity and the absence of a replaced form control in the rails.

### Changed — the attach control reads as an upload again

The capability line ("images are analyzed; video contributes its first
frame…") sat permanently under the media rail as a two-line paragraph, and
paying for that space had squeezed the attach control down to a 12px text link
with a 📎 emoji — the one thing in the tray that has to look like a button.

The words now live behind a `?` in the rail, as a tap-toggled panel (in flow,
because the composer chassis is `overflow-hidden` and would clip a floating
one). Attach is a real bordered pill at the rails' `text-sm` with an upload
mark, and the `Originals: stored` dial stays exactly where it was, one step
smaller and quieter, since it reports a standing preference rather than an
action.

### Fixed — Qwen3.7 Max ran into a 400 on every request, and had no thinking selector

Two independent mistakes, both of which made "Max" look like the problem when it
never was.

`max_tokens` was the shared 16k default from the OpenAI-compatible factory, but
**DashScope caps `qwen-max` at 8192** and rejects anything higher — so every Qwen
run failed with `400 InternalError.Algo.InvalidParameter: Range of max_tokens
should be [1, 8192]` before a token was generated. The ceiling is now a
per-provider declaration (`maxTokens`), because it is a fact about the API, not a
preference.

The composer also showed **no Thinking rail** for this target. Qwen's reasoning
knob is a token BUDGET (`enable_thinking` + `thinking_budget`), not an effort
word, and the ladder maps onto it cleanly — so the target now offers
low · medium · high · xhigh · max, each mapped to a budget at or under half the
8192 ceiling so reasoning cannot consume the room the JSON envelope needs.
**"Max" in `Qwen3.7 Max` is the model TIER** (Alibaba's flagship, beside Plus and
Turbo) and says nothing about reasoning depth — the same class of mistake as
inventing a `gemini-3.6-thinking` model string, in reverse.

The body builder is now a pure, exported function (`buildCompatBody`), tested
without SDK mocking, so both facts are pinned by tests rather than by comments.

### Changed — the composer's Shape and Depth rails stop clipping their own labels

Beside a caption there was ~300px of a 390px screen for five multi-word shape
labels, and the intrinsically-sized pill overflowed it: the chassis clipped
mid-segment and "Few-shot" wrapped to two lines, making the rail visibly taller
than the Target and Thinking rails above it.

Both rails now stack — caption above a full-width control — and `Segmented` grew
a `fill` variant that lays its options out as equal `1fr` columns with ModeRig's
cell type. Every label fits one line at 390px (measured: five 65px cells, no
scroll, 44pt tap targets intact), and the active segment keeps Void ink on a
Laser fill.

### Changed — the full-tree audit is now a gate, not a printout

`npm audit || true` printed 14 high entries and passed regardless, so a genuinely
new advisory would have scrolled past among the known ones. `npm run audit:check`
(`scripts/check-audit.mjs`) replaces it and fails on any advisory that is not a
documented exemption.

**On the 14 entries: they are one advisory, and it is a false positive.** All of
them fan out from GHSA-mh99-v99m-4gvg on `brace-expansion` (range `<=5.0.7`); the
other twelve package names are "depends on a vulnerable version of…" paths. The
fix — CVE-2026-14257's `EXPANSION_MAX` / `EXPANSION_MAX_LENGTH` limits — **was
backported to 1.1.17 and 2.1.3**, but the advisory range was never narrowed, so
patched releases still match it.

It also cannot be removed. `eslint@9` depends on `minimatch@^3.1.5`, and
minimatch@3 does `require('brace-expansion')` and **calls** the result, while
5.0.8 exports an object — so a 1.x is the only patched shape that consumer can
use. **`npm audit` cannot reach 0 on the full tree while this project uses ESLint
9**, and forcing it to (the previous blanket `^5` override) broke every braced
glob in the tree instead.

So the exemption is verified rather than asserted: the script re-checks that every
installed copy of `brace-expansion` — at any nesting depth — actually contains the
limits, and fails if one does not. An allowlist that cannot rot into a blanket
ignore. Both failure modes are covered by negative tests: an unpatched copy fails
the gate, and a non-exempt advisory fails the gate. The first of those caught a
real bug in the script's own directory walk, which had been verifying only the
root copy.

The production gate (`npm audit --omit=dev --audit-level=high`) stays at **0** and
is unchanged.


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

**Tradeoff, taken deliberately.** The advisory range is `<=5.0.7`, so every 1.x
and 2.x release matches it regardless of content. The full-tree `npm audit`
therefore reports 14 high entries again, every one in dev tooling (the eslint
chain and workbox-build), none in shipped code. CI gates
`npm audit --omit=dev --audit-level=high`, which stays at **0**, and the full-tree
step was already advisory-only (`|| true`). The alternative was keeping a silently
broken glob engine in exchange for a tidier report about packages that never
reach production.

The pinned 1.x/2.x releases do carry the fix — see "the full-tree audit is now a
gate" above, which supersedes this entry's original claim that no patched 1.x or
2.x existed. The true statement is narrower: no patched release falls *outside*
the advisory's range, because the range was never narrowed after the backport.


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

- **Auto routing.** VIZION picks the model per run from a documented table,
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
  and 2.x lines have no patched release <sup>[corrected below]</sup>, and that
  single package was the root
  cause of fourteen reported entries cascading up through `minimatch` →
  `@eslint/config-array` / `@eslint/eslintrc` → `eslint` → `eslint-config-next`
  and its plugins, and through `filelist` → `jake` → `ejs` →
  `@trickfilm400/rollup-plugin-off-main-thread` → `workbox-build`.

No application code changed. Verified beyond the standard gate: the icon
matrix was regenerated under sharp 0.35 and is **pixel-identical** to the
committed PNGs (raw-buffer compare, max channel delta 0 — only PNG container
bytes differ, so the shipped assets are left untouched), and the service
worker still precaches its 21 entries under esbuild 0.28.

> **Corrected after release.** "The 1.x and 2.x lines have no patched release"
> was wrong. CVE-2026-14257's `EXPANSION_MAX` / `EXPANSION_MAX_LENGTH` limits
> were backported to **1.1.17** and **2.1.3**; the advisory's `<=5.0.7` range
> was simply never narrowed, so patched releases still match it. The blanket
> `^5` override this entry describes was also actively harmful — it broke brace
> expansion through `minimatch@3` — and is superseded by the per-major keys in
> the Unreleased section.

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
