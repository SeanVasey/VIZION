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

## How a request flows

`POST /api/enhance { input, mode, target }` → auth (401 if signed out) → cap check (429 if
over) → `enhance()` builds the system prompt (mode + target idioms), calls the provider,
parses the JSON `{ output, rationale }` → server computes the word-diff → logs usage →
returns `{ output, rationale, diff, tokens, costUsd, usage }`. The client renders the
transformation diff with copy/share/export.
