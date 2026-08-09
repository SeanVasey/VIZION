# 6. Tolerant envelope parsing — salvage a completed output over a malformed tail

Date: 2026-08-01
Status: accepted · extends [ADR-0002](0002-stream-inside-the-json-envelope.md)

> Retroactive record. The decision shipped in the 0.3.0 cycle (`CHANGELOG.md`,
> "enhance runs no longer die over a salvageable envelope"); this ADR files the
> rationale the audit found undocumented (`DOC-008`).

## Context

[ADR-0002](0002-stream-inside-the-json-envelope.md) has every provider stream a
JSON envelope (`{ "output": "…", "rationale": "…" }`) and a scanner extract the
`output` string live so the user sees tokens as they arrive. That contract
assumed a well-formed envelope at end-of-stream.

In practice a provider occasionally closes the stream with a malformed _tail_ —
a trailing comma, an unterminated `rationale`, stray text after the closing
brace — **after** the `output` string itself has demonstrably completed (its
closing quote was already seen by the scanner). Strict `JSON.parse` of the whole
raw buffer throws, and the original behaviour discarded the entire run: a paid,
fully-streamed, already-displayed result thrown away over garbage the user never
needed.

## Decision

**When strict parsing fails but the streamed `output` provably completed,
salvage it instead of failing the run.** In `src/lib/providers/adapter.ts`:

- The scanner tracks whether the `output` string closed (`scanner.done`) and
  accumulates the decoded text.
- If `parseEnhancePayload(raw)` throws **and** `scanner.done` is true **and** the
  decoded output is non-empty, the run recovers with
  `{ output: decoded.trim(), rationale: "" }` and a `salvaged` flag.
- The rationale is honestly empty — it is the part that was lost — never
  fabricated.
- If the output did **not** complete, the error still propagates: a truncated
  output is a real failure and must not masquerade as success.

## Consequences

- The envelope contract from ADR-0002 is relaxed at exactly one seam: a
  well-formed `output` survives a malformed surrounding envelope. The strict
  parse remains the happy path.
- `salvaged` rides the result so downstream can tell a clean parse from a
  recovered one; cost accounting is unaffected (usage is counted before parsing).
- A provider that regresses to truncating the `output` mid-string is still
  surfaced as an error — the salvage is gated on `scanner.done`, not on "any
  parse failure".
