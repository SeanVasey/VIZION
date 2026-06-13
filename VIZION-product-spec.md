# VIZ(IO)N — Product Specification

**A VASEY/AI application · Prompt-engineering studio, mobile-first**

> VIZ(IO)N is the inclusive successor to rePROMPTer 2: same two-model lineage, now a three-model panel with per-target formatting, multi-mode enhancement, and media-aware prompt construction. Where rePROMPTer 2 *upgraded* a prompt, VIZ(IO)N *transforms* it — clarifying, expanding, condensing, reformatting, and re-targeting the same idea for whichever engine is about to receive it.

-----

## 0. Assumptions (stated explicitly)

|# |Assumption                                                                                                                                                                                                                                                                                  |Rationale                                                                    |
|--|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
|A1|**The attached image is available.** Palette is derived from `IMG_2994.JPG` (5 swatches).                                                                                                                                                                                                   |Verified five hex values; no fallback needed.                                |
|A2|“Same 2 models” refers to rePROMPTer 2’s pairing; VIZ(IO)N widens this to **3** target models per the brief.                                                                                                                                                                                |The “more inclusive version” framing.                                        |
|A3|The three target models (**Opus 4.8, GPT-5.5, Gemini Pro 3.1**) are treated as named product targets; the provider-adapter layer is version-agnostic so model strings can be swapped without UI changes.                                                                                    |Future-proofing against model churn.                                         |
|A4|**Magic-link users still set a password** during onboarding to convert passwordless entry into a durable email+password account; magic link then remains a convenience re-entry path. This resolves the apparent tension between “magic link” and “non-OAuth users must set email+password.”|Brief requires non-OAuth users to hold an email+password credential.         |
|A5|A **`MediaAsset`** entity is added beyond the six named entities, since attached media is a first-class input.                                                                                                                                                                              |The brief calls for media to be “viewed” and folded into the upgraded prompt.|
|A6|iOS Safari is the **lead** target; **Android / Samsung Galaxy (Chrome)** reaches parity-plus (richer Web Push, more generous storage) and is noted where the platforms diverge.                                                                                                             |Brief specifies iOS-first; Sean ships dual-platform.                         |
|A7|Brand house = **VASEY/AI** (AI tooling). No association with VASEY.AUDIO.                                                                                                                                                                                                                   |Brand-separation rule.                                                       |

-----

## 1. Brand & Visual Design

### 1.1 Logo & wordmark — the (IO) aperture

The wordmark reads **VIZ(IO)N** — phonetically *vision*, structurally *viz · io · n*. The parentheses are not punctuation; they are a **lens aperture**, and the `IO` they enclose is the focal point where **I**nput becomes **O**utput.

```
   V I Z ( I O ) N
            ▲
   chalk     lime    chalk
   (context) (focus) (context)
```

**Treatment rules**

- `V Z N` set in the display face, **Chalk `#F2F3F6`** on dark (or **Void** on light).
- `( )` rendered as thin **Silver `#B9BCC5`** brackets — a hairline aperture ring, ~40% weight of the letterforms.
- `I O` set in **Laser `#B7FF3C`**, one weight heavier than its neighbors. The `I` is a vertical *input bar*; the `O` is an *output ring*. A 1px lime caret `›` sits hairline-tight between them at large sizes only (`I › O`), suppressed in the favicon/app-icon for legibility.
- **App-icon glyph:** a Void rounded-square tile; centered, an `I` and `O` in Laser separated by a lime transformation chevron, framed by the silver aperture brackets. Exported as a **transparent-background PNG suite** (full size matrix) plus an SVG master; manifest declares **both `"any"` and `"maskable"`** icon entries.

**Signature element (the one memorable thing):** the **transformation diff** — input prompt on the void end, enhanced prompt on the chalk end, with changed tokens lit in Laser. The aperture motif and the diff are the brand’s two recurring gestures; everything else stays quiet.

> Designer’s note: a near-black canvas with a single acid-green accent is, normally, an AI-design default I’d avoid on reflex. Here it’s **brief-mandated** — the palette is extracted from your supplied image, not reached for — so the discipline goes into making the *execution* unmistakable: the (IO) aperture, the input→output color ramp, and the diff visualization carry the identity, not the green-on-black itself.

### 1.2 Color system (derived from `IMG_2994.JPG`)

Seven roles: five extracted, two derived (no semantic success/error exists in a mono+lime strip, so `Pulse` and `Flare` are synthesized to sit beside the accent without colliding with it).

