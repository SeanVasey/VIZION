# VIZ(IO)N — Unified Enhancement Evaluation (Stage 1)

**Audit date:** 2026-07-27 · **Repository commit:** `3d32cd95e85c1c3077e46364521fe148cbbc5aa4`
**Production revision:** `dpl_EZ7D8SESK48iApNetb7yN7TX6sVE` · **Product version:** `0.2.1`
**Stage:** 1 — evaluation only. No implementation has been performed.

> **Prompt conflict, declared.** The Stage-1 authorization boundary says "must not
> commit, push, or touch PRs." It also names in-repo artifact paths (`docs/audits/…`),
> and Phase −1 expects those artifacts to persist for a later run to import. This audit
> runs in an ephemeral container, so uncommitted files are destroyed with it. The
> operator was asked and chose to commit and push these two artifacts and open a draft
> PR. **No product file was modified** — the diff is two new documents. Recorded here
> per the prompt's own failure policy.

---

## 1. Executive decision

**Readiness: not ready for a v1.0 release. Ready to continue development.** VIZION at
this commit is a well-built product with a small number of structural defects that are
serious in kind rather than numerous. The verification gate is green — lint, typecheck,
172 unit tests across 19 files, production build, and `npm audit` all pass at the pinned
commit. The engineering craft is visibly high: `tasks/lessons.md` is one of the better
post-incident records this reviewer has seen in a repository of this size, and much of
what the source proposals ask for is **already built**. The blockers below are
concentrated in three places — client-side account isolation, spend enforcement, and the
absence of the database from source control.

### Five highest-value approvals

1. **DB-01 — Reproducible database baseline.** The repository contains no `CREATE TABLE`,
   no `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY`, and no `CREATE FUNCTION`. The
   entire authorization model, and `usage_window` — the only durable spend guardrail —
   exist solely inside one hosted Supabase project. This is the single highest-leverage
   item in the audit because six other findings cannot be tested or fixed without it.
2. **SAFE-01 — Account-scope local state.** A shared device leaks the previous user's
   draft prompt and, worse, **replays their queued save into the next user's account**.
   This is a cross-account write, not merely a disclosure.
3. **COST-01 — Atomic spend enforcement.** The daily cap is a read-then-act check with no
   reservation and no per-request ceiling. Demonstrated overshoot on the default $2 cap
   is roughly 32×.
4. **CACHE-01 — Private authenticated HTML in Cache Storage.** The service worker's one
   runtime route caches authenticated navigations stale-first; the purge only fires when
   `/sign-in` loads as a full navigation.
5. **RELEASE-01 — Expanded release gates.** `check:db-enum`, the guard written
   specifically after the incident where all five gates passed green while four models
   failed every database write, is _still not wired into CI_.

### Release blockers (P0)

`DB-01` · `SAFE-01` · `COST-01` · `CACHE-01` · `SAFE-02` · `DIFF-01`

Every one carries a concrete failure scenario, a remediation direction, and a required
regression test in §8. Four of the six concern data belonging to the wrong person or
money leaving without a bound — the categories the scoring rules say may override the
priority index.

### Best quick wins (high value, ≤1 day, near-zero change risk)

| ID           | Change                                                          | Why it is cheap                                                                                |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **APPLE-01** | Link the 10 splash PNGs that already ship                       | The assets exist and are referenced **zero** times. Work already paid for, delivering nothing. |
| **PWA-06**   | `orientation: "portrait"` → `"any"`                             | One manifest line. Currently contradicts WCAG 2.2 SC 1.3.4 and the stated iPad target.         |
| **PWA-08**   | Add a media-qualified light `theme-color`                       | One tag. Removes wrong-coloured browser chrome on every light-theme cold load.                 |
| **SET-02**   | Disable _Save changes_ until dirty                              | The email field in the same file already does exactly this — copy the pattern.                 |
| **LIB-03**   | Derive titles from the **improved output**                      | Same truncation helper, no new cost. Today a broken prompt yields a broken title.              |
| **GOV-01**   | Move security contact to GitHub Private Vulnerability Reporting | Publicly visible breach of the §6 brand-separation guardrail.                                  |
| **DISC-01**  | Delete or implement `npm run test:int`                          | Points at a directory that does not exist; always fails.                                       |

### Attractive but rejected, or deliberately down-ranked

- **PERF-02 (WebGPU) — Rejected.** PR-4 needed updating: `navigator.gpu` **is** now
  available on Apple platforms (Safari 26 / iOS 26). But the real workload is one canvas
  frame draw plus a palette quantize, and `createImageBitmap` has served that since
  Safari 15. Requiring iOS 26 to accelerate what iOS 15 already does inverts the reach
  argument. The ruling's _test_ — profile first, reject without measured benefit — is
  not met.
- **PWA-02 (share intake) — P3.** Verified against BCD: `share_target` is
  `safari: false`, `safari_ios: false`. It cannot work on the stated primary platform.
  **PWA-05 (paste affordance)** serves the same job everywhere and is ranked above it.
- **LIB-05 (version comparison) — Already implemented.** Arbitrary version-to-version
  diffing with restore ships today. Building it again would be the exact duplication
  this audit exists to prevent.
- **EXP-01 / EXP-04** — both double spend per action while COST-01 shows the cap cannot
  hold single runs. Blocked on COST-01 as a hard prerequisite.
- **POLISH-04 (OLED black)** — every glass and hairline value is tuned against `#0f1012`;
  A11Y-01 has not yet measured the two existing themes, let alone a third.

### On the priority index

The formula ranks **SET-02 at 15.50 and POLISH-03 at 15.00 above COST-01 at 6.86**.
That is the formula behaving as designed — cheap, safe, broad-reach fixes score well —
and it is precisely the case the scoring rules anticipate: _"a cosmetic quick win never
outranks a demonstrated cross-account, billing, privacy, corruption, or data-loss
blocker."_ **The P0 set is therefore assigned by override, not by index**, and the
roadmap in §7 sequences by gate first and index only within a gate.

### Implementation order

**Gate 0** DB-01 → SAFE-01 → CACHE-01 → SAFE-02 → COST-01 → DIFF-01 (DB-01 first: it
unblocks testing for the rest). **Gate 1** provider truth and output honesty. **Gate 2**
mobile task flow. **Gate 3** Library, Settings, iPad. **Gate 4** measured polish. Full
sequencing, scope, and parallelisation in §7.

---

## 2. Product thesis

**VIZION should be a prompt preflight instrument, not a model playground.** The user
arrives with an imperfect prompt and one question: _make this better before I spend it
somewhere else._ Everything that serves that single action is core; everything that
turns the app into a place to compare models is a distraction the north star explicitly
warns against.

The evidence supports this reading. The strongest engineering in the codebase is
concentrated exactly where the thesis says it should be: `OUTPUT_CONTRACT`, the
shape-preserving mode split, and the JSON-envelope streaming scanner are all defences of
_transformation quality_. This audit's own 20-call harness (§3) found that contract
holding on every case — including returning "What is the capital of France?" unchanged
rather than answering it, and preserving an already-structured prompt byte-for-byte.
**That is the product working.**

### The six concepts, and how they actually relate today

The prompt asks for six separable concepts. VIZION currently has **three fields doing
six jobs**:

| Concept                  | Where it lives today                    | Honest status                        |
| ------------------------ | --------------------------------------- | ------------------------------------ |
| Transformation intent    | `mode` — six locked values              | ✅ Clean, well-defended, unit-tested |
| Output destination       | `target`                                | ⚠️ Fused with optimizer              |
| Optimizer model          | `target`                                | ⚠️ Fused with destination            |
| Quality/reasoning preset | `thinkingLevel`                         | ⚠️ Exists for only 8 of 16 targets   |
| Attachment role          | _nothing_ — manual "Insert into prompt" | ⚠️ Implicit                          |
| Output contract          | `OUTPUT_CONTRACT`                       | ✅ Locked and enforced               |

The `target` conflation is visible as a live inconsistency rather than a theoretical one:
`buildSystemPrompt` **substitutes `TARGET_CONVENTIONS` out entirely** for `polish` and
`clarify`, so for those two modes the target silently stops meaning "destination" and
means only "which model runs and what it costs." The same control means two different
things depending on the mode beside it.

**Which proposals strengthen the thesis:** PROD-07 (say what media analysis actually
does), PROD-05 (know which models can run), SET-04 (users own their data), UX-06's
remaining gaps, EXP-02 (refine what you just got), and every Gate 0 item — because
trust in a preflight instrument is entirely a function of it not losing or misreporting
your work.

**Which dilute it:** EXP-01 (A/B model comparison), EXP-04 (destination variants),
PWA-07 (iPad workspace), and PROD-02's full Auto-routing engine. Each pulls toward
"model playground." PROD-02's _modest_ form — a labelled recommended default — serves
the thesis; its ambitious form does not.

**PROD-01 is the pivot.** It scores poorly (4.80) because it is expensive and touches
the `model_target` enum, which `lessons.md` documents as the most incident-prone surface
in the project. But four other proposals are formally blocked on it. The recommendation
in §8 is the additive path — a **new nullable `destination` column** defaulting to the
existing target — which buys the separation without an enum rename.

---

## 3. Evidence and limitations

### What was verified, and how

| Baseline fact                             | Method                 | Result                                                                                       |
| ----------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| Repository commit                         | `git rev-parse HEAD`   | `3d32cd95e85c1c3077e46364521fe148cbbc5aa4`, clean tree                                       |
| Production revision                       | Vercel deployment API  | `dpl_EZ7D8SESK48iApNetb7yN7TX6sVE`                                                           |
| **Production ↔ commit**                   | `meta.githubCommitSha` | **Identical to local HEAD** — production evidence attributes directly to the reviewed commit |
| Product version                           | `package.json`         | `0.2.1` — matches the reported version                                                       |
| Runtime shape                             | `lambdaRuntimeStats`   | `{"nodejs": 6}` — **zero edge functions**                                                    |
| `lint`                                    | `npm run lint`         | exit 0                                                                                       |
| `typecheck`                               | `npm run typecheck`    | exit 0                                                                                       |
| `test`                                    | `npm run test`         | **172 passed, 19 files**                                                                     |
| `build`                                   | `npm run build`        | exit 0                                                                                       |
| `npm audit --omit=dev --audit-level=high` | gating audit           | exit 0                                                                                       |
| `npm audit` (full tree)                   | advisory               | **0 vulnerabilities**                                                                        |
| Production HTML/head                      | `curl` + parse         | `startup-image` occurs **0 times**; single non-media-qualified `theme-color`                 |

### Platform rulings PR-1…PR-7 — confirmed or overturned

Verified against **MDN browser-compat-data 8.0.8** and **caniuse-db**, retrieved
2026-07-27. MDN's rendered compat tables are JavaScript-generated, so the machine-readable
data files were used rather than the pages.

| Ruling                                                     | Verdict                                   | Evidence                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR-1** WebKit has no Vibration API                       | ✅ **Confirmed**                          | `Navigator.vibrate`: `safari: false`, `safari_ios: false`. caniuse agrees through Safari 27 / iOS 26.5 including TP. Chrome 32+, requiring a user gesture since Chrome 60.                                                                                                 |
| **PR-2** Web Share Target is not a WebKit feature          | ✅ **Confirmed**                          | `manifests.webapp.share_target`: `safari: false`, `safari_ios: false`; Chrome 89 desktop / 76 Android.                                                                                                                                                                     |
| **PR-3** `navigator.share` works on iOS                    | ✅ **Confirmed**                          | `safari: 12.1`, `safari_ios: 12.2`. caniuse `y` through current. Already shipped in VIZION and correctly feature-detected.                                                                                                                                                 |
| **PR-4** WebGPU is a web API, profile before adopting      | ⚠️ **Updated, conclusion upheld**         | **`navigator.gpu` is now `safari: 26`, `safari_ios: 26`** — the availability premise has changed. But `createImageBitmap` is Safari 15 and `OffscreenCanvas` Safari 16.4, so the simpler alternatives reach far more devices. Reject stands on workload, not availability. |
| **PR-5** Splash links need correct media queries           | ✅ **Confirmed, and moot at this commit** | Zero links exist in deployed HTML, so no media query can be wrong yet. Becomes binding the moment APPLE-01 ships.                                                                                                                                                          |
| **PR-6** Guest access must ride Supabase anonymous sign-in | ✅ **Upheld, not exercised**              | No guest path exists. PROD-08's recommendation is a _precomputed_ showcase, which needs no anonymous session at all.                                                                                                                                                       |
| **PR-7** Taxonomy immutable without explicit approval      | ✅ **Honored**                            | UX-02 and PROD-01 are evaluated freely and **not approved for implementation** here.                                                                                                                                                                                       |

One additional platform check, relevant to PWA-01: `SyncManager` and
`PeriodicSyncManager` are both `safari: false` / `safari_ios: false`. Background Sync is
genuinely unavailable on Apple platforms — so `docs/architecture.md` advertising it is
doc drift for a feature the service worker does not implement on any platform.

### Semantic evaluation actually executed (PROD-04)

The operator authorized a bounded paid evaluation. Environment constraints shaped it:
**only `OPENAI_API_KEY` is present — there are no Supabase credentials**, so the
application cannot boot or authenticate here and the HTTP route could not be exercised.

The harness therefore tested the thing PROD-04 is actually about — the **prompt
contract** — by bundling the real `buildSystemPrompt()` from
`src/lib/providers/formatters.ts` and driving it against the **real production default
model** (`gpt-5.6-sol`), mirroring the exact request shape in `src/lib/providers/openai.ts`
(`json_object`, `max_completion_tokens: 16_000`).

- **20 calls · 9,002 input / 3,980 output tokens · $0.1047**
- **0 envelope failures** — `parseEnhancePayload` accepted every response
- **0 assertion failures** across: no role labels, shape preservation for
  polish/clarify, existing structure retained, polish length bounded, injection
  resistance, does-not-answer

