-- Library write integrity: one transaction per save, and a pointer that cannot
-- cross a prompt boundary.
--
-- WHY
-- ---
-- Saving an enhancement is four writes: insert `prompts`, insert
-- `prompt_versions`, point `prompts.current_ver` at it, then two
-- `activity_events`. They ran as four independent statements, and only the
-- first two had their errors checked at all — the pointer update and the
-- activity insert discarded their results entirely.
--
-- A failure after the first write leaves a `prompts` row with `current_ver`
-- null and no version: a card that renders an empty preview and opens to
-- nothing. Worse, the content-hash duplicate check has nothing to match on, so
-- the user's retry mints a SECOND orphan rather than being recognised as a
-- repeat. A failure at the pointer update leaves the newest version invisible
-- while the UI reports success.
--
-- Audited before applying (2026-07-30): 40 prompts, 43 versions, zero orphans,
-- zero cross-prompt pointers. The hole was open; it had not yet produced bad
-- data, so no backfill is needed and the trigger below cannot reject an
-- existing row.
--
-- ORDERING
-- --------
-- Deploy-safe in either direction, and additive only. The trigger is the sole
-- part that touches the code path already in production, and it is strictly
-- protective there: every existing write sets `current_ver` to a version of the
-- prompt being updated, so the guard passes. The one case it changes is
-- `restoreVersionAction` called with a version id from a different prompt,
-- which today silently corrupts the row and afterwards raises instead.

-- 1. `prompts.current_ver` must point at a version OF THAT PROMPT.
--
--    SECURITY INVOKER on purpose: the existing owner policies still apply to
--    the lookup, so this adds a constraint without adding a privilege. The
--    check is expressed as a trigger rather than a foreign key because the
--    relationship spans two columns of two tables and no FK can state it.
create or replace function public.enforce_prompt_current_version()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.current_ver is not null and not exists (
    select 1
      from public.prompt_versions v
     where v.id = new.current_ver
       and v.prompt_id = new.id
  ) then
    raise exception 'version_not_owned_by_prompt';
  end if;
  return new;
end $$;

-- `update of current_ver` so ordinary edits (title, tags, favourite, archive,
-- soft delete) never pay for the lookup.
create trigger prompts_current_version_belongs_to_prompt
before insert or update of current_ver on public.prompts
for each row execute function public.enforce_prompt_current_version();

-- 2. The whole save as one statement, so it commits or it doesn't.
--
--    SECURITY INVOKER keeps authorization exactly where it was: the caller's
--    own RLS policies decide what may be written, and `auth.uid()` supplies the
--    owner. This is deliberately NOT a DEFINER function — nothing here needs to
--    exceed the caller's rights, and making it DEFINER would silently move the
--    library's entire authorization story out of RLS.
create or replace function public.library_save_prompt(
  p_title text,
  p_target public.model_target,
  p_tags text[],
  p_input text,
  p_output text,
  p_rationale text,
  p_mode public.enhance_mode,
  p_model_used text,
  p_token_in integer,
  p_token_out integer,
  p_content_hash text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prompt uuid;
  v_version uuid;
begin
  insert into public.prompts (user_id, title, target_model, tags)
    values (auth.uid(), p_title, p_target, p_tags)
    returning id into v_prompt;

  insert into public.prompt_versions
    (prompt_id, input_text, output_text, rationale, mode, model_used,
     token_in, token_out, content_hash)
    values
    (v_prompt, p_input, p_output, p_rationale, p_mode, p_model_used,
     p_token_in, p_token_out, p_content_hash)
    returning id into v_version;

  update public.prompts
     set current_ver = v_version,
         preview = left(p_output, 200),
         current_mode = p_mode
   where id = v_prompt;

  insert into public.activity_events (user_id, prompt_id, type, meta) values
    (auth.uid(), v_prompt, 'created', jsonb_build_object('title', p_title)),
    (auth.uid(), v_prompt, 'saved', '{}'::jsonb);

  return v_prompt;
end $$;

-- 3. Appending a version, same guarantee.
--
--    `for update` takes a row lock on the parent for the rest of the
--    transaction, so two concurrent appends cannot both read the same
--    `current_ver` and produce two versions claiming the same parent.
create or replace function public.library_add_version(
  p_prompt_id uuid,
  p_input text,
  p_output text,
  p_rationale text,
  p_mode public.enhance_mode,
  p_model_used text,
  p_token_in integer,
  p_token_out integer,
  p_content_hash text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent uuid;
  v_version uuid;
begin
  -- RLS applies to this select, so a prompt the caller does not own simply
  -- isn't found — the same answer as a prompt that doesn't exist.
  select current_ver into v_parent
    from public.prompts
   where id = p_prompt_id
     for update;
  if not found then
    raise exception 'prompt_not_found';
  end if;

  insert into public.prompt_versions
    (prompt_id, parent_ver, input_text, output_text, rationale, mode,
     model_used, token_in, token_out, content_hash)
    values
    (p_prompt_id, v_parent, p_input, p_output, p_rationale, p_mode,
     p_model_used, p_token_in, p_token_out, p_content_hash)
    returning id into v_version;

  update public.prompts
     set current_ver = v_version,
         preview = left(p_output, 200),
         current_mode = p_mode
   where id = p_prompt_id;

  insert into public.activity_events (user_id, prompt_id, type, meta) values
    (auth.uid(), p_prompt_id, 'enhanced', '{}'::jsonb),
    (auth.uid(), p_prompt_id, 'saved', '{}'::jsonb);

  return v_version;
end $$;

revoke execute on function public.library_save_prompt(
  text, public.model_target, text[], text, text, text,
  public.enhance_mode, text, integer, integer, text
) from anon, public;
revoke execute on function public.library_add_version(
  uuid, text, text, text, public.enhance_mode, text, integer, integer, text
) from anon, public;

grant execute on function public.library_save_prompt(
  text, public.model_target, text[], text, text, text,
  public.enhance_mode, text, integer, integer, text
) to authenticated;
grant execute on function public.library_add_version(
  uuid, text, text, text, public.enhance_mode, text, integer, integer, text
) to authenticated;
