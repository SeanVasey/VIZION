# Runbook — model providers (P3)

The enhance engine routes each **target** to its provider. Keys are **server-side only**
(never in the client bundle) and read inside `/api/enhance`.

## Keys (server env / Vercel project env)

```
ANTHROPIC_API_KEY=   # Fable 5 + Opus 5 + Sonnet 5 targets
OPENAI_API_KEY=      # GPT-5.6 Sol + Luna + Terra targets
GOOGLE_API_KEY=      # Gemini 3.6 Flash target
XAI_API_KEY=         # Grok 4.5 target
MISTRAL_API_KEY=     # Mistral Large 3 target
DEEPSEEK_API_KEY=    # DeepSeek V4
META_API_KEY=        # Muse Spark 1.1 (Meta Model API) — replaces LLAMA_API_KEY
MINIMAX_API_KEY=     # MiniMax M3
MOONSHOT_API_KEY=    # Kimi K3 (Moonshot AI)
PERPLEXITY_API_KEY=  # Sonar Pro
DASHSCOPE_API_KEY=   # Qwen3.7 Max (Alibaba Cloud Model Studio)
ZAI_API_KEY=         # GLM-5.2 (Z.ai open platform)
```

A target whose key is absent returns **503** with a "not configured" message; the other
targets keep working. Magic-link/profile features don't need these.

Where to create the new keys:

| Key | Console |
| --- | --- |
| `DEEPSEEK_API_KEY` | platform.deepseek.com → API keys |
| `META_API_KEY` | developer.meta.com (Meta Model API) → API keys |
| `MINIMAX_API_KEY` | platform.minimax.io → API keys (international region) |
| `MOONSHOT_API_KEY` | platform.moonshot.ai → API keys (international region) |
| `PERPLEXITY_API_KEY` | perplexity.ai → Settings → API |
| `DASHSCOPE_API_KEY` | Alibaba Cloud Model Studio (international/Singapore region) |
| `ZAI_API_KEY` | z.ai open platform → API keys |

The seven compat providers are all served through the shared OpenAI-compatible
streaming adapter (`src/lib/providers/openai-compat.ts`) — region matters for
MiniMax, Moonshot, and DashScope (the adapter points at the international
endpoints `api.minimax.io`, `api.moonshot.ai`, and
`dashscope-intl.aliyuncs.com`; a China-region key will 401 against them).
Meta's adapter points at the Meta Model API (`api.meta.ai`) — the retired
Llama API (`api.llama.com`) and its `LLAMA_API_KEY` / `MODEL_LLAMA` /
`PRICE_LLAMA_*` env vars no longer apply; **rename the Vercel env var to
`META_API_KEY`** (a Meta Model API key, not an old Llama API key) or the Meta
target reports 503 "not configured".

Keys must be able to call the provider's standard inference endpoint (Anthropic
Messages, OpenAI-compatible Chat Completions, Gemini `generateContent`). A
restricted / project-scoped key without that permission passes the "configured"
check but the provider rejects the call with **401/403 "insufficient
permissions"** — use an unrestricted key or grant the inference scope.
`/api/media` retries such failures on another configured provider
(see `docs/runbooks/media.md`); `/api/enhance` surfaces them directly.

> **Deploy note:** each key needs adding to the Vercel project env (Vercel →
> vizion → Settings → Environment Variables). Until a key is set, that
> provider's target returns 503 "not configured" while the rest keep working —
> keys can therefore be added one at a time. The 2026-07 Muse Spark cutover
> renamed `LLAMA_API_KEY` → `META_API_KEY`; the Meta target stays "not
> configured" until the new var is set.

## Model strings (env-overridable — D9)

Defaults live in `src/lib/providers/config.ts`; override per deployment:

```
MODEL_OPUS=claude-opus-5                              # default
MODEL_SONNET=claude-sonnet-5                          # default
MODEL_GPT=gpt-5.6-sol                                 # default — point at your deployed OpenAI model
MODEL_GPT_LUNA=gpt-5.6-luna                           # default — the 5.6 family's balanced mid tier
MODEL_GPT_TERRA=gpt-5.6-terra                         # default — the 5.6 family's fast tier
MODEL_FABLE=claude-fable-5                            # default
MODEL_DEEPSEEK=deepseek-chat                          # default — tracks the current DeepSeek flagship (V4)
MODEL_GEMINI=gemini-3.6-flash                         # default — point at your deployed Gemini model (see note below)
MODEL_MUSE=muse-spark-1.1                             # default — the Meta Model API serving string
MODEL_MINIMAX=MiniMax-M3                              # default
MODEL_MISTRAL=mistral-large-latest                    # default — tracks the current Large release
MODEL_KIMI=kimi-k3                                    # default
MODEL_SONAR=sonar-pro                                 # default
MODEL_QWEN=qwen-max                                   # default — tracks the current Max release (Qwen3.7 Max)
MODEL_GROK=grok-4.5                                   # default — point at your deployed xAI model
MODEL_GLM=glm-5.2                                     # default — point at a long-context variant string if Z.ai serves one separately
```

The labels in the picker are named product targets; set the env to the exact
model string your account serves. Swapping a model is a config change, not a
refactor.

> **A vendor's app picker is not its API model list.** Gemini's "Thinking" and
> "Fast", ChatGPT's "Ultra"/"Light", etc. are consumer labels for a
> reasoning-depth option on ONE model — not separate model strings. There is
> **no `gemini-3.6-thinking`**: pointing `MODEL_GEMINI` at an invented name
> 404s every call, and since `/api/media` reads 404 as a config error, media
> analysis would silently fall back to another provider rather than surfacing
> the mistake. Always take model strings from the provider's model-ID table.

