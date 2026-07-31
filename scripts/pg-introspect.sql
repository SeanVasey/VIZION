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
  select 'rls', relname || ' rowsecurity=' || relrowsecurity::text
           || ' forced=' || relforcerowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'

  union all
  select 'policy',
         tablename || ': ' || policyname || ' ' || cmd
           || ' roles=' || array_to_string(roles, ',')
           || ' using=' || coalesce(qual, '-')
           || ' check=' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public'

  union all
  select 'trigger', c.relname || ': ' || pg_get_triggerdef(tg.oid)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal

  union all
  -- Signature, volatility, SECURITY DEFINER, the pinned search_path, body hash.
  select 'function',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
           || pg_get_function_result(p.oid)
           || ' vol=' || p.provolatile::text || ' secdef=' || p.prosecdef::text
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
  select 'exec-grant',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '): ' || r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
     and r.rolname in ('anon', 'authenticated', 'service_role')
)
select category, count(*) as n, md5(string_agg(line, E'\n' order by line)) as digest
  from facts group by category order by category;