|Role                         |Name  |Hex      |Source     |Usage                                                                  |
|-----------------------------|------|---------|-----------|-----------------------------------------------------------------------|
|**Background**               |Void  |`#0F1012`|extracted  |App base, splash, standalone status bar backdrop                       |
|**Surface**                  |Onyx  |`#2B2D33`|extracted  |Cards, sheets, glass panels, bottom-nav bar                            |
|**Secondary / Muted**        |Silver|`#B9BCC5`|extracted  |Secondary text, borders, disabled states, aperture brackets            |
|**Primary text / Light base**|Chalk |`#F2F3F6`|extracted  |Body text on dark; canvas base in light theme                          |
|**Accent / Primary action**  |Laser |`#B7FF3C`|extracted  |CTAs, the (IO) highlight, focus glow, diff-changed tokens, active icons|
|**Success** *(derived)*      |Pulse |`#3DD68C`|synthesized|Save confirmed, copied, sync-complete                                  |
|**Error** *(derived)*        |Flare |`#FF5247`|synthesized|Auth failure, enhancement error, validation                            |
|*Optional warning*           |Amber |`#FFC24B`|synthesized|Storage-eviction warnings, token-limit cautions                        |

**Why Pulse ≠ Laser:** Laser is the *action/identity* color and appears constantly; a success state painted in the same hue would be indistinguishable from a button. Pulse is cooler and slightly desaturated so “it worked” never reads as “click me.”

**Contrast — verified (WCAG 2.1, relative-luminance method):**

|Combination                         |Ratio     |Verdict              |
|------------------------------------|----------|---------------------|
|Chalk text on Void                  |17.16:1   |AAA                  |
|Silver text on Void                 |10.03:1   |AAA                  |
|Chalk on Onyx                       |12.40:1   |AAA                  |
|Silver on Onyx                      |7.25:1    |AAA                  |
|Laser on Void                       |15.76:1   |AAA                  |
|Laser on Onyx                       |11.39:1   |AAA                  |
|**Void text on Laser fill (button)**|15.76:1   |AAA                  |
|Void text on Chalk (light mode)     |17.16:1   |AAA                  |
|Pulse on Void                       |10.15:1   |AAA                  |
|Flare on Void                       |5.94:1    |AA                   |
|**Laser *text* on Chalk**           |**1.09:1**|**FAIL — prohibited**|

**Hard rule from the math:** Laser is a *fill and accent on dark surfaces only.* It is never used as text on a light background, and buttons are always **Void text on a Laser fill**, never the reverse.

### 1.3 Typography

Consistent with the VASEY/AI suite, with the utility face elevated because prompts *are* code-adjacent.

|Role              |Family        |Source      |Use                                                                                     |
|------------------|--------------|------------|----------------------------------------------------------------------------------------|
|**Display**       |Bebas Neue    |Google Fonts|Wordmark, screen titles, mode labels (tall, condensed, instrument-panel energy)         |
|**Body / UI**     |Reddit Sans   |Google Fonts|Buttons, body copy, form fields, nav labels                                             |
|**Utility / Mono**|JetBrains Mono|Google Fonts|Prompt text, the diff view, JSON/XML scaffolds, token counts, model tags, version hashes|

**Type scale** — Major Third (ratio 1.25), base 16px: `12 · 14 · 16 · 20 · 25 · 31 · 39`. Bebas runs at the `25`+ steps with wide tracking; mono sits at `14` with tabular numerals for token/cost readouts.

### 1.4 Spacing, elevation & iconography

- **Grid:** 4px base unit; 8-point rhythm for component padding; 16/24px section gutters; thumb-zone-aware bottom inset.
- **Elevation = translucency + light, not drop shadow.** Frosted **Onyx** glass panels (`backdrop-filter: blur(16px)`, ~72% opacity) over Void, edged with a 1px Silver hairline at 20% and, on focus/active, a soft **Laser** outer glow (`0 0 0 1px Laser, 0 0 24px Laser@25%`). Three tiers: base (Void), raised (glass Onyx), focused (glass + lime edge-light).
- **Gradient:** a single quiet vertical Void→Onyx wash on the app shell; no rainbow gradients.
- **Iconography:** 1.5px stroke, rounded joins, 24px grid. Silver at rest, **Laser** when active. Provider marks (GitHub, Google, model vendors) and any official dev/brand logos are sourced from **thesvg.org** first, then optimized through the standard Potrace→SVGO pipeline.
- **Aesthetic direction:** dark-default **glassmorphism** with a single energetic signal (Laser), generous negative space, and an “instrument console” feel — closer to a studio rack unit than a chat app. Light theme inverts to a Chalk canvas with Void text; Laser is retained as accent (fill-only, per §1.2).

