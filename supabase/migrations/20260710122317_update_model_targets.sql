-- Rename + extend the model_target enum for the five-model roster:
-- Opus 4.8 · GPT-5.6 Sol · Fable 5 · Gemini 3.5 Thinking · Grok 4.5.
--
-- Renames update EXISTING rows automatically (enum values are stored by OID),
-- so prompt_versions / usage_events / profiles.default_model written under the
-- old names come back with the new names — no data backfill needed.
--
-- REQUIRED immediately before deploying the branch that writes the new IDs:
-- old code writes 'gpt_5_5' / 'gemini_pro_3_1', which stop existing the moment
-- the renames run, and new code writes 'gpt_5_6_sol' / 'gemini_3_5_thinking',
-- which don't exist until they run — keep the apply→deploy window short.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'gpt_5_5' TO 'gpt_5_6_sol';
ALTER TYPE model_target RENAME VALUE 'gemini_pro_3_1' TO 'gemini_3_5_thinking';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'fable_5' AFTER 'gpt_5_6_sol';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'grok_4_5' AFTER 'gemini_3_5_thinking';
