# Historical planning documents

These three files are the **v1-era** planning canon for VIZION. They are kept
verbatim for provenance and are **no longer authoritative** — they describe a
three-model / five-mode product that the shipped app has long since outgrown
(sixteen target models, six enhancement modes, Target renamed Adapt, Polish
added). They also predate the wordmark simplification: they render the name
with the original parenthesized-aperture wordmark and explain its rationale,
which is why that spelling survives verbatim here and nowhere else in the tree.
Reading them as current truth generates false audit signals every cycle,
which is exactly the drift [ADR-0005](../decisions/0005-living-canon.md) was
written to stop.

| file                      | what it was                               |
| ------------------------- | ----------------------------------------- |
| `VIZION FINAL PLAN v1.md` | the original build plan and decision log  |
| `VIZION-product-spec.md`  | the v1 product specification (§-numbered) |
| `VIZION-style-guide.html` | the v1 visual style guide                 |

**Where the living canon lives now** (per ADR-0005): the code itself, the
`CHANGELOG.md`, `src/styles/tokens.css` (the locked 7-role token layer), and the
audit ledger under `docs/audits/`.

Section citations elsewhere in the tree (e.g. `product-spec §4.1`,
`style-guide §1.4` in source comments) point at these documents by section for
historical rationale; they remain readable here, but the behaviour of record is
the code and the tokens, not this text.