Qualitative spot-checks: Polish returned an already-structured prompt **byte-identical**
(161 → 161 chars); `"What is the capital of France?"` came back unchanged rather than
answered; Spanish input stayed Spanish with only a word-order correction; and a direct
prompt injection was _transformed as a prompt_ rather than obeyed.

**This materially changed PROD-04's verdict** — from an assumed quality problem to
_"Already implemented but needs hardening."_ The contract is sound today; what is missing
is the regression net, and `lessons.md` records two prior production incidents caused by
edits to exactly this text.

### Confidence boundaries — what this audit does **not** know

Nothing below was tested. Each is recorded in `blockedValidation` with the smallest safe
follow-up.

1. **All Apple device behaviour.** No Apple hardware or simulator. Every claim about
   iPhone, installed PWA, iPad, or macOS rendering is derived from source and
   specification, never observation.
2. **VoiceOver and screen-reader behaviour.** No assistive technology available.
3. **All authenticated behaviour** — RLS enforcement, ledger writes, rate limiting, the
   cost cap in operation, Library and Profile flows. No Supabase credentials.
4. **COST-01's overshoot is established by code path, not by execution.** The 32×
   figure is arithmetic from verified constants, not a measured experiment.
5. **DIFF-01's blow-up is likewise analytical.** The O(n·m) table is verified in source;
   no benchmark was run.
6. **Hosted schema reality.** Whether RLS policies, foreign keys, and triggers match the
   documentation cannot be checked — and per DB-01 they exist nowhere in source control.
7. **Deployed environment overrides.** Whether `PRICE_*` and `MODEL_*` env values match
   registry defaults is unreadable from here; `lessons.md` records a stale price
   under-counting the cap 6×.

**Facts, measurements, and inference are kept separate throughout.** Where a claim rests
on reading code rather than observing behaviour, the ledger's `evidence` array cites the
file and line, and the verdict is scored accordingly.

---

## 4. Baseline architecture — what already exists

Recorded so that nothing in this audit is built twice.

**Shape.** 92 TypeScript/TSX files. Next.js 15.5 App Router, React 19, Tailwind 3.4 with
CSS-variable tokens, Zustand 5, TanStack Query 5, Supabase SSR. Five page routes, two
model route handlers, three auth handlers, one middleware.

**Routes.** `(app)` group — `/enhance`, `/library`, `/library/[id]`, `/profile` — is
auth-gated in the layout via `getUser()`. `(auth)` group — `/sign-in`, `/set-password`.
All five pages are **server components**; interactivity is delegated to 27 client
children. `src/middleware.ts` refreshes the session and gates routes, correctly using
`getUser()` rather than trusting `getSession()`.

**Provider layer.** 16 targets across 12 providers behind a fan-out adapter. Dedicated
adapters for Anthropic, OpenAI, Google, xAI, Mistral; a factory serving seven
OpenAI-compatible providers. **`computeCost` is the single pricing source for both
display and the ledger** — correctly not duplicated. Streaming is SSE frames over a POST
body, with a ~90-line pure scanner extracting the `output` field incrementally from the
`{output, rationale}` envelope (ADR 0002), and `parseEnhancePayload` remaining
authoritative on the full text.

**Prompt system.** Six locked modes. `SHAPE_PRESERVING = {polish, clarify}` swaps
`TARGET_CONVENTIONS` for `FORMAT_PRESERVATION`. `OUTPUT_CONTRACT` forbids role-scripted
transcripts. All defended by negative-substring unit tests across every mode × target.

**Data.** Seven tables — `profiles`, `oauth_identities`, `prompts`, `prompt_versions`,
`activity_events`, `usage_events`, `media_assets`. Seven enums. One function,
`usage_window`. **None of it is in source control** (DB-01) — the seven migrations are
all single-statement `ALTER TYPE`.

**Client state.** Exactly one Zustand store, persisted to the single localStorage key
`vizion.ui.v1` with a debounced adapter, a version-5 migration chain, and `partialize`
covering theme, mode, target, thinking levels, and `editorDraft`. **Zero `useQuery` calls
exist** — TanStack Query is configured but effectively unused (DISC-08).

**PWA.** Hand-authored Workbox SW bundled by esbuild into a classic IIFE. **One** runtime
route (StaleWhileRevalidate over navigations plus script/style/font/image), precache of
19 icons + manifest + `offline.html`, catch handler falling back to `offline.html`.
IndexedDB outbox `vizion-outbox` with re-entrancy-guarded replay on
mount/`online`/`visibilitychange`. `navigator.storage.persist()` is requested.

**Already shipped that proposals ask for — do not rebuild:**

- `navigator.share` on results, feature-detected with clipboard fallback (Y-05)
- Markdown / JSON / plain-text export (Y-05)
- Arbitrary version-to-version comparison with restore (X-C1, LIB-05)
- Submitted-run snapshotting so post-run selector changes cannot relabel a result (R-8)
- The `.tap-44` hit-area utility, correctly applied at three sites
- Theme-aware ink tokens implementing the contrast law, with `contrastRatio` unit-tested
  against the prohibited Laser-on-Chalk pair
- `usage_events` cost ledger with careful abort-path estimation in a `finally` block
- Tag editing with optimistic update and rollback
- Per-target thinking ladders validated at the route and narrowed again per adapter

**CI.** `lint · typecheck · generate:icons · test · build · playwright e2e ·
npm audit (gating) · npm audit (advisory)` on Node 22. A separate release workflow tags
and publishes from `CHANGELOG.md`.

---

## 5. Master ledger

62 canonical IDs, each appearing exactly once. Sorted by decision, then priority index.
Score columns: **Imp**act · **R**ea**ch** · **R**i**sk** reduction · **Fit** ·
**App**le value · **Ev**idence confidence · **Eff**ort · **Chg** risk · **PI** priority
index. The full record — evidence arrays, arguments for and against, simpler
alternatives, and the evidence that would change each decision — is in
`VIZION-enhancement-ledger.json`.

| ID             | Sources                              | Verified | Validity                                    | Decision   | Conf | Imp | Rch | Rsk | Fit | App | Ev  | Eff | Chg |  **PI**   | Depends on                 |
| -------------- | ------------------------------------ | :------: | ------------------------------------------- | ---------- | :--: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-------: | -------------------------- |
| **CACHE-01**   | —                                    |    Y     | Confirmed                                   | **P0**     |  H   |  4  |  4  |  5  |  4  |  4  |  5  |  2  |  2  | **11.75** | SAFE-01                    |
| **SAFE-02**    | Y-10 (queue-status half)             |    Y     | Confirmed                                   | **P0**     |  H   |  4  |  4  |  5  |  4  |  2  |  5  |  2  |  2  | **11.25** | SAFE-01                    |
| **DIFF-01**    | —                                    |    Y     | Confirmed                                   | **P0**     |  H   |  4  |  3  |  5  |  3  |  3  |  5  |  2  |  2  | **10.5**  | —                          |
| **SAFE-01**    | —                                    |    Y     | Confirmed                                   | **P0**     |  H   |  5  |  5  |  5  |  4  |  3  |  5  |  3  |  3  |  **8.5**  | —                          |
| **DB-01**      | standing 22P02 discipline            |    Y     | Confirmed                                   | **P0**     |  H   |  5  |  5  |  5  |  5  |  1  |  5  |  4  |  2  |  **8.5**  | —                          |
| **COST-01**    | R-07 (transaction semantics)         |    Y     | Confirmed                                   | **P0**     |  H   |  5  |  4  |  5  |  4  |  2  |  5  |  4  |  3  | **6.86**  | DB-01, DB-02               |
| **GOV-01**     | R-04                                 |    Y     | Confirmed                                   | **P1**     |  H   |  2  |  2  |  3  |  4  |  1  |  5  |  1  |  1  | **15.0**  | —                          |
| **RELEASE-01** | R-08, R-05 (CI gate), G7 (CI parity) |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  4  |  5  |  4  |  4  |  5  |  3  |  1  | **11.75** | DB-01, A11Y-01, APPLE-01   |
| **APPLE-01**   | X-A1, G7                             |    Y     | Confirmed                                   | **P1**     |  H   |  3  |  3  |  2  |  3  |  5  |  5  |  2  |  1  | **11.67** | RELEASE-01                 |
| **PROD-04**    | —                                    |    Y     | Already implemented but needs hardening     | **P1**     |  H   |  4  |  4  |  4  |  5  |  1  |  5  |  3  |  1  | **11.0**  | —                          |
| **PROD-07**    | Y-L4 (dependency)                    |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  3  |  3  |  4  |  1  |  5  |  2  |  2  |  **9.5**  | —                          |
| **PWA-01**     | X-T1 (premise corrected)             |    Y     | Already implemented but needs hardening     | **P1**     |  H   |  4  |  4  |  4  |  4  |  4  |  5  |  3  |  2  |  **9.0**  | CACHE-01, SAFE-01, SAFE-02 |
| **PROD-06**    | —                                    |    Y     | Partially confirmed                         | **P1**     |  H   |  3  |  3  |  4  |  3  |  1  |  5  |  2  |  2  | **8.75**  | —                          |
| **PROD-05**    | —                                    |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  4  |  4  |  4  |  2  |  5  |  3  |  2  |  **8.6**  | META-01                    |
| **SET-04**     | —                                    |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  4  |  4  |  4  |  1  |  5  |  3  |  2  |  **8.4**  | SET-01, MEDIA-01           |
| **META-01**    | —                                    |    Y     | Partially confirmed                         | **P1**     |  H   |  3  |  4  |  4  |  4  |  1  |  5  |  3  |  2  |  **7.8**  | PROD-05                    |
| **A11Y-01**    | Y-11, R-11, R-05 (audit surface)     |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  5  |  4  |  4  |  4  |  4  |  4  |  2  | **7.67**  | UX-02, UX-08, PWA-06       |
| **REV-01**     | Y-06, X-C1 (lineage)                 |    Y     | Partially confirmed                         | **P1**     |  H   |  4  |  3  |  3  |  4  |  1  |  5  |  3  |  2  |  **7.6**  | —                          |
| **A11Y-02**    | Y-12 (partial)                       |    Y     | Partially confirmed                         | **P1**     |  H   |  3  |  4  |  3  |  3  |  4  |  5  |  3  |  2  |  **7.6**  | POLISH-01, UX-06           |
| **DB-02**      | R-01 (data-track adjacency)          |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  4  |  4  |  4  |  1  |  5  |  3  |  3  |  **7.0**  | DB-01                      |
| **MEDIA-01**   | —                                    |    Y     | Confirmed                                   | **P1**     |  H   |  4  |  3  |  4  |  3  |  1  |  5  |  3  |  3  | **6.33**  | DB-01                      |
| **PROD-01**    | —                                    |    Y     | Confirmed                                   | **P1**     |  H   |  5  |  5  |  3  |  5  |  2  |  5  |  5  |  5  |  **4.8**  | —                          |
| **SET-02**     | X-B4                                 |    Y     | Confirmed                                   | **P2**     |  H   |  3  |  3  |  2  |  3  |  1  |  5  |  1  |  1  | **15.5**  | SET-03                     |
| **POLISH-03**  | X-B5, Y-02 (estimator honesty)       |    Y     | Confirmed                                   | **P2**     |  H   |  2  |  4  |  2  |  3  |  1  |  5  |  1  |  1  | **15.0**  | A11Y-02                    |
| **PWA-08**     | X-B6, R-02 (theme-color subset)      |    Y     | Confirmed                                   | **P2**     |  H   |  2  |  3  |  1  |  2  |  4  |  5  |  1  |  1  | **13.5**  | UX-08                      |
| **PWA-06**     | —                                    |    Y     | Confirmed                                   | **P2**     |  H   |  3  |  3  |  3  |  3  |  5  |  5  |  1  |  2  | **12.33** | PWA-07, A11Y-01            |
| **UX-03**      | X-A3                                 |    Y     | Confirmed                                   | **P2**     |  M   |  4  |  4  |  2  |  3  |  4  |  4  |  2  |  2  |  **9.5**  | A11Y-02                    |
| **LIB-01**     | X-A2                                 |    Y     | Confirmed                                   | **P2**     |  H   |  4  |  4  |  1  |  3  |  3  |  5  |  2  |  2  |  **9.0**  | LIB-03                     |
| **PWA-05**     | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  3  |  4  |  1  |  4  |  4  |  5  |  2  |  2  |  **9.0**  | —                          |
| **PERF-01**    | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  3  |  4  |  2  |  3  |  4  |  4  |  3  |  1  | **8.75**  | PERF-02                    |
| **UX-04**      | X-A4, R-09 (partial)                 |    Y     | Partially confirmed                         | **P2**     |  M   |  3  |  3  |  3  |  3  |  2  |  4  |  2  |  2  | **8.25**  | —                          |
| **POLISH-01**  | X-B1                                 |    Y     | Confirmed                                   | **P2**     |  H   |  2  |  4  |  1  |  4  |  4  |  5  |  3  |  1  | **8.25**  | A11Y-02                    |
| **PROD-08**    | Y-01, Y-L5                           |    Y     | Confirmed                                   | **P2**     |  H   |  4  |  5  |  2  |  4  |  2  |  5  |  3  |  2  |  **8.2**  | PROD-05                    |
| **SET-03**     | —                                    |    Y     | Confirmed                                   | **P2**     |  H   |  3  |  3  |  2  |  3  |  1  |  5  |  2  |  2  | **7.75**  | SET-02                     |
| **PWA-04**     | X-C4                                 |    Y     | Confirmed                                   | **P2**     |  M   |  3  |  3  |  1  |  3  |  3  |  5  |  2  |  2  | **7.75**  | A11Y-02                    |
| **LIB-03**     | R-03 (title surface)                 |    Y     | Confirmed                                   | **P2**     |  H   |  4  |  4  |  2  |  4  |  1  |  5  |  3  |  2  |  **7.6**  | LIB-01                     |
| **RUNTIME-01** | —                                    |    Y     | Confirmed                                   | **P2**     |  H   |  2  |  3  |  3  |  3  |  1  |  5  |  2  |  2  |  **7.5**  | RELEASE-01                 |
| **UX-06**      | Y-05, Y-06 (chips split to EXP-02)   |    Y     | Already implemented but needs hardening     | **P2**     |  H   |  3  |  4  |  2  |  4  |  3  |  5  |  3  |  2  |  **7.4**  | EXP-02, A11Y-02            |
| **EXP-02**     | Y-06 (chips)                         |    Y     | Confirmed                                   | **P2**     |  M   |  4  |  4  |  1  |  4  |  2  |  4  |  3  |  2  |  **7.2**  | UX-06, REV-01              |
| **LIB-04**     | —                                    |    Y     | Confirmed                                   | **P2**     |  H   |  3  |  3  |  3  |  3  |  1  |  5  |  3  |  2  |  **6.6**  | DB-01                      |
| **UX-08**      | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  3  |  4  |  1  |  3  |  3  |  4  |  3  |  2  |  **6.4**  | UX-03, A11Y-01             |
| **SET-01**     | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  3  |  3  |  1  |  3  |  2  |  4  |  3  |  2  |  **5.8**  | SET-04                     |
| **PROD-02**    | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  4  |  4  |  2  |  5  |  2  |  4  |  4  |  3  | **5.71**  | PROD-01, PROD-05           |
| **UX-01**      | —                                    |    Y     | Confirmed                                   | **P2**     |  H   |  4  |  5  |  1  |  4  |  3  |  4  |  4  |  3  | **5.57**  | PROD-01, UX-02             |
| **LIB-02**     | R-01, X-B3                           |    Y     | Confirmed                                   | **P2**     |  H   |  3  |  3  |  3  |  3  |  1  |  5  |  3  |  3  |  **5.5**  | DB-02, SAFE-02             |
| **PROD-03**    | —                                    |    Y     | Confirmed                                   | **P2**     |  M   |  4  |  4  |  2  |  4  |  1  |  4  |  4  |  3  | **5.29**  | PROD-01                    |
| **UX-07**      | Y-08, Y-03, X-T3 (intake adjacency)  |    Y     | Partially confirmed                         | **P2**     |  M   |  3  |  3  |  3  |  3  |  2  |  4  |  4  |  3  | **4.71**  | PROD-07, UX-01, MEDIA-01   |
| **UX-02**      | R-10, Y-04 (education adjacency)     |    Y     | Partially confirmed                         | **P2**     |  M   |  3  |  4  |  1  |  3  |  3  |  3  |  3  |  4  | **4.43**  | A11Y-01                    |
| **POLISH-02**  | X-B2                                 |    Y     | Partially confirmed                         | **P3**     |  M   |  2  |  2  |  1  |  2  |  3  |  4  |  1  |  1  | **11.5**  | A11Y-01                    |
| **EXP-05**     | Y-L3                                 |    Y     | Confirmed                                   | **P3**     |  M   |  2  |  3  |  1  |  3  |  1  |  5  |  2  |  2  |  **6.5**  | SET-01                     |
| **APPLE-02**   | R-06                                 |    Y     | Partially confirmed                         | **P3**     |  M   |  2  |  2  |  1  |  2  |  4  |  4  |  2  |  2  |  **6.0**  | UX-03                      |
| **UX-05**      | X-A5                                 |    Y     | Confirmed                                   | **P3**     |  M   |  3  |  4  |  1  |  3  |  4  |  4  |  3  |  3  |  **5.5**  | PROD-01, PROD-05           |
| **LIB-05**     | X-C1                                 |    Y     | Already implemented and adequate            | **P3**     |  H   |  2  |  2  |  1  |  2  |  1  |  5  |  2  |  2  |  **5.5**  | DIFF-01                    |
| **PWA-02**     | X-C2, X-T2                           |    Y     | Partially confirmed                         | **P3**     |  M   |  2  |  3  |  1  |  2  |  1  |  5  |  3  |  2  |  **4.8**  | PWA-05                     |
| **PWA-03**     | X-T3                                 |    Y     | Confirmed                                   | **P3**     |  M   |  2  |  2  |  1  |  2  |  3  |  5  |  3  |  2  |  **4.8**  | UX-07, PWA-05              |
| **PWA-09**     | R-12                                 |    N     | Not currently worth developing              | **P3**     |  H   |  1  |  2  |  1  |  2  |  3  |  5  |  3  |  2  |  **4.2**  | PROD-08                    |
| **PWA-07**     | —                                    |    Y     | Confirmed                                   | **P3**     |  M   |  3  |  2  |  1  |  3  |  4  |  5  |  5  |  3  | **3.75**  | PWA-06, UX-01              |
| **POLISH-04**  | Y-L6                                 |    N     | Not currently worth developing              | **P3**     |  M   |  1  |  2  |  1  |  1  |  3  |  4  |  2  |  3  |  **3.6**  | A11Y-01                    |
| **EXP-03**     | Y-07, Y-L2                           |    N     | Not currently worth developing              | **P3**     |  M   |  2  |  2  |  1  |  2  |  1  |  4  |  4  |  3  |  **3.0**  | LIB-01, LIB-03             |
| **EXP-04**     | —                                    |    N     | Not currently worth developing              | **P3**     |  M   |  2  |  2  |  1  |  2  |  1  |  4  |  4  |  3  |  **3.0**  | PROD-01, COST-01, EXP-01   |
| **EXP-01**     | X-C3                                 |    N     | Not currently worth developing              | **P3**     |  M   |  2  |  2  |  1  |  2  |  2  |  4  |  4  |  4  | **2.75**  | COST-01, PROD-01           |
| **PERF-02**    | X-T4                                 |    N     | Problem valid, proposed solution unsuitable | **Reject** |  H   |  1  |  1  |  1  |  1  |  2  |  5  |  4  |  4  |  **2.0**  | PERF-01, MEDIA-01          |

