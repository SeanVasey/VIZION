# Security Policy

## Reporting a vulnerability

Please report security issues privately to **sean@vasey.audio** with the subject
`VIZION SECURITY`. Do not open a public issue for undisclosed vulnerabilities. We aim
to acknowledge within 72 hours and to ship a fix or mitigation promptly.

## Security posture (non-negotiable guardrails)

- **No DIY auth.** Authentication is handled exclusively by Supabase Auth (magic link,
  GitHub, and Google). JWTs are short-lived (≤ 7 days) with rotation.
- **Row-Level Security on every table from creation.** Policies restrict every
  `select/insert/update/delete` to `auth.uid() = user_id`; child tables join through
  parent ownership. No table ships without a policy.
- **Model provider keys are server-side only.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  and `GOOGLE_API_KEY` are read only inside Next route handlers (the provider-adapter
  proxy) and never reach the client bundle.
- **Per-user rate limits and cost caps** on every model route.
- **Parameterized queries** everywhere; no string-built SQL.
- **`npm audit`** runs in CI on every PR and push to `main`.
- **Security headers** (HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy`) are set in `next.config.ts`; a nonce-based
  CSP is tightened during P6 hardening.
- **Console stripping** in production builds (keeping `error`/`warn`).
- **Server is the source of truth.** Local storage is convenience only — never the
  only copy of user data, mitigating iOS ITP cache eviction.

## Secrets

No secrets are ever committed. `.env.example` documents the required variable shape;
real values live in `.env*.local` (gitignored) and in the Vercel project environment.

## Supported versions

VIZ(IO)N is pre-1.0; security fixes target the latest `main`.
