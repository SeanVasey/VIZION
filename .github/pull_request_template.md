<!-- markdownlint-disable MD041 -->

<!--
PULL REQUEST TITLE

Use an imperative, specific title. Recommended convention:

  <type>(<scope>): <concise outcome>

Common types: feat, fix, perf, refactor, docs, test, build, ci, chore,
security, revert.

Examples:
  feat(enhance): add a per-model thinking-depth selector
  fix(library): prevent duplicate save on offline retry
  perf(api): reduce enhance-route admission latency

AUTHOR INSTRUCTIONS

1. Explain the outcome and evidence; do not merely inventory changed files.
2. Keep the level of detail proportionate to the change and its risk.
3. Replace every placeholder. For a consequential but inapplicable section,
   write `N/A — <brief reason>`. Delete optional low-value sections that do not
   apply so the rendered PR stays focused.
4. Open the PR as a draft until it is coherent enough for useful review.
5. Never include credentials, secret values, personal/customer data,
   unsanitized production logs, or private vulnerability details. Use the
   repository's approved private security-reporting process when necessary.
6. Check an author-attestation box only when it is true. CI results, required
   reviews, and rulesets remain the authoritative controls.
-->

## Summary

<!--
In 2–5 sentences, explain:
- what changed;
- why it was necessary; and
- the resulting user, product, developer, or operational outcome.

Prefer: “Users can now recover an interrupted upload without restarting it.”
Avoid: “Updated upload.ts and added tests.”
-->

## Context and motivation

<!--
Describe the problem, opportunity, incident, requirement, or technical debt.
Explain why this change belongs now and who benefits. Include evidence or
constraints that shaped the work when relevant.
-->

### Related work

<!--
Use GitHub closing keywords when appropriate: `Closes #123` or `Fixes #123`.
Link specifications, designs, discussions, incidents, decisions, analytics,
external tickets, or predecessor/follow-up PRs. Remove unused rows.
-->

| Reference               | Link or identifier |
| ----------------------- | ------------------ |
| Issue / task            | Closes #           |
| Specification / design  |                    |
| Discussion / decision   |                    |
| Incident / support case |                    |
| Related PR              |                    |

## Change profile

<!--
Use one or more change types: feature, bug fix, security, accessibility,
performance, refactor, documentation, test, dependency, build/CI,
infrastructure, database/data, maintenance, or revert.

Risk guidance:
- Low: isolated, backward-compatible, and easily reversible.
- Medium: affects shared behavior or needs coordinated validation.
- High: affects a sensitive or broad surface, public contract, production
  infrastructure, or state that is difficult to reverse.
- Critical: exceptional blast radius or safety/business continuity risk;
  requires an explicitly coordinated review and release plan.
-->

| Field                | Selection and rationale          |
| -------------------- | -------------------------------- |
| Change type(s)       |                                  |
| Primary area / owner |                                  |
| Risk level           | Low / Medium / High / Critical — |
| User-facing change   | No / Yes —                       |
| Breaking change      | No / Yes —                       |
| Version impact       | None / Patch / Minor / Major —   |
| Deployment mode      | None / Standard / Coordinated —  |
| Feature flag         | None / Existing / New —          |

## Scope and behavior

### In scope

<!-- List the behavior, surfaces, or responsibilities intentionally changed. -->

-

### Out of scope and non-goals

<!--
State what this PR intentionally does not solve. Link material follow-up work
rather than silently expanding scope.
-->

-

### Behavior before and after

<!--
Describe observable behavior. Use `N/A — no behavioral change` when accurate.
Add or remove rows as needed.
-->

| Scenario            | Before | After |
| ------------------- | ------ | ----- |
| Primary path        |        |       |
| Failure / edge path |        |       |

## Implementation

### Approach

<!--
Explain the implementation strategy, important invariants, unusual control
flow, trust boundaries, or state transitions. Keep routine mechanics brief.
-->

### Key changes

<!-- Group by behavior, component, route, service, API, or data layer. -->

| Area | Change | Rationale |
| ---- | ------ | --------- |
|      |        |           |

### Decisions and trade-offs

<!--
Record consequential choices, alternatives considered, and why this option was
selected. Note costs accepted now and decisions reviewers should challenge.
Use `N/A — straightforward implementation` when appropriate.
-->

- **Decision:**
  - **Alternatives considered:**
  - **Trade-off / consequence:**

## Impact and risk

<!--
Keep risk, breaking changes, known failures, and recovery limits visible.
Do not hide decision-critical information in a collapsed section.
-->

- **Affected users, systems, environments, or integrations:**
- **Highest credible failure mode:**
- **Blast radius and likelihood:**
- **Mitigations and safeguards:**
- **Backward / forward compatibility:**
- **Known limitations or unresolved concerns:**
- **Residual risk after mitigation:**

## Verification

### Automated checks

