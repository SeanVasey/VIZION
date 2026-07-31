-- Kimi and MiniMax move to their newest flagships (K3, M3) and OpenAI's
-- GPT-5.6 family gains the Luna and Terra tiers — the sixteen-model roster.
--
-- The RENAMEs update EXISTING rows automatically (enum values are stored by
-- OID), so prompt_versions / usage_events / profiles.default_model written
-- under 'kimi_k2_6' / 'minimax_m2_7' come back as 'kimi_k3' / 'minimax_m3' —
-- no data backfill needed.
--
-- Deploy order: the ADD VALUEs are the safe direction (old code never writes
-- them; new code requires them) — apply before deploying. The RENAMEs are the
-- tight ones: old code writes the K2.6/M2.7 ids, which stop existing the
-- moment the renames run, and new code writes the K3/M3 ids, which don't
-- exist until they run — keep the apply→deploy window short (same drill as
-- 20260710, 20260724, and 20260725).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'kimi_k2_6' TO 'kimi_k3';
ALTER TYPE model_target RENAME VALUE 'minimax_m2_7' TO 'minimax_m3';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gpt_5_6_luna';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gpt_5_6_terra';