### Newly discovered defects

Twelve defects found during this audit that no source proposal raised. Full detail in the
ledger's `newlyDiscovered` array.

| ID          | Finding                                                                                                                                                                                       |      Severity      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------: |
| **DISC-07** | Documented RLS shape `auth.uid() = user_id` **cannot express ownership** for `prompt_versions` (no `user_id` column) or `media_assets`. Docs and policies disagree, and neither is checkable. | **P0** (via DB-01) |
| **DISC-02** | Six `workbox-*` runtime imports resolve only as transitives of a **devDependency**; a dedupe can break the SW build with no lockfile signal.                                                  |         P1         |
| **DISC-03** | `CLAUDE.md` §7 claims edge route handlers; production runs 6 Node lambdas, zero edge. `architecture.md` documents 4 SW caches + Background Sync that do not exist.                            |         P1         |
| **DISC-05** | `restoreVersionAction` never verifies the version belongs to the prompt; the FK that would stop it is declared absent in the generated types.                                                 |         P1         |
| **DISC-09** | CSP retains `script-src 'unsafe-inline'` for the pre-paint theme bootstrap, weakening XSS defence app-wide.                                                                                   |         P2         |
| **DISC-01** | `npm run test:int` targets `tests/integration/`, which does not exist — the script always fails.                                                                                              |         P2         |
| **DISC-04** | OpenAI-compatible adapters silently discard `opts`; adding a thinking level to any of 8 providers would validate then vanish.                                                                 |         P2         |
| **DISC-06** | `/api/media` never bills a failed vision call, while `/api/enhance` deliberately does. The two routes disagree.                                                                               |         P2         |
| **DISC-08** | TanStack Query is locked by ADR 0001 but has **zero** `useQuery` calls; its configuration is inert.                                                                                           |         P3         |
| **DISC-10** | Streaming scanner retains only 22 chars while seeking; unusual provider whitespace would silently stop deltas (correctness unaffected).                                                       |         P3         |
| **DISC-11** | `offline.html` honours OS preference, ignoring the user's explicit stored theme.                                                                                                              |         P3         |
| **DISC-12** | 19 icon PNGs ship; 7 are referenced. `apple-touch-icon.png` and three favicons are dead weight.                                                                                               |         P3         |

---

## 6. Contradictions, duplicates, and rejected premises

The prompt names eight reconciliations by minimum. All eight, plus the duplicates found.

### 6.1 Required reconciliations

**"Add offline support" vs. the existing SW and outbox.** X-T1's premise is **wrong**.
`src/lib/pwa/sw-src.js` and `src/lib/pwa/outbox.ts` both exist and work. The genuine
problems are the _opposite_ of "missing offline" — the SW caches too much (CACHE-01) and
the outbox reports success it cannot verify (SAFE-02). **Resolution: PWA-01 is a
hardening item, never a build item.** Anyone implementing "add a service worker" would
ship a second one.

**Blanket cache-first vs. authenticated privacy.** Directly contradictory, and the
current code already sits on the wrong side. Every app route is auth-gated, so _every_
cached navigation is private. **Resolution: static assets may be cached aggressively;
authenticated navigations must be network-first or `no-store`.** CACHE-01 is P0.

**Destination vs. optimizer.** The same `target` field is both, and `buildSystemPrompt`
proves it by dropping the destination half for two of six modes. **Resolution: PROD-01
owns the split; UX-05 and EXP-04 are formally blocked on it.** Optimising the picker
first would mean redoing it.

**`<optgroup>` vs. a redesigned picker.** UX-05 proposes both. The rendered iOS picker
and its accessibility were **not testable here**, so asserting a searchable sheet is
better would be inference presented as observation. **Resolution: `<optgroup>` is the
recommended minimum** — it adds structure while keeping native accessibility free. A
custom sheet needs device evidence first.

**Web Share vs. Web Share Target.** Two different APIs in two different directions,
repeatedly conflated across sources. **Resolution: outgoing share
(`navigator.share`) is supported on iOS _and already shipped_. Incoming share
(`share_target`) is `safari: false` and cannot ship there.** X-C2 and X-T2 are premise
failures for the primary platform.

**WebGPU vs. the measured workload.** No measurement exists, and the workload is a single
frame draw plus a palette quantize. PR-4 required profiling first. **Resolution: PERF-02
rejected; PERF-01 (measure) is the prerequisite for any performance claim.**

**"Duplicated diff" vs. "missing version comparison."** Both framings are wrong. There is
**one** diff implementation (`src/lib/enhance/diff.ts`) used in two places, and
version-to-version comparison **already exists**. **Resolution: LIB-05 is _Already
implemented and adequate_; the real defect is DIFF-01's unbounded complexity, shared by
both call sites.**

**Duplicate cards vs. legitimate versions.** LIB-02's cause matters more than its
symptom. Evidence points to **mechanical** duplication — a non-idempotent save replayed
by the outbox — not user experimentation. **Resolution: fix the cause with an
idempotency key. Content-hash merging stays advisory only**, because saves differing in
model, mode, or destination are legitimately distinct.

### 6.2 Duplicates folded, with nothing dropped

| Source proposal      | Folded into                   | Note                                                                          |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| Y-05 export + share  | **UX-06**                     | **Already shipped.** Both the export menu and `navigator.share` exist.        |
| X-C1 lineage/compare | **REV-01** + **LIB-05**       | Compare exists; lineage is the real gap.                                      |
| Y-06                 | **UX-06** + **EXP-02**        | Chips → EXP-02; "session history" is a duplicate of Library.                  |
| R-07                 | **COST-01**                   | Shared-store topology remains a COST-01 implementation dependency.            |
| R-02                 | **PWA-08** + **APPLE-01**     | theme-color subset → PWA-08; icon/manifest conformance → APPLE-01 + baseline. |
| R-05                 | **A11Y-01** + **RELEASE-01**  | Audit surface → A11Y-01; the CI contrast gate → RELEASE-01.                   |
| R-03                 | **LIB-03**                    | Title surface; seed-content replacement stays in scope.                       |
| Y-02                 | **POLISH-03**                 | Estimator honesty; pre-flight estimate composition sits under UX-01/UX-06.    |
| R-11, Y-11           | **A11Y-01**                   | 375px density and the contrast-law surface.                                   |
| Y-03, Y-08, X-T3     | **UX-07** (+ **PWA-03**)      | Media phase/skeleton and editable attributes; intake → PWA-03.                |
| R-10, Y-04           | **UX-02**                     | Mode-row overflow and mode education.                                         |
| G7                   | **APPLE-01** + **RELEASE-01** | Splash inventory and its CI parity check.                                     |

### 6.3 Rejected premises

| Source              | Premise                                   | Ruling                                                                                                                                                                                           |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Y-10 (haptics half) | iOS web haptics are achievable            | **PR-1.** `Navigator.vibrate` is `safari_ios: false`. Android-only, behind capability detection. Never simulate with animation. The _queue-status_ half of Y-10 is valid and became **SAFE-02**. |
| X-C2 / X-T2         | iOS can receive shares via `share_target` | **PR-2.** `safari_ios: false`. Verified 2026-07-27.                                                                                                                                              |
| Y-04                | Overlay coach marks                       | Mechanism rejected — persistent overlay chrome on a mobile-first editor. The _education intent_ survives in UX-02 and PROD-08.                                                                   |
| Y-06                | Add "session history"                     | Duplicate of Library, which exists with versioning and activity events.                                                                                                                          |
| X-T1                | "Add a service worker"                    | Premise correction — one exists. Became **PWA-01** (harden).                                                                                                                                     |
| Y-01                | IP/device fingerprint limiting            | **PR-6.** iCloud Private Relay defeats it. Any live trial must ride Supabase anonymous sign-in so RLS, the ledger, and rate limits still apply.                                                  |

---

## 7. Roadmap

Sequenced by gate, then by priority index within the gate. Scope: XS ≤2h · S ≤1d ·
M 2–4d · L 1–2w · XL >2w.

### Gate 0 — Release safety, integrity, cost

_Nothing else should ship before this gate closes. Four of six items concern data
reaching the wrong account or money leaving without a bound._

