# Runbook — model providers (P3)

The enhance engine routes each **target** to its provider. Keys are **server-side only**
(never in the client bundle) and read inside `/api/enhance`.

## Keys (server env / Vercel project env)

```
ANTHROPIC_API_KEY=   # Opus 4.8 target
OPENAI_API_KEY=      # GPT-5.5 target
GOOGLE_API_KEY=      # Gemini Pro 3.1 target
```

A target whose key is absent returns **503** with a "not configured" message; the other
targets keep working. Magic-link/profile features don't need these.

## Model strings (env-overridable — D9)

Defaults live in `src/lib/providers/config.ts`; override per deployment:

```
MODEL_OPUS=claude-opus-4-8     # default
MODEL_GPT=gpt-5.5              # default — point at your deployed OpenAI model
MODEL_GEMINI=gemini-pro-3.1    # default — point at your deployed Gemini model
```

`GPT-5.5` and `Gemini Pro 3.1` are the named product targets; set the env to the exact
model string your account serves. Swapping a model is a config change, not a refactor.

## Cost cap & rate limit

```
COST_CAP_USD_PER_DAY=2.00   # daily spend cap per user
RATE_LIMIT_PER_MIN=20       # requests / minute per user
# Optional pricing overrides (USD per 1M tokens) used for the cap:
PRICE_OPUS_IN= PRICE_OPUS_OUT= PRICE_GPT_IN= PRICE_GPT_OUT= PRICE_GEMINI_IN= PRICE_GEMINI_OUT=
```

Both limits are enforced **before** any model call via the `usage_window` aggregate
(RLS-scoped to the caller). Every successful enhance writes a `usage_events` row
(tokens + cost) — the ledger backs both the rate window and the daily cost sum.

## Modes (`src/lib/enhance/modes.ts`)

Six enhancement modes drive the transformation. `MODE_INSTRUCTIONS` carries the per-mode
instruction; `buildSystemPrompt` wraps it with the target's idioms:

| Mode         | Intent                                                              |
| ------------ | ------------------------------------------------------------------ |
| **Clarify**  | Resolve ambiguity, sharpen the existing ask — no new requirements.  |
| **Polish**   | Corrections only — spelling/grammar/word-order, stay near original. |
| **Expand**   | Add structure, constraints, examples, acceptance criteria.          |
| **Condense** | Strip to the minimum viable prompt; keep every load-bearing part.   |
| **Reformat** | Restructure the same intent into a cleaner shape.                   |
| **Target**   | Re-render into the target engine's idiomatic syntax.                |

**Shape-preserving modes.** `Clarify` and `Polish` are in a `SHAPE_PRESERVING` set
(`src/lib/providers/formatters.ts`). For these, `buildSystemPrompt` swaps the target's
structural idioms (Opus XML sections, GPT JSON specs, Gemini "parts") for a
format-preservation directive scoped to the transformed prompt — so prose stays prose
instead of being rebuilt into bullet lists / markdown, while the JSON response envelope
is explicitly exempt. The other four modes keep the target idioms — restructuring is
their point.

## How a request flows

`POST /api/enhance { input, mode, target }` → auth (401 if signed out) → cap check (429 if
over) → `enhance()` builds the system prompt (mode + target idioms), calls the provider,
parses the JSON `{ output, rationale }` → server computes the word-diff → logs usage →
returns `{ output, rationale, diff, tokens, costUsd, usage }`. The client renders the
transformation diff with copy/share/export.
