-- Default model becomes CLEARABLE: null = "no stored default → start on Auto"
-- (owner direction, 2026-08-15: "there should be an option to clear the
-- preferred model and select no model at all so it returns the default to
-- auto"). Two changes, both to the COLUMN, neither to the enum:
--
--   · drop not null — the Settings sheet's Auto row clears the default by
--     writing null. 'auto' is still not a model_target label and must never
--     become one: it is a UI/wire concept only (src/lib/enhance/auto-target.ts),
--     and the enum is shared with usage_events.target and prompts.target_model,
--     where a literal 'auto' would be a lie about what ran. Absence is the
--     representation.
--   · drop default — handle_new_user() inserts without this column, so new
--     accounts now start with no default, i.e. on Auto (owner decision,
--     2026-08-15). Existing rows keep whatever they hold.
--
-- Deploy order: safe either side of the deploy. A constraint is only REMOVED —
-- old code keeps writing real enum ids and reads rows that still hold them;
-- only new code ever writes or reads null.
alter table public.profiles
  alter column default_model drop not null,
  alter column default_model drop default;