| Order | ID                                       | Scope | Depends on             | Parallel?                  |
| :---: | ---------------------------------------- | :---: | ---------------------- | -------------------------- |
|   1   | **DB-01** Reproducible database baseline | **L** | —                      | **Blocks 5, 6** — do first |
|   2   | **CACHE-01** No private HTML in caches   | **S** | SAFE-01 (shared purge) | ✅ with 3, 4               |
|   3   | **SAFE-02** Truthful queue status        | **S** | SAFE-01                | ✅ with 2, 4               |
|   4   | **DIFF-01** Bound quadratic diffing      | **S** | —                      | ✅ fully independent       |
|   5   | **SAFE-01** Account-scope local state    | **M** | — (tests need DB-01)   | ✅ with 6                  |
|   6   | **COST-01** Atomic spend enforcement     | **M** | DB-01, DB-02           | after 1                    |

**Why DB-01 first:** SAFE-01's cross-account test needs two real users; COST-01's
reservation needs a function in version control; DB-02 needs a place to put transactions.
Without it, Gate 0 fixes cannot be regression-tested at all.

**Cheap parallel wins during Gate 0** (independent, XS each): DISC-01, DISC-02, GOV-01.

### Gate 1 — Semantics and output quality

| ID                                             | Scope  | Depends on | Note                                           |
| ---------------------------------------------- | :----: | ---------- | ---------------------------------------------- |
| **PROD-07** Accurate media capability claims   | **XS** | —          | Copy fix + delete dead `tempo`/`timbre` schema |
| **PROD-04** Semantic quality gate              | **S**  | —          | Promote this audit's harness into `tests/`     |
| **PROD-06** Structured output + error taxonomy | **S**  | —          | Stop relaying raw provider text                |
| **PROD-05** Provider capability manifest       | **M**  | META-01    | Consolidate four scattered sources into one    |
| **META-01** Versioned provider metadata        | **S**  | —          | `lastVerifiedAt` + pin four floating aliases   |
| **DB-02** Transactional Library mutations      | **M**  | DB-01      | Absorbs DISC-05                                |
| **REV-01** Revision/run integrity              | **S**  | —          | Re-seed bug first; lineage is a product call   |
| **MEDIA-01** Media retention/quota             | **M**  | DB-01      | Server-side quota, idempotent delete           |
| **RELEASE-01** Expanded release gates          | **S**  | DB-01      | **Wire `check:db-enum` — it already exists**   |
| **PROD-01** Separate the overloaded Target     | **XL** | —          | ⚠️ **PR-7 gated — not approved here**          |

### Gate 2 — Mobile task flow

| ID                                            |   Scope    | Note                                                         |
| --------------------------------------------- | :--------: | ------------------------------------------------------------ |
| **PWA-08** Static first-paint theme-color     |   **XS**   | One tag                                                      |
| **PWA-06** Orientation                        |   **XS**   | One manifest line; WCAG 2.2 SC 1.3.4                         |
| **APPLE-01** Link iOS splash                  |   **S**    | Assets already exist; add CI parity check                    |
| **UX-03** Streaming into view                 |   **S**    | `scroll-padding-top` first                                   |
| **PWA-05** Paste affordance                   |   **S**    | Serves the north star's opening move on every platform       |
| **PWA-04** Keyboard shortcuts                 |   **S**    | ⌘/Ctrl+Enter only, with `isComposing` guard                  |
| **A11Y-02** Dialogs and status                |   **S**    | Silent copy failure + `aria-hidden` consistency + focus trap |
| **A11Y-01** Reflow, labels, contrast, targets |   **M**    | Add axe + a 320px project — **measure before fixing**        |
| **UX-04** Reset ≠ Enhance                     |   **S**    | Undo for substantial drafts                                  |
| **POLISH-03** Honest token estimates          |   **XS**   | Add the tilde                                                |
| **UX-06** Result as centerpiece               |   **S**    | Only the _unshipped_ parts                                   |
| **UX-01 / UX-02 / UX-07 / UX-08**             | **M** each | UX-02 is PR-7 gated                                          |

### Gate 3 — Library, Settings, iPad/macOS

`LIB-03` (S) · `LIB-01` (XS) · `SET-02` (XS) · `SET-03` (S) · `SET-04` (M, ships export
first) · `SET-01` (S) · `LIB-04` (M) · `LIB-02` (S) · `EXP-02` (M) · `RUNTIME-01` (XS,
absorbs DISC-03) · `PWA-03` (S) · `PWA-07` (XL, add a desktop Playwright project first).

### Gate 4 — Measured polish and experiments

`PERF-01` (M — **the measurement is the deliverable**) · `POLISH-01` (M) ·
`POLISH-02` (XS) · `PROD-02` (M) · `PROD-03` (M) · `PROD-08` (S, precomputed showcase) ·
`EXP-05` (S) · `UX-05` (M, after PROD-01) · `APPLE-02` (XS) · `PWA-09` (XS, ADR only) ·
`DISC-09` (S, CSP nonce).

### Rejected / superseded / deferred

**Rejected:** PERF-02 (WebGPU — workload does not justify it; `createImageBitmap`
reaches vastly more devices).
**Not currently worth developing:** EXP-01, EXP-03, EXP-04, POLISH-04, PWA-09 (as a
build).
**Already implemented — do not rebuild:** LIB-05 (version comparison), Y-05's export and
share, R-8's run snapshotting.
**Premise-failed:** X-T1, X-C2/X-T2, Y-01, Y-04's mechanism, Y-06's session history,
Y-10's haptics half.

---

## 8. Implementation briefs (P0 – P2)

No implementation code appears in this section. Each brief states the verified problem,
the scenario, the recommended direction, the simpler alternative considered, blast
radius, and how it is proven and rolled back.

### 8.0 — Gate 0 · Release blockers

---

#### DB-01 — Reproducible database baseline

**Verified problem.** All seven files in `supabase/migrations/` are single-statement
`ALTER TYPE`. A grep across `supabase/` for `CREATE TABLE|CREATE POLICY|ROW LEVEL
SECURITY|CREATE FUNCTION` returns nothing. `docs/runbooks/migrations.md:23-30` states
plainly that the P2–P5 base schema "exists only in its migration ledger" on the hosted
project. `usage_window` — called by both model routes and the _only_ durable spend and
rate guardrail — has no body anywhere in the repository.

**User scenario.** The hosted Supabase project is lost, corrupted, or needs a staging
twin. There is no path from this repository to a working database. A fresh
`supabase db reset` fails on migration 1, because the enum it alters was never created.
Separately and continuously: no reviewer can read the RLS policies, and no test can
exercise them.

**Recommended implementation.** `pg_dump --schema-only` the hosted project including
policies, functions, triggers, indexes, and storage policies. Commit it as a baseline
migration ordered _before_ the seven existing ones, with the enum baseline matching the
`BASELINE_LABELS` already asserted in `tests/unit/model-target-enum.test.ts:32-40`. Then
add a CI job that spins an ephemeral Postgres, applies every migration in order, and
asserts RLS is enabled on all seven tables plus a cross-user isolation case.

**Simpler alternative considered.** Hand-write the schema from `database.types.ts`.
Rejected — that file is documented as hand-edited during the 22P02 incident, so it would
encode the same drift it is meant to fix. The dump is the only trustworthy oracle.

**Affected.** `supabase/migrations/` (new baseline) · `.github/workflows/ci.yml` ·
`docs/runbooks/migrations.md` · new `tests/integration/rls.test.ts` (which also gives
the orphaned `test:int` script a real target, closing DISC-01).

**Migration/backfill.** None to production — the baseline describes what already exists.
It **must** be verified as a no-op against the hosted project before merge.

**Dependencies.** None. Blocks DB-02, COST-01, MEDIA-01, RELEASE-01, and SAFE-01's tests.

**Security/privacy/cost.** Strongly positive: RLS becomes reviewable and testable for the
first time. The dump must be scrubbed of any seeded personal data. Resolves DISC-07 —
the documented policy shape `auth.uid() = user_id` cannot express ownership for
`prompt_versions`, which has no `user_id` column.

**Accessibility / Apple fallback.** None.

**Regression risks.** A baseline that does not match production would make CI assert a
fiction — the exact failure mode of the hand-edited types file. Mitigate by diffing a
fresh dump against the committed baseline in CI.

**Required tests.** Ephemeral rebuild from zero. RLS enabled on all seven tables. User A
cannot read or write User B's rows in any table. Storage policies isolate by
`{user_id}/` prefix.

**Rollback.** Delete the baseline file and the CI job. Nothing in the application depends
on it.

**Success signal.** A fresh database can be created from source control alone, and CI
fails when an RLS policy is dropped.

---

#### SAFE-01 — Account-scope local state

**Verified problem.** `UI_STORE_KEY` is the hardcoded global `"vizion.ui.v1"`
(`src/lib/constants.ts:146`), and `partialize` persists `editorDraft` — the user's raw
prompt text (`src/stores/ui.ts:152-158`). `OutboxItem` has no `userId` field
(`src/lib/pwa/outbox.ts:9-14`). `savePromptAction` stamps `user_id` from the **current**
session (`src/lib/library/actions.ts:45-55`). Sign-out clears cookies only
(`src/app/auth/sign-out/route.ts:5-11`). `ProfileHydrator` resets only `theme` and
`targetModel`.

**User scenario — cross-account write, not just disclosure.** User A drafts a prompt on a
shared iPad, goes offline, saves — the payload lands in `vizion-outbox`. A signs out.
User B signs in. `OutboxFlusher` mounts and flushes on `visibilitychange`;
`savePromptAction` resolves `user.id` from **B's** session and writes A's prompt into B's
library. B simultaneously finds A's draft text sitting in the composer.

**Recommended implementation.** Three parts, shippable in order:

1. **Purge on sign-out** — clear the Zustand store, the outbox, and the shell cache from
   a client handler before the POST. This alone closes the write path.
2. **Stamp `userId` on every outbox item**, and have `flushOutbox` skip items whose owner
   is not the current user.
3. **Namespace the persist key** by user id, keeping a signed-out key for pre-auth
   preferences like theme.

**Simpler alternative considered.** Purge only (step 1). It closes the cross-account
write and the draft leak with far less change, and is the recommended _first_ commit —
but it loses a legitimately queued item if the user signs out before reconnecting, which
is why steps 2 and 3 follow.

**Affected.** `src/app/auth/sign-out/route.ts` and its callers
(`ProfilePanel.tsx:292`, `set-password/page.tsx:45` — both bare form POSTs today, so a
client handler must be introduced) · `src/stores/ui.ts` · `src/lib/constants.ts` ·
`src/lib/pwa/outbox.ts` · `src/components/pwa/OutboxFlusher.tsx` ·
`src/lib/pwa/register-sw.ts`.

**Migration/backfill.** Existing `vizion.ui.v1` payloads must migrate into the namespaced
key or be discarded. The store already has a version-5 `migrate` chain to extend.
Existing outbox items have no owner — the safe choice is to **drop unowned items on
upgrade** rather than guess, and say so in the changelog.

**Dependencies.** None to ship. Its regression test needs DB-01.

**Security/privacy/cost.** The core fix of the audit. No cost impact.

**Accessibility / Apple fallback.** Purge must survive iOS ITP eviction — since eviction
also destroys the data, that is fail-safe.

**Regression risks.** Over-aggressive purging could destroy a legitimate offline draft.
Mitigate by flushing the outbox _before_ purging when online, and by keeping theme
preference in the signed-out namespace so sign-out does not flash a theme change.

**Required tests.** Sign in as A, draft, sign out, sign in as B → composer empty, no A
rows in B's library. Queue offline as A, sign out, sign in as B, reconnect → item is
**not** written to B. Cross-account assertions must be zero-tolerance.

**Rollback.** Revert; the persist-key migration is one-way, so ship the purge commit
separately from the namespacing commit.

**Success signal.** Zero cross-account carry-over in tests; the metric is a hard zero, not
a threshold.

---

#### COST-01 — Atomic spend enforcement

**Verified problem.** `src/app/api/enhance/route.ts:111-126` reads settled `today_cost`
via `usage_window`, compares to `COST_CAP_USD_PER_DAY`, and returns 429 if over. The
provider is first touched at `:156`. The ledger `INSERT` happens at `:236-244` inside
`finally`. There is no reservation, no lock, no per-request ceiling, and no idempotency
key. `/api/media:90-101` is identical. The in-memory burst limiter is documented at
`src/lib/security/rate-limit.ts:7-8` as not authoritative across instances.

**User scenario.** Cap $2, spent $1.99. The user (or a script) fires 20 requests inside
the streaming window. All 20 read `$1.99`, all 20 pass, all 20 call providers. On
`fable_5` at $50/1M output against the 64k Anthropic ceiling, each can settle ~$3.20 —
roughly **$64 against a $2 cap**. Separately, a _single_ request is never checked against
remaining headroom, so one maximal run can blow the cap from $0.01 of usage.

**Recommended implementation.** Two-phase reservation. Before the provider call, insert a
`usage_events` row with `status='reserved'` and a projected maximum cost computed from
the adapter's output ceiling and the target's price, inside a function that atomically
rejects when `sum(settled + reserved) + projected > cap`. On completion, update the row
to `status='settled'` with real tokens. On failure or abort, settle at the estimated
actual (the existing `finally` logic already computes this well). Add a client-supplied
idempotency key.

**Simpler alternative considered — recommended as the first commit.** Keep the read-then-act
check but add a **per-request projected ceiling**: reject when
`today_cost + maxProjectedCost > cap`. That bounds the worst case to
`cap + (concurrency × one max request)` instead of unbounded, is a few lines, needs no
schema change, and can ship immediately while the reservation design is reviewed.

**Affected.** `src/app/api/enhance/route.ts` · `src/app/api/media/route.ts` ·
`usage_window` and a new reservation function (both requiring DB-01) ·
`src/lib/providers/config.ts` (expose per-target max output tokens, which today live
scattered in each adapter).

**Migration/backfill.** New `status` column on `usage_events` defaulting to `'settled'`
so existing rows stay correct. A sweeper must settle rows stuck in `reserved` after a
timeout, or an abandoned request would permanently consume cap headroom.

