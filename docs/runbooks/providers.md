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
DASHSCOPE_API_KEY=   # Qwen3.8 Max (Alibaba Cloud Model Studio)
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

### Gemini key/project refusals ("Your project has been denied access")

> Diagnosed in production 2026-08: every Gemini run failed with
> **"Gemini request failed: Your project has been denied access. Please
> contact support."** That sentence is **Google's own 403 body**, relayed
> verbatim by the adapter — it is *not* a VIZION capability limit, and
> "support" means *Google's* support. Google returns it when the **Google
> Cloud project behind `GOOGLE_API_KEY`** has lost access to the Gemini API
> (project flagged/denied by Google's abuse systems, API disabled or terms
> unaccepted on that project, or a free-tier project in a state that now
> requires linked billing). The adapter, endpoint (`v1beta`
> `streamGenerateContent?alt=sse`), and the default `gemini-3.6-flash` model
> string are all correct in this failure mode — no code or model change fixes
> it.
>
> Remediation, in order:
> 1. In Google AI Studio, create a **fresh API key under a different (or
>    newly created) project** with the Gemini API enabled — and billing
>    linked, if the account's tier requires it. Verify it with a one-off
>    `curl` `generateContent` call before deploying.
> 2. Replace `GOOGLE_API_KEY` in the Vercel project env (Vercel → vizion →
>    Settings → Environment Variables) and redeploy.
> 3. While there, confirm no stray `MODEL_GEMINI` override points at a
>    preview/allowlisted id — an entitlement the project lacks surfaces the
>    same way.
> 4. If a fresh project is also denied, the *account* is flagged — that one
>    genuinely is "contact Google support" (or use a different Google
>    account's key).
>
> The adapter now appends the remediation hint to 401/403 messages and logs
> `[google] upstream error <status>` server-side (`console.warn` survives the
> production strip), so the next refusal is visible in the Vercel runtime
> logs instead of only in one client's error paragraph.

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
MODEL_DEEPSEEK=deepseek-v4-pro                        # default — pinned exact flagship id (PRV-007)
MODEL_GEMINI=gemini-3.6-flash                         # default — point at your deployed Gemini model (see note below)
MODEL_MUSE=muse-spark-1.1                             # default — the Meta Model API serving string
MODEL_MINIMAX=MiniMax-M3                              # default
MODEL_MISTRAL=mistral-large-latest                    # default — STILL FLOATING; see the pinning note below
MODEL_KIMI=kimi-k3                                    # default
MODEL_SONAR=sonar-pro                                 # default
MODEL_QWEN=qwen3.8-max                                # default — pinned exact release id (PRV-007)
MODEL_GROK=grok-4.5                                   # default — point at your deployed xAI model
MODEL_GLM=glm-5.2                                     # default — point at a long-context variant string if Z.ai serves one separately
```

The labels in the picker are named product targets; set the env to the exact
model string your account serves. Swapping a model is a config change, not a
refactor.

> **Floating aliases & provisional prices (audit PRV-007 / PRV-008).** Two of
> the sixteen defaults were repinned to exact ids on 2026-08-01
> (`deepseek-v4-pro`, `qwen3.8-max` — both taken verbatim from the vendors'
> model-ID pages, with DeepSeek's published cache-miss rates). One alias
> remains deliberate: **`mistral-large-latest`** — Mistral publishes no exact
> wire string for the current Large 3 (v25.12), and inferring one from the
> deprecated `mistral-large-2411` pattern risks 404ing every call. **The day
> Mistral publishes the versioned id, set `MODEL_MISTRAL` (and re-verify
> `PRICE_MISTRAL_*`).** Three price rows are PROVISIONAL, marked in
> `config.ts`: `PRICE_KIMI_*` (K2-series carry-over), `PRICE_MINIMAX_*`
> (M2-series carry-over), and `PRICE_GLM_*` (GLM-5 reference rates) — replace
> the defaults (or set the env overrides) when Moonshot / MiniMax / Z.ai
> publish list rates. **A price change is a cost-cap change**: after any
> repin, check the deployed `PRICE_*` overrides in Vercel — a stale override
> silently miscounts the daily cap.

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
| Qwen3.8 Max | `enable_thinking` + `thinking_budget` (tokens) | low · medium · high · xhigh · max |
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
- **A model tier is not a thinking level.** "Max" in `Qwen3.8 Max` is Alibaba's
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
Qwen3.8 Max defaults reflect the current 50%-promo rate ($1.25/$3.75, list $2.50/$7.50) —
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

Qwen's 8192 is the tightest ceiling in the fleet and the `max` thinking budget
(4096) consumes half of it, so Qwen truncates sooner than any other target. It
is now `MAX_TOKENS_QWEN`-overridable: if Alibaba's model page publishes a higher
range for **Qwen3.8 Max**, set the env var to that number rather than editing
the adapter. Do not raise it on a guess — every value outside the published
range 400s on *every* call, which trades an occasional truncation for total
failure.

## Connection policy: idle, not elapsed

Every streaming adapter bounds itself on **silence**, not on total time.

| constant | default | what it means |
| --- | --- | --- |
| `PROVIDER_IDLE_MS` | 60s | Time since the last token. The one that should ever fire. |
| `PROVIDER_TOTAL_MS` | 285s | Backstop only. **Must stay under** the enhance route's `maxDuration` (300s). |
| `MEDIA_TIMEOUT_MS` | 55s | `/api/media` only — a bounded one-shot under a `maxDuration=60` route. |

This replaced a single `PROVIDER_TIMEOUT_MS = 55_000` passed as the SDK clients'
`timeout`. That option is a **whole-request deadline that covers the streamed
body read** — not a connect or first-byte timeout — so it could not distinguish
a hung connection from a healthy generation that was simply long, and cut both
at 55s. The practical effect was that the clock, not `max_tokens`, was the real
output ceiling: roughly 2,000-4,000 tokens against the 16,000-64,000 the
adapters request. The truncated run was still billed, because the route's
`finally` block settles the ledger from `streamedChars`.

`withIdleTimeout` (`src/lib/providers/idle-timeout.ts`) wraps the stream loop in
the five SDK adapters; `google.ts` is a raw fetch and carries the same policy by
hand with an `AbortController` re-armed on every read. Both cancel the source on
idle-out, which is what actually aborts the upstream request — without it the
connection keeps streaming tokens nobody reads, and keeps billing for them.

**`maxDuration` and `PROVIDER_TOTAL_MS` are a pair.** If the route window ever
drops below the total backstop, the platform kills the function first and skips
the `finally` block that settles the spend hold — the exact leak PRV-002 exists
to prevent. `tests/unit/provider-policy.test.ts` pins the inequality. Raising
`maxDuration` past 300 requires a Vercel plan whose Node-runtime limit allows
it.

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
