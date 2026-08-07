# Repository assessment — 2026-07-29

## Executive assessment

VIZION is a notably disciplined, product-coherent Next.js PWA. It has strong
typing, unusually broad unit coverage, authenticated browser coverage through a
realistic Supabase seam, deliberate mobile interaction work, server-only model
credentials, RLS-oriented data access, bounded inputs, security headers, and an
offline outbox. The code reads like a maintained product rather than a prototype.

The largest risk is not component code. It is **environment reproducibility**:
the repository explicitly does not contain the baseline database schema, so a
new environment cannot be recreated or audited from version control alone. The
next largest risk is **cost-limit atomicity**: model routes read a usage window,
call a provider, then write usage, which permits concurrent requests to pass the
same preflight and overshoot the cap. After those, the highest-return work is to
reduce a few very large client components, align documentation and CI with the
actual application, and add production observability and performance budgets.

### Scorecard

| Dimension              | Assessment                            | Rationale                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application efficiency | **Good (B+)**                         | Streaming, bounded payloads, debounced persistence, server components at route boundaries, and careful media handling are strong. Large client modules and no explicit bundle/Lighthouse budget leave regressions easy to miss.                |
| Code quality           | **Very good (A-)**                    | Strict TypeScript, focused pure helpers, extensive unit/e2e coverage, good operational notes, and consistent UX primitives. Several 650–770-line components and stale architecture text increase maintenance cost.                             |
| Security               | **Good, with two material gaps (B+)** | Auth uses server revalidation, APIs fail closed, keys stay server-side, CSP/RLS/rate and cost controls exist. Reproducibility of RLS/schema and non-atomic cost enforcement need priority attention.                                           |
| Functionality and UX   | **Very good (A-)**                    | Mobile-first, accessible, resilient states, safe areas, reduced effects, keyboard handling, and offline recovery are first-class. Small discoverability, status, and recovery improvements can add value without changing the visual language. |

## Scope and method

This was a static review of application source, tests, configuration, migrations,
CI, runbooks, and recent project lessons, followed by the repository verification
gate. No provider keys or hosted Supabase credentials were used, so live model
quality, production RLS behavior, OAuth, storage policies, and hosted schema drift
were not exercised. Recommendations below distinguish observed facts from items
that require production measurement.

## What is working well

### Efficiency

- Enhancement output streams over SSE rather than waiting for a full completion,
  and proxy buffering is disabled. The client can expose useful progress while a
  long request runs (`src/app/api/enhance/route.ts`).
- Model inputs, media context, item counts, and block lengths are bounded before a
  provider call, controlling latency, memory, abuse surface, and spend.
- The Zustand persistence adapter debounces synchronous `localStorage` writes,
  avoiding a write on every editor keystroke (`src/stores/ui.ts`).
- Media upload follows reserve → upload → ready, preventing browser-only quota
  checks from being the integrity boundary (`src/lib/media/pipeline.ts` and
  `supabase/migrations/20260727120000_media_roles_and_reservation.sql`).
- Route pages remain server components and hydrate only interactive islands. This
  is the right baseline even though much of the product is necessarily interactive.

### Quality and maintainability

- The project uses strict TypeScript, pure domain helpers, shared UI primitives,
  and a broad test suite covering provider formatting, stream parsing, media,
  library operations, accessibility contracts, security headers, and navigation.
- Browser tests reach authenticated product surfaces through a Supabase stub rather
  than a production auth bypass (`tests/e2e/global-setup.ts` and
  `tests/e2e/support/supabase-stub.mjs`). This is an excellent security-conscious
  test seam.
- `tasks/lessons.md` documents failure modes and corrected assumptions in unusual
  depth. It is valuable institutional memory, especially around WebKitGTK versus
  iOS, stale test servers, CSP, and service workers.
- Provider-specific behavior is behind one adapter/config boundary, making model
  changes substantially cheaper than scattering wire details through UI code.

### Security and privacy

- Middleware gates with `supabase.auth.getUser()`, not cookie-only `getSession()`,
  and returns JSON 401s for unauthenticated APIs (`src/lib/supabase/middleware.ts`).
- Provider keys are accessed only in server-marked provider modules. The browser
  receives public Supabase credentials, as intended, and RLS remains the data
  boundary.
- Security headers include CSP, clickjacking protection, MIME sniffing protection,
  referrer and permissions policies, and production-only HSTS
  (`next.config.ts`). Custom/self-hosted Supabase REST and WebSocket origins are
  derived from configuration rather than assumed.
- Both model routes combine a cheap process-local burst limiter with the durable
  database usage window, validate request shapes, and record provider usage.
- Account deletion is POST-only and uses the service role only after authenticating
  the current user (`src/app/auth/delete-account/route.ts`).

### UX and aesthetics

- The design system is tokenized and consistent rather than composed of one-off
  values (`src/styles/tokens.css`, `src/styles/globals.css`).
- Safe-area, keyboard, scroll restoration, reduced-effects, press-state, loading,
  error, empty, and offline behavior are treated as product requirements.
