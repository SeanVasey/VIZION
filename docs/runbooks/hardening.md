# Runbook — hardening & security checklist (P6 / v1.0)

## Security checklist

- [x] **No DIY auth** — Supabase Auth only; JWT ≤ 7d + rotation (D7).
- [x] **RLS on every table from creation** — `profiles`, `oauth_identities`,
      `usage_events`, `prompts`, `prompt_versions`, `activity_events`,
      `media_assets`. `prompt_versions` has no update/delete policy (immutable).
- [x] **Model keys server-side only** — provider modules import `server-only`;
      keys read only in `/api/{enhance,media}`. Never in the client bundle.
- [x] **Rate limit + cost cap on every model route** — DB `usage_window` cap +
      an in-memory burst limiter (`src/lib/security/rate-limit.ts`).
- [x] **Parameterized queries** — all DB access is via the typed Supabase client.
- [x] **`npm audit` in CI** — gates on `--omit=dev --audit-level=high` (prod
      deps clean); full-tree report runs advisory-only.
- [x] **Security headers + CSP** — `next.config.ts`: HSTS, `X-Content-Type-Options`,
      `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a CSP
      (`default-src 'self'`; Supabase in `connect/img/media`; `frame-ancestors`,
      `object-src`, `base-uri` locked). Residual `script-src 'unsafe-inline'` for
      the pre-paint theme bootstrap — nonce upgrade is the next step.
- [x] **Console stripped in production** — `compiler.removeConsole` (keeps
      error/warn).
- [x] **Server is the source of truth** — local cache (localStorage / IndexedDB)
      is convenience only.
- [x] **Brand separation** — VASEY/AI only; zero VASEY.AUDIO crossover.
- [x] **Edge/DDoS posture** — Vercel platform + per-user caps + the burst limiter.

Re-run `get_advisors` (security + performance) after any DDL — currently clean.

## iOS storage-eviction recovery

- `navigator.storage.persist()` is requested on SW registration.
- The **server is the source of truth**: every screen re-hydrates from Supabase
  on load (Server Components fetch fresh; TanStack Query is offline-aware cache).
- **Offline outbox** (`src/lib/pwa/outbox.ts`): mutations that fail while offline
  (e.g. Save to library) are queued in IndexedDB and replayed by `OutboxFlusher`
  on `online` / `visibilitychange` — covering iOS's lack of Background Sync.

## Backup & restore test

**Version restore (in-app):** open a prompt → History → **Restore** an older
version. `current_ver` re-points; the version rows are immutable (RLS denies
update/delete), so no data is lost. Verified by the immutability policy + the
restore action; exercise on the preview with a real session.

**Database backup:** Supabase takes automated daily backups (Project → Database →
Backups). To restore, use Point-in-Time Recovery or a backup snapshot from the
dashboard. Because the server is authoritative and local caches are disposable, a
DB restore fully reconstitutes user state on next launch.

## Accessibility (WCAG AA)

- Contrast: the seven-role palette is AAA on dark surfaces; Laser is fill-only
  (never text on light — the 1.09:1 combo is prohibited in code review).
- Skip-to-content link; visible Laser focus ring on every focusable element;
  `prefers-reduced-motion` disables transitions/animations.
- Labels on all inputs; `aria-current` on the active nav tab; `role`/`aria-label`
  on landmarks and status regions.
- Lighthouse: run `npx lighthouse <preview-url> --only-categories=pwa,accessibility`
  against a deployed preview for the PWA ✓ + a11y score.
