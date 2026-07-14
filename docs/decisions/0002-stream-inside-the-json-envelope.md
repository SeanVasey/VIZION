# 2. Stream inside the JSON envelope (incremental output-field extraction)

Date: 2026-07-14 · Status: accepted

## Context

Token streaming for `/api/enhance` collided with the enhance contract: every
provider returns one JSON object `{output, rationale}`, enforced in the system
prompt and by `json_object` response modes, validated by `parseEnhancePayload`,
and guarded by negative-substring unit tests that exist because of two real
production bugs (role framing, shape destruction). Naive token streaming would
surface raw JSON syntax to the user; changing the model contract (plain text +
sentinel, or separate calls) would discard that hardening and lose `json_object`
enforcement.

## Decision

Keep the envelope exactly as it is. The adapter pipes every provider's raw
token stream through one pure scanner (`src/lib/providers/json-stream.ts`)
that finds `"output": "` and decodes the string's characters — escapes split
across chunk boundaries included — until the unescaped closing quote; those
decoded characters are the `delta` events. The full raw text is still
accumulated and validated with the unchanged `parseEnhancePayload` before the
`done` event. The buffered `enhance()` is a drain of `enhanceStream()`, so
there is exactly one code path.

Transport is SSE frames on the fetch POST response body (EventSource is
GET-only). Every pre-stream gate failure (auth, validation, rate/cost caps)
stays a plain JSON error with its real HTTP status; only post-header failures
become an in-stream `error` event.

## Consequences

- Zero prompt/contract churn; the formatter guard tests are untouched.
- The scanner is ~90 lines, pure, and chunk-fuzzed in unit tests.
- `rationale` is not streamed (it renders with the finished diff anyway).
- If a provider reorders fields so `output` comes last, streaming silently
  degrades to "everything arrives at the end" — correctness is unaffected
  because the final parse is authoritative.
