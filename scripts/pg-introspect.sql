-- A per-category fingerprint of the `public` schema.
--
-- Run against a replayed local cluster (scripts/verify-migrations.mjs prints
-- it) and against the hosted project (paste into the SQL editor, or the
-- Supabase MCP `execute_sql`). Equal counts AND equal digests in every row
-- means the repo's migrations reproduce production.
--
-- It is deliberately built from `line` strings rather than a pg_dump diff:
-- pg_dump output is ordered by OID and formatted per server version, so two
-- identical schemas produce different text. Sorting the facts before hashing
-- makes the comparison independent of both.
--
-- Known-benign difference: `--` comments inside a function body count toward
-- the `function` digest, and the apply path that wrote the hosted schema
-- stripped them. If `function` is the only category that differs, compare
--   md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
-- per function before treating it as drift.
--
-- SCOPE. `column`, `constraint`, `index`, `grant` and `trigger` cover `public`
-- only, deliberately: `scripts/pg-shim.sql` stands up a minimal
-- storage.objects / storage.buckets rather than the platform's, so their shapes
-- are expected to differ and comparing them would be noise, not signal. What
-- the baseline actually creates in `storage` — the policies, the RLS flags and
-- the bucket rows — IS compared, because those are the access controls.

with facts as (
  -- Enums, with value order — an out-of-order `add value` is a real difference.
  select 'enum' as category,
         t.typname || ' = [' || string_agg(e.enumlabel, ',' order by e.enumsortorder) || ']' as line
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   group by t.typname

  union all
  select 'column',
         c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' NOT NULL' else '' end
           || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped

  union all
  select 'constraint', c.relname || ': ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all
  select 'index', indexdef from pg_indexes where schemaname = 'public'

  union all
  -- Owner is part of the RLS fact: a table's owner bypasses its policies
  -- unless FORCE is set, so "who owns this" and "is bypass forced off" are one
  -- question, not two.
  --
  -- For `public` only. The storage tables are the platform's — hosted they
  -- belong to `supabase_storage_admin`, and pg-shim.sql necessarily creates
  -- its stand-ins as the local superuser, so comparing that would report a
  -- difference on every run and mean nothing. Their RLS flags, which the
  -- baseline does depend on, are still compared.
  select 'rls', n.nspname || '.' || relname || ' rowsecurity=' || relrowsecurity::text
           || ' forced=' || relforcerowsecurity::text
           || case when n.nspname = 'public'
                   then ' owner=' || pg_get_userbyid(c.relowner)
                   else ' owner=<platform-managed>' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r'
     and (n.nspname = 'public' or (n.nspname, c.relname) in
          (('storage', 'objects'), ('storage', 'buckets')))

  union all
  -- `storage`, not just `public`. The baseline creates seven policies on
  -- storage.objects — they are what scopes avatar and media uploads to their
  -- owner — so a public-only filter would have let a restore with no per-user
  -- isolation on either bucket fingerprint as identical.
  -- `permissive` is load-bearing, not metadata: RESTRICTIVE policies compose
  -- with AND rather than OR, so flipping one of the two storage.objects INSERT
  -- policies would require an upload to satisfy BOTH the avatar and the media
  -- predicate — which no upload can — while the predicates themselves, and
  -- therefore the rest of this fact, stayed identical.
  select 'policy',
         schemaname || '.' || tablename || ': ' || policyname || ' ' || cmd
           || ' ' || permissive
           || ' roles=' || array_to_string(roles, ',')
           || ' using=' || coalesce(qual, '-')
           || ' check=' || coalesce(with_check, '-')
    from pg_policies where schemaname in ('public', 'storage')

  union all
  -- Bucket configuration is DDL in every way that matters: `public` decides
  -- whether media is served by URL or only by signed URL, and the mime
  -- allowlist is an upload control. Both are set by INSERTs in the baseline.
  select 'bucket',
         id || ' public=' || public::text
           || ' limit=' || coalesce(file_size_limit::text, '-')
           || ' mime=[' || coalesce(array_to_string(allowed_mime_types, ','), '') || ']'
    from storage.buckets

  union all
  -- `tgenabled` is not in the definition: `pg_get_triggerdef` reconstructs the
  -- same CREATE TRIGGER whether the trigger fires or not. A disabled
  -- `enforce_prompt_current_version` would leave the schema looking identical
  -- while `prompts.current_ver` could point at another prompt's version.
  -- O=origin (the normal enabled state) · D=disabled · R=replica · A=always.
  select 'trigger', c.relname || ': ' || pg_get_triggerdef(tg.oid)
           || ' enabled=' || tg.tgenabled::text
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal

  union all
  -- Signature, volatility, SECURITY DEFINER, the pinned search_path, body hash.
  -- Owner matters most on the SECURITY DEFINER routines, where it IS the
  -- privilege set the body runs with — `spend_reserve` owned by a different
  -- role is a different function, with every other field here unchanged.
  select 'function',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
           || pg_get_function_result(p.oid)
           || ' vol=' || p.provolatile::text || ' secdef=' || p.prosecdef::text
           || ' owner=' || pg_get_userbyid(p.proowner)
           || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '-')
           || ' body=' || md5(regexp_replace(coalesce(p.prosrc, ''), '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'

  union all
  -- What the API roles may do. A table the client can write directly is a
  -- different security posture from one reachable only through a function.
  select 'grant', table_name || ': ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')

  union all
  -- LEFT join, and grantee 0 mapped to PUBLIC. `aclexplode` emits PUBLIC with
  -- grantee OID 0, which has no pg_roles row — an inner join silently dropped
  -- it. That is the grant that matters most here: EXECUTE is granted to PUBLIC
  -- by default, several of these routines are SECURITY DEFINER, and the
  -- baseline's `revoke execute … from … public` is precisely the control this
  -- fingerprint exists to compare.
  select 'exec-grant',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '): '
           || coalesce(r.rolname, 'PUBLIC')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
     and coalesce(r.rolname, 'PUBLIC') in
         ('anon', 'authenticated', 'service_role', 'PUBLIC')
)
select category, count(*) as n, md5(string_agg(line, E'\n' order by line)) as digest
  from facts group by category order by category;