## Thinking levels (per-request)

Reasoning depth is a **request option**, not a model string. The composer's
"Thinking" selector appears for targets listed in `TARGET_THINKING_LEVELS`
(`src/lib/constants.ts`); the route validates the level and the adapter
translates it onto the provider's parameter:

| Targets | Wire parameter | Levels |
| --- | --- | --- |
| Fable 5 · Opus 5 · Sonnet 5 | `output_config.effort` | low · medium · high · xhigh · max |
| GPT-5.6 Sol / Luna / Terra | `reasoning_effort` | low · medium · high |
| Gemini 3.6 Flash | `generationConfig.thinkingConfig.thinkingLevel` | minimal · low · medium · high |
| Qwen3.7 Max | `enable_thinking` + `thinking_budget` (tokens) | low · medium · high · xhigh · max |
| Grok 4.5 | `reasoning_effort` | low · medium · high |

Notes that keep this working:

- **"Auto" sends nothing** — the provider default applies (Gemini: `medium`
  dynamic; GPT-5.6: `medium`; Grok: `high`, reasoning can't be disabled;
  Claude 5 family: thinking on by default at `high` effort; DashScope: whatever
  `enable_thinking` defaults to for the served model).
- **Gemini:** `thinkingLevel` and the Gemini-2.5-era `thinkingBudget` are
  mutually exclusive — the adapter only ever sends the former.
- **Anthropic:** thinking bills as output tokens against `max_tokens`, so the
  adapter raises the output ceiling at `high` (32k) and `xhigh`/`max` (64k);
  never send the retired `thinking.budget_tokens` (400 on the Claude 5 family).
- **Qwen:** the knob is a token BUDGET, not an effort word, so the ladder maps
  onto budgets in `openai-compat.ts` (512 · 1k · 2k · 3k · 4k). Every step stays
  at or under half of DashScope's **8192** output ceiling — reasoning that eats
  the ceiling leaves nothing for the JSON envelope, which surfaces as "hit its
  length limit" rather than a result. Thinking is only honoured on a streamed
  request (ours always are) and arrives in `delta.reasoning_content`, which the
  adapter never reads, so `content` stays clean JSON.
- **A model tier is not a thinking level.** "Max" in `Qwen3.7 Max` is Alibaba's
  flagship tier (beside Plus and Turbo). Reading it as a reasoning depth is what
  left the target with no selector while its API took a budget all along — the
  same class of mistake as inventing `gemini-3.6-thinking` above, in reverse.
- **Cost:** higher levels spend more output tokens, which the daily cost cap
  counts like any other output — expect fewer runs per day at `max`.
- The remaining seven targets' providers expose no per-request knob through
  our adapters, so they show no selector.

Note on cost: Fable 5 lists at $10/$50 per 1M tokens (in/out) — noticeably pricier than
the other targets, so users reach the daily cost cap sooner on it. At the other end,
DeepSeek V4 (~$0.45/$0.90), MiniMax M3 (~$0.30/$1.20), and GPT-5.6 Terra
(~$0.20/$0.80) barely dent the cap.
Qwen3.7 Max defaults reflect the current 50%-promo rate ($1.25/$3.75, list $2.50/$7.50) —
override `PRICE_QWEN_*` when the promo lapses. GLM-5.2 list rates were unpublished at
launch — the defaults ($1.00/$3.20) are the GLM-5 reference rates; override
`PRICE_GLM_*` when Z.ai publishes 5.2 pricing. Kimi K3 and MiniMax M3 launch
defaults carry the K2.6/M2.7 list rates forward — override `PRICE_KIMI_*` /
`PRICE_MINIMAX_*` if the published rates differ. GPT-5.6 Luna/Terra defaults
($1.00/$4.00, $0.20/$0.80) follow the family tiering below Sol — override
`PRICE_GPT_LUNA_*` / `PRICE_GPT_TERRA_*` to match your account's rates.

## Output ceilings (`max_tokens`)

The OpenAI-compatible factory sends **16k** by default, which keeps a runaway
generation bounded without truncating a real answer. It is a per-API fact, not a
preference: **DashScope caps `qwen-max` at 8192** and rejects anything higher
with `400 InternalError.Algo.InvalidParameter: Range of max_tokens should be
[1, 8192]` — which failed *every* Qwen run until the provider declared its own
`maxTokens`. When adding a compat provider, read its `max_tokens` range from the
API reference rather than inheriting the default and hoping.

## Cost cap & rate limit

```
COST_CAP_USD_PER_DAY=2.00   # daily spend cap per user
RATE_LIMIT_PER_MIN=20       # requests / minute per user
# Optional pricing overrides (USD per 1M tokens) used for the cap:
PRICE_OPUS_IN= PRICE_OPUS_OUT= PRICE_GPT_IN= PRICE_GPT_OUT= PRICE_FABLE_IN=
PRICE_FABLE_OUT= PRICE_GEMINI_IN= PRICE_GEMINI_OUT= PRICE_GROK_IN= PRICE_GROK_OUT=
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
| **Adapt**    | Re-render into the target engine's idiomatic syntax (id: `target`). |

**The output is the prompt itself.** Every mode × target prompt carries an
`OUTPUT_CONTRACT` (`src/lib/providers/formatters.ts`): the `output` field must be
the improved prompt — the single message the user pastes into the target engine's
message box, in the author's voice. The model must never emit role labels
(`System:` / `User:` / `Assistant:` / `Developer:`), never write a system prompt or
persona spec for a hypothetical assistant, and never embed the input as a "message
to respond to". Without this, the target idioms read as an instruction to script
roles, and Expand/Reformat/Adapt returned a role-labelled system prompt instead of
the transformed prompt.

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