- Shared sheet, segmented-control, toast, skeleton, pressable, and confirmation
  primitives reduce behavioral drift while preserving the established visual style.

## Prioritized findings and recommendations

### P0 — Make the database and security boundary reproducible

**Observed:** `AGENTS.md` states that core tables were applied live and are not
tracked; the migration directory contains only incremental changes. A bare project
therefore lacks profiles, prompts, versions, usage, media, their triggers, and their
original RLS policies.

**Risk:** A clean recovery, staging environment, security audit, contributor setup,
or vendor migration cannot reconstruct the production boundary. Generated types and
incremental migrations can agree while the hosted database differs. This is a
business-continuity and security-verifiability issue, not only developer convenience.

**Recommendation:** Export a reviewed baseline migration from the canonical project,
sanitize all data, and commit the full schema: enums, tables, constraints, indexes,
functions, grants, RLS enablement, policies, storage bucket configuration, and
triggers. Test `supabase db reset` (or an equivalent disposable-project restore) in
CI, then apply all incremental migrations and run policy assertions as authenticated
user A, user B, and anonymous. Preserve the hosted drift preflight as a separate check.

### P0 — Make spend reservation atomic across concurrent model requests

**Observed:** `/api/enhance` and `/api/media` query `usage_window`, perform a provider
call, and insert the final ledger row afterward. The preflight rejects only when
existing cost is already at the cap. Concurrent requests can all observe the same
remaining allowance; one request can also push the total above the cap.

**Risk:** The stated daily cap is a soft lagging threshold, not a strict cap. Parallel
requests, retries, disconnects, or ledger-write failures can overspend. The fallback
token estimate improves accounting but does not make admission atomic.

**Recommendation:** Add a Postgres RPC that atomically reserves a conservative
maximum request cost under a per-user advisory/row lock. Insert a pending ledger row
inside that transaction, reject when the reservation would exceed the limit, and
settle it to actual usage afterward. Expire abandoned reservations. Keep the in-memory
limiter only as a cheap first layer. Alert on reservation settlement failures.

### P1 — Commit schema-policy tests, not only enum-shape tests

**Observed:** Static tests carefully reconcile model enums, migrations, and generated
types, but the untracked baseline prevents equivalent tests for all RLS policies,
grants, foreign keys, immutability, indexes, and storage ownership rules.

**Recommendation:** Once the baseline exists, add disposable-database integration
tests for cross-user reads/writes, immutable version rows, collection ownership,
media path ownership, SECURITY DEFINER grants/search paths, and account deletion.
Fail CI if a new table lacks RLS or if `anon` can execute privileged functions.

### P1 — Add production observability with privacy-safe structured events

**Observed:** Critical failures use `console.error`/`console.warn`, and production
stripping intentionally retains them. There is no repository-level error tracking,
request correlation, metric export, or alert definition.

**Risk:** Ledger failures, provider drift, stream errors, latency regressions, and
offline replay failures may exist only as uncorrelated log lines. Conversely, adding
ad hoc logging later could accidentally capture prompts or extracted media context.

**Recommendation:** Define a small structured event interface with correlation ID,
route, target/provider, duration, status class, token counts, reservation/ledger
result, and salvage flag—never prompt/output/media content. Connect it to the hosting
platform or an error tracker. Add alerts for ledger/reservation failures, elevated
5xx/429 rates, provider parse salvage, and p95 latency. Document retention and access.

### P1 — Put measurable performance and accessibility budgets in CI

**Observed:** The suite has rich behavioral coverage but no committed Lighthouse,
bundle-size, Core Web Vitals, or automated axe budget. Fifty-three source modules are
client components, and the largest interactive modules are approximately 650–770
lines. These are not defects by themselves; they are regression risk.

**Recommendation:** Capture a production build baseline for route JS, LCP, CLS,
INP proxy/TBT, and accessibility. Gate only material regressions initially (for
example, route-JS growth over a fixed allowance), then tighten based on real devices.
Run axe against sign-in and stub-authenticated Enhance, Library, prompt detail, and
Profile. Collect real-user web vitals after deployment.

### P1 — Split the largest client components by responsibility

**Observed:** `TransformationDiff`, `AttachmentTray`, `EnhanceComposer`,
`PromptDetail`, and `LibraryBrowser` each combine data operations, local state,
interaction logic, and substantial rendering.

**Risk:** Large change surfaces raise review cost, increase unnecessary re-renders,
and make isolated tests harder. They also encourage future features to accumulate in
the same files.

**Recommendation:** Refactor incrementally, only when touching each area: extract
controller hooks for orchestration, retain pure view sections, and move independent
sheets/toolbars behind narrow props. Use the React Profiler before adding memoization;
do not introduce a new state framework or broad rewrite.

### P1 — Align architecture and CI documentation with reality

