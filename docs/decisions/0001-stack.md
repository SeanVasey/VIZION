# ADR 0001 — Locked stack & foundational decisions

Status: **Accepted (LOCKED)** · Mirrors the decision log in `VIZION FINAL PLAN v1.md §1`.

| #   | Decision        | Choice                                       | Rationale                                        |
| --- | --------------- | -------------------------------------------- | ------------------------------------------------ |
| D1  | Framework       | Next.js 15 App Router + React 19 + TS        | RSC keeps model keys server-side; house standard |
| D2  | Styling         | Tailwind + CSS-var tokens (7 roles)          | Instant dark/light swap, token-driven            |
| D3  | Server state    | TanStack Query                               | Offline-aware cache for prompts/history          |
| D4  | UI state        | Zustand                                      | Lightweight editor/mode/model store              |
| D5  | PWA             | Workbox custom SW + manifest                 | App-shell precache; iOS-correct install          |
| D6  | DB              | Supabase Postgres + RLS from day one         | Per-user isolation at the database               |
| D7  | Auth            | Supabase Auth — magic link + GitHub + Google | Three required methods; JWT ≤7d + rotation       |
| D8  | Storage         | Supabase Storage (per-user prefix)           | Avatars + media, policy-scoped                   |
| D9  | Model access    | Next route-handler provider adapter          | Keys hidden, cost caps, model-string agnostic    |
| D10 | Async jobs      | Inngest (deferred to v0.4+)                  | Queued media extraction / batch re-targeting     |
| D11 | Brand house     | VASEY/AI — no VASEY.AUDIO association        | Brand-separation rule                            |
| D12 | Icon rule       | Transparent PNG suite + `any` + `maskable`   | Suite-wide PWA icon standard                     |
| D13 | Safe-area       | Reusable v2 luminance-polarity template      | Closes the recurring iOS notch issue generically |
| D14 | Provider logos  | thesvg.org → Potrace/SVGO                    | Suite icon pipeline standard                     |
| D15 | Magic-link → pw | Set a password at onboarding (A4)            | Durable email+password credential                |
| D16 | MediaAsset      | First-class entity (A5)                      | Attached media is a core input                   |

**Open question (resolve before media GA):** media-detail extraction on-device (fast,
private, limited) vs. via model proxy (richer, token cost). Default lean: proxy behind a
flag with on-device fallback, decided after a latency/cost spike in Phase 5.