<!--
List checks actually run and their results. Link to durable CI evidence when
useful; do not paste raw logs. Explain failures and checks not run.
Add or remove rows to match the repository.
-->

| Check or command           | Result                | Evidence / notes |
| -------------------------- | --------------------- | ---------------- |
| Lint / formatting          | Pass / Fail / Not run |                  |
| Type / static analysis     | Pass / Fail / Not run |                  |
| Unit tests                 | Pass / Fail / Not run |                  |
| Integration tests          | Pass / Fail / Not run |                  |
| End-to-end tests           | Pass / Fail / Not run |                  |
| Build / package            | Pass / Fail / Not run |                  |
| Security / dependency scan | Pass / Fail / Not run |                  |

### Manual validation

<!--
Provide reproducible steps and results. Cover the primary path plus meaningful
negative, permission, recovery, and edge cases affected by this change.
-->

| Scenario          | Steps / input | Expected result | Actual result |
| ----------------- | ------------- | --------------- | ------------- |
| Primary path      |               |                 |               |
| Error / edge path |               |                 |               |

### Test environment

<!--
List only relevant details: OS, browser/device/viewport, runtime, database,
feature flags, test account role, locale/time zone, or representative fixture.
Use sanitized or synthetic data.
-->

- **Environment:**
- **Configuration / flag state:**
- **Browser, device, or viewport:**
- **Role / permission level:**
- **Data or fixture:**

### Coverage and gaps

- **Tests added or updated:**
- **Regression coverage:**
- **Not tested and why:**

## Conditional impact assessment

<!--
Complete every applicable module below. Delete an optional module that clearly
cannot apply. For security/privacy, data migrations, breaking contracts, or
production rollout, retain the module and state `N/A — <reason>` when its
inapplicability may not be obvious from the diff.
-->

### UI, UX, and accessibility

<!--
For user-visible changes, include before/after evidence with meaningful alt
text and a short textual explanation. Validate affected loading, empty, error,
disabled, success, offline, and permission states as applicable.

Address relevant keyboard behavior, focus order/visibility, semantics and
labels, screen-reader output, contrast, zoom/reflow, touch targets, reduced
motion, responsive layout, safe areas, themes, and supported locales.
-->

- **Visual evidence:**
- **States, themes, and responsive behavior validated:**
- **Accessibility validation and tools used:**
- **Localization / internationalization impact:**
- **Known UI or accessibility gaps:**

### Security and privacy

<!--
Explain changed trust boundaries and concrete mitigations. Consider
authentication, authorization, least privilege, RLS/policies, tenant isolation,
input/output handling, injection/XSS/CSRF/SSRF, file uploads, redirects, CORS,
rate limiting, abuse, secrets, CI permissions, sensitive logs/telemetry,
retention, consent, and third-party data sharing as applicable.

Do not claim “secure” without evidence. Do not disclose an unresolved exploit
or sensitive reproduction details in a public PR.
-->

- **Threat surface or trust-boundary change:**
- **Authorization and data-access review:**
- **Input, output, and abuse controls:**
- **Sensitive-data and logging impact:**
- **Security validation performed:**
- **Required security / privacy reviewer:**

### API, schema, contract, and integration compatibility

<!--
Cover public and internal APIs, events, queues, webhooks, CLI behavior, shared
types, serialized data, SDKs, third-party integrations, and consumers.
Describe versioning, deprecation, compatibility, and required consumer action.
-->

| Contract / consumer | Change | Compatibility                  | Consumer action / deadline |
| ------------------- | ------ | ------------------------------ | -------------------------- |
|                     |        | Backward-compatible / Breaking |                            |

### Database, storage, and data lifecycle

<!--
Name migrations without exposing secrets. Address deployment order, online
compatibility, locks/downtime, index cost, large-table impact, backfill volume,
batching, idempotency, retries, validation, RLS/policies, retention, deletion,
reversibility, and recovery. Distinguish code rollback from data recovery.
-->

- **Migration / change identifier:**
- **Data volume and affected records:**
- **Forward- and backward-compatible deployment order:**
- **Locking, downtime, or performance impact:**
- **Backfill / validation plan:**
- **Policy, ownership, retention, or deletion impact:**
- **Reversal, roll-forward, or data-recovery plan:**

### Dependencies and supply chain

<!--
Explain why each material dependency change is needed. Confirm provenance,
maintainer health, version/lockfile impact, license compatibility, advisories,
transitive risk, runtime/bundle impact, and removal of replaced packages when
applicable.
-->

| Dependency | Action / version          | Purpose | Security, license, and size review |
| ---------- | ------------------------- | ------- | ---------------------------------- |
|            | Added / Updated / Removed |         |                                    |

### Performance and resource use

<!--
Use measurements when performance could change. State the scenario, dataset,
hardware/environment, variability, and performance budget. Consider latency,
throughput, Web Vitals, query count, bundle size, memory, CPU, network, storage,
cold starts, and cache behavior as applicable.
-->

