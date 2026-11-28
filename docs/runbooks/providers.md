# Runbook — model providers (P3)

The enhance engine routes each **target** to its provider. Keys are **server-side only**
(never in the client bundle) and read inside `/api/enhance`.

## Keys (server env / Vercel project env)

```
ANTHROPIC_API_KEY=   # Fable 5.2 + Opus 5.5 + Sonnet 5.5 + Haiku 5.5 targets
OPENAI_API_KEY=      # GPT-6.2 Astra + GPT-6.2 Sol + GPT-6.1 Terra + GPT-6 Luna targets
GOOGLE_API_KEY=      # Gemini 4 Carbon + Neon + Hydrogen targets
XAI_API_KEY=         # Grok 4.7 target
MISTRAL_API_KEY=     # Mistral Large 4 target
DEEPSEEK_API_KEY=    # DeepSeek V4 Pro
META_API_KEY=        # Muse Wonder 1.0 + Muse Spark 1.3 (Meta Model API) — replaces LLAMA_API_KEY
MINIMAX_API_KEY=     # MiniMax M3.1 Flash
MOONSHOT_API_KEY=    # Kimi K3.1 Pro (Moonshot AI)
PERPLEXITY_API_KEY=  # Sonar Pro (legacy chat endpoint — see "Sonar Pro is on a sunset endpoint")
DASHSCOPE_API_KEY=   # Qwen4 Max (Alibaba Cloud Model Studio)
ZAI_API_KEY=         # GLM-5.3 (Z.ai open platform)
```

Twenty-one targets, twelve keys (the 2026-11-28 roster). The four new slots —
Haiku 5.5, Gemini 4 Carbon, Gemini 4 Neon, Muse Wonder 1.0 — ride keys that were
already required, so no new key is needed for this roster.

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

