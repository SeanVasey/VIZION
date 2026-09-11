# Runbook — model providers (P3)

The enhance engine routes each **target** to its provider. Keys are **server-side only**
(never in the client bundle) and read inside `/api/enhance`.

## Keys (server env / Vercel project env)

```
ANTHROPIC_API_KEY=   # Fable 5.1 + Opus 5 + Sonnet 5 targets
OPENAI_API_KEY=      # GPT-6 Astra + GPT-5.6 Sol + Luna + Terra targets
GOOGLE_API_KEY=      # Gemini 3.8 Flash target
XAI_API_KEY=         # Grok 4.6 target
MISTRAL_API_KEY=     # Mistral Large 3 target
DEEPSEEK_API_KEY=    # DeepSeek V4
META_API_KEY=        # Muse Spark 1.1 (Meta Model API) — replaces LLAMA_API_KEY
MINIMAX_API_KEY=     # MiniMax M3
MOONSHOT_API_KEY=    # Kimi K3 (Moonshot AI)
PERPLEXITY_API_KEY=  # Sonar Pro
DASHSCOPE_API_KEY=   # Qwen3.8 Max (Alibaba Cloud Model Studio)
ZAI_API_KEY=         # GLM-5.3 (Z.ai open platform)
```

A target whose key is absent returns **503** with a "not configured" message; the other
targets keep working. Magic-link/profile features don't need these.

Where to create the new keys:

| Key                  | Console                                                     |
| -------------------- | ----------------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | platform.deepseek.com → API keys                            |
| `META_API_KEY`       | developer.meta.com (Meta Model API) → API keys              |
| `MINIMAX_API_KEY`    | platform.minimax.io → API keys (international region)       |
| `MOONSHOT_API_KEY`   | platform.moonshot.ai → API keys (international region)      |
| `PERPLEXITY_API_KEY` | perplexity.ai → Settings → API                              |
| `DASHSCOPE_API_KEY`  | Alibaba Cloud Model Studio (international/Singapore region) |
| `ZAI_API_KEY`        | z.ai open platform → API keys                               |

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

### Any provider's 401/403 is the SERVER'S key, and the message now says so

> Seen in production 2026-09-11: **"Mistral request failed: 401 status code
> (no body)"** — Mistral answers a refused key with an empty body, so the
> user got a bare status and no next step. Every adapter now routes its HTTP
> failures through `describeProviderFailure` (`src/lib/providers/errors.ts`):
> a 401/403 names the env var to replace (`MISTRAL_API_KEY`, …) and says the
> key was refused, not the prompt; a 404 points at the `MODEL_*` override;
> and `[<provider>] upstream error <status>` is logged with `console.warn`
> (survives the production strip) so the deployment logs carry it. Mistral
> keys have two namespaces — a Codestral key 401s on `api.mistral.ai` even
> though it is valid — and a key created before the Large 3 card may lack
> the model; replace the key, then check `MODEL_MISTRAL` if a 404 follows.

### Gemini key/project refusals ("Your project has been denied access")

