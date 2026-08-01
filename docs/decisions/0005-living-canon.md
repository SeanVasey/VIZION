# 5. The living canon is code + CHANGELOG + tokens + the audit ledger

Date: 2026-08-01
Status: accepted

## Context

Three root files — `VIZION FINAL PLAN v1.md`, `VIZION-product-spec.md`,
`VIZION-style-guide.html` — were described by `CLAUDE.md` §1 as "authoritative
companions (treat as locked)". They describe the **v1 era**: a three-model panel
(Opus 4.8 · GPT-5.5 · Gemini Pro 3.1) with five enhancement modes. The shipped
product is sixteen target models across twelve developers, six modes (Polish
arrived with its own migration), and "Target" renamed "Adapt".

So the repo simultaneously ordered agents to treat those files as locked truth
*and* stated a different roster and mode-count in the same `CLAUDE.md` section.
Every audit cycle re-discovered the contradiction (`DOC-005`, `MOD-002`) and had
no standing to resolve it, because "locked" forbade both editing them and
ignoring them. This is the ruling that resolves it (audit question **Q2**, owner
accepted recommendation (a)).

## Decision

1. **The three v1 files are reclassified as historical.** They move to
   `docs/history/` (see its `README.md`) and are kept verbatim for provenance.
   They are no longer authoritative and must not be "treated as locked."

2. **The living canon — the sources of truth an agent must reconcile against —
   is:**
   - **the code** (`src/`), first and last: what actually ships;
   - **`CHANGELOG.md`**: the dated record of every behavioural change, including
     the 3→16 model and 5→6 mode transitions;
   - **`src/styles/tokens.css`**: the LOCKED 7-role design-token layer (additive
     tokens live in `globals.css`);
   - **the audit ledger** under `docs/audits/` (`01-ledger.md` +
     `02-adjudication.md` + the decision records it cites).

3. **Section citations survive the move.** Source comments cite the v1 spec and
   style guide by section (`product-spec §4.1`, `style-guide §1.4`) as
   historical rationale. Those citations are not path links and remain valid;
   they are pointers to *why*, while the code and tokens remain the *what*.

## Consequences

- `CLAUDE.md` §1 no longer calls the three files "locked authoritative
  companions"; it points at `docs/history/` and names this ADR as the canon of
  record. `docs/architecture.md` and `docs/decisions/0001-stack.md` update their
  path references to `docs/history/`.
- Future audits reconcile against the living canon above. A disagreement between
  a historical file and the code is **not** a finding — it is expected drift, by
  this decision.
- If the product ever wants a *current* narrative spec, it is written fresh
  against the code, not by editing the v1 files.