-----

## 2. Platform & Architecture

### 2.1 Mobile-first PWA (iOS Safari lead)

- **Installable:** Web App Manifest with `display: standalone`, `theme_color: #0F1012`, `background_color: #0F1012`, full icon matrix (transparent PNGs) declaring **both `"any"` and `"maskable"`** purposes, plus generated iOS splash screens per device class.
- **Offline shell:** app shell (nav, mode UI, last-opened prompt, cached library page) precached; enhancement requests require network and **queue** when offline, flushing on next foreground.
- **Safe-area handling:** `viewport-fit=cover` + `env(safe-area-inset-*)` on the bottom-nav, header, and full-bleed surfaces — wired through your **reusable agentic safe-area template (v2, luminance-based dark/light polarity detection)** so the status-bar tint and nav contrast resolve correctly against Void or Chalk without per-app hand-tuning. This closes the recurring iOS notch/home-indicator issue across the suite generically.
- **Touch ergonomics:** ≥44×44pt targets (48px comfortable); primary actions anchored in the bottom third; **3-tab bottom nav** — `Enhance · Library · Profile`.
- **Standalone behaviors:** `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, custom splash, swipe-back affordance (Safari standalone has no chrome), and pull-to-refresh suppressed inside the enhance editor to protect in-progress text.

### 2.2 Frontend stack

|Layer         |Choice                                                   |One-line justification                                                   |
|--------------|---------------------------------------------------------|-------------------------------------------------------------------------|
|Framework     |**Next.js 15 (App Router) + React 19 + TypeScript**      |Your standard; RSC + route handlers keep model keys server-side.         |
|Styling       |**Tailwind CSS** + CSS variables for the 7 tokens        |Token-driven theming and trivial dark/light swap.                        |
|Server state  |**TanStack Query**                                       |Cache + background refetch + offline-aware mutations for prompts/history.|
|UI/local state|**Zustand**                                              |Tiny, ergonomic store for editor draft, mode, model selection.           |
|PWA / SW      |**Workbox** (custom service worker)                      |App-shell precache + per-route runtime strategies (below).               |
|Media         |Client-side **crop** (canvas) before upload; lazy `Image`|Avatar crop and media-attachment preview without a heavy editor.         |

**Service-worker strategy**

- App shell & static assets → **stale-while-revalidate**.
- Auth/session & enhancement API → **network-first** (never serve a stale enhancement).
- Library/history reads → **network-first with cache fallback** for offline browsing.
- Mutations (save/version) → **Background Sync queue** on Android; on iOS, a local IndexedDB outbox flushed on `visibilitychange`.

### 2.3 Backend & data layer

|Layer           |Choice                                                           |One-line justification                                                                                                     |
|----------------|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
|DB              |**Supabase Postgres** with **RLS from day one**                  |Per-user row isolation enforced at the database, not the app.                                                              |
|Auth            |**Supabase Auth**                                                |Native magic-link + GitHub + Google OAuth in one provider.                                                                 |
|Storage         |**Supabase Storage** (per-user bucket prefix)                    |Avatars + attached media, access-scoped by policy.                                                                         |
|API             |**Next.js Route Handlers / Edge** as a **provider-adapter proxy**|Anthropic / OpenAI / Google calls server-side; keys never reach the client; per-user cost caps + rate limits enforced here.|
|Async (optional)|**Inngest**                                                      |Queued/long media-extraction or batch re-targeting jobs if enhancement latency grows.                                      |
|Deploy          |**Vercel** (preview deploys per PR)                              |Your primary target; edge for DDoS posture.                                                                                |

**Provider adapter:** a single `enhance(input, mode, target)` interface fans out to model-specific formatters (§4.3). Swapping `claude-opus-4-8` → a newer string is a config change, not a refactor.

### 2.4 iOS PWA limitations & mitigations

|Limitation               |Reality on iOS Safari                                                                                  |Mitigation                                                                                                                                                                                                                        |
|-------------------------|-------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Push notifications**   |Web Push works **only** for Home-Screen-installed PWAs (16.4+), permission gated, no silent background.|Treat push as enhancement, not foundation: in-app **activity feed** is canonical; offer **email digests** for re-engagement; request push permission contextually *after* install + first save. Android/Galaxy gets full Web Push.|
|**Storage eviction**     |IndexedDB/Cache may be cleared after ~7 days of inactivity (ITP).                                      |**Server is source of truth** — local cache is convenience only. Call `navigator.storage.persist()`; re-hydrate from Supabase on launch; never store the *only* copy of a prompt locally.                                         |
|**Background sync**      |Unreliable/absent in Safari.                                                                           |IndexedDB **outbox** pattern; flush on `visibilitychange`/`online`.                                                                                                                                                               |
|**Standalone navigation**|No browser chrome / back button.                                                                       |Custom in-app back affordance + edge-swipe; preserve editor draft across nav.                                                                                                                                                     |
|**Storage quota**        |Smaller, opaque quota vs. Android.                                                                     |Cap local media cache; evict oldest; warn in **Amber** before hitting limits.                                                                                                                                                     |

-----

## 3. Authentication & Accounts

**Signup/login is required before any enhancement.** The unauthenticated state shows only the brand, a one-line value prop, and the three auth methods.

### 3.1 Methods

1. **Magic email link** (passwordless entry → completes to email+password per A4).
1. **GitHub OAuth.**
1. **Google OAuth.**

No DIY auth — Supabase Auth handles tokens (JWT ≤7d + rotation), session, and OAuth handshakes.

### 3.2 Profile population & editing

- **OAuth signups:** auto-populate **avatar, full name, email** from the provider. All remain user-editable; the user sets a **username/display name**. No password required (provider is the credential).
- **Magic-link / non-OAuth:** after email verification, the user **must set a password** and may upload an avatar. Email+password becomes the durable credential; magic link stays available as a convenience.

### 3.3 Profile fields

- **Circular avatar** with upload + client-side **crop** (square crop → circular mask).
- **Full name.**
- **Username / display name** (unique, used on shared prompts).
- **Email address** (verified).
- **Password** (where applicable — non-OAuth accounts).

The account **stores and syncs saved prompts, version history, and the activity feed** across devices via Supabase, scoped by RLS.

-----

## 4. Core Features

### 4.1 Enhancement engine — modes

|Mode                         |What it does                                                                     |Lyric for it                                                                          |
|-----------------------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
|**Clarify**                  |Resolves ambiguity, fixes intent, tightens scope without changing the ask.       |Editing for sense before flourish.                                                    |
|**Expand**                   |Adds structure, constraints, examples, and missing specificity.                  |Eminem-grade multisyllabic density — more precision packed per line, not more padding.|
|**Condense**                 |Strips redundancy to the minimum viable prompt; token-budget aware.              |The opposite club selection.                                                          |
|**Reformat**                 |Restructures into roles, sections, JSON specs, CoT scaffolds, or few-shot frames.|Re-orchestration of the same motif.                                                   |
|**Model-Targeted Adaptation**|Re-renders the prompt into the chosen model’s idiomatic syntax (§4.3).           |Same composition, different instrument.                                               |

Every mode renders a **transformation diff**: original on the Void side, enhanced on the Chalk side, changed tokens lit in **Laser**, with an explanation of *what changed and why* in the interface’s voice.

### 4.2 Media-prompt tools

Attach an **image, video frame, or audio reference**; VIZ(IO)N “reads the details” (subject, composition, palette, lighting, style, mood, tempo/timbre for audio) and **folds them into the upgraded prompt**, formatted for the target *generation* model — Midjourney image-reference syntax, Runway ML / Sora / Kling motion phrasing, or a structured audio-gen spec. This is the bridge between your visual/Midjourney-U work and the prompt studio: drop a reference, get a generation-ready prompt that already encodes what the asset actually contains.

### 4.3 Model selector — per-model formatting awareness

|Target            |Idiomatic conventions VIZ(IO)N applies                                                                           |
|------------------|-----------------------------------------------------------------------------------------------------------------|
|**Opus 4.8**      |XML-tagged sections, explicit system/user separation, chain-of-thought scaffolds, long-context structuring.      |
|**GPT-5.5**       |Developer/system/user roles, JSON-mode / structured-output specs, tool/function schemas, terse system directives.|
|**Gemini Pro 3.1**|Multimodal “parts” structuring, its own system-instruction conventions, safety/grounding framing.                |

The selector is a **club rack**, not a toggle: choosing a target re-renders syntax to match — the same intent, fitted to the engine that will swing it.

### 4.4 Library, versioning, sharing

- **Saved prompt library** with tags, search, and target-model filter.
- **Version history** per prompt — Beethoven-style motif development: each save is a new `PromptVersion`, with diffs between any two versions and one-tap restore.
- **Activity feed** tied to the profile (created / enhanced / saved / shared / restored).
- **Copy / share / export:** copy-to-clipboard, shareable link (display-name attributed), and export as **Markdown, JSON, or plain text**.

-----

## 5. Data Model & Flows

### 5.1 Schema (entities & key fields)

```
User
  id            uuid  PK
  email         text  unique, not null
  password_hash text  null            -- null for OAuth-only accounts
  auth_method   enum('magic_link','github','google')
  created_at    timestamptz
  last_login    timestamptz