> Diagnosed in production 2026-08: every Gemini run failed with
> **"Gemini request failed: Your project has been denied access. Please
> contact support."** That sentence is **Google's own 403 body**, relayed
> verbatim by the adapter — it is _not_ a VIZION capability limit, and
> "support" means _Google's_ support. Google returns it when the **Google
> Cloud project behind `GOOGLE_API_KEY`** has lost access to the Gemini API
> (project flagged/denied by Google's abuse systems, API disabled or terms
> unaccepted on that project, or a free-tier project in a state that now
> requires linked billing). The adapter, endpoint (`v1beta`
> `streamGenerateContent?alt=sse`), and the default `gemini-3.6-flash` model
> string are all correct in this failure mode — no code or model change fixes
> it.
>
> Remediation, in order:
>
> 1. In Google AI Studio, create a **fresh API key under a different (or
>    newly created) project** with the Gemini API enabled — and billing
>    linked, if the account's tier requires it. Verify it with a one-off
>    `curl` `generateContent` call before deploying.
> 2. Replace `GOOGLE_API_KEY` in the Vercel project env (Vercel → vizion →
>    Settings → Environment Variables) and redeploy.
> 3. While there, confirm no stray `MODEL_GEMINI` override points at a
>    preview/allowlisted id — an entitlement the project lacks surfaces the
>    same way.
> 4. If a fresh project is also denied, the _account_ is flagged — that one
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
MODEL_GPT_ASTRA=gpt-6-astra                           # default — OpenAI's tier above the 5.6 family
MODEL_GPT=gpt-5.6-sol                                 # default — point at your deployed OpenAI model
MODEL_GPT_LUNA=gpt-5.6-luna                           # default — the 5.6 family's small, cost-efficient tier
MODEL_GPT_TERRA=gpt-5.6-terra                         # default — the 5.6 family's balanced mid tier
MODEL_FABLE=claude-fable-5-1                          # default — the 2026-09-01 point release (Fable 5 is legacy)
MODEL_DEEPSEEK=deepseek-v4-pro                        # default — pinned exact flagship id (PRV-007)
MODEL_GEMINI=gemini-3.8-flash                         # default — point at your deployed Gemini model (see note below)
MODEL_MUSE=muse-spark-1.1                             # default — the Meta Model API serving string
MODEL_MINIMAX=MiniMax-M3                              # default
MODEL_MISTRAL=mistral-large-2512                      # default — pinned 2026-08-08 (see the note below)
MODEL_KIMI=kimi-k3                                    # default
MODEL_SONAR=sonar-pro                                 # default
MODEL_QWEN=qwen3.8-max                                # default — pinned exact release id (PRV-007)
MODEL_GROK=grok-4.6                                   # default — point at your deployed xAI model
MODEL_GLM=glm-5.3                                     # default — point at a long-context variant string if Z.ai serves one separately
```

The labels in the picker are named product targets; set the env to the exact
model string your account serves. Swapping a model is a config change, not a
refactor.

> **Pinned ids & verified prices — second full re-verify 2026-09-11 (first:
> 2026-08-08, audit PRV-007 / PRV-008).** All seventeen defaults are pinned
> to exact vendor ids, read from each vendor's own page (`pricesVerifiedAt`
> on each `TARGETS` entry; per-row sources and caveats in the `config.ts`
> comments). What moved: **Fable 5 → Fable 5.1** (`claude-fable-5-1`, same
> $10/$50; Fable 5 is on Anthropic's legacy list), **Sonnet 5's base rate is
> now $2/$10** (the intro price became the price), **GPT-6 Astra** joins at
> $10/$50, **Gemini 3.6 → 3.8 Flash** (`gemini-3.8-flash`, no `minimal`
> level; the $0.75/$3.75 listed is introductory through 2026-12-31, so 3.6's
> $1.50/$7.50 standard is carried), **DeepSeek's announced increase landed
> 2026-08-16** (the peak-hour cache-miss rate $1.32/$3.96 is carried; off-peak
> is half), **Grok 4.5 → 4.6** (same $2/$6, adds `xhigh`), **GLM-5.2 → 5.3**
> (rate not yet published — 5.2's $1.40/$4.40 carried, `pricesAssumed`), and
> **Qwen3.8 Max's output ceiling is 131,072** (the 8,192 the adapter carried
> was 3.7's). Carried, NOT re-verified: `mistral-large-2512` and Mistral's
> $0.5/$1.5 (the models overview no longer surfaces the Large ids), and
> MiniMax's 2026-08 rate (its pricing page could not be read; third-party
> listings are lower, so the higher figure stays as the safe side). Standing
> caveats: MiniMax is a list price with "permanent 50% off"; Qwen's rate is
> the Singapore/International region's, ~18% above the others; Sonar Pro
> bills a per-request search fee (~$6/1k requests) the per-token table cannot
> express. **A price change is a cost-cap change AND a routing change**: Auto
> ranks candidates by the live `PRICE_*` values (see “Auto routing” below),
> so after any repin check the deployed `PRICE_*` overrides in Vercel — a
> stale override silently miscounts the daily cap _and_ skews which model
> Auto picks.

> **A vendor's app picker is not its API model list.** Gemini's "Thinking" and
> "Fast", ChatGPT's "Ultra"/"Light", etc. are consumer labels for a
> reasoning-depth option on ONE model — not separate model strings. There is
> **no `gemini-3.8-thinking`**: pointing `MODEL_GEMINI` at an invented name
> 404s every call, and since `/api/media` reads 404 as a config error, media
> analysis would silently fall back to another provider rather than surfacing
> the mistake. Always take model strings from the provider's model-ID table.

## Thinking levels (per-request)

Reasoning depth is a **request option**, not a model string — and since
2026-09 it is **one ladder for every model** (ADR-0018): the composer's
"Thinking" dial offers Auto · Low · Medium · High · Max whatever the target,
the route validates the level against the app's vocabulary and resolves Auto
to a task-shaped default, and each adapter translates the level onto its
provider's parameter through one table (`providerEffort`,
`src/lib/providers/errors.ts`). The rail appears for targets flagged in
`TARGET_HAS_THINKING` (`src/lib/constants.ts`) and always under Auto.

| Targets                                  | Wire parameter                                  | low · medium · high · max → |
| ---------------------------------------- | ----------------------------------------------- | --------------------------- |
| Fable 5.1 · Opus 5 · Sonnet 5            | `output_config.effort`                          | low · medium · high · max   |
| GPT-6 Astra · GPT-5.6 Sol / Terra / Luna | `reasoning_effort`                              | low · medium · high · max   |
| Grok 4.6                                 | `reasoning_effort`                              | low · medium · high · xhigh |
| Gemini 3.8 Flash                         | `generationConfig.thinkingConfig.thinkingLevel` | low · medium · high · high  |
| DeepSeek V4 Pro · Kimi K3 · GLM-5.3      | `reasoning_effort` (three-valued)               | low · high · high · max     |
| Qwen3.8 Max                              | `enable_thinking` + `thinking_budget` (tokens)  | 1,024 · 4,096 · 8,192 · 16k |

Notes that keep this working:

- **"Auto" is resolved by the ROUTE, not the vendor.** The client sends no
  level; `/api/enhance` picks `medium` for the bounded modes (polish /
  clarify / condense) and `high` for the structure-inventing ones (expand /
  reformat / adapt) or a long / media-bearing input — the same tier split
  Auto routing uses. Vendor defaults were `high` on Anthropic and Grok and
  **`max` on Kimi K3 and GLM-5.3**, which is what made an untuned run on
  those targets the slowest, costliest configuration for a grammar fix.
- **Three-valued providers collapse Medium onto their `high`** — it is
  their middle value and their default; Low and Max stay the true ends, so
  the peak caption's "highest cost" is never a lie.
- **Legacy stops fold, never 400.** `minimal` (Gemini 3.6's floor) and
  `xhigh` (Anthropic's second ultra tier) stay in `THINKING_LEVELS` for old
  drafts and stores; the route accepts them and `normalizeThinkingLevel`
  lands them on Low / High. Anthropic, OpenAI and xAI still serve `xhigh`
  as its own value, so it rides through there. There is no longer a
  per-target 400 ("That thinking level isn't available for this model").
- **Gemini 3.8:** `thinkingLevel` and the Gemini-2.5-era `thinkingBudget`
  are mutually exclusive — the adapter only ever sends the former. 3.8 Flash
  does not accept `minimal` (3.6 did); Max lands on `high`, its top.
- **Anthropic:** thinking bills as output tokens against `max_tokens`, so the
  adapter raises the output ceiling at `xhigh`/`max` (64k); never send the
  retired `thinking.budget_tokens` (400 on the Claude 5 family).
- **Qwen:** the knob is a token BUDGET, not an effort word, so the ladder
  maps onto budgets in `openai-compat.ts` (1k · 4k · 8k · 16k). Every step
  stays at or under half the **32k** ceiling the adapter sends (Model Studio
  publishes 131,072 for qwen3.8-max) — reasoning that eats the ceiling leaves
  nothing for the JSON envelope, which surfaces as "hit its length limit"
  rather than a result. Thinking is only honoured on a streamed request (ours
  always are) and arrives in `delta.reasoning_content`, which the adapter
  never reads, so `content` stays clean JSON.
- **A model tier is not a thinking level.** "Max" in `Qwen3.8 Max` is Alibaba's
  flagship tier (beside Plus and Turbo). Reading it as a reasoning depth is what
  left the target with no selector while its API took a budget all along — the
  same class of mistake as inventing `gemini-3.8-thinking` above, in reverse.
- **Cost:** higher levels spend more output tokens, which the daily cost cap
  counts like any other output — expect fewer runs per day at `max`.
- The four targets with no knob (Muse Spark 1.1, MiniMax M3, Mistral Large 3,
  Sonar Pro) show no rail and are sent nothing; the dial's value waits for
  the next model that can use it.

Note on cost: Fable 5.1 and GPT-6 Astra list at $10/$50 per 1M tokens (in/out) —
noticeably pricier than the other targets, so users reach the daily cost cap
sooner on them. At the other end, GPT-5.6 Luna ($0.20/$1.20) and MiniMax M3
($0.30/$1.20) barely dent the cap; DeepSeek V4 Pro is no longer in that group
since its 2026-08-16 increase. Every default was re-verified against its
vendor's published rates on 2026-09-11 (the "Pinned ids & verified prices" note
above); `src/lib/providers/config.ts` is the authoritative per-target list, and
each row carries its `pricesVerifiedAt` date. Override the matching `PRICE_*_IN`
/ `PRICE_*_OUT` env vars when your account's rates differ — and remember a price
override re-ranks Auto routing as well as re-pricing the cap.

## Output ceilings (`max_tokens`)

The OpenAI-compatible factory sends **16k** by default, which keeps a runaway
generation bounded without truncating a real answer, and **32k** for the deep
tier (High / Max) on providers that declare `deepMaxTokens` — DeepSeek, Kimi
K3, GLM-5.3 — because reasoning bills against the same ceiling (the Anthropic
lesson). The ceiling is a per-API fact, not a preference: **DashScope capped
`qwen3.7-max` at 8192** and rejected anything higher with
`400 InternalError.Algo.InvalidParameter: Range of max_tokens should be
[1, 8192]` — which failed _every_ Qwen run until the provider declared its
own `maxTokens`. That 8192 then outlived the model it described: Model
Studio's `qwen3.8-max` page publishes **131,072**, and the carried 8192 with
a 4096 thinking budget was why Qwen truncated sooner than any other target.
When adding or bumping a compat provider, read its `max_tokens` range from the
API reference rather than inheriting a default — in either direction.

Qwen's adapter now sends 32k (four times the max thinking budget) and is still
`MAX_TOKENS_QWEN`-overridable: if a region serves a lower range, set the env
var to that number rather than editing the adapter. Do not raise it on a
guess — every value outside the served range 400s on _every_ call, which
trades an occasional truncation for total failure.

## Connection policy: idle, not elapsed

Every streaming adapter bounds itself on **silence**, not on total time.

| constant            | default | what it means                                                                                             |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `PROVIDER_IDLE_MS`  | 60s     | Time since the last token. The one that should ever fire.                                                 |
| `PROVIDER_TOTAL_MS` | 285s    | Absolute wall across the stream's lifetime. **Must stay under** the enhance route's `maxDuration` (300s). |
| `MEDIA_TIMEOUT_MS`  | 55s     | `/api/media` only — a bounded one-shot under a `maxDuration=60` route.                                    |

### What the SDK `timeout` option actually covers

Read this before reasoning about any of the above, because the obvious
assumption is wrong and this repo shipped it once.

In both vendored SDKs the timeout timer is armed around `fetch()` and cleared
the moment that promise settles — `openai/src/core.ts:597-602`
(`.finally(() => clearTimeout(timeout))`) and
`@anthropic-ai/sdk/src/client.ts:729-733`. **A streaming `fetch()` resolves at
the response headers**, and the body is consumed afterwards, so `timeout` bounds
connect-and-headers and nothing after it. Once the first byte lands, the SDK
stops bounding the stream entirely.

Two things follow:

- The retired `PROVIDER_TIMEOUT_MS = 55_000` was **not** what truncated long
  runs mid-stream — it could not have been. The route's `maxDuration = 60` was:
  the platform killed the whole function. The raised window is therefore the
  primary fix, not a supporting one.
- A total budget **cannot** be expressed as the SDK `timeout`. That timer is
  already gone by the time the body streams, so a continuously productive
  stream would outlive it and be killed by the platform instead — skipping the
  route's `finally` block and stranding the spend hold, the exact PRV-002 leak.

So both budgets are enforced in application code. `withIdleTimeout`
(`src/lib/providers/idle-timeout.ts`) wraps the stream loop in the five SDK
adapters and holds the idle timer **and** an absolute deadline taken at the
first call; the total does not reset on a chunk, which is the entire point.
`google.ts` is a raw fetch and carries the same policy by hand: one
`AbortController`, a total timer that stays armed for the whole body read, and
an idle timer re-armed inside the read loop.

`PROVIDER_TOTAL_MS` is still passed as the SDK `timeout` as well, where it does
usefully bound a hang before headers.

Cancellation is not optional and not cosmetic. Both SDKs implement
`[Symbol.asyncIterator]` as an **async generator**, and that protocol queues a
`return()` behind an already-pending `next()` — and at idle-out there is always
a `next()` in flight. So each adapter passes `withIdleTimeout` the SDK's own
abort handle (`stream.controller.abort()`, `MessageStream.abort()`), which is
called first: it aborts the HTTP request, settles the pending read, and lets the
queued `return()` run. Without it the error cannot even propagate, and the
connection keeps streaming tokens nobody reads — and keeps billing for them.

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

Both limits — the per-minute rate window **and** the daily cost cap — are
enforced atomically **before** any model call by the `spend_reserve` RPC under a
per-user advisory lock (ADR-0009), fronted by a per-instance in-memory burst
limiter (`src/lib/security/rate-limit.ts`). Every run settles into a
`usage_events` row (tokens + cost) via `spend_settle` — that ledger is what the
reservation math reads.

## Auto routing (`src/lib/enhance/auto-target.ts` + `src/lib/providers/manifest.ts`)

Auto is a **static, precomputed policy — deliberately not a model call**. Two
inputs live in the manifest: an editorial `strength` rank (1–10, one rationale
comment per entry — re-rank there, never inline) and a `speed` class. Cost
comes from the live `TARGETS` prices as a blended $/1M at a documented 1:1
in:out mix.

At module load the router materializes **six ladders** — {quality, balanced,
budget} × {light, heavy}:

- The **tier** is the old table's split, kept verbatim: polish/clarify/condense
  are `light` until >4,000 chars or an attachment escalates; expand/reformat/
  adapt are always `heavy`.
- Each ladder orders the pool (all seventeen minus `autoExcluded` — currently
  Sonar Pro, whose search-grounded answers and per-request search fee make it
  a manual-pick-only engine): **quality** sorts by strength then price;
  **balanced** does the same under a price ceiling (premium-tier models rank
  after everything else) and, on the light tier, puts `fast` models first;
  **budget** sorts by price then strength. A strength floor per (preference,
  tier) decides who may lead; below-floor targets are appended, never
  dropped, so a ladder can't be emptied.
- Resolution walks the ladder and takes the **first target whose provider key
  is configured** — Auto can never resolve to a 503. Nothing configured =
  ladder head + the route's ordinary pre-stream 503.

The media route uses the same ladders pinned to the heavy tier and filtered to
vision-capable targets (`resolveAutoVisionTarget`).

Operational couplings to know:

- **`PRICE_*` overrides re-rank Auto.** The router prices candidates from the
  live `TARGETS` values, so a pricing override is a routing change, not just a
  cap change. After editing Vercel env, sanity-check what Budget resolves to.
- **A key added or removed re-routes Auto** on the next invocation —
  availability is part of the policy, by design.
- The exported `AUTO_LADDERS` are the test surface: `auto-target.test.ts`
  derives its expectations from them and from live `TARGETS`, so price moves
  don't rot the suite.

## Modes (`src/lib/enhance/modes.ts`)

Six enhancement modes drive the transformation. `MODE_INSTRUCTIONS` carries the per-mode
instruction; `buildSystemPrompt` wraps it with the target's idioms:

| Mode         | Intent                                                              |
| ------------ | ------------------------------------------------------------------- |
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
