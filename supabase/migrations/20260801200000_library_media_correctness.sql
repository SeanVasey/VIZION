-- Stage 2 Wave 2 of the 2026-08-01 audit (PR #72 gate): library + media
-- server-side correctness. Six independent fixes, each annotated with its
-- ledger id. Additive / protective only — no table is created and no
-- signature changes, so deploy order is safe in either direction (the one
-- behavior change is that writes which previously corrupted data now raise).

-- ---------------------------------------------------------------------------
-- 1. Q5 / LIB-010 — the duplicate-detection hash includes the target.
--
--    Same content saved for a DIFFERENT destination model is a distinct
--    prompt, not a duplicate: without the target in the formula, "Save as new
--    version" filed a Kimi K3 result under an Opus 5 card and the library's
--    target facet misattributed it. Versions carry no target column, so the
--    backfill keys on the parent prompt's target_model — the best available
--    truth for historical rows. MUST stay byte-matched with
--    src/lib/library/hash.ts (pinned by tests/unit/library-hash.test.ts
--    against a live digest of this exact expression).
update public.prompt_versions v
   set content_hash = encode(
     digest(
       v.input_text || chr(31) || v.output_text || chr(31) || v.mode::text
         || chr(31) || p.target_model::text,
       'sha256'),
     'hex')
  from public.prompts p
 where p.id = v.prompt_id;

-- ---------------------------------------------------------------------------
-- 2. LIB-002 — `prompt_versions.parent_ver` must point at a version OF THE
--    SAME PROMPT, and never at itself.
--
--    The FK alone accepts another user's version id (FK checks ignore RLS —
--    a uuid existence oracle) and a self-referential parent. Same shape as
--    the current_ver guard in 20260730234204: SECURITY INVOKER trigger,
--    because the relationship spans two columns and no FK can state it.
--    In-app writers always derive the parent from the locked row's
--    current_ver, so nothing legitimate can trip this.
create or replace function public.enforce_version_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.parent_ver is not null then
    if new.parent_ver = new.id then
      raise exception 'parent_not_of_prompt';
    end if;
    if not exists (
      select 1
        from public.prompt_versions v
       where v.id = new.parent_ver
         and v.prompt_id = new.prompt_id
    ) then
      raise exception 'parent_not_of_prompt';
    end if;
  end if;
  return new;
end $$;

create trigger prompt_versions_parent_same_prompt
before insert or update of parent_ver on public.prompt_versions
for each row execute function public.enforce_version_parent();

-- ---------------------------------------------------------------------------
-- 3. LIB-004 — kill the duplicate-save race inside the transaction.
--
--    The action's check-then-insert leaves a window two concurrent identical
--    saves (two tabs, an outbox replay racing a manual save) both pass. The
--    app-side fix is a cross-tab Web Lock on the flush; this is the
--    server-side belt: an advisory lock per (owner, hash) serializes the
--    check, and a save that lost the race returns the EXISTING prompt id —
--    both callers converge on one card. Signature and return type unchanged,
--    so old code + new function is safe.
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
  -- Serialize identical saves for this owner for the rest of the transaction.
  perform pg_advisory_xact_lock(
    hashtext('library_save:' || auth.uid()::text || ':' || p_content_hash));

  -- Re-check under the lock: a concurrent identical save that committed first
  -- makes this one a duplicate — converge on its card instead of minting a
  -- second one. (The action's own pre-check still handles the common case
  -- with its richer "save as new version" offer.)
  select v.prompt_id into v_prompt
    from public.prompt_versions v
    join public.prompts p on p.id = v.prompt_id
   where v.content_hash = p_content_hash
     and p.user_id = auth.uid()
     and p.deleted_at is null
   limit 1;
  if v_prompt is not null then
    return v_prompt;
  end if;

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

-- ---------------------------------------------------------------------------
-- 4. LIB-009 — deleting a collection must not reorder the library.
--
--    The FK's ON DELETE SET NULL executes as an UPDATE on prompts, and the
--    bare row-level trigger stamped updated_at on every released prompt —
--    a 20-prompt collection delete pushed all 20 above genuinely recent work
--    while the sheet promised "they just leave the collection". A column
--    list scopes the stamp to real content/state changes; collection
--    membership (assignment or release) no longer counts as recency.
drop trigger if exists prompts_set_updated_at on public.prompts;
create trigger prompts_set_updated_at
before update of title, tags, favorite, archived_at, deleted_at,
  current_ver, preview, current_mode on public.prompts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. MED-001 — storage INSERT requires a live reservation.
--
--    The old policy checked only bucket + owner folder, so a signed-in user
--    could upload straight to media/{uid}/ with no media_assets row: objects
--    the quota meter never counts, capped only by the bucket's per-file
--    limit. Uploads now require the exact path to have been reserved
--    (status 'pending') by media_reserve — which the app has always done
--    first, so no legitimate client changes behavior.
drop policy "media_obj_insert_own" on storage.objects;
create policy "media_obj_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
        from public.media_assets a
       where a.storage_path = name
         and a.user_id = auth.uid()
         and a.status = 'pending'
    )
  );

--    And the declared size becomes the MEASURED size at commit: media_reserve
--    stores the client-declared byte count (reserve 1 byte, upload 25 MB —
--    quota charged 1 byte). The ready-flip now goes through an RPC that reads
--    the uploaded object's real size from storage metadata and corrects
--    size_bytes, failing closed when the object is missing.
create or replace function public.media_commit(p_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_path text;
  v_actual bigint;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select storage_path into v_path
    from public.media_assets
   where id = p_id and user_id = auth.uid() and status = 'pending'
   for update;
  if v_path is null then
    raise exception 'not_pending';
  end if;

  -- SECURITY INVOKER: the owner-scoped select policy on storage.objects
  -- admits exactly this user's folder, which v_path is inside by construction.
  select nullif(o.metadata->>'size', '')::bigint into v_actual
    from storage.objects o
   where o.bucket_id = 'media' and o.name = v_path;
  if v_actual is null then
    raise exception 'object_missing';
  end if;

  update public.media_assets
     set status = 'ready', size_bytes = v_actual
   where id = p_id;

  return v_actual;
end $$;

revoke execute on function public.media_commit(uuid) from anon, public;
grant execute on function public.media_commit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Q3 / MED-002 — one size limit: 50 MB everywhere.
--
--    The bucket enforced 25 MB while media_reserve, admitFiles, and every
--    user-facing string promised 50 — any 25–50 MB file passed reservation
--    and always died at upload with a raw storage error. Ruling Q3 raises
--    the bucket to the number the product promises.
update storage.buckets
   set file_size_limit = 52428800 -- 50 MB, matching media_reserve's v_quota
 where id = 'media';
