-- Add the Mistral Large 3 target to the model roster.
--
-- Deploy order: apply this migration BEFORE deploying the code that knows the
-- value — ADD VALUE is the safe direction (old code never writes it; new code
-- requires it), unlike the earlier RENAME VALUE migration.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so this
-- migration stays single-statement.
ALTER TYPE model_target ADD VALUE IF NOT EXISTS 'mistral_large_3' AFTER 'gemini_3_5_thinking';
