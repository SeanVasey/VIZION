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
  (Opus 4.8 first, then GPT-5.6 Sol · Gemini 3.5 Thinking · Mistral Large 3 ·
  Grok 4.5). The response carries
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
  the `{user_id}/…` path prefix. The Midjourney image-ref uses a 7-day **signed URL**.
- `media_assets` (RLS owner-only) records each attachment (`kind`, `storage_path`,
  `size_bytes`, `extracted` jsonb).
- A per-user **50 MB** budget shows an **Amber** warning at 80% and blocks new uploads at
  100% (tune in `src/lib/media/formatters.ts`).

## Generation formatters

`buildGenerationPrompt(base, attributes, target, refUrl?)` in
`src/lib/media/formatters.ts` is pure and unit-tested:

- **Midjourney** — `<ref> <desc> --ar 16:9 --v 6 [--iw 1]`
- **Runway / Sora / Kling** — labeled motion phrasing (`Subject / Camera & motion / …`)
- **Audio** — structured spec (`Tempo / Timbre / Mood / Duration`)
