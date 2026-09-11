-- The 2026-09 frontier re-verify: four slots move to the vendor's current
-- frontier release and OpenAI gains a tier above the 5.6 family — the
-- seventeen-model roster.
--
--   fable_5          → fable_5_1        claude-fable-5-1  (2026-09-01 release)
--   gemini_3_6_flash → gemini_3_8_flash gemini-3.8-flash  (3.6 → 3.7 → 3.8)
--   grok_4_5         → grok_4_6         grok-4.6
--   glm_5_2          → glm_5_3          glm-5.3
--   + gpt_6_astra                       gpt-6-astra       (new OpenAI tier)
--
-- Every id and rate was read from the vendor's own page on 2026-09-11 (the
-- per-row sources are in src/lib/providers/config.ts). Sonnet 5's base rate
-- is now $2/$10 on platform.claude.com, so its "intro price" caveat is closed.
--
-- The RENAMEs update EXISTING rows automatically (enum values are stored by
-- OID), so prompts.target_model, drafts.target_model, profiles.default_model
-- and usage_events.target come back renamed with no backfill. The ADD VALUE
-- is the safe direction (old code never writes it; new code requires it).
--
-- LEGACY_TARGET_IDS gains the four renames so a stale persisted selection in
-- a client's localStorage resolves instead of 400ing on /api/enhance;
-- tests/unit/model-target-enum.test.ts pins that correspondence.
--
-- Deploy order: the RENAMEs are the tight direction — old code writes the
-- old labels, which stop existing the moment this runs, and new code writes
-- the new ones, which do not exist until it runs — apply, then deploy,
-- keeping the window short (same drill as 20260710, 20260724, 20260725,
-- 20260726 and 20260808). `npm run check:db-enum` confirms the hosted
-- project caught up.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'fable_5' TO 'fable_5_1';
ALTER TYPE model_target RENAME VALUE 'gemini_3_6_flash' TO 'gemini_3_8_flash';
ALTER TYPE model_target RENAME VALUE 'grok_4_5' TO 'grok_4_6';
ALTER TYPE model_target RENAME VALUE 'glm_5_2' TO 'glm_5_3';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gpt_6_astra' AFTER 'gpt_5_6_sol';
