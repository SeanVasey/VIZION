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
  rate limit + daily cost cap + usage logging as `/api/enhance`.
- **provider fallback**: when the selected model fails for a _config-shaped_ reason —
  missing key, a key the provider rejects (401/403), or an unknown model string
  (404) — the route retries once on the first _other_ configured provider
  (Opus 5 first, then GPT-5.6 Sol · Gemini 3.6 Flash · Mistral Large 3 ·
  Grok 4.5 · Muse Spark 1.1 · Kimi K3 · Sonar Pro). Targets whose flagship is
  text-only (DeepSeek V4 · MiniMax M3 · Qwen3.7 Max · GLM-5.2) skip the
  attempt and route straight to that same chain. The response carries
  `fallbackFrom` + the real `usage.target`; usage is logged (and the chip credited)
  against the model that actually analyzed, and the card shows a soft note.
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
- **Audio** — structured spec (`Tempo / Timbre / Mood / Duration`)
