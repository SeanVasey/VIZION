-- Withdraw the direct usage_events write grants.
--
-- ⚠ ORDERING — DO NOT APPLY THIS BEFORE THE RELEASE THAT CALLS record_usage()
-- IS LIVE IN PRODUCTION.
--
-- The deployed application before that release writes the ledger with a direct
-- `supabase.from("usage_events").insert(...)` under the user's JWT. Applying
-- this migration while that build is serving traffic makes every ledger write
-- fail with 42501. The route swallows that failure into a `console.error`
-- (`writeErrorLogLine`) and still streams a successful response — so spend
-- would stop being recorded, `today_cost` would stop rising, and the daily cap
-- would silently stop working. That is a strictly worse failure than the one
-- `20260730200000_usage_ledger_integrity.sql` closes.
--
-- Correct sequence:
--   1. apply 20260730200000  (constraint + record_usage)   — closes the hole
--   2. deploy the release that calls record_usage()
--   3. verify a real enhancement writes a usage_events row on the new build
--   4. apply THIS migration
--
-- After this lands, `usage_events` is reachable by a client for SELECT only.
-- The remaining SELECT policy (`usage_select_own`) is what lets the account
-- read back its own spend; INSERT flows exclusively through the SECURITY
-- DEFINER writer, and UPDATE/DELETE remain denied by the absence of any policy.

revoke insert, update, delete on table public.usage_events from anon, authenticated;

-- The owner-scoped INSERT policy is now unreachable for want of the privilege.
-- Dropping it keeps `pg_policies` an honest description of what can happen.
drop policy if exists usage_insert_own on public.usage_events;