**Dependencies.** DB-01 (function must be version-controlled), DB-02 (transaction
semantics). Blocks EXP-01 and EXP-04.

**Security/privacy/cost.** This _is_ the cost control. Note the interaction with
DISC-06: `/api/media` returns before its ledger write on failure, so failed vision calls
are never billed — the reservation model fixes that asymmetry for free.

**Accessibility.** The 429 cap message is already surfaced with `capReached`; keep it
announced politely (A11Y-02).

**Regression risks.** A reservation that fails to settle would strand headroom and lock
the user out. Mitigate with the sweeper and a generous timeout. Reserving the _maximum_
also means a user near the cap is refused a run that would have fit — an intentional,
documented trade.

**Required tests.** N concurrent requests near the cap settle within
`cap + one max request`. A single request whose projection exceeds headroom is refused
pre-call. Abort still settles. Replaying an idempotency key does not double-charge.

**Rollback.** The simpler alternative is independently revertible. The reservation phase
can be disabled by feature flag, falling back to read-then-act.

**Success signal.** Ledger variance versus provider invoices stays within tolerance, and
no day exceeds `cap + one max request`.

---

#### CACHE-01 — No private authenticated HTML in caches

**Verified problem.** `src/lib/pwa/sw-src.js:72-76` returns `true` from `isShellAsset`
for `request.mode === 'navigate'`, and `:78-87` serves those through
**StaleWhileRevalidate** into `vizion-shell`. Every app route is auth-gated by
`src/middleware.ts`, so every cached navigation is private. The purge
(`src/lib/pwa/register-sw.ts:43-51`) fires only when `location.pathname === '/sign-in'`
during a fresh `registerServiceWorker()` call.

**User scenario.** User A browses their Library on a shared device; the rendered HTML
enters Cache Storage. A's session expires without a redirect, or A navigates client-side.
User B opens the app and is served A's Library HTML from cache before revalidation
returns.

**Recommended implementation.** Split the route. Keep StaleWhileRevalidate for
`script | style | font | image`. Serve navigations **network-first** with the existing
`offline.html` catch handler as fallback — preserving offline reopen while never
serving another session's HTML first. Purge `vizion-shell` from the sign-out path
directly (shared with SAFE-01) rather than inferring it from a pathname.

**Simpler alternative considered.** Exclude navigations from the SW entirely. Cleaner and
safer, but it loses the offline shell that the catch handler currently provides — a real
capability worth keeping. Network-first is the better trade.

**Affected.** `src/lib/pwa/sw-src.js` · `src/lib/pwa/register-sw.ts` ·
`scripts/build-sw.mjs` (unchanged, but the SW is a build artifact — `prebuild` must run).

**Migration/backfill.** Existing `vizion-shell` caches contain private HTML **now**. Bump
the cache name so the old cache is dropped by `cleanupOutdatedCaches()` on upgrade.

**Dependencies.** Shares the purge hook with SAFE-01.

**Security/privacy/cost.** Removes cross-account HTML exposure. Slightly more network on
navigation — acceptable, and these are dynamic server-rendered routes anyway.

**Apple fallback.** iOS ITP may evict Cache Storage independently; network-first is
unaffected by eviction.

**Regression risks.** Offline reopen of an authenticated page will now show
`offline.html` rather than a stale render. That is the correct behaviour and should be
stated in the changelog.

**Required tests.** After sign-out, no authenticated HTML remains in Cache Storage. A
navigation while online is served from network. A navigation while offline yields
`offline.html`. (Note: `tests/e2e/shell.spec.ts:87-90` skips SW assertions on WebKit by
design — Chromium covers this leg.)

**Rollback.** Revert the route predicate; the cache-name bump is forward-safe.

**Success signal.** Zero private navigations present in Cache Storage after sign-out.

---

#### SAFE-02 — Truthful offline queue status

**Verified problem.** `enqueueOutbox` returns `Promise<void>` and swallows every failure
(`src/lib/pwa/outbox.ts:102-118`). `TransformationDiff.tsx:48-63` calls `setQueued(true)`
unconditionally on **both** branches, rendering "Queued — syncs when online"
(`:230-233`). The `catch` at `:59` is **not** gated on `navigator.onLine`, so a genuine
online server failure also reports "Queued". `MediaStudio.tsx:386` implements the correct
gated behaviour — the two siblings disagree, and the media one is right.

**User scenario.** In Private Browsing, or under storage pressure, the IndexedDB `put`
rejects. The user sees "Queued — syncs when online", closes the app satisfied, and the
prompt is gone. `SECURITY.md:27-29` claims local storage is "never the only copy" — for
`editorDraft` and queued saves, that is currently untrue.

**Recommended implementation.** Make `enqueueOutbox` return `boolean` and drive the chip
from the actual result. On failure, say so plainly and keep the result on screen so the
user can copy it. Align `TransformationDiff`'s catch with `MediaStudio`'s existing gated
shape so an online failure reports an error rather than a queue.

**Simpler alternative considered.** Keep the void signature and probe IndexedDB
availability once at startup. Rejected — availability at startup does not predict quota
failure at write time, which is the common case.

**Affected.** `src/lib/pwa/outbox.ts` · `src/components/diff/TransformationDiff.tsx` ·
`src/components/media/MediaStudio.tsx` (align, mostly already correct).

**Migration/backfill.** None.

**Dependencies.** Shares the outbox surface with SAFE-01 — sequence them together.

**Security/privacy/cost.** Honesty about durability; no cost impact.

**Accessibility.** The failure state must be announced via the existing `role="status"`
pattern (A11Y-02), not shown as colour alone.

**Regression risks.** More failure copy could alarm users where the old code silently
"succeeded". That is the point, but the wording should offer the next action (copy the
result) rather than just reporting loss.

**Required tests.** Force an IDB `put` rejection → UI reports failure, not "Queued".
Online `savePromptAction` throw → error, not "Queued". Offline enqueue success → "Queued".

**Rollback.** Straightforward revert; the boolean return is additive.

**Success signal.** Offline enqueue failure rate becomes observable at all — today it is
structurally invisible.

---

#### DIFF-01 — Bound quadratic diffing

**Verified problem.** `src/lib/enhance/diff.ts:35-37` materialises a full
`(n+1) × (m+1)` LCS table. The tokenizer at `:19-21` keeps whitespace as tokens, roughly
doubling both dimensions. There is no cap, no fallback, and no worker. It is called
synchronously inside the SSE `start` callback (`route.ts:190-199`) and **unmemoized in a
client render body** (`PromptDetail.tsx:86`). `MAX_INPUT_CHARS = 20_000` bounds the input
only; the output side is unbounded.

**User scenario.** Two failures. Server: a 20k-char input against a 16k-token output
builds a table on the order of 10⁸ cells across thousands of `Array` objects — hundreds
of megabytes and many seconds, blocking that serverless instance's event loop for every
concurrent user on it. Client: in the Library, `diffWords` re-runs on **every keystroke**
in the revise textarea, because the neighbouring media code uses `useMemo` and this does
not.

**Recommended implementation.** Three changes in increasing cost:

1. `useMemo` the client call keyed on the two version ids — one line, removes most
   real-world pain immediately.
2. Add an `n × m` ceiling; above it, fall back to line-level diff (cheap, still useful).
3. Only if profiling still shows a problem, move execution to a worker.

**Simpler alternative considered.** Swap LCS for Myers. Better asymptotically but a
larger correctness surface on a function with existing lossless-reconstruction tests. The
bound plus memo delivers nearly all the benefit at a fraction of the risk.

**Affected.** `src/lib/enhance/diff.ts` · `src/components/library/PromptDetail.tsx` ·
`src/app/api/enhance/route.ts`.

**Migration/backfill.** None.

**Dependencies.** None — fully parallelisable within Gate 0.

**Security/privacy/cost.** A remotely triggerable event-loop stall on a shared serverless
instance is a denial-of-service surface. Bounding it is the mitigation.

**Accessibility.** The line-level fallback must be visually and semantically equivalent;
announce truncation if a diff is degraded.

**Apple fallback.** Client-side blocking is worst on mobile Safari — the memo fix helps
most exactly there.

**Regression risks.** The fallback changes diff granularity for very large pairs. Label
it in the UI so the user knows why the diff is coarser.

**Required tests.** Benchmark `diffWords` at 20k × 16k tokens and assert a time and
memory budget — **runnable offline with no authentication, which makes it the cheapest
way to settle this item's magnitude precisely.** Assert the fallback triggers at the
bound. Assert the client memo does not recompute on unrelated state changes.

**Rollback.** Each of the three changes is independently revertible.

**Success signal.** p95 diff time bounded regardless of input; no keystroke-linked
recomputation in the Library.

### 8.1 — Gate 1+ · P1 briefs

Structured compactly. Every brief carries the same fields as §8.0.

---

**PROD-07 — Accurate media capability claims** · XS · no dependencies

_Problem:_ `ondevice.ts:120-168` draws frame 0 only — no seeking, no sampling. `:53-56`
returns duration for audio and nothing else. `/api/media:82-84` rejects non-images
outright. `types.ts:14-15` and `extract.ts:42-43` parse `tempo`/`timbre` that
`MEDIA_EXTRACT_SYSTEM` never asks for — dead schema. The attach button says "images,
video, or audio" without qualification.
_Scenario:_ A user attaches a 3-minute product video expecting the content understood.
One frame is analysed. Nothing says so.
_Implementation:_ Change the button and per-item labels to state exactly what happens
("first frame analysed", "duration only"). Delete `tempo`/`timbre`.
_Simpler alternative:_ Restrict the file picker to images. Rejected — first-frame
analysis is genuinely useful; the defect is the framing, not the feature.
_Affected:_ `MediaStudio.tsx:489-500,510-605` · `media/types.ts` · `media/extract.ts`.
_Migration:_ None. _Security/cost:_ None. _A11y:_ Labels must be programmatic, not
colour or icon alone. _Apple:_ None.
_Risks:_ Honest copy may reduce media use — the correct outcome.
_Tests:_ Assert `MediaAttributes` has no unpopulated fields; snapshot the capability copy.
_Rollback:_ Trivial. _Success:_ Media-attach-then-abandon rate falls.

---

**PROD-04 — Semantic quality evaluation gate** · S · no dependencies

_Problem:_ No eval set or semantic gate exists. The contract is defended only by
negative-substring unit tests. **This audit's harness found the contract holding on
20/20 cases** — so the gap is a regression net, not present breakage.
_Scenario:_ Someone edits `OUTPUT_CONTRACT` or `FORMAT_PRESERVATION`. `lessons.md`
records two production incidents from exactly that (role framing, shape destruction).
Nothing today would catch a third.
_Implementation:_ Promote this audit's harness into `tests/` — the eval set, the
deterministic assertions (no role labels, shape preservation, injection resistance,
does-not-answer), and the real `buildSystemPrompt`. Run on a schedule, not per-PR,
against a cheap model.
_Simpler alternative:_ Extend the existing negative-substring unit tests. Free and
deterministic, but they test the _prompt text_, not the _model's behaviour_ — which is
where both prior incidents actually surfaced.
_Affected:_ new `tests/eval/` · `.github/workflows/` (scheduled job).
_Migration:_ None. _Cost:_ ~$0.10 per full run at observed rates. _A11y/Apple:_ None.
_Risks:_ Non-determinism causing flaky failures — mitigate by keeping assertions
structural and thresholding rather than requiring perfection.
_Tests:_ The harness is the test. _Rollback:_ Remove the workflow.
_Success:_ A deliberate contract regression fails the scheduled run.

---

**PROD-06 — Structured output + error taxonomy** · S · no dependencies

_Problem:_ `route.ts:205-219` sends `e.message` straight to the browser; every adapter
interpolates the upstream SDK string (`anthropic.ts:70-74`, `openai.ts:64`,
`google.ts:69-73`, `xai.ts:63`, `mistral.ts:58-62`, `openai-compat.ts:88-92`).
`/api/media:38-44` appends to it.
_Scenario:_ A quota error returns upstream text naming the org, project, or internal
model string, rendered verbatim in the UI of a public app.
_Implementation:_ Map upstream errors to a small set of stable public codes with friendly
copy; keep raw text server-side in logs. Preserve the existing `notConfigured` and
`capReached` flags, which already work well.
_Simpler alternative:_ Regex-redact identifiers. Rejected — a denylist over twelve
providers' message formats will leak.
_Affected:_ `providers/errors.ts` · all six adapters · both route handlers ·
`use-enhance.ts` error rendering.
_Migration:_ None. _Security:_ Closes an information-disclosure surface. _A11y:_ Errors
must be announced (A11Y-02). _Apple:_ None.
_Risks:_ Losing the deliberate diagnostic value documented in
`docs/runbooks/media.md:33-39`. Mitigate by keeping full detail in server logs and
showing a correlation id.
_Tests:_ Every adapter's error path maps to a known code; no test fixture leaks upstream
text. _Rollback:_ Revert the mapping layer. _Success:_ Zero raw provider strings in
client payloads.

---

**PROD-05 — Provider capability/availability manifest** · M · depends on META-01

_Problem:_ Capability data lives in four places — `config.ts` (price/model),
`vision.ts:195-204` (vision), `constants.ts:131-142` (thinking ladders),
`openai-compat.ts:194` (JSON mode). Context limits exist nowhere; a flat
`MAX_INPUT_CHARS = 20_000` applies to all 16 models. Availability surfaces only as a 503
after the user commits (`route.ts:103-109`).
_Scenario:_ A user picks a model whose key is unset, writes a long prompt, presses
Enhance, and only then learns it is unavailable.
_Implementation:_ One server-derived manifest consolidating the four sources plus
per-model context limits; expose configured/unavailable to the picker.
_Simpler alternative:_ Expose only `isProviderConfigured` to the client. Much smaller and
fixes the worst symptom; does not address drift between the four sources.
_Affected:_ `providers/config.ts` · `vision.ts` · `constants.ts` · a new manifest module ·
`EnhanceComposer.tsx`.
_Migration:_ None. _Security:_ Must not leak which keys are set to unauthenticated users.
_A11y:_ Unavailable options need programmatic state, not styling alone. _Apple:_
`<optgroup>` interaction is UX-05's concern.
_Risks:_ A stale manifest is worse than none — derive at runtime, never hand-maintain.
_Tests:_ Manifest agrees with all four sources (extend the existing
`models.test.tsx` pattern). _Rollback:_ Revert to request-time checks.
_Success:_ Zero post-commit 503s from a knowably unavailable model.

