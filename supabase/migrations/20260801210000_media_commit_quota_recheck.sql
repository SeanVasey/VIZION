-- MED-001 follow-up (Codex review, PR #75): re-check the aggregate quota with
-- the MEASURED size at commit, under the same per-user lock media_reserve takes.
--
-- WHY
-- ---
-- media_reserve enforces the 50 MB per-user quota against the client-DECLARED
-- byte count. media_commit (migration 20260801200000) corrects each row's
-- size_bytes to the object's real measured size — but never re-validated the
-- aggregate. So a client could reserve many assets declaring 1 byte each (each
-- reserve passes: the running declared sum stays tiny), upload a 50 MB object
-- into every reserved path (each within the bucket's per-file limit), then
-- commit them all — every commit flipping its row to the real 50 MB with no
-- ceiling on the total. The COMMITTED (quota-counted) storage was therefore
-- unbounded, defeating the very check media_reserve exists to enforce.
--
-- FIX
-- ---
-- Take pg_advisory_xact_lock on the same 'media_quota:<uid>' key as
-- media_reserve, then before flipping the row to 'ready' verify that the sum of
-- every OTHER asset this user holds plus THIS object's measured size does not
-- exceed the quota; fail closed (quota_exceeded) if it would. The first commit
-- that would push the real aggregate over the ceiling is rejected, so the ready
-- set can never exceed quota. Honest clients (who declare real sizes) are
-- unaffected — their aggregate is already accurate at reserve time. The app's
-- upload path already treats a failed commit as an upload failure and cleans up
-- the object + pending row (MED-005), so a rejected commit does not strand a
-- ready-but-uncounted asset.
--
-- Note: an uploaded-but-never-committed object still consumes raw bucket storage
-- at its pending row's declared size until cleaned up; reaping abandoned pending
-- reservations is a separate follow-up (tracked, not addressed here). This
-- migration closes the COMMITTED-quota bypass, which is the accounting invariant.

create or replace function public.media_commit(p_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quota constant bigint := 52428800; -- 50 MB — matches media_reserve's v_quota
  v_path text;
  v_actual bigint;
  v_other bigint;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Serialize this user's quota mutations for the rest of the transaction — the
  -- SAME lock media_reserve takes — so two concurrent commits cannot both read
  -- the pre-commit total and jointly overshoot.
  perform pg_advisory_xact_lock(hashtext('media_quota:' || auth.uid()::text));

  select storage_path into v_path
    from public.media_assets
   where id = p_id and user_id = auth.uid() and status = 'pending'
   for update;
  if v_path is null then
    raise exception 'not_pending';
  end if;

  -- SECURITY INVOKER: the owner-scoped select policy on storage.objects admits
  -- exactly this user's folder, which v_path is inside by construction.
  select nullif(o.metadata->>'size', '')::bigint into v_actual
    from storage.objects o
   where o.bucket_id = 'media' and o.name = v_path;
  if v_actual is null then
    raise exception 'object_missing';
  end if;

  -- The declared-size bypass: reserve trusted the client's byte count, so this
  -- pending row may have been admitted at 1 byte while its object is 50 MB.
  -- Re-validate the MEASURED aggregate before it counts as real storage.
  select coalesce(sum(size_bytes), 0) into v_other
    from public.media_assets
   where user_id = auth.uid() and id <> p_id;
  if v_other + v_actual > v_quota then
    raise exception 'quota_exceeded';
  end if;

  update public.media_assets
     set status = 'ready', size_bytes = v_actual
   where id = p_id;

  return v_actual;
end $$;

revoke execute on function public.media_commit(uuid) from anon, public;
grant execute on function public.media_commit(uuid) to authenticated;
