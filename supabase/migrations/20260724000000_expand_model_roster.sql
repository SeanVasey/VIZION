-- Opus 4.8 → Opus 5 rename + the thirteen-model roster expansion:
-- Sonnet 5 joins Anthropic; DeepSeek V4 · Llama 4 Maverick · MiniMax M2.7 ·
-- Kimi K2.6 · Sonar Pro (Perplexity) · Qwen3.7 Max join as new developers.
--
-- The RENAME updates EXISTING rows automatically (enum values are stored by
-- OID), so prompt_versions / usage_events / profiles.default_model written
-- under 'opus_4_8' come back as 'opus_5' — no data backfill needed.
--
-- Deploy order: the ADD VALUEs are the safe direction (old code never writes
-- them; new code requires them) — apply before deploying. The RENAME is the
-- tight one: old code writes 'opus_4_8', which stops existing the moment the
-- rename runs, and new code writes 'opus_5', which doesn't exist until it
-- runs — keep the apply→deploy window short (same drill as 20260710).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'opus_4_8' TO 'opus_5';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'sonnet_5' AFTER 'opus_5';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'deepseek_v4';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'llama_4_maverick';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'minimax_m2_7';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'kimi_k2_6';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'sonar_pro';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'qwen3_7_max';