**Observed:** `docs/architecture.md` says failed navigation serves a precached `/`
shell, while current auth-era lessons say protected routes cannot be precached and the
static `offline.html` is the fallback. It also refers to Meta among provider additions
although the current target roster does not contain a Meta model. The diagram labels
route handlers “Edge,” but the routes do not export an Edge runtime and use dependencies
that should be verified before claiming it. CI runs build before e2e, while the
contracted gate describes e2e before build (and e2e performs its own build).

**Recommendation:** Update the architecture map from executable configuration,
identify route runtime accurately, document the real offline strategy, remove stale
provider text, and make the verification order consistent. Avoid duplicating mutable
facts where a link to the canonical roster/runbook is enough.

### P1 — Resolve the middleware Edge-runtime compatibility warning

**Observed:** The production build succeeds but warns that the Supabase bundle uses
the Node `process.version` API unsupported by the Edge runtime, with the import trace
ending at `src/lib/supabase/middleware.ts`. Middleware is itself an Edge-runtime
surface, irrespective of the API route runtime documentation.

**Risk:** Today this is a warning rather than a demonstrated failure, but dependency
or bundler changes can turn a tolerated dead-code path into an edge deployment defect.
Persistent build warnings also normalize noise and make new warnings easier to miss.

**Recommendation:** Reproduce against the deployed runtime, confirm whether the code
path is tree-shaken, and align the supported `@supabase/ssr`/`supabase-js` versions or
imports with Supabase's current Next middleware guidance. Add a smoke request through
deployed middleware and treat unexpected build warnings as CI failures after the
known warning is resolved. Do not suppress it without proving the emitted bundle is
safe.

### P2 — Improve offline recovery transparency

**Observed:** The app persists editor UI locally and queues supported writes in
IndexedDB, then flushes on reconnect/visibility changes. This is resilient, but queue
state is largely infrastructure rather than a visible user concept.

**Recommendation:** Add a subtle existing-style status in the editor/library:
“Saved,” “Waiting for connection,” or “Sync needs attention,” plus a manual retry and
details for failed items. Never imply server durability until replay succeeds. This is
a functional trust improvement that requires no visual redesign.

### P2 — Add provider readiness and failure guidance

**Observed:** Missing provider configuration is handled cleanly at request time with a 503. Users can still select a target that the deployment cannot serve and discover the
problem only after submitting.

**Recommendation:** Expose an authenticated, cacheable capability endpoint containing
only enabled provider/target IDs (never keys). Mark unavailable targets in the current
picker and explain why. Keep server validation authoritative because configuration can
change between selection and submission.

### P2 — Reduce avoidable client/data work in Library

**Observed:** Library filtering is a pure client operation over fetched prompt rows,
which is simple and appropriate at small scale. Paging utilities exist, but scale and
query plans were not measurable without the hosted database.

**Recommendation:** Establish expected library size, inspect `EXPLAIN ANALYZE` for the
real queries, and add indexes for actual predicates/orderings. When datasets justify
it, move search/filter/pagination server-side with a debounced query while retaining
the current UI. Do not add virtualization or full-text search preemptively.

### P2 — Small aesthetic/functionality improvements within the current system

1. Add restrained first-run guidance for Auto routing, thinking depth, and reference
   roles; dismiss permanently and reuse existing sheet/toast typography.
2. Make model availability, sync state, and storage quota visible at the decision
   point, using existing Amber/status treatments rather than new visual grammar.
3. Add command/keyboard hints where actions already have shortcuts, while keeping
   touch labels primary.
4. Preserve skeleton geometry and audit it against final content at narrow widths to
   reduce perceived layout movement.
5. Offer a compact “recent prompts” affordance in Enhance using existing cards, not a
   new dashboard, to improve repeat workflows.

## Suggested delivery sequence

1. **Recovery/security foundation:** commit baseline schema, disposable restore, and
   RLS/grant tests.
2. **Spend correctness:** atomic reservations, settlement, alerting, concurrency tests.
3. **Operational confidence:** structured privacy-safe telemetry and web-vitals/error
   dashboards.
4. **Regression budgets:** Lighthouse/axe/bundle baselines and CI thresholds.
5. **Focused maintainability:** split large components opportunistically behind current
   tests; correct architecture/CI documentation immediately.
6. **Product polish:** sync status, target availability, and low-key onboarding.

## Verification limits and follow-up evidence

The automated gate validates the repository without secrets. A release assessment
should additionally include:

- a clean schema restore into a disposable Supabase project;
- hosted `check:db-enum` plus security advisors and explicit RLS adversarial tests;
- one live request per configured provider, including abort and concurrent-cap cases;
- OAuth/magic-link/account-deletion tests in a non-production project;
- media upload/extraction/cleanup and quota tests against real Storage;
- Lighthouse and axe on a deployed preview, plus iOS Home Screen verification on
  physical hardware as prescribed by `docs/runbooks/ios-verification.md`;
- restore-from-backup timing and data-integrity evidence.

## Bottom line

The repository is already above the typical quality bar for a product of this size.
The best next investment is not a redesign or framework change. It is to make the
database boundary reproducible, make spend admission atomic, and measure production
behavior. Those changes protect the product while preserving its existing interaction
model and aesthetic.