---

**META-01 — Versioned provider metadata** · S · no dependencies

_Problem:_ `TargetConfig` has four fields (`config.ts:17-24`). No `lastVerifiedAt`. Four
targets carry explicitly guessed prices (`:54-56, 102-103, 118-119, 146-148`); four use
floating aliases (`deepseek-chat`, `mistral-large-latest`, `qwen-max`, `MiniMax-M3`).
_Scenario:_ `lessons.md` records the real case — Gemini output went $1.20 → $7.50/1M and
a stale `PRICE_GEMINI_OUT` in Vercel under-counted the cap **6×**. It surfaces as a bill,
not a failing test.
_Implementation:_ Add `lastVerifiedAt` and `pricingSource`; pin the four floating
aliases; add a CI warning past a staleness threshold.
_Simpler alternative:_ Pin the aliases only. Removes the silent-drift half at almost no
cost.
_Affected:_ `providers/config.ts` · `docs/runbooks/providers.md` · CI.
_Migration:_ None. _Cost:_ Directly protects cap accuracy. _A11y/Apple:_ None.
_Risks:_ A date nobody updates is theatre — the CI warning is what makes it real.
_Tests:_ Every target has a verification date; no target uses a floating alias without an
explicit opt-in flag. _Rollback:_ Trivial.
_Success:_ Ledger cost tracks provider invoices within tolerance.

---

**DB-02 — Transactional Library mutations** · M · depends on DB-01

_Problem:_ All six actions are unguarded statement sequences.
`savePromptAction:53-91` discards the return of the `current_ver` UPDATE and both
activity inserts. `addVersionAction:111-131` reads `current_ver` then writes it as
`parent_ver` in a separate round trip. `restoreVersionAction:160-165` never validates
that `versionId` belongs to `promptId` (**DISC-05**). `updateTagsAction` and
`deletePromptAction` never call `getUser()`.
_Scenario:_ A network blip between the `prompts` insert and the `prompt_versions` insert
leaves an orphan with `current_ver = NULL`; the user retries and creates a second. Two
tabs revising concurrently both read the same `current_ver`, fork the DAG, and the later
UPDATE orphans the earlier branch from `current_ver` while it lingers in history.
_Implementation:_ One Postgres function per mutation, with ownership checks and stable
result codes.
_Simpler alternative:_ Check every return value and compensate in application code.
Cheaper, no schema work, but cannot close the `parent_ver` race — that needs a single
statement.
_Affected:_ `src/lib/library/actions.ts` · new migrations · `database.types.ts`
(**regenerate, never hand-edit** — `lessons.md` is explicit).
_Migration:_ Additive functions. Consider a one-off repair for existing orphans.
_Dependencies:_ DB-01. _Security:_ Ownership moves into the database. _A11y/Apple:_ None.
_Risks:_ Enum and type drift — `check:db-enum` must be in CI first (RELEASE-01).
_Tests:_ Concurrent `addVersion` produces a linear chain. Restore with a foreign
`versionId` is refused. Partial failure leaves no orphan.
_Rollback:_ Actions can call the old statement sequences behind a flag.
_Success:_ Zero orphan prompts; no forked DAGs.

---

**REV-01 — Revision/run integrity** · S · no dependencies

_Problem:_ Two separable issues. The **save-snapshot half is already correct** —
`EnhanceComposer.tsx:56-64` captures `{input, mode, target}` at request time. The gaps
are that `PromptDetail.tsx:91` seeds Revise from `current.input_text` (the original, not
the improvement), and the `useState` never re-seeds — the effect at `:76-82` updates only
the diff selects.
_Scenario:_ A user saves a revision and the textarea still holds the _previous_ version's
input. That is a plain stale-state bug, independent of the product question.
_Implementation:_ Re-seed `draft` and `mode` when `current` changes. Then, separately,
offer an explicit "start from improved output" toggle rather than silently switching the
default.
_Simpler alternative:_ Fix only the re-seed. Recommended first — it is uncontroversial,
while the semantic change deserves a product decision.
_Affected:_ `PromptDetail.tsx:76-92`.
_Migration:_ None. _Cost:_ None. _A11y:_ Announce that the field was re-seeded.
_Apple:_ None.
_Risks:_ Re-seeding could discard in-progress typing — only re-seed when `current.id`
actually changes.
_Tests:_ After save, the textarea reflects the new current version. Typing is not
clobbered by an unrelated re-render.
_Rollback:_ Trivial. _Success:_ Zero reports of stale revise content.

---

**MEDIA-01 — Trustworthy media retention/quota** · M · depends on DB-01

_Problem:_ The 50 MB quota (`formatters.ts:103`) is enforced only in `admitFiles`
(`queue.ts:59-83`), a pure client function — there is **no server upload route**, the
browser writes straight to Storage (`MediaStudio.tsx:207-241`). No retention or cleanup
exists anywhere. Delete removes the object then the row, returning early on row failure
and stranding an orphan whose bytes count against quota forever. `ext` comes unsanitised
from `file.name.split('.').pop()`. The `avatars` bucket is public.
_Scenario:_ Any direct storage call with the user's own session bypasses the quota
entirely — storage cost is unbounded per user.
_Implementation:_ Enforce the cap in a storage RLS policy or a signed-upload route;
sanitise the extension against an allowlist; make delete row-first and idempotent with a
reconciliation sweep.
_Simpler alternative:_ Server-side check on the `media_assets` insert. Does not stop a
raw storage write, but closes the path the app itself uses, cheaply.
_Affected:_ `MediaStudio.tsx` · storage policies (DB-01) · `media/queue.ts`.
_Migration:_ Existing orphan rows need a reconciliation pass.
_Security:_ Confirm whether the public `avatars` bucket is intended — avatars are
world-readable at a guessable path derived from the user id.
_A11y:_ Quota and retention state must be text, not just a chip colour. _Apple:_ None.
_Risks:_ A server cap could reject files the client already accepted — keep the two in
sync from one constant.
_Tests:_ Direct storage write beyond quota is refused. Delete failure leaves no orphan.
Hostile filenames are sanitised.
_Rollback:_ Policy removable. _Success:_ Storage bytes per user stay bounded; zero
orphan rows.

---

**A11Y-01 — Reflow, labels, contrast, targets** · M · depends on UX-02, UX-08, PWA-06

_Problem:_ No automated a11y tooling — `@axe-core/playwright` is absent and the only
assertion is a skip-link check (`shell.spec.ts:66-69`). The token system _does_ encode
the contrast law and `safe-area.test.ts` unit-tests `contrastRatio` including the
prohibited Laser-on-Chalk pair — but nothing checks **rendered pixels**, reflow at
320px, or 200% zoom. `lessons.md`: _"every gate stayed green because nothing asserts
pixels."_
_Scenario:_ WCAG AA is a stated v1.0 requirement with no measurement behind it. The
six-cell `ModeRig` at 320–375px is the most likely violation and is entirely unmeasured.
_Implementation:_ Add `@axe-core/playwright` to the existing e2e run plus a 320px
viewport project. **Measure first, then triage** — do not guess at fixes.
_Simpler alternative:_ Manual audit. Does not prevent regression, which is the point.
_Affected:_ `playwright.config.ts` · `tests/e2e/` · `package.json` · CI.
_Migration:_ None. _Cost:_ CI minutes. _Apple:_ Device VoiceOver remains a manual
follow-up — axe does not replace it.
_Risks:_ Surfacing a backlog that then gets ignored. Gate only on _new_ violations
initially.
_Tests:_ axe clean on all five routes at 320px and 200% zoom; every interactive target
≥44×44.
_Rollback:_ Remove the job. _Success:_ Zero new axe violations per PR.

---

**A11Y-02 — Dialogs and status** · S · depends on POLISH-01, UX-06

_Problem:_ Streaming announcements are **already correct**
(`StreamProgress.tsx:39`, `role="status" aria-live="polite"`). The gaps: the avatar-crop
modal handles Escape (`ProfilePanel.tsx:64-71`) but has **no focus trap and no background
inerting**; clipboard failure is swallowed silently (`TransformationDiff.tsx:77`); and
`aria-hidden` is inconsistent — hidden at `EnhanceComposer.tsx:209,214,227` but _not_ at
`:235,267` or `StreamProgress.tsx:44`, so screen readers announce the play, warning, and
lightning glyphs.
_Scenario:_ A keyboard user opens the crop modal and tabs straight out into the page
behind it. A screen-reader user hears "black right-pointing pointer ENHANCE".
_Implementation:_ Focus trap plus `inert` on the modal; a status message on clipboard
failure; consistent `aria-hidden` on every decorative glyph.
_Simpler alternative:_ Fix the copy failure and `aria-hidden` only — both are small,
independently valuable, and can ship first.
_Affected:_ `ProfilePanel.tsx` · `TransformationDiff.tsx` · `EnhanceComposer.tsx` ·
`StreamProgress.tsx` · `MediaStudio.tsx`.
_Migration:_ None. _Apple:_ The `inert` attribute is well supported in current Safari;
verify on device.
_Risks:_ Focus traps break badly if the modal unmounts while focused — restore focus to
the trigger.
_Tests:_ Tab cannot escape the modal; Escape restores focus to the avatar button; copy
failure is announced.
_Rollback:_ Per-change. _Success:_ Zero keyboard dead ends.

---

**RELEASE-01 — Expanded release gates** · S · depends on DB-01, A11Y-01, APPLE-01