Profile                               -- 1:1 with User
  user_id       uuid  PK, FK -> User.id
  avatar_url    text                  -- Supabase Storage, circular-cropped
  full_name     text
  display_name  text  unique
  theme         enum('dark','light','system')  default 'dark'
  default_model enum('opus_4_8','gpt_5_5','gemini_pro_3_1')

OAuthIdentity                         -- 0..n per User
  id            uuid  PK
  user_id       uuid  FK -> User.id
  provider      enum('github','google')
  provider_uid  text                  -- provider's stable user id
  raw_profile   jsonb                 -- avatar/name/email snapshot at link time
  linked_at     timestamptz
  UNIQUE(provider, provider_uid)

Prompt                                -- a saved prompt "project"
  id            uuid  PK
  user_id       uuid  FK -> User.id   -- RLS: owner only
  title         text
  current_ver   uuid  FK -> PromptVersion.id
  target_model  enum('opus_4_8','gpt_5_5','gemini_pro_3_1')
  tags          text[]
  created_at    timestamptz
  updated_at    timestamptz

PromptVersion                         -- immutable snapshots
  id            uuid  PK
  prompt_id     uuid  FK -> Prompt.id
  parent_ver    uuid  FK -> PromptVersion.id  null
  input_text    text                  -- raw input at this version
  output_text   text                  -- enhanced result
  mode          enum('clarify','expand','condense','reformat','target')
  model_used    text                  -- provider string actually called
  token_in      int
  token_out     int
  created_at    timestamptz

