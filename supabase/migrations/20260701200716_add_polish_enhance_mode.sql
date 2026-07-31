-- Add the `polish` value to the enhance_mode enum.
--
-- POLISH is the lightest-touch enhancement mode (corrections only). It is added
-- immediately after `clarify` to mirror the UI ordering in src/lib/constants.ts.
--
-- REQUIRED before deploying the branch that adds Polish: without this value,
-- saving a polished prompt version (usage_events / prompt_versions inserts with
-- mode = 'polish') is rejected by the enum constraint.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; apply this
-- migration on its own (Supabase applies each migration independently).

ALTER TYPE enhance_mode ADD VALUE IF NOT EXISTS 'polish' AFTER 'clarify';