| Metric and scenario | Baseline | After | Delta / budget | Evidence |
| ------------------- | -------: | ----: | -------------: | -------- |
|                     |          |       |                |          |

- **Caching or invalidation impact:**
- **Expected behavior at peak / degraded conditions:**

### Reliability and observability

<!--
Describe timeouts, retries, backoff, idempotency, concurrency, partial failure,
rate limits, fallbacks, disaster recovery, and graceful degradation as relevant.
Identify the signals that distinguish healthy behavior from regression.
-->

- **Failure and recovery behavior:**
- **Logs, metrics, traces, or audit events added/changed:**
- **Dashboard, alert, or runbook impact:**
- **Expected post-release signals:**
- **Alert / escalation owner:**

### Automation or AI assistance

<!--
Complete only when repository policy or the change warrants disclosure. Name
the tools and scope of assistance, not private prompts or sensitive inputs.
Human review remains responsible for correctness, security, licensing, and
policy compliance.
-->

- **Tools / automation used:**
- **Files, tests, or decisions assisted:**
- **Human validation performed:**
- **Data-handling or licensing considerations:**

## Deployment, rollout, and recovery

<!--
Use `N/A — no runtime or release impact` when accurate. Do not put secret
values here; list variable or secret names only. A source-code revert is not a
complete recovery plan for irreversible data changes or external side effects.
-->

| Concern                                | Plan |
| -------------------------------------- | ---- |
| Environments affected                  |      |
| Prerequisites / external dependencies  |      |
| Environment variables / secret names   |      |
| Feature flag and default state         |      |
| Migration / deployment order           |      |
| Cache / queue / search-index action    |      |
| Rollout strategy and monitoring window |      |
| Expected downtime / user disruption    |      |
| Post-deploy verification               |      |
| Rollback trigger                       |      |
| Containment / code rollback            |      |
| Data recovery / roll-forward           |      |
| Responsible owner                      |      |

## Documentation and release communication

<!--
Link updated artifacts or explain why no update is needed. Consider README,
setup/configuration, `.env.example`, API/schema docs, architecture decisions,
runbooks, examples, screenshots, support guidance, migration/upgrade notes,
changelog, and release notes.
-->

| Artifact                      | Status                           | Link / rationale |
| ----------------------------- | -------------------------------- | ---------------- |
| User documentation            | Updated / Not needed / Follow-up |                  |
| Developer / API documentation | Updated / Not needed / Follow-up |                  |
| Operations / support runbook  | Updated / Not needed / Follow-up |                  |
| Changelog / release notes     | Updated / Not needed / Follow-up |                  |
| Migration / upgrade guidance  | Updated / Not needed / Follow-up |                  |

### Proposed release note

<!--
Write one concise, user-facing entry. Avoid implementation jargon. Use
`None — <reason>` for an internal-only change.
-->

## Reviewer guidance

<!--
Help reviewers spend attention where it matters. Do not reproduce the full file
list already provided by GitHub.
-->

- **Review focus / highest-risk areas:**
- **Suggested review order:**
- **Decisions or assumptions to challenge:**
- **Files that are generated or mechanical:**
- **Questions for reviewers:**

## Follow-up work

<!--
Every material deferred item should have an owner and tracking reference.
Use `N/A — no follow-up work` when accurate.
-->

| Follow-up | Owner | Issue / reference | Target |
| --------- | ----- | ----------------- | ------ |
|           |       |                   |        |

## Author readiness checklist

<!--
Check only completed attestations. If an item is inapplicable, make that clear
in the relevant section rather than treating an unchecked box as “N/A.”
-->

- [ ] The title and summary describe the outcome clearly and use the
      repository's conventions.
- [ ] The PR has a focused scope; unrelated changes were removed or separated.
- [ ] I reviewed the complete diff, including generated files, lockfiles,
      configuration, and migrations.
- [ ] Related issues, specifications, decisions, and follow-up work are linked.
- [ ] Applicable automated checks pass; failures, skipped checks, and untested
      areas are documented.
- [ ] Tests cover changed behavior and meaningful failure, permission,
      recovery, or edge paths where appropriate.
- [ ] User-visible states, responsive behavior, themes, localization, and
      accessibility were evaluated where affected.
- [ ] Security, privacy, authorization, data, dependency, and supply-chain
      implications were evaluated where affected.
- [ ] Breaking changes, compatibility limits, migrations, configuration
      changes, deployment steps, and recovery limits are disclosed.
- [ ] Documentation, examples, changelog entries, release notes, and
      operational guidance are updated where needed.
- [ ] No secrets, credentials, sensitive data, unsanitized logs, debug code, or
      unintended artifacts are included.
- [ ] Known limitations, residual risks, reviewer focus areas, and responsible
      owners are stated honestly.
- [ ] This PR is ready for review; required reviewers and repository-native
      checks will provide formal approval.

## Additional notes

<!--
Add any relevant context not captured above. Remove this section if empty.
-->
