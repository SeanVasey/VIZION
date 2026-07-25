-- Meta's slot moves to Muse Spark 1.1 (the Meta Model API successor to the
-- retired Llama API line) and Z.ai's GLM-5.2 joins as a new developer —
-- the fourteen-model roster.
--
-- The RENAME updates EXISTING rows automatically (enum values are stored by
-- OID), so prompt_versions / usage_events / profiles.default_model written
-- under 'llama_4_maverick' come back as 'muse_spark_1_1' — no data backfill
-- needed.
--
-- Deploy order: the ADD VALUE is the safe direction (old code never writes
-- it; new code requires it) — apply before deploying. The RENAME is the
-- tight one: old code writes 'llama_4_maverick', which stops existing the
-- moment the rename runs, and new code writes 'muse_spark_1_1', which
-- doesn't exist until it runs — keep the apply→deploy window short (same
-- drill as 20260710 and 20260724).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE model_target RENAME VALUE 'llama_4_maverick' TO 'muse_spark_1_1';
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'glm_5_2';
