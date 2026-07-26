-- Google's slot moves to Gemini 3.6 and splits in two: Gemini 3.6 Thinking
-- (replacing Gemini 3.5 Flash) and Gemini 3.6 Flash — the seventeen-model roster.
--
-- Both targets send the SAME model string (`gemini-3.6-flash`). Gemini 3.x has
-- no separate thinking model ID: "Thinking" and "Flash" are thinkingLevel
-- values (high / minimal) on one model, which is why this is two enum labels
-- and one MODEL_GEMINI override rather than two model strings.
--
-- The RENAME updates EXISTING rows automatically (enum values are stored by
-- OID), so prompt_versions / usage_events / profiles.default_model written
-- under 'gemini_3_5_thinking' come back as 'gemini_3_6_thinking' — no data
-- backfill needed. Note this id has now been renamed twice
-- (gemini_pro_3_1 → gemini_3_5_thinking → gemini_3_6_thinking); BOTH legacy
-- keys in LEGACY_TARGET_IDS must point at the current id.
--
-- Deploy order: the ADD VALUE is the safe direction (old code never writes it;
-- new code requires it) — apply before deploying. The RENAME is the tight one:
-- old code writes 'gemini_3_5_thinking', which stops existing the moment the
-- rename runs, and new code writes 'gemini_3_6_thinking', which doesn't exist
-- until it runs — keep the apply→deploy window short (same drill as 20260710,
-- 20260724, 20260725, and 20260726).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'gemini_3_5_thinking' TO 'gemini_3_6_thinking';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'gemini_3_6_flash' AFTER 'gemini_3_6_thinking';