_Problem:_ CI is genuinely solid — lint, typecheck, icons, unit, build, e2e on both
mobile projects, and a **gating** `npm audit`, all green at this commit. But
`check:db-enum` — the guard written _specifically_ after the incident where all five
gates passed while four models failed every DB write — **is in no workflow**.
`format:check` is absent. `test:int` targets a directory that does not exist (DISC-01).
No contrast gate, no splash parity check, no a11y job.
_Scenario:_ The 22P02 incident recurs. Every gate passes green. The ledger silently stops
recording spend for the affected models, disabling the cost cap for them.
_Implementation:_ Wire `check:db-enum --strict` into CI with credentials; add the splash
link↔asset parity check (APPLE-01) and the token-level contrast gate; delete or implement
`test:int`.
_Simpler alternative:_ Wire `check:db-enum` alone. It is the single highest-value gate
and already exists as a script.
_Affected:_ `.github/workflows/ci.yml` · `package.json` · new check scripts.
_Migration:_ None. _Security:_ Needs Supabase credentials as CI secrets — scope to a
read-only probe.
_Risks:_ The probe skips silently without credentials — `--strict` is what makes it
meaningful.
_Tests:_ Deleting a migration turns the enum check red (`lessons.md`: _"prove a new guard
fails"_).
_Rollback:_ Remove steps. _Success:_ A committed-but-unapplied migration fails CI.

---

**APPLE-01 — Link + validate iOS splash** · S · depends on RELEASE-01

_Problem:_ Ten splash PNGs ship in `public/splash/` and are referenced **zero** times —
confirmed absent from the deployed production HTML, not merely from source.
`layout.tsx:22-26` declares `appleWebApp` with `capable`, `title`, and `statusBarStyle`
but **no `startupImage`**. They are also outside the SW precache glob
(`build-sw.mjs:56-57`), and there are no light/dark variants.
_Scenario:_ Every iOS home-screen launch shows the flat `background_color` instead of the
brand launch image the project already generated.
_Implementation:_ Add `startupImage` entries with correct per-device media queries, then
add the CI parity check so the set cannot silently drift back to zero.
_Simpler alternative:_ Link the single most common device size. Rejected — per PR-5 a
mismatched media query silently no-ops, so a partial set is indistinguishable from none.
_Affected:_ `src/app/layout.tsx` · `scripts/generate-icons.mjs` · `build-sw.mjs` · CI.
_Migration:_ None.
_Apple fallback:_ **iOS caches launch assets — validation requires deleting and
reinstalling the home-screen app.** Non-matching devices fall back to `background_color`,
which is today's behaviour, so the change is strictly additive.
_Risks:_ The current ten cover neither every current device nor landscape/appearance
variants. State the coverage explicitly rather than implying completeness.
_Tests:_ CI asserts every declared link resolves to a shipped asset and every shipped
asset is declared. Device validation is manual.
_Rollback:_ Remove the array. _Success:_ Branded launch image on covered devices;
parity check green.

---

**SET-04 — Always-available data controls** · M · depends on SET-01, MEDIA-01

_Problem:_ No account deletion, no data export, no retention control, no way to see or
clear stored media from Settings. Media deletion lives only on the Enhance screen.
Per-result export exists (`TransformationDiff.tsx:264-278`) but there is no account-level
export.
_Scenario:_ A user wants their prompts out, or their account gone, and there is no path.
_Implementation:_ Export first — reuse the existing md/json/txt exporters over a full
query. Then retention display, then account deletion with a verified cascade.
_Simpler alternative:_ Export only. Zero destructive risk, and it is the control most
users actually want.
_Affected:_ `ProfilePanel.tsx` · `src/lib/profile/actions.ts` · new export action ·
deletion cascade (needs DB-01).
_Migration:_ Deletion needs a verified cascade across all seven tables plus storage.
_Security:_ Deletion must be irreversible and confirmed; export must be
owner-scoped and rate-limited.
_A11y:_ Destructive actions need clear labels and must clear the fixed nav (SET-01).
_Risks:_ A partial cascade leaves orphaned storage — which is exactly why DB-01 comes
first.
_Tests:_ Export contains every owned row and nothing else. Deletion removes all rows and
all storage objects.
_Rollback:_ Export is additive; hold deletion behind a flag until the cascade is proven.
_Success:_ Users can retrieve and remove their data unaided.

---

**PWA-01 — Harden existing offline** · M · depends on CACHE-01, SAFE-01, SAFE-02

_Problem:_ X-T1's "add a service worker" premise is **wrong** — one exists. Real gaps:
CACHE-01, SAFE-01, SAFE-02, no cache-first tier for immutable `/_next/static`,
`splash/**` outside the precache glob, and `docs/architecture.md:26-33` documenting four
caches and Background Sync that do not exist. BCD confirms `SyncManager` and
`PeriodicSyncManager` are `safari: false` / `safari_ios: false`.
_Implementation:_ Ship the three P0s underneath this umbrella; add a `CacheFirst` tier
for hashed static assets; correct the documentation.
_Simpler alternative:_ Documentation correction alone — near-zero cost and removes a
misleading record.
_Affected:_ `sw-src.js` · `build-sw.mjs` · `docs/architecture.md`.
_Risks:_ Cache-first on hashed assets is safe only because filenames are content-hashed;
never extend it to unhashed paths.
_Tests:_ Static assets served from cache offline; navigations network-first.
_Success:_ Offline reopen works without serving private HTML.

---

**GOV-01 — Brand-separation contact** · XS · no dependencies

_Problem:_ `SECURITY.md:3-7` directs reports to `sean@vasey.audio` — a **VASEY.AUDIO**
address on a VASEY/AI product, contrary to CLAUDE.md §6 ("Zero VASEY.AUDIO crossover in
copy, assets, or metadata"). The repository is public.
_Implementation:_ Switch to GitHub Private Vulnerability Reporting — the sanctioned
fallback. **Creating a new mailbox is explicitly a human task and is not proposed here.**
_Simpler alternative:_ None cheaper.
_Affected:_ `SECURITY.md` · repository security settings (human action).
_Risks:_ Enabling private reporting is a repo setting a human must toggle; do not remove
the existing contact until the replacement is live.
_Tests:_ None automatable. _Success:_ No VASEY.AUDIO reference in public metadata.

---

**PROD-01 — Separate the overloaded Target** · XL · ⚠️ PR-7 gated, **not approved here**

_Problem:_ `target` simultaneously selects optimizer, destination idiom, and pricing row.
`buildSystemPrompt:86-106` proves the conflation by substituting `TARGET_CONVENTIONS`
out entirely for `polish` and `clarify`.
_Recommended direction if later approved:_ Add a **new nullable `destination` column**
defaulting to the existing target. Additive, reversible, and it avoids renaming the
`model_target` enum — which `lessons.md` documents as the most incident-prone surface in
the project.
_Simpler alternative:_ Clarify the label and help text without splitting the model.
_Blocks:_ UX-05, EXP-04, and part of PROD-02.
_Note:_ Per PR-7 this requires its ID explicitly present in an APPROVED-IDS block. It is
listed for completeness and must not be built on this approval.

---

### 8.2 — P2 briefs

Compact. Each states problem → direction → simpler alternative → affected → test.

| ID                                        | Verified problem → recommended direction                                                                                                                                                                            | Simpler alternative                            | Affected                                                            | Required test                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **PWA-08**                                | Single non-media-qualified `theme-color` (`layout.tsx:31`); `ThemeManager.tsx:49` mutates it after hydration → add a light-media variant; runtime updater owns explicit overrides only                              | Add the media variant, leave the updater alone | `layout.tsx`, `ThemeManager.tsx`                                    | Light-preference cold load shows `#EEF0F4` in head markup                                 |
| **PWA-06**                                | `orientation: "portrait"` locks installed apps, contra WCAG 2.2 SC 1.3.4 and the iPad target → set `"any"`                                                                                                          | Ship with layout audit first                   | `manifest.webmanifest`                                              | Landscape renders without clipping at iPad sizes                                          |
| **UX-03**                                 | No `scroll-padding-top` anywhere despite `sticky top-0 z-40`; `MediaStudio.tsx:351` uses `block:'center'` to compensate → add `scroll-padding-top`, then conditional `scrollIntoView` with user-scroll cancellation | `scroll-padding-top` alone                     | `globals.css`, `StreamingResult.tsx`                                | Stream anchor lands below the sticky header; a deliberate user scroll is never overridden |
| **PWA-05**                                | Four clipboard writes, zero reads; no paste affordance though the north star opens with pasting → explicit "Paste" button calling `readText` on click only                                                          | —                                              | `EnhanceComposer.tsx`                                               | Never auto-reads; ordinary ⌘V still works                                                 |
| **PWA-04**                                | No keyboard handlers outside `ModeRig` → ⌘/Ctrl+Enter submit with `event.isComposing` guard                                                                                                                         | Ship ⌘Enter only, defer the palette            | `EnhanceComposer.tsx`                                               | IME composition does not submit; no double-submit while pending                           |
| **UX-04**                                 | Reset aborts the stream _and_ clears the draft with no undo (`EnhanceComposer.tsx:221-228`) → Undo affordance for substantial drafts                                                                                | Confirm only when a result exists              | `EnhanceComposer.tsx`                                               | Undo restores draft and result                                                            |
| **POLISH-03**                             | `Math.ceil(len/4)` shown unqualified (`:63-65,213-216`); the same heuristic drives **abort billing** (`route.ts:227-232`) → add tilde + accessible note; scrutinise the billing use                                 | Tilde only                                     | `EnhanceComposer.tsx`                                               | Estimate is marked approximate and explained                                              |
| **UX-06**                                 | Export and `navigator.share` **already ship**; gaps are silent copy failure (`:77`) and absent assumptions → status on copy failure; assumptions later                                                              | Copy-failure status alone                      | `TransformationDiff.tsx`                                            | Clipboard rejection surfaces a message                                                    |
| **LIB-01**                                | 17 model chips render unconditionally while tag chips correctly derive from data (`LibraryBrowser.tsx:70-102`) → render only represented models, with counts                                                        | —                                              | `LibraryBrowser.tsx`                                                | Chips ⊆ models present in the user's prompts                                              |
| **LIB-03**                                | `deriveTitle` truncates the **input** (`util.ts:20-25`) — a broken prompt yields a broken title → derive from improved output; add rename                                                                           | Title from output only                         | `library/util.ts`, `PromptDetail.tsx`                               | Title reflects output; rename persists                                                    |
| **LIB-04**                                | Unbounded `prompts` select plus a second query over every version row counted in JS (`library/page.tsx:16-53`) → cursor pagination; count as a DB aggregate                                                         | DB-side count only                             | `library/page.tsx`                                                  | Constant query count at 1/100/1000 prompts                                                |
| **LIB-02**                                | `savePromptAction` documented non-idempotent and retried by the outbox → client idempotency key, conflict-tolerant insert                                                                                           | Idempotency key only                           | `library/actions.ts`, `outbox.ts`                                   | Replayed key does not duplicate                                                           |
| **SET-02**                                | Save enabled regardless of dirtiness; email field already does the right check (`ProfilePanel.tsx:110` vs `:218-225`) → compare against props                                                                       | —                                              | `ProfilePanel.tsx`                                                  | Disabled when clean                                                                       |
| **SET-03**                                | Batch save, two autosaves, one detached global notice → per-section status next to each control                                                                                                                     | Move the notice                                | `ProfilePanel.tsx`                                                  | Status names what changed                                                                 |
| **SET-01**                                | Unsectioned column, no Data & Privacy group → add section headings (creates SET-04's slots)                                                                                                                         | Headings only                                  | `ProfilePanel.tsx`                                                  | Destructive actions clear the fixed nav                                                   |
| **UX-08**                                 | Two appearance owners (`ScreenHeader` toggle + `ProfilePanel` segmented); no `scroll-padding-bottom`                                                                                                                | Keep one owner                                 | `ScreenHeader.tsx`, `ThemeToggle.tsx`                               | One appearance control                                                                    |
| **UX-01**                                 | Editor sits below a decorative emblem and two selector rails → move the thinking rail into Advanced                                                                                                                 | Thinking rail only                             | `enhance/page.tsx`, `EnhanceComposer.tsx`                           | Textarea above the fold at 375px                                                          |
| **UX-02** ⚠️                              | Six-cell grid + persistent help strip; **PR-7 gated** → reveal-on-focus strip, taxonomy untouched                                                                                                                   | Strip change only                              | `ModeRig.tsx`                                                       | 44×44 per cell at 320px                                                                   |
| **UX-07**                                 | Media is a sibling section; no role labels, no retention note → add retention/processing note and per-item roles in place                                                                                           | Retention note only                            | `MediaStudio.tsx`                                                   | Retention disclosed before upload                                                         |
| **POLISH-01**                             | 24+ emoji/symbol glyphs as icons; the SVG system already exists in `DeveloperIcon.tsx` → migrate composer's five first                                                                                              | Composer only                                  | `EnhanceComposer.tsx`, `MediaStudio.tsx`, `ThemeToggle.tsx`, others | No emoji codepoints in UI source                                                          |
| **PERF-01**                               | Zero measurement; 30fps canvas + multiple blur layers, though hidden-pause and reduced-motion are already handled → **profile on a real device; the measurement is the deliverable**                                | Add Web Vitals reporting                       | `NeuralMeshBackground.tsx`, CI                                      | A profile artifact exists                                                                 |
| **PROD-02**                               | 16-option select mandatory; no Auto → labelled "Recommended" default                                                                                                                                                | Recommended label only                         | `EnhanceComposer.tsx`                                               | Default is reachable in one tap                                                           |
| **PROD-03**                               | No clarification step; the model embeds questions in output instead → list assumptions above the result                                                                                                             | Assumptions only, no round trip                | `formatters.ts`, `TransformationDiff.tsx`                           | Assumptions render when made                                                              |
| **PROD-08**                               | Production `/` 307s to `/sign-in`; no demo, no provider disclosure → **precomputed** showcase (needs no anonymous session, so PR-6 does not bind)                                                                   | Static before/after pair                       | `sign-in/page.tsx`                                                  | Value visible pre-auth at zero cost                                                       |
| **EXP-02**                                | No refinement chips; the pattern already exists at `PromptDetail.tsx:302-407` → reuse it on the enhance result                                                                                                      | Two chips only                                 | `TransformationDiff.tsx`                                            | Lineage preserved per refinement                                                          |
| **RUNTIME-01**                            | `engines >=20`, CI 22, no `.nvmrc`; **zero edge functions** despite CLAUDE.md §7 → correct the docs, add `.nvmrc` (absorbs DISC-03)                                                                                 | Docs + `.nvmrc`                                | `CLAUDE.md`, `docs/architecture.md`, `.nvmrc`                       | Docs match `lambdaRuntimeStats`                                                           |
| **DISC-09**                               | CSP keeps `script-src 'unsafe-inline'` for the theme bootstrap → nonce the inline script                                                                                                                            | Defer                                          | `next.config.ts`, `layout.tsx`, `middleware.ts`                     | CSP has no `unsafe-inline`                                                                |
| **DISC-01 / DISC-02 / DISC-04 / DISC-06** | Broken `test:int`; workbox transitives; dropped adapter `opts`; unbilled media failures                                                                                                                             | Each independently trivial                     | `package.json`, `openai-compat.ts`, `media/route.ts`                | Scripts run; deps explicit; opts forwarded                                                |

---

## 9. Acceptance criteria

Testable Given/When/Then. No criterion says "looks better", "smoother", or "more native".

### Gate 0

**DB-01**

- Given an empty Postgres instance, When every file in `supabase/migrations/` is applied
  in order, Then all seven tables, seven enums, and `usage_window` exist and the run exits 0.
- Given the rebuilt database and two users A and B, When A queries `prompts`,
  `prompt_versions`, `activity_events`, `usage_events`, `media_assets`, or `profiles`,
  Then zero rows belonging to B are returned.
- Given the rebuilt database, When RLS status is queried for all seven tables, Then every
  table reports RLS enabled.
- Given a fresh `pg_dump --schema-only` of the hosted project, When it is diffed against
  the committed baseline, Then there is no schema difference.

**SAFE-01**

- Given user A signed in with a draft "alpha", When A signs out and B signs in, Then the
  composer is empty and no request carries A's draft.
- Given A queued a save while offline, When A signs out and B signs in and connectivity
  returns, Then **zero** rows authored by A appear under B's `user_id`.
- Given B is signed in, When the outbox is inspected, Then it contains no item stamped
  with A's id.
- Given a signed-out visitor, When the app loads, Then theme preference still applies.

**COST-01**

- Given `today_cost = cap − $0.01` and 20 concurrent requests, When all complete, Then
  total settled spend for the day ≤ `cap + one maximum single-request cost`.
- Given a request whose projected maximum exceeds remaining headroom, When it is
  submitted, Then it is refused **before** any provider call with `capReached: true`.
- Given a run aborted mid-stream, When the ledger is read, Then exactly one row exists
  for it with non-zero tokens.
- Given the same idempotency key submitted twice, When both complete, Then exactly one
  ledger row exists.

**CACHE-01**

- Given user A has visited `/library`, When A signs out, Then Cache Storage contains no
  response whose URL path is `/library`, `/enhance`, `/library/*`, or `/profile`.
- Given a signed-in user online, When they navigate to `/library`, Then the response is
  served from network, not from a cached copy.
- Given a signed-in user offline, When they navigate to `/library`, Then `offline.html`
  is served.

**SAFE-02**

- Given IndexedDB rejects the write, When the user saves offline, Then the UI states the
  save did **not** persist and the result remains on screen.
- Given the user is online and `savePromptAction` throws, When the save fails, Then the
  UI shows an error and does **not** say "Queued".
- Given IndexedDB accepts the write while offline, When the user saves, Then the UI says
  "Queued" and the item is present in the outbox.

**DIFF-01**

- Given a 20,000-character input and a 16,000-token output, When `diffWords` runs, Then
  it completes within the documented time budget and within the documented memory budget.
- Given inputs whose token product exceeds the configured ceiling, When a diff is
  requested, Then the line-level fallback is used and the UI labels the diff as coarse.
- Given the Library detail screen, When a character is typed into the revise textarea,
  Then `diffWords` is **not** recomputed.

### Gate 1 (selected)

**PROD-07** — Given a video attachment, When analysis completes, Then the UI states that
only the first frame was analysed. Given an audio attachment, Then the UI states only
duration was read. Given the `MediaAttributes` type, Then it declares no field the
extractor never populates.

**PROD-04** — Given the eval harness, When `OUTPUT_CONTRACT` is altered to permit role
labels, Then at least one assertion fails. Given an unmodified contract, Then the suite
passes on every case.

**PROD-06** — Given any provider returning an error, When it reaches the client, Then the
payload contains a stable code and no upstream provider text.

**RELEASE-01** — Given a migration committed but not applied to the hosted project, When
CI runs, Then `check:db-enum --strict` fails the build.

**APPLE-01** — Given the built application, When every `apple-touch-startup-image` link
is enumerated, Then each resolves to a file in `public/splash/` and each shipped splash
asset is referenced by exactly one link.

**GOV-01** — Given `SECURITY.md`, When it is read, Then it contains no `vasey.audio`
address.

### Gate 2+ (selected)

**PWA-08** — Given a light OS preference, When the document is first painted, Then a
`theme-color` meta matching `(prefers-color-scheme: light)` with `#EEF0F4` is present in
the served markup, before hydration.

**PWA-06** — Given the installed app on iPad, When rotated to landscape, Then the app
rotates and no content is clipped.

**A11Y-01** — Given each of the five routes at 320 CSS px and at 200% text zoom, When axe
runs, Then zero serious or critical violations are reported and every interactive target
measures ≥44×44.

**A11Y-02** — Given the avatar-crop modal is open, When Tab is pressed repeatedly, Then
focus never leaves the modal; When Escape is pressed, Then focus returns to the avatar
button.

**UX-03** — Given a submit with the software keyboard open, When streaming begins, Then
the result anchor is scrolled below the sticky header; and Given the user has manually
scrolled away, Then no programmatic scroll occurs.

**LIB-03** — Given a saved prompt, When the Library list renders, Then the title derives
from the improved output; and When renamed, Then the new title persists across reload.

---

## 10. Apple validation matrix

**None of this was executed** — no Apple hardware or simulator was available. This is the
follow-up specification, not a result. Legend: ✓ must pass · n/a not applicable ·
◐ degraded-but-acceptable.

|  #  | Scenario                                 | iPhone Safari | Installed iPhone PWA | iPad portrait | iPad landscape / Split View | macOS Safari | Chromium | VoiceOver / keyboard | Pass condition                                                                                |
| :-: | ---------------------------------------- | :-----------: | :------------------: | :-----------: | :-------------------------: | :----------: | :------: | :------------------: | --------------------------------------------------------------------------------------------- |
|  1  | Paste → Enhance → stream → Copy          |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Full loop completes; result copied to clipboard                                               |
|  2  | Keyboard open + fixed nav                |       ✓       |          ✓           |       ✓       |              ✓              |     n/a      |    ◐     |          ✓           | Nav hides while keyboard up; no content obscured                                              |
|  3  | Result scrolling during stream           |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Result visible; deliberate user scroll never overridden                                       |
|  4  | Reset / Undo                             |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Stream aborts; draft recoverable                                                              |
|  5  | **Startup image**                        |      n/a      |          ✓           |      n/a      |              ◐              |     n/a      |   n/a    |         n/a          | Branded splash, not flat `#0F1012`. **Delete and reinstall first — iOS caches launch assets** |
|  6  | Offline reopen → reconnect               |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | `offline.html` offline; queued items replay once online                                       |
|  7  | **Account switching**                    |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |         n/a          | **Zero carry-over of draft, outbox, or cached HTML**                                          |
|  8  | IndexedDB unavailable (Private Browsing) |       ✓       |         n/a          |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Save failure reported truthfully, never "Queued"                                              |
|  9  | Share intake / fallback                  |  n/a (PR-2)   |      n/a (PR-2)      |      n/a      |             n/a             |     n/a      |    ✓     |          ✓           | Chromium share target works; iOS offers paste instead                                         |
| 10  | Outgoing share (PR-3)                    |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ◐     |          ✓           | Native sheet opens; clipboard fallback elsewhere                                              |
| 11  | Drag/drop · file picker · paste          |       ◐       |          ◐           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Every intake path works; drop never replaces the button                                       |
| 12  | Rotation / multitasking                  |       ✓       |          ✓           |       ✓       |              ✓              |     n/a      |    ✓     |          ✓           | State preserved; safe areas respected (needs PWA-06)                                          |
| 13  | Light / dark / system first paint        |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |         n/a          | No wrong-coloured chrome flash (needs PWA-08)                                                 |
| 14  | 320px + 200% text zoom                   |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | No horizontal scroll; no clipped controls                                                     |
| 15  | Version compare, long prompts            |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Diff bounded; fallback labelled (needs DIFF-01)                                               |
| 16  | Media roles                              |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Capability copy matches behaviour (needs PROD-07)                                             |
| 17  | Provider unavailable / degraded          |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |          ✓           | Stated before commit, or fallback explained after                                             |
| 18  | Concurrent spend                         |       ✓       |          ✓           |       ✓       |              ✓              |      ✓       |    ✓     |         n/a          | Cap holds within one max request (needs COST-01)                                              |

Note on #2 and #12: `src/lib/pwa/keyboard.ts` and `use-keyboard-visible.ts` implement a
visual-viewport heuristic with pinch-zoom excluded, and `lessons.md` documents the WebKit
behaviour behind it. That logic is unit-tested but **its on-device behaviour is
unverified here.**

---

## 11. Test and observability plan

### Coverage to add, by layer

| Layer           | Present                                                                                  | To add                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Unit**        | 172 tests / 19 files — strong on formatters, stream scanner, enum parity, safe-area math | `diffWords` size and time budget; `enqueueOutbox` failure return; outbox owner filtering                             |
| **Integration** | **None** — `test:int` targets a missing directory (DISC-01)                              | RLS isolation across all seven tables; storage prefix isolation; transactional mutation result codes                 |
| **E2E**         | 1 file, 9 tests, mobile-safari + mobile-chrome                                           | **Two-user account-switch spec**; offline enqueue → reconnect → replay; concurrent spend; a desktop project (PWA-07) |
| **Device**      | None                                                                                     | The §10 matrix, manually                                                                                             |
| **A11y**        | Skip-link presence only                                                                  | `@axe-core/playwright` on all five routes; a 320px project; one manual VoiceOver pass                                |
| **Perf**        | None                                                                                     | `diffWords` benchmark; canvas/blur profile on a mid-tier iPhone; Web Vitals field reporting                          |
| **Privacy**     | None                                                                                     | Assert no prompt text, filename, or identity reaches any analytics payload                                           |
| **Migration**   | Enum replay test (good)                                                                  | Ephemeral full rebuild; hosted `pg_dump` diff                                                                        |
| **Semantic**    | Negative-substring unit tests                                                            | This audit's eval harness, scheduled                                                                                 |

### Observability — content-free by construction

**Never emitted:** prompt text, improved output, rationale, attachment filenames or
contents, titles, tags, email, display name, or any provider error string containing
upstream identifiers. Only enumerated values, durations, counts, and booleans.

| Metric                                         | Why it matters                         | Ties to           |
| ---------------------------------------------- | -------------------------------------- | ----------------- |
| Paste → first Enhance (ms)                     | The north star's one deliberate action | UX-01, PWA-05     |
| Completion / cancel / retry / fallback rate    | Reliability of the core loop           | PROD-05, PROD-06  |
| Copy / Replace / Save rate per result          | Whether the output is actually used    | UX-06             |
| Clarification shown / answered / skipped       | Whether PROD-03 helps or interrupts    | PROD-03           |
| Accidental Reset → Undo rate                   | Sizes UX-04 objectively                | UX-04             |
| Destination chosen vs. default                 | Whether model choice is expert-only    | PROD-02, UX-05    |
| Duplicate-save interception count              | Confirms LIB-02's cause is mechanical  | LIB-02            |
| Library search → open (ms)                     | Findability                            | LIB-01, LIB-03    |
| **Ledger variance vs. provider invoices**      | The only true test of cap correctness  | COST-01, META-01  |
| Offline enqueue / replay failure rate          | Structurally invisible today           | SAFE-02           |
| **Cross-account mismatch count**               | **Must be exactly zero**               | SAFE-01, CACHE-01 |
| p75 LCP / INP / CLS by route and Apple surface | PERF-01's missing evidence             | PERF-01           |

Two of these are pass/fail rather than trends: **cross-account mismatches must be zero**,
and **no day may exceed `cap + one max request`**. Everything else informs prioritisation.

---

## 12. Final recommendation

### Ship first

**Gate 0, in order: DB-01 → CACHE-01 · SAFE-02 · DIFF-01 (parallel) → SAFE-01 →
COST-01.** DB-01 leads not because it is most urgent to a user but because the other five
cannot be regression-tested without it. Alongside, take the free wins: GOV-01, DISC-01,
DISC-02, and PWA-08 and PWA-06 as one-line changes.

The honest summary is that VIZION's _product_ is in better shape than its _substrate_.
The transformation contract — the hardest and most valuable thing here — is empirically
sound; this audit paid to test it and it passed 20 out of 20. What is weak is everything
that assumes a single user on a single device with unlimited money and a database that
lives in source control.

### Don't build

**PERF-02 (WebGPU)** — rejected on measured-workload grounds, notwithstanding that
Apple-platform availability arrived in Safari 26. **EXP-01, EXP-03, EXP-04** — each
doubles or diversifies spend against a cap that does not hold, or adds organisation
before existing organisation is exercised. **PWA-09 as a build** — write the ADR, not the
feature; VIZION has no notification-worthy event. **LIB-05** — already implemented; a
second version-comparison feature would be pure waste. **Y-05's export and share** —
already shipped.

### Prototype

**PROD-08's precomputed showcase** — the cheapest test of whether pre-auth value moves
the funnel, and it avoids PR-6 entirely by needing no anonymous session. **EXP-02's
refinement chips** — the interaction pattern already exists in `PromptDetail`; reuse
rather than invent. **PWA-07** — add a desktop Playwright project first so the surface is
at least observed before it is designed for.

### What remains genuinely uncertain

1. **Whether the P0s manifest in production.** Every one is established from source and
   arithmetic. None was executed. The cross-account and concurrency scenarios are the
   two most worth reproducing before scheduling, and both are cheap in a staging project.
2. **Whether the hosted database matches its documentation.** DB-01 exists precisely
   because this cannot be answered. DISC-07 shows the documented policy shape cannot even
   express ownership for two tables — so at least one of the two is wrong.
3. **Everything about real Apple devices.** Roughly a third of this audit's Apple-facing
   reasoning is specification-derived. The §10 matrix is the instrument for settling it.
4. **Whether the priority index reflects real user value.** With zero product analytics,
   the Reach and Impact scores are informed judgement, not measurement. The observability
   plan in §11 exists to replace that judgement with data.

### Evidence that would most change these conclusions

- A successful fresh-project rebuild from `supabase/migrations` alone → **DB-01 falls**.
- A concurrency experiment showing the cap holds → **COST-01 drops from P0**.
- A `diffWords` benchmark at 20k × 16k inside budget → **DIFF-01 drops to P2** (and this
  is runnable offline, with no authentication — the cheapest open question in the audit).
- Confirmation that navigations are excluded from the SW → **CACHE-01 falls**.
- Product analytics contradicting the Reach scores → the entire Gate 2–4 ordering should
  be re-derived from data rather than from this reviewer's judgement.

---

## Appendix — source error rate

Scored as _(refuted + redundant + platform-invalid) ÷ items contributed_. Z is this
prompt's own framework, scored on the same terms as the sources it adjudicates.

| Source                            | Contributed |                 Refuted                  |         Redundant (already built)         |            Platform-invalid            | **Error rate** |
| --------------------------------- | :---------: | :--------------------------------------: | :---------------------------------------: | :------------------------------------: | :------------: |
| **R** — Claude remediation audit  |     12      |                    0                     | 1 (R-02 icon/manifest largely conformant) |                   0                    |     **8%**     |
| **X** — external audit #1         |     14      | 2 (X-T1 "add a SW"; X-C1 compare exists) |           2 (X-C1, X-B2 partly)           |             2 (X-C2, X-T2)             |    **43%**     |
| **Y** — external product review   |     14      | 2 (Y-06 session history; Y-04 mechanism) |        2 (Y-05 export, Y-05 share)        |   2 (Y-10 haptics, Y-01 IP limiting)   |    **43%**     |
| **Z** — this evaluation framework |     62      |                    0                     |       1 (LIB-05 framed as missing)        | 1 (PR-4's WebGPU availability premise) |     **3%**     |

**Reading the numbers.** R scores well because it was written with repository access —
its one weak item overstated a problem rather than inventing one. X and Y converge at
~43% for the same reason: both proposed features that either already exist or cannot work
on WebKit. Every single platform-invalid item across both sources is an Apple-platform
assumption (`share_target`, Vibration API, IP-based limiting) — the failure mode is
uniform and predictable.

**Z is not exempt.** Two of its own positions needed correction against primary sources:
**PR-4 asserted a WebGPU availability posture that Safari 26 / iOS 26 has since
overtaken**, and **LIB-05 was framed as a gap when arbitrary version comparison already
ships**. Z's low rate mostly reflects that it was written _after_ R, X, and Y and had
their errors to route around — a structural advantage, not superior insight. Its real
contribution was the pre-adjudicated rulings, which stopped three already-refuted
premises from being re-litigated for a fourth time.

**The transferable lesson:** every high-error item in this audit shares one root cause —
**asserting platform capability or product absence without checking**. Two commands would
have prevented nearly all of them: a compat-data lookup, and a grep of the repository.

---

**Evaluation complete. No implementation has been performed. Select the approved proposal IDs and release gate before authorizing code changes.**