MediaAsset                            -- attached references (assumption A5)
  id            uuid  PK
  user_id       uuid  FK -> User.id
  prompt_ver_id uuid  FK -> PromptVersion.id  null
  storage_path  text                  -- Supabase Storage
  kind          enum('image','video','audio')
  extracted     jsonb                 -- subject/palette/composition/etc.
  created_at    timestamptz

ActivityEvent                         -- profile activity feed
  id            uuid  PK
  user_id       uuid  FK -> User.id
  prompt_id     uuid  FK -> Prompt.id  null
  type          enum('created','enhanced','saved','shared','restored','profile_updated')
  meta          jsonb
  created_at    timestamptz
```

**RLS posture:** every table carries `user_id`; policies restrict `select/insert/update/delete` to `auth.uid() = user_id`. `PromptVersion` and `MediaAsset` join through their parent’s ownership.

### 5.2 Key flows

**Onboarding / auth**

```
Launch → (no session) Auth gate
  ├─ Magic link → email → verify → SET PASSWORD + avatar → Profile created → Home
  ├─ GitHub OAuth → consent → auto-fill avatar/name/email → set display_name → Home
  └─ Google OAuth → consent → auto-fill avatar/name/email → set display_name → Home
```

**Enhancing a prompt**

```
Home/Enhance → type/paste input  (optional: attach media → extract details)
  → pick Mode + Target model
  → Enhance → provider-adapter proxy → model
  → Transformation diff (Void input | Chalk output, Laser-lit changes + rationale)
  → Copy / Share / Export  — or — Save (creates Prompt + first PromptVersion)
```

**Saving & revisiting (versioning)**

```
Open Prompt from Library → view current version
  → edit + re-Enhance → Save → new PromptVersion (parent = previous)
  → Diff any two versions → Restore sets current_ver
```

**Editing profile / avatar**

```
Profile → Edit → upload image → square crop → circular mask → Storage
  → update full_name / display_name / email / (password if non-OAuth)
  → ActivityEvent('profile_updated')
