# Runbook — media prompts (P5)

Attach an image / video / audio reference and fold its detected attributes into a
generation-ready prompt (Midjourney · Runway · Sora · Kling · audio).

## Extraction pipeline (flagged)

```
NEXT_PUBLIC_MEDIA_EXTRACTION=proxy   # default — vision via the model proxy
# NEXT_PUBLIC_MEDIA_EXTRACTION=ondevice   # fast, private, limited
```

- **proxy** (default): the client captures a downscaled frame and posts it to
  `/api/media`, which runs a vision pass on the **selected target model** and returns
  attributes (subject, composition, palette, lighting, style, mood) plus the prose
  description. Needs that provider's key. `/api/media` is a model route — same auth +
  rate limit + daily cost cap + usage logging as `/api/enhance`. With Auto routing
  on, the request carries `auto: true` and the route resolves the target itself
  through the auto ladders filtered to vision-capable, configured targets
  (`resolveAutoVisionTarget`) before the pass runs.
- **provider fallback**: when the selected model fails for a _config-shaped_ reason —
  missing key, a key the provider rejects (401/403), or an unknown model string
  (404) — the route retries once on the first _other_ configured provider
  (Opus 5.5 first, then GPT-6.2 Sol · Gemini 4 Hydrogen · Mistral Large 4 ·
  Grok 4.7 · Muse Spark 1.3 · Kimi K3.1 Pro · Qwen4 Max · MiniMax M3.1 Flash ·
  Sonar Pro — `VISION_FALLBACK_ORDER` in `src/lib/providers/vision.ts`; one
  entry per provider, so the four 2026-11 slots are reachable as selected
  targets but are not fallbacks). Targets whose model is text-only (DeepSeek V4
  Pro · GLM-5.3 — their vision models are separate SKUs) skip the attempt and
  route straight to that same chain. The response carries `fallbackFrom` + the
  real `usage.target`; usage is logged (and the chip credited) against the
  model that actually analyzed, and the card shows a soft note.
- **lowest effort, 4096 tokens of headroom** (2026-11-28): every vision-capable
  model on the roster now reasons, and reasoning bills against the output cap
  before any JSON is written — a cap sized for the JSON alone can be spent on
  thinking and return **empty attributes with no error**. So the vision call
  asks for the model's own **lowest** effort word — the ladder's `low`
  translated through the same per-target vocabulary the enhance path uses
  (`providerEffort`); nothing is sent to a model with no knob, i.e. Sonar Pro —
  instead of inheriting a vendor
  default that is `high` on most of the roster and `max` on Kimi, Muse Wonder
  and MiniMax, and every capped call carries `VISION_MAX_TOKENS = 4096` — the
  1024 caps that Anthropic, Mistral, Meta, Kimi and Qwen carried were each
  sized when that model had no reasoning to pay for. Gemini's call sets no
  output cap at all; it gets the low `thinkingLevel` only. The Qwen call reads
  the same `QWEN_BASE_URL` override as the enhance adapter. None of this was
  exercised against a live provider (see "What is not verified" in
  `docs/runbooks/providers.md`).
- **on-device fallback** (also used for audio, when the flag is `ondevice`, or when the
  proxy is unconfigured/unreachable): canvas palette + dimensions for image/video, and
  duration for audio. No key, no network.

## Troubleshooting

- **"Vision request failed: 401 You have insufficient permissions for this
  operation."** — the _provider_ rejected the server's API key for the vision call
  (our own 401 is "Sign in to analyze media."). Typical causes: a restricted /
  project-scoped key without access to the inference endpoint, or a workspace key
  whose org can't use that model. Fix the key in the provider console (then in the
  Vercel project env); until then the route analyzes on the first other configured
  provider and only degrades to on-device when no provider works.
- **404 model errors** — the `MODEL_*` env override points at a string that account
  doesn't serve; see `docs/runbooks/providers.md`.

## Storage

- Private Supabase bucket **`media`** (not public); writes/reads scoped to the owner via
  the `{user_id}/…` path prefix.
- `media_assets` (RLS owner-only) records each attachment (`kind`, `storage_path`,
  `size_bytes`, `extracted` jsonb).
- A per-user **50 MB** budget shows an **Amber** warning at 80% and blocks new uploads at
  100% (tune in `src/lib/media/formatters.ts`).

### Viewing stored media

The manager (Settings → Data & privacy, and the composer tray past 80%) shows a
thumbnail per image row and opens any `ready` row in a preview sheet. Because the
bucket is private, both go through signed URLs — `src/lib/media/preview.ts`:

- **List** — one `createSignedUrls` batch for the image rows only
  (`PREVIEW_URL_TTL_SECONDS`, 1 h). A signer failure, or a per-path error,
  degrades that row to its kind glyph; the list keeps working.
- **Open** — `createSignedUrl` per tap, so a long-open page never hands the
  sheet a URL that aged out of the batch.
- `pending`/`failed` rows have no object in the bucket and are deliberately not
  openable.
- `img-src`/`media-src` in `next.config.ts` already allow `https://*.supabase.co`;
  a custom storage domain would need adding there. The service worker ignores
  cross-origin requests, so signed URLs are never cached by it.
- Thumbnails are the **full stored objects**, rendered small and lazily. This is
  a known, accepted cost (decided 2026-07-28): opening the manager with a large
  library downloads those originals, and it repeats per visit because each load
  mints fresh signed URLs that miss the browser cache.

  The obvious fix is not available here. Signing thumbnails individually with
  `{ transform: { width, height, resize: "cover" } }` needs **Storage image
  transformations, which are Pro+**; this project's org is on the free plan. The
  transform is bound into the signed token, so it also cannot be bolted onto a
  batch-signed URL after the fact — it is one signing request per image or
  nothing.

  What would work on any plan, if the cost ever bites: capture a ~96 px JPEG at
  upload with the downscaler the composer already runs
  (`captureFrameDataUrl(file, kind, 96)`) and keep it as a data URI on a new
  nullable `media_assets.thumb` column. The list then costs zero extra requests
  and zero quota, and video rows gain a real first-frame thumbnail instead of a
  glyph. It needs a migration plus a backfill for rows predating the column.

## Generation formatters

`buildGenerationPrompt(base, attributes, target)` in
`src/lib/media/formatters.ts` is pure and unit-tested (no reference URL or
image-weight flag is ever embedded — asserted by negative tests):

- **Midjourney** — `<desc> --ar <from extracted dimensions, default 16:9> --v 6`
- **Runway / Sora / Kling** — labeled motion phrasing (`Subject / Camera & motion / …`)
- **Audio** — structured spec (`Mood / Duration` — file metadata only, no
  semantic tempo/timbre pass; the old fields were dead schema, 2026-07)