**Qwen's base URL is migrating (2026-11-28).** Alibaba is moving the
OpenAI-compatible API from the shared `dashscope-intl.aliyuncs.com` host to a
per-workspace host
(`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`).
The shared host is still the adapter's default — it is the one being migrated
_from_ — and `QWEN_BASE_URL` overrides it for both the enhance adapter and the
vision call (`QWEN_BASE_URL` in `src/lib/providers/openai-compat.ts`, imported
by `vision.ts`). Set it when your workspace is moved; an unset variable on a
moved workspace is the first thing to check if Qwen starts failing at the
connection rather than at the key.

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
MODEL_FABLE=claude-fable-5-2                          # default — Fable 5.2
MODEL_OPUS=claude-opus-5-5                            # default — Opus 5.5
MODEL_SONNET=claude-sonnet-5-5                        # default — Sonnet 5.5
MODEL_HAIKU=claude-haiku-5-5                          # default — Haiku 5.5 (NEW 2026-11)
MODEL_GPT_ASTRA=gpt-6.2-astra                         # default — GPT-6.2 Astra, OpenAI's frontier tier
MODEL_GPT=gpt-6.2-sol                                 # default — GPT-6.2 Sol (the variable keeps its name; it now means Sol 6.2)
MODEL_GPT_TERRA=gpt-6.1-terra                         # default — GPT-6.1 Terra, the balanced mid tier
MODEL_GPT_LUNA=gpt-6-luna                             # default — GPT-6 Luna, the small tier
MODEL_DEEPSEEK=deepseek-v4-pro                        # default — unchanged; still serves the V4-Pro-0813 snapshot
MODEL_GEMINI_CARBON=gemini-4-carbon                   # default — Gemini 4 Carbon (NEW 2026-11)
MODEL_GEMINI_NEON=gemini-4-neon                       # default — Gemini 4 Neon (NEW 2026-11)
MODEL_GEMINI=gemini-4-hydrogen                        # default — Gemini 4 Hydrogen (the old Flash slot; the variable keeps its name)
MODEL_MUSE_WONDER=muse-wonder-1.0                     # default — Muse Wonder 1.0 (NEW 2026-11; preview, not in every region)
MODEL_MUSE=muse-spark-1.3                             # default — Muse Spark 1.3
MODEL_MINIMAX=MiniMax-M3.1-Flash                      # default
MODEL_MISTRAL=mistral-large-4-0                       # default — PINNED to the versioned id; mistral-large-4 and -latest float
MODEL_KIMI=kimi-k3.1-pro                              # default
MODEL_SONAR=sonar-pro                                 # default — legacy chat endpoint, sunset 2026-09-27 (see below)
MODEL_QWEN=qwen4-max                                  # default — listed verbatim; there is no dated snapshot to pin
MODEL_GROK=grok-4.7                                   # default
MODEL_GLM=glm-5.3                                     # default — unchanged; GLM-5.4 is Coding Plan only (see below)
```

The labels in the picker are named product targets; set the env to the exact
model string your account serves. Swapping a model is a config change, not a
refactor. A blank value (what a copied `.env.example` line sets) is read as
unset and the default applies (`strEnv` in `config.ts`).

> **A `MODEL_*` / `PRICE_*` override OUTLIVES a roster move — clear the stale
> ones after this bump.** A slot keeps its variable name when its model moves:
> a deployment that still sets `MODEL_OPUS=claude-opus-5` goes on calling
> Opus 5 **under the Opus 5.5 label and the Opus 5.5 price**, and nothing
> fails — the picker's label, the rate the cap charges and Auto's ranking all
> come from the new row while the wire carries the old id (the only tell is the
> model string in the result meta, which echoes what was sent). The same holds
> in reverse for a `PRICE_*` pair left at a previous model's rate. After
> applying the 2026-11-28 roster, open the Vercel project env and delete (or
> re-point) every `MODEL_*` and `PRICE_*` override you no longer mean. Two
> names are easy to misread now that their slots have siblings:
> `MODEL_GEMINI` / `PRICE_GEMINI_*` mean **Gemini 4 Hydrogen** (not Carbon or
> Neon), and `MODEL_GPT` / `PRICE_GPT_*` mean **GPT-6.2 Sol**. `MODEL_MUSE` /
> `PRICE_MUSE_*` stay Muse **Spark**; Wonder has its own. New names this pass:
> `MODEL_HAIKU`, `PRICE_HAIKU_IN/OUT`, `MODEL_GEMINI_CARBON`,
> `PRICE_GEMINI_CARBON_IN/OUT`, `MODEL_GEMINI_NEON`,
> `PRICE_GEMINI_NEON_IN/OUT`, `MODEL_MUSE_WONDER`, `PRICE_MUSE_WONDER_IN/OUT`,
> and `QWEN_BASE_URL`.

> **Pinned ids & verified prices — third full re-verify 2026-11-28.** All
> twenty-one defaults were re-read from each vendor's own page
> (`pricesVerifiedAt` is `2026-11-28` on every `TARGETS` entry; per-row sources
> and caveats in the `config.ts` comments). Where a vendor lists an
> introductory rate beside the base one, the **base** rate is carried —
> overcounting the cap for a few weeks is the safe side of a spend limit.
> Fourteen of the seventeen slots moved and four joined:
>
> - **Anthropic:** Fable 5.1 → **5.2** (`claude-fable-5-2`, **$8/$40**, down
>   from $10/$50) · Opus 5 → **5.5** (`claude-opus-5-5`, **$4/$20**, down from
>   $5/$25; thinking can no longer be disabled and the vendor default effort is
>   `medium` — immaterial here, the route always sends a level) · Sonnet 5 →
>   **5.5** (`claude-sonnet-5-5`, $2/$10) · **Haiku 5.5** joins
>   (`claude-haiku-5-5`, $0.10/$0.50 for prompts up to 100K tokens, $0.50/$2.50
>   beyond — a boundary `MAX_INPUT_CHARS` keeps far away).
> - **OpenAI** (the tiers version independently now): GPT-6 Astra → **GPT-6.2
>   Astra** (`gpt-6.2-astra`, $8/$40) · GPT-5.6 Sol → **GPT-6.2 Sol**
>   (`gpt-6.2-sol`, **$2/$10** — this row was $5/$30) · GPT-5.6 Terra →
>   **GPT-6.1 Terra** (`gpt-6.1-terra`, $1/$5) · GPT-5.6 Luna → **GPT-6 Luna**
>   (`gpt-6-luna`, $0.10/$0.50 standard; the $0.05/$0.25 on the pricing page is
>   the Flex/Batch rate, which this adapter does not use). `none` is rejected on
>   the 6.2 pair and is never sent.
> - **Google** (Gemini 4 is named by element): Gemini 3.8 Flash → **Gemini 4
>   Hydrogen** (`gemini-4-hydrogen`, the same $1.50/$7.50 the Flash slot
>   carried) · **Gemini 4 Neon** joins (`gemini-4-neon`, $3/$15, no promo, no
>   free tier) · **Gemini 4 Carbon** joins (`gemini-4-carbon`) at the **$4/$20
>   base rate** — the pricing page lists $2/$10 as an introductory rate
>   **through 2026-11-30** and $4/$20 from 2026-12-01, so the row is already at
>   what it will cost; do not "correct" it down to the promo.
> - **Meta:** **Muse Wonder 1.0** joins (`muse-wonder-1.0`, $4/$20) — in
>   **preview** on the pay-as-you-go Model API, Standard mode only, not offered
>   in every region · Muse Spark 1.1 → **1.3** (`muse-spark-1.3`, same
>   $1.25/$4.25; the cheaper "-contributor" variant trades prompts for training
>   data and is deliberately not used).
> - **MiniMax:** M3 → **M3.1 Flash** (`MiniMax-M3.1-Flash`, $0.15/$0.60, one
>   rate at any input length, no promo label — M3's $0.30/$1.20 was the
>   "permanent 50% off" list price).
> - **Mistral:** Large 3 → **Large 4**, pinned to `mistral-large-4-0` (the
>   versioned id on the model card; `mistral-large-4` and
>   `mistral-large-latest` float), $0.70/$2.10 on both the card and the pricing
>   page. A 401 is still the key being refused; a 404 would be this id retired.
> - **Moonshot:** Kimi K3 → **K3.1 Pro** (`kimi-k3.1-pro`, $2/$10 flat; the
>   `-highspeed` variant is twice the rate and not used).
> - **Qwen:** Qwen3.8 Max → **Qwen4 Max** (`qwen4-max`, $1.50/$4.50). The rate
>   is the International (Singapore) scope's; the Global scope is ~6% cheaper,
>   so set `PRICE_QWEN_*` to the account's actual billing scope.
> - **xAI:** Grok 4.6 → **4.7** (`grok-4.7`, same $2/$6).
> - **Unchanged ids:** **DeepSeek V4 Pro** (`deepseek-v4-pro`; the changelog's
>   only newer entry is V4.1-Flash, a throughput tier; the peak-hour cache-miss
>   rate $1.32/$3.96 is still carried, off-peak is half) · **GLM-5.3** — its
>   $1.40/$4.40 is now **published**, so the `pricesAssumed` flag it carried is
>   gone. **GLM-5.4 exists but is Coding Plan only** ("the Model API will be
>   made available upon completion of the security assessment", docs.z.ai,
>   2026-11-23); it is not on the roster until the Model API serves it ·
>   **Sonar Pro** — see the next note.
>
> **One row is priced by carry-over (`pricesAssumed`, PRV-008): Sonar Pro.**
> Perplexity's pricing page no longer lists a `sonar-pro` rate at all; the last
> published $3/$15 is carried as a reference figure. The only Perplexity model
> with a current rate (`perplexity/sonar` on the Agent API) is far cheaper, so
> the carried figure overcounts — the safe side. The per-request search fee the
> per-token table cannot express still applies.
>
> The standing rule is unchanged: **a price change is a cost-cap change AND a
> routing change** (Auto ranks by the live `PRICE_*` values). GPT-6.2 Sol in
> particular got cheaper and stronger in the same slot, which moves it up every
> Auto ladder.

> **History — the second full re-verify, 2026-09-11 (first: 2026-08-08, audit
> PRV-007 / PRV-008). Superseded by the 2026-11-28 note above; kept as the
> record of what moved then.** All seventeen defaults are pinned
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
> reasoning-depth option on ONE model — not separate model strings. There was
> never a `gemini-3.8-thinking`, and there is no `gemini-4-thinking`: pointing
> `MODEL_GEMINI` at an invented name 404s every call, and since `/api/media`
> reads 404 as a config error, media analysis would silently fall back to
> another provider rather than surfacing the mistake. (Gemini 4's Carbon, Neon
> and Hydrogen ARE three model strings — they are models, not depth labels —
> and each has its own `MODEL_*` variable.) Always take model strings from the
> provider's model-ID table.

## Thinking levels (per-request)

Reasoning depth is a **request option**, not a model string — and since
2026-09 it is **one ladder for every model** (ADR-0018): the composer's
"Thinking" dial offers Auto · Low · Medium · High · Max whatever the target,
the route validates the level against the app's vocabulary and resolves Auto
to a task-shaped default, and each adapter translates the level onto the
model's own words through one table (`providerEffort`,
`src/lib/providers/errors.ts`). The rail appears for targets flagged in
`TARGET_HAS_THINKING` (`src/lib/constants.ts`) and always under Auto.

**Since 2026-11-28 the vocabulary is chosen PER TARGET, not per provider**
(`TARGETS[id].effort` in `src/lib/providers/config.ts`; ADR-0018, Amendment 1).
A per-provider table held only while every model a vendor served took the same
words. Gemini 4 ended that: Carbon accepts `low · medium · high`, Neon and
Hydrogen add `xhigh`, so "the Google vocabulary" would have either 400'd Carbon
or capped the other two a stop short of what the peak caption promises. The
adapter layer passes the target's vocabulary down as
`opts.effortVocabulary`; each provider adapter keeps a documented fallback for
a direct call (Gemini's is the narrower `toHigh`, a set every Gemini 4 model
accepts — an unconfigured caller can under-reach but never 400). Vocabularies
are named for their SHAPE, not for a vendor:

| Vocabulary | Targets                                                  | Wire parameter                                                                 | low · medium · high · max → |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `five`     | Fable 5.2 · Opus 5.5 · Sonnet 5.5 · Haiku 5.5            | `output_config.effort`                                                         | low · medium · high · max   |
| `five`     | Muse Wonder 1.0 · Muse Spark 1.3 · MiniMax M3.1 Flash    | `reasoning_effort`                                                             | low · medium · high · max   |
| `openai`   | GPT-6.2 Astra · GPT-6.2 Sol · GPT-6.1 Terra · GPT-6 Luna | `reasoning_effort`                                                             | low · medium · high · max   |
| `toXhigh`  | Grok 4.7 · Gemini 4 Neon · Gemini 4 Hydrogen             | `reasoning_effort` (Grok) · `generationConfig.thinkingConfig.thinkingLevel`    | low · medium · high · xhigh |
| `toHigh`   | Gemini 4 Carbon · Mistral Large 4                        | `generationConfig.thinkingConfig.thinkingLevel` · `reasoning_effort` (Mistral) | low · medium · high · high  |
| `three`    | DeepSeek V4 Pro · Kimi K3.1 Pro · GLM-5.3                | `reasoning_effort` (low · high · max)                                          | low · high · high · max     |
| `threeX`   | Qwen4 Max                                                | `reasoning_effort` (low · high · xhigh)                                        | low · high · high · xhigh   |
| —          | Sonar Pro                                                | none                                                                           | nothing is sent             |

`tests/unit/provider-effort.test.ts` pins the table and
`tests/unit/models.test.tsx` pins `TARGET_HAS_THINKING` (the client's copy of
"has a knob") to the presence of `effort` (the server's).

Notes that keep this working:

- **"Auto" is resolved by the ROUTE, not the vendor — and it reads the
  target's vocabulary.** The client sends no level; `/api/enhance` calls
  `defaultThinkingLevel(mode, inputChars, hasMedia, target)`. A heavy job (the
  structure-inventing modes expand / reformat / adapt, or a long /
  media-bearing input) gets `high`. A light job (polish / clarify / condense)
  gets the **moderate** stop: `medium` where the model's API has a Medium of
  its own, and **`low` where it does not** (`hasDistinctMedium`, derived from
  the table — today the `three` and `threeX` rows: DeepSeek V4 Pro, Kimi K3.1
  Pro, GLM-5.3 and Qwen4 Max). This is the 2026-11-28 correction: the first
  cut returned `medium` for every light job, the adapter folds `medium` onto
  `high` on a three-valued API, and so on those models Auto sent `high` for a
  light job and `high` for a heavy one — it was choosing nothing, and a grammar
  fix ran at a restructuring job's depth. Vendor defaults are `high` on most of
  the roster and **`max` on Kimi K3.1 Pro, GLM-5.3, Muse Wonder 1.0 and
  MiniMax M3.1 Flash**; none is inherited by an untuned run.
- **The route says what Auto chose.** The `done` event's result carries
  `resolvedThinking` — present ONLY when the dial was on Auto and the target
  has a knob (the same presence-is-the-signal rule as `resolvedTarget`) — and
  the result meta renders it beside the model string, e.g.
  "· Medium thinking (auto)". An explicit dial choice is the user's own and is
  not echoed. The label is looked up, so a level a build has never heard of
  renders as nothing.
- **Three-valued models collapse an EXPLICIT Medium onto their `high`** — it
  is their middle word (low < high < top). Low and Max stay the true ends, so
  the peak caption's "highest cost" is never a lie. The dial still shows both
  stops; only Auto avoids the collapse.
- **Legacy stops fold, never 400.** `minimal` and `xhigh` stay in
  `THINKING_LEVELS` for old drafts and stores; the route accepts them and
  `normalizeThinkingLevel` lands them on Low / High — except on the
  vocabularies whose API serves `xhigh` as a tier of its own (`five`,
  `openai`, `toXhigh`, `threeX`), where it rides through. There is no
  per-target 400 ("That thinking level isn't available for this model").
- **Gemini 4:** `thinkingLevel` and the Gemini-2.5-era `thinkingBudget` are
  mutually exclusive — the adapter only ever sends the former. Gemini 4 cannot
  stop thinking and rejects `minimal`, so the floor is `low`. Carbon's Max
  lands on `high` (its top); Neon's and Hydrogen's on `xhigh`.
- **Anthropic:** thinking bills as output tokens against `max_tokens`, so the
  adapter raises the output ceiling at `xhigh`/`max` (64k); never send the
  retired `thinking.budget_tokens`. From the 5.5 generation thinking cannot be
  disabled at all. Haiku 5.5 serves the same five words as its siblings.
- **OpenAI:** `none` is rejected on the 6.2 pair and is never sent — the
  ladder's floor is `low`.
- **Mistral Large 4 is a reasoning model.** It takes a top-level
  `reasoning_effort` (low · medium · high, default high) and does **not**
  accept none / minimal / xhigh / max even though the API-wide enum lists
  them, so Max lands on `high`. Its reasoning bills against `max_tokens`, so
  the flat 16k ceiling Large 3 had now steps to 32k on the deep tier. Still no
  `stream_options` (Mistral 422s on unknown request fields), and
  `reasoning_effort` is omitted entirely when no level was resolved, so a
  non-reasoning model pointed at via `MODEL_MISTRAL` is never sent it.
- **Muse (both) and MiniMax M3.1 Flash gained a knob** and cannot stop
  reasoning (`none` is a 400 on each). Muse Wonder's and MiniMax's vendor
  default is `max`, so like Kimi they must never run on an inherited default.
  MiniMax still interleaves reasoning inside `content` as `<think>` spans (the
  filter stays); Meta redacts `reasoning_content` to empty.
- **Qwen moved from a token BUDGET to an effort WORD.** Through Qwen3.8 the
  knob was `enable_thinking` + `thinking_budget`, and the adapter carried a
  per-stop budget table (1k · 4k · 8k · 16k). Qwen4-Max takes
  `reasoning_effort` (low · high (default) · xhigh) and **rejects the two
  together**, so the budget table is removed rather than kept beside the word.
  Left unset the model thinks at `high` against a 131,072-token budget — the
  route's resolved level matters here as much as on Kimi.
- **A model tier is not a thinking level.** "Max" in `Qwen4 Max` is Alibaba's
  flagship tier. Reading it as a reasoning depth is what once left the target
  with no selector while its API took a reasoning control all along — the same
  class of mistake as inventing a `gemini-…-thinking` model string, in reverse.
- **Cost:** higher levels spend more output tokens, which the daily cost cap
  counts like any other output — expect fewer runs per day at `max`.
- **One target has no knob: Sonar Pro.** Its reasoning control lives on
  Perplexity's Agent API; the legacy chat endpoint this adapter still calls
  documents none. It shows no rail and is sent nothing; the dial's value waits
  for the next model that can use it.

Note on cost: Fable 5.2 and GPT-6.2 Astra list at $8/$40 per 1M tokens
(in/out) — the priciest rows, so users reach the daily cost cap soonest on
them — followed by Opus 5.5, Gemini 4 Carbon and Muse Wonder 1.0 at $4/$20. At
the other end, Haiku 5.5 and GPT-6 Luna ($0.10/$0.50) and MiniMax M3.1 Flash
($0.15/$0.60) barely dent the cap. Every default was re-verified against its
vendor's published rates on 2026-11-28 (the "Pinned ids & verified prices" note
above); `src/lib/providers/config.ts` is the authoritative per-target list, and
each row carries its `pricesVerifiedAt` date. Override the matching `PRICE_*_IN`
/ `PRICE_*_OUT` env vars when your account's rates differ — and remember a price
override re-ranks Auto routing as well as re-pricing the cap.

## Refusals: the model declined (422), not "non-JSON response"

A completed, HTTP-200 turn whose stop reason is a **refusal** and which
produced no output is now reported as what it is. The adapter layer
(`src/lib/providers/adapter.ts`) checks the provider's raw stop reason against
`REFUSAL_STOPS` (`errors.ts`) — Anthropic `refusal`; OpenAI-compatible
`content_filter`; Gemini `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`,
`RECITATION` — and, when nothing decoded, throws `ProviderRefusalError`.
`/api/enhance` turns that into an error event with **status 422** and the
sentence `The model declined this request (category). Nothing was produced —
try a different target model, or rephrase the prompt.` (the parenthesis appears
only when the provider gave a category). Not a 502: nothing
upstream failed — the key is fine, the model id is served, the request was
well-formed. Before this, the empty stream fell through to "The model returned
a non-JSON response.", which names the wrong party and offers no next step.

- The category is the provider's own word when it gave one (Anthropic's
  `stop_details.category`, read through a widened type because the vendored
  SDK's delta type predates the field). It is relayed for display, never
  interpreted.
- **Only when nothing decoded.** A filter that fires after a complete output
  is the existing salvage path — what streamed was paid for and is kept.
- **Server-side refusal fallbacks are deliberately NOT enabled.** Anthropic's
  `fallbacks` beta would retry a refused turn on another model server-side. A
  fallback model bills at its own rate, and the cost ledger prices a run by
  its **target** (`computeCost(target, …)`), so a fallback would be charged at
  the wrong rate with no ledger row saying so. Enabling it is a
  cost-accounting decision for the owner, not an adapter default; the user's
  remedy today is the one the sentence names — pick another target or rephrase.

## Output ceilings (`max_tokens`)

The OpenAI-compatible factory sends **16k** by default, which keeps a runaway
generation bounded without truncating a real answer, and **32k** for the deep
tier (High / Max) on providers that declare `deepMaxTokens` — DeepSeek, Kimi,
GLM, and since 2026-11-28 Meta (Muse) and MiniMax, whose models now reason —
because reasoning bills against the same ceiling (the Anthropic lesson).
Mistral's own adapter takes the same 16k → 32k step for the same reason now
that Large 4 reasons. The ceiling is a per-API fact, not a preference:
**DashScope capped `qwen3.7-max` at 8192** and rejected anything higher with
`400 InternalError.Algo.InvalidParameter: Range of max_tokens should be
[1, 8192]` — which failed _every_ Qwen run until the provider declared its
own `maxTokens`. That 8192 then outlived the model it described: Model
Studio's `qwen3.8-max` page published **131,072**, and the carried 8192 with
a 4096 thinking budget was why Qwen truncated sooner than any other target.
When adding or bumping a compat provider, read its `max_tokens` range from the
API reference rather than inheriting a default — in either direction.

Qwen4-Max's cap covers chain-of-thought **and** answer (ceiling 131,072
non-thinking / 262,144 thinking), so its adapter sends **32k** on the base step
and **64k** on the deep tier. `MAX_TOKENS_QWEN`, when set, caps **both**
steps: an explicit value is a statement about what the account's scope
serves, and a fixed 64k deep step would 400 every High / Max run on exactly
the accounts that set it. If an account's scope serves a lower range, set the
env var to that number rather than editing the adapter. Do not set it on a guess, and do not copy an old
`MAX_TOKENS_QWEN=8192` forward from a previous `.env`: that re-imposes the
qwen3.7 ceiling on a model that spends its cap on thinking first, which
truncates. (`.env.example` carried exactly that line until 2026-11-28.)

Several vendors now document `max_completion_tokens` as the preferred name and
`max_tokens` as a deprecated alias (Qwen, Kimi, Meta, MiniMax). Every one of
them still serves the alias, so the shared factory keeps the one field.

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
- Each ladder orders the pool (all twenty-one minus `autoExcluded` — currently
  Sonar Pro, whose search-grounded answers and per-request search fee make it
  a manual-pick-only engine, and whose legacy chat endpoint is sunset): **quality** sorts by strength then price;
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

The same tier classifier (`classifyTier`) also resolves the **Thinking dial's**
Auto, so routing and depth cannot disagree about what kind of job this is — and
since 2026-11-28 the depth half reads the resolved target's effort vocabulary
(`medium`, or `low` where the model has no Medium of its own; see "Thinking
levels" above). Auto routing resolves the target first; the depth is chosen
for the model that will actually run.

The four 2026-11 slots enter the pool with their own editorial ranks
(`TARGET_ROUTING` in `manifest.ts`, rationale per row, checked 2026-11-28):
Haiku 5.5 strength 6 / fast, Gemini 4 Carbon 9 / deliberate, Gemini 4 Neon 8 /
standard, Muse Wonder 1.0 8 / deliberate (a preview with regional gaps and a
vendor-default effort of max — strong, unproven, never fast).

Operational couplings to know:

- **`PRICE_*` overrides re-rank Auto.** The router prices candidates from the
  live `TARGETS` values, so a pricing override is a routing change, not just a
  cap change. After editing Vercel env, sanity-check what Budget resolves to.
  A **stale** override does the same silently: after a roster bump, a
  `PRICE_*` left at the previous model's rate ranks the new model by the old
  price (see the override note under "Model strings").
- **A key added or removed re-routes Auto** on the next invocation —
  availability is part of the policy, by design.
- The exported `AUTO_LADDERS` are the test surface: `auto-target.test.ts`
  derives its expectations from them and from live `TARGETS`, so price moves
  don't rot the suite.

## Sonar Pro is on a sunset endpoint (open follow-up)

Perplexity **ended Sonar Chat Completions support on 2026-09-27**. The legacy
endpoint this adapter calls (`https://api.perplexity.ai`, model `sonar-pro`)
**still answers**: requests are "reformulated as Agent API requests, rolling
out gradually by model". Still answering is not still supported — the status
that matters is the vendor's docs, not the 200.

What that means for this deployment today:

- The slot keeps working until Perplexity stops reformulating it; there is no
  published date for that, and a change may arrive per model.
- The pricing page no longer lists `sonar-pro`. The $3/$15 in `config.ts` is a
  **carried reference figure** (`pricesAssumed`), and it overcounts relative to
  the only Perplexity model with a current rate.
- The legacy endpoint documents no reasoning control, so Sonar Pro is the one
  target with no Thinking rail.
- It stays out of Auto's pool (`autoExcluded`), so no user lands on it by
  surprise; it is a manual pick only.

**Open follow-up — not done in the 2026-11-28 pass:** move the slot to the
Agent API, a Responses-style endpoint at `https://api.perplexity.ai/v1` with
model `perplexity/sonar`. That is a **new adapter**, not a config change — the
shared factory in `openai-compat.ts` speaks Chat Completions — which is why it
was left out of a roster re-verify. When it lands: re-read the rate (and drop
`pricesAssumed`), re-check whether the Agent API's reasoning control gives the
target a knob (`TARGET_HAS_THINKING.sonar_pro` and `TARGETS.sonar_pro.effort`
move together), and re-read the vision path, which uses the same legacy
endpoint.

## Looked at and not added (2026-11-28)

Each would need a new adapter, a new key and a new developer mark — a roster
change of a different size from a rename:

- **Tencent Hy4.**
- **Xiaomi MiMo-V2.6-Pro.**

Within existing developers, three other ids were read and left off on purpose:
DeepSeek's V4.1-Flash (a throughput tier; `deepseek-v4-pro` is still the API's
strongest), Z.ai's GLM-5.4 (Coding Plan only until the Model API serves it),
and Kimi's `-highspeed` variant (twice the rate).

## What is not verified

**None of the provider changes in the 2026-11-28 pass were exercised against a
live API.** The verification gate has no provider keys, so what is green is
unit tests over pure request builders, stubbed streams and the translation
table — evidence that the app sends what the docs say each API accepts, not
evidence that each API accepts it. Every id, rate and effort word was read from
the vendor's own page on 2026-11-28; none was confirmed by a response.

**The first live run per provider is the real test.** Specifically unproven:

- **Every new or renamed model id** resolves on the deployment's keys (a 404
  names the `MODEL_*` override to check; a 401/403 names the key).
- **Every effort word** in the table above is accepted by its model — in
  particular the four that gained a knob this pass (Mistral Large 4, Muse
  Wonder 1.0, Muse Spark 1.3, MiniMax M3.1 Flash), Qwen4 Max's move from
  `enable_thinking` + `thinking_budget` to `reasoning_effort`, and Carbon's
  narrower set.
- **Mistral Large 4's stream shape.** Its reasoning models may stream `content`
  as an **array of typed chunks** (`thinking` beside `text`) rather than a
  plain string. `mistralText` (`src/lib/providers/mistral.ts`) keeps text
  chunks only and passes a string through — written from the **documented**
  shape, **not from a captured Large 4 stream**. If a Large 4 run returns an
  empty or corrupted envelope, look there first.
- **Refusal handling.** `ProviderRefusalError` is pinned against synthetic
  stop reasons; no real refused turn has been observed on any provider, and
  the category field is read through a widened SDK type.
- **Vision at the lowest effort with 4096 tokens of headroom**
  (`docs/runbooks/media.md`) — no image has been analyzed by any of the
  re-pointed models.
- **Muse Wonder 1.0's regional availability** on the account behind
  `META_API_KEY`.
- **Neither migration has been applied to the hosted project**
  (`docs/runbooks/migrations.md`).

Record the first live result per provider here, dated, and delete the matching
bullet.

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
transformation diff with copy/share/export. Under an Auto dial the result also
carries `resolvedThinking` (and, under Auto routing, `resolvedTarget` +
`resolvedReason`); a model that declined the request ends the stream with a 422
error event instead (see "Refusals" above).