```

### 5.3 Wireframes — three core screens

**Home / Enhance**

```
┌──────────────────────────────┐
│ ▟ safe-area · status (auto)  │
│  VIZ(IO)N            ◐ theme  │
├──────────────────────────────┤
│  [ Clarify ][ Expand ][ … ]  │  ← mode chips (Laser = active)
│                              │
│ ┌──────────────────────────┐ │
│ │ input prompt…            │ │  ← mono editor
│ │                          │ │
│ └──────────────────────────┘ │
│  📎 Attach media   ⌁ tokens  │
│                              │
│  Target: ( Opus 4.8  ▾ )     │  ← club rack
│                              │
│  ┌────────────────────────┐  │
│  │      ►  ENHANCE         │  │  ← Void text on Laser fill
│  └────────────────────────┘  │
├──────────────────────────────┤
│  ◇ Enhance   ▤ Library   ◑ Me │  ← bottom nav, safe-area inset
└──────────────────────────────┘
```

**Library / History**

```
┌──────────────────────────────┐
│  Library          🔎  ⛃ model │
├──────────────────────────────┤
│ [ #marketing ][ #code ][ +tag]│
│ ┌──────────────────────────┐ │
│ │ Launch email v4   · Opus │ │  ← card, glass Onyx
│ │ edited 2h · 3 versions   │ │
│ ├──────────────────────────┤ │
│ │ MJ ref: skyline v2 · Gem │ │
│ │ media ◧ · 5 versions     │ │
│ ├──────────────────────────┤ │
│ │ JSON spec gen v1  · GPT  │ │
│ └──────────────────────────┘ │
│  ⟲ Activity ───────────────  │
│  • enhanced "Launch email"   │
│  • restored v2 of "JSON…"    │
├──────────────────────────────┤
│  ◇ Enhance   ▤ Library   ◑ Me │
└──────────────────────────────┘
```

**Profile**

```
┌──────────────────────────────┐
│  Profile               ✎ Edit │
├──────────────────────────────┤
│           ╭────╮             │
│           │ ◉  │  ← circular  │
│           ╰────╯    avatar     │
│        Sean Vasey            │
│        @vasey  ·  GitHub ⬡   │  ← auth badge
│        sean@…                │
│                              │
│  Default model  ( Opus 4.8 ▾)│
│  Theme          ( System  ▾) │
│  ───────────────────────────│
│  87 prompts · 240 versions   │
│  ───────────────────────────│
│  Manage account   Sign out   │
├──────────────────────────────┤
│  ◇ Enhance   ▤ Library   ◑ Me │
└──────────────────────────────┘
```

-----

## 6. Tech-stack summary

|Concern     |Pick                                                  |Justification                                               |
|------------|------------------------------------------------------|------------------------------------------------------------|
|Framework   |Next.js 15 App Router + React 19 + TS                 |RSC keeps model keys server-side; your house standard.      |
|Styling     |Tailwind + CSS-var tokens                             |7-token system swaps dark/light instantly.                  |
|Server state|TanStack Query                                        |Offline-aware cache for prompts/history.                    |
|Local state |Zustand                                               |Lightweight editor/mode/model store.                        |
|PWA         |Workbox SW + manifest (any+maskable, transparent PNGs)|Installable, offline shell, iOS-correct icons.              |
|DB          |Supabase Postgres + RLS                               |Per-user isolation at the database.                         |
|Auth        |Supabase Auth (magic link + GitHub + Google)          |Three required methods in one provider, JWT rotation.       |
|Storage     |Supabase Storage                                      |Avatars + media, policy-scoped.                             |
|Model access|Next route-handler provider adapter                   |Keys hidden, cost caps + rate limits, model-string agnostic.|
|Async (opt.)|Inngest                                               |Queued media extraction / batch re-targeting.               |
|Deploy      |Vercel (preview per PR)                               |Edge DDoS posture; your primary target.                     |
|Icons       |thesvg.org → Potrace/SVGO pipeline                    |Official provider marks, optimized to suite standard.       |

-----

## 7. Suggested next moves & references

- **Build handoff:** this spec is ready to become a `VIZION_CLAUDE_CODE_PROMPT.md` + `VIZION_FINAL_PLAN_v1.md` pair under Standard CLAUDE.md v2.0, mirroring the IkoniK/Inbox·NERØ handoff pattern.
- **Worth a read for the engine design:** Anthropic’s prompt-engineering docs (`docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview`) and OpenAI’s structured-outputs guidance — both directly inform the per-model formatter logic in §4.3.
- **Safe-area:** fold the v2 luminance-polarity template in from the start so VIZ(IO)N ships notch-clean rather than retrofitted.
- **Open question for you:** should the media-prompt extractor run on-device (fast, privacy-preserving, limited) or through the same model proxy (richer, costs tokens)? That choice shapes the `MediaAsset.extracted` pipeline and the iOS storage budget.