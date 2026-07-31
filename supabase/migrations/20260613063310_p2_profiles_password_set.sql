-- Magic-link accounts must set a durable password at onboarding (D15/A4).
-- Track whether that has happened so onboarding can gate on it. OAuth accounts
-- leave this false (the provider is their credential) and are never gated.
alter table public.profiles
  add column password_set boolean not null default false;

comment on column public.profiles.password_set is
  'True once a magic-link user has set a durable password (A4). OAuth users stay false.';
