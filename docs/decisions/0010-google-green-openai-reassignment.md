# 10. Google takes green; OpenAI is assigned a hue

Date: 2026-08-07
Status: accepted (amends [0003](./0003-developer-accents.md)) — the
`--dev-openai` half is superseded by [0011](./0011-openai-maroon.md)
(2026-08-08), which replaces the h336 magenta with an owner-directed maroon.
The `--dev-google` decision below stands.

## Context

Owner direction, from an on-device review of the library list: green reads as
Google's association, not OpenAI's, so `--dev-google` should be green — and
`--dev-openai` should move to something unique that no other entry in the
accent list already uses.

Under [0003] Google wore a violet sourced from the Gemini mark
(`#b379da` ← thesvg google-gemini `#8e75b2`) and OpenAI wore its historic
product green (`#0ea480` ← `#10a37f`). The direction reassigns the green
association and retires the violet.

Nothing about 0003's method is in question, so this decision _reapplies_ it:
the one-hex-per-developer luminance corridor (relative luminance between
0.1995 and 0.2922, i.e. ≥3:1 against both composited card fills), the ΔE2000
floors to the semantic roles co-present on the library list (20 to `--laser`,
18 to both `--flare` values, 15 to `--amber` and `--pulse`), the two
alternating lightness tiers (A ≈ Y 0.207, B ≈ Y 0.283), and published-anchor
sourcing with minimal OKLCH drift.

## Decision

### `--dev-google: #219042` — tier A, hue held at Google's published green

The anchor is the green of Google's published four-colour logo palette,
`#34a853`. The anchor itself cannot ship: its luminance (0.2936) sits just
above the corridor, and it measures ΔE2000 13.1 to `--pulse` (`#3dd68c`) — a
green accent that close to the success green is exactly the false-state signal
0003 exists to prevent.

The collision is solved in **lightness, not hue** — the anthropic precedent.
At this hue only tier A clears `--pulse`: a tier-B green at the anchor hue
measures ~13.9 (fail) and needs ≥6° of drift to pass, while tier A passes at
the anchor hue with room (20.5 vs the 15 floor). So the token moves to tier A
and the hue is **held**: drift +0.01, tighter anchor fidelity than nine of the
eleven sourced entries. Chroma 0.150 is the palette's full-chroma norm (meta
0.151, qwen 0.151). Measured: Y 0.2066; 3.09:1 on the aurora-lit dark card,
3.99:1 on the light card; floors laser 33.4 · flare 68.8/66.9 · amber 42.4 ·
pulse 20.5.

The tier flip also _improves_ the property the tiers exist for: the wheel now
runs mistral B (54°) → google A (148°) → perplexity B (210°), where the old
violet slot sat B between two other Bs.

### `--dev-openai: #cf70ba` — tier B, assigned by rule, and documented as such

With the green ceded, OpenAI has no published colour left to source —
openai.com's brand palette is black and white. Neutral cannot render that
fact: 0003 reserves neutrality for xAI alone, test-enforced, precisely so the
absence stays meaningful. So the hue is **assigned, not sourced**, and the
token comment says so — the second unsourced entry in the set, after xAI.

The assignment rule, so it is reproducible rather than taste: take the widest
hue gap the roster leaves open — qwen 290° → minimax 7° (77°, containing the
vacated violet) — and fill it at tier B, which alternates with the A tiers on
both flanks. From the geometric midpoint (~328°), bias +8° so the result does
not read as the Gemini violet it replaces: at h336 the distance to the retired
`#b379da` reaches ΔE2000 10.0 (at the midpoint it is ~6.9, a plausible
mistaken-identity range). Measured: Y 0.2840; 4.02:1 dark, 3.07:1 light;
nearest live accents minimax 15.5 and qwen 18.7 — both clear of the palette's
own tightest standing pair (10.6, deepseek~meta); floors laser 81.6 · flare
29.3/36.7 · amber 56.7 · pulse 52.7.

## Consequences

- The green ↔ developer association flips. Cards that read "OpenAI" by green
  now read Google; returning users relearn one association, and the magenta
  cannot be misread as any other entry, live or retired.
- OpenAI joins xAI as an entry whose colour states a sourcing fact ("publishes
  no colour") rather than citing an anchor. If OpenAI ever publishes a
  chromatic identity, re-derive from it and retire the assignment rule.
- 0003's per-token figures for `google` and `openai` are superseded by the
  measurements above; every constraint, floor, and construction in 0003 is
  untouched and was verified to hold for both new values.
- `tests/unit/developer-accents.test.ts` needed no change: it pins the layer's
  _constructions_ (roster coverage, single-neutral, corridor for xAI, light
  blocks, geometry pairs), not individual hexes — both new values satisfy it
  as-is.
