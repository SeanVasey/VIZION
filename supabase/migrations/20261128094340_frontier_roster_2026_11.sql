-- The 2026-11 frontier re-verify: fourteen of the seventeen slots move to the
-- vendor's current release, and four new slots join — the twenty-one-model
-- roster.
--
--   fable_5_1        → fable_5_2          claude-fable-5-2     ($8/$40, a cut)
--   opus_5           → opus_5_5           claude-opus-5-5      ($4/$20)
--   sonnet_5         → sonnet_5_5         claude-sonnet-5-5
--   gpt_6_astra      → gpt_6_2_astra      gpt-6.2-astra        ($8/$40)
--   gpt_5_6_sol      → gpt_6_2_sol        gpt-6.2-sol          ($2/$10)
--   gpt_5_6_terra    → gpt_6_1_terra      gpt-6.1-terra        ($1/$5)
--   gpt_5_6_luna     → gpt_6_luna         gpt-6-luna           ($0.10/$0.50)
--   gemini_3_8_flash → gemini_4_hydrogen  gemini-4-hydrogen    (the fast slot)
--   muse_spark_1_1   → muse_spark_1_3     muse-spark-1.3
--   minimax_m3       → minimax_m3_1_flash MiniMax-M3.1-Flash
--   mistral_large_3  → mistral_large_4    mistral-large-4-0
--   kimi_k3          → kimi_k3_1_pro      kimi-k3.1-pro
--   qwen3_8_max      → qwen4_max          qwen4-max
--   grok_4_6         → grok_4_7           grok-4.7
--   + haiku_5_5                           claude-haiku-5-5     (Anthropic's small tier)
--   + gemini_4_carbon                     gemini-4-carbon      (Google's strongest)
--   + gemini_4_neon                       gemini-4-neon        (between the two)
--   + muse_wonder_1_0                     muse-wonder-1.0      (Meta's strongest, preview)
--
-- deepseek_v4, sonar_pro and glm_5_3 keep their ids: each is still the
-- vendor's API flagship (GLM-5.4 is Coding Plan only; Sonar's chat endpoint
-- is sunset but still answering — see docs/runbooks/providers.md).
--
-- Every id and rate was read from the vendor's own page on 2026-11-28 (the
-- per-row sources are in src/lib/providers/config.ts).
--
-- The RENAMEs update EXISTING rows automatically (enum values are stored by
-- OID), so prompts.target_model, drafts.target_model, profiles.default_model
-- and usage_events.target come back renamed with no backfill. The ADD VALUEs
-- are the safe direction (old code never writes them; new code requires
-- them).
--
-- LEGACY_TARGET_IDS gains the fourteen renames so a stale persisted selection
-- in a client's localStorage resolves instead of 400ing on /api/enhance;
-- tests/unit/model-target-enum.test.ts pins that correspondence.
--
-- Deploy order: the RENAMEs are the tight direction — old code writes the
-- old labels, which stop existing the moment this runs, and new code writes
-- the new ones, which do not exist until it runs — apply, then deploy,
-- keeping the window short (same drill as 20260710, 20260724, 20260725,
-- 20260726, 20260808 and 20260911). This one renames the DEFAULT target
-- (opus_5), so the window touches every user who has never picked a model.
-- `npm run check:db-enum` confirms the hosted project caught up.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'fable_5_1' TO 'fable_5_2';
ALTER TYPE model_target RENAME VALUE 'opus_5' TO 'opus_5_5';
ALTER TYPE model_target RENAME VALUE 'sonnet_5' TO 'sonnet_5_5';
ALTER TYPE model_target RENAME VALUE 'gpt_6_astra' TO 'gpt_6_2_astra';
ALTER TYPE model_target RENAME VALUE 'gpt_5_6_sol' TO 'gpt_6_2_sol';
ALTER TYPE model_target RENAME VALUE 'gpt_5_6_terra' TO 'gpt_6_1_terra';
ALTER TYPE model_target RENAME VALUE 'gpt_5_6_luna' TO 'gpt_6_luna';
ALTER TYPE model_target RENAME VALUE 'gemini_3_8_flash' TO 'gemini_4_hydrogen';
ALTER TYPE model_target RENAME VALUE 'muse_spark_1_1' TO 'muse_spark_1_3';
ALTER TYPE model_target RENAME VALUE 'minimax_m3' TO 'minimax_m3_1_flash';
ALTER TYPE model_target RENAME VALUE 'mistral_large_3' TO 'mistral_large_4';
ALTER TYPE model_target RENAME VALUE 'kimi_k3' TO 'kimi_k3_1_pro';
ALTER TYPE model_target RENAME VALUE 'qwen3_8_max' TO 'qwen4_max';
ALTER TYPE model_target RENAME VALUE 'grok_4_6' TO 'grok_4_7';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'haiku_5_5' AFTER 'sonnet_5_5';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gemini_4_carbon' BEFORE 'gemini_4_hydrogen';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gemini_4_neon' BEFORE 'gemini_4_hydrogen';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'muse_wonder_1_0' BEFORE 'muse_spark_1_3';
