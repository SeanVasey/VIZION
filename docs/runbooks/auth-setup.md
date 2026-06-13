# Runbook — auth & Supabase setup (P2)

VIZ(IO)N uses **Supabase Auth** (magic link + GitHub + Google) against the provisioned
project. The app code is complete; the items below are the **dashboard/provider config**
that only you can do (they need real OAuth apps and your deploy URL).

## 1. Environment variables

Local (`.env.local`, gitignored) and Vercel project env:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # the publishable key is fine here
NEXT_PUBLIC_SITE_URL=https://<your-deploy-domain>
```

`SUPABASE_SERVICE_ROLE_KEY` is **not** needed for P2 (all access is the user's session
under RLS). Add it only when a later phase needs to bypass RLS server-side.

## 2. Auth → URL configuration (Supabase dashboard)

- **Site URL:** your production domain (e.g. `https://vizion.vercel.app`).
- **Redirect URLs** (allow-list): add every origin the OAuth/magic-link flow returns to:
  - `http://localhost:3000/auth/callback`
  - `https://<your-vercel-preview-and-prod>/auth/callback`

The magic-link email uses the default confirmation URL, which lands on `/auth/callback`
(PKCE code exchange). The app also ships `/auth/confirm` for the `token_hash` template if
you prefer that style.

## 3. OAuth providers (Supabase → Authentication → Providers)

Register an OAuth app with each provider, then paste the client id/secret into Supabase:

- **GitHub:** Settings → Developer settings → OAuth Apps → New. Authorization callback URL:
  `https://<project-ref>.supabase.co/auth/v1/callback`.
- **Google:** Cloud Console → Credentials → OAuth client (Web). Authorized redirect URI:
  `https://<project-ref>.supabase.co/auth/v1/callback`.

Until a provider is enabled, its button on the gate returns a "provider not enabled"
error (surfaced inline); magic link works without any provider setup.

## 4. Email

The default Supabase email sender is rate-limited and fine for testing. For production,
configure custom SMTP under **Authentication → Emails**.

## 5. Data model (already applied)

Migrations live in the project (applied via MCP): `profiles` + `oauth_identities` with
**RLS owner-only policies**, an auto-profile trigger on signup, and an `avatars` storage
bucket (public read, owner-scoped writes). Regenerate types after schema changes:

```
supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

## 6. Onboarding (D15/A4)

Magic-link accounts are routed to `/set-password` on first sign-in and gated there (via
the `(app)` layout) until `profiles.password_set` is true. OAuth accounts skip this — the
provider is their credential.
