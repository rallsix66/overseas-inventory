-- OPT-3 Production Migration baseline audit
-- READ-ONLY ONLY. Run the same statements against Production and Staging.
-- This file intentionally contains no DDL, DML, migration repair, or db push.

BEGIN TRANSACTION READ ONLY;

-- A. Snapshot identity and migration history
SELECT
  now() AT TIME ZONE 'UTC' AS snapshot_utc,
  current_database() AS database_name,
  current_setting('server_version') AS server_version,
  pg_current_wal_lsn()::text AS wal_lsn;

SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

SELECT e.extname, e.extversion, n.nspname AS extension_schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

-- B. Canonical object inventory. The row text is deliberately stable so two
-- environments can be compared by kind, object_count, and digest first, then
-- by object_key when a digest differs.
WITH catalog_rows AS (
  SELECT
    'column'::text AS kind,
    format('%I.%I.%I', n.nspname, c.relname, a.attname) AS object_key,
    concat_ws('|',
      format_type(a.atttypid, a.atttypmod),
      a.attnotnull::text,
      coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
      a.attidentity,
      a.attgenerated
    ) AS canonical
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped

  UNION ALL

  SELECT
    'constraint',
    format('%I.%I.%I', n.nspname, c.relname, con.conname),
    concat_ws('|', con.contype, con.condeferrable::text,
      con.condeferred::text, con.convalidated::text,
      pg_get_constraintdef(con.oid, true))
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    'index',
    format('%I.%I', n.nspname, ic.relname),
    concat_ws('|', i.indisunique::text, i.indisprimary::text,
      i.indisvalid::text, pg_get_indexdef(i.indexrelid))
  FROM pg_index i
  JOIN pg_class tc ON tc.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  JOIN pg_class ic ON ic.oid = i.indexrelid
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    concat_ws('|', t.tgenabled, pg_get_triggerdef(t.oid, true))
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal

  UNION ALL

  SELECT
    'function',
    format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)),
    concat_ws('|', pg_get_function_result(p.oid),
      pg_get_userbyid(p.proowner), p.prosecdef::text,
      coalesce(array_to_string(p.proacl, ','), ''),
      coalesce(array_to_string(p.proconfig, ','), ''),
      pg_get_functiondef(p.oid))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    'table_rls',
    format('%I.%I', n.nspname, c.relname),
    concat_ws('|', c.relrowsecurity::text, c.relforcerowsecurity::text,
      pg_get_userbyid(c.relowner))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')

  UNION ALL

  SELECT
    'policy',
    format('%I.%I.%I', schemaname, tablename, policyname),
    concat_ws('|', permissive, roles::text, cmd,
      coalesce(qual, ''), coalesce(with_check, ''))
  FROM pg_policies
  WHERE schemaname = 'public'
), known_expected_drift(kind, object_key) AS (
  VALUES
    ('column', 'public.product_variant.is_archived'),
    ('column', 'public.product_variant.archived_at'),
    ('column', 'public.product_variant.archived_by'),
    ('constraint', 'public.product_variant.product_variant_archived_by_fkey'),
    ('index', 'public.idx_variant_is_archived'),
    ('function', 'public.claim_sync_run_system(p_warehouse_id uuid, p_mode text, p_run_id uuid, p_lease_duration integer, p_triggered_by uuid, p_triggered_from text, p_input_artifact_hash text)')
), scoped_rows AS (
  SELECT 'full'::text AS comparison_scope, c.*
  FROM catalog_rows c

  UNION ALL

  SELECT 'known_drift_excluded', c.*
  FROM catalog_rows c
  WHERE NOT EXISTS (
    SELECT 1
    FROM known_expected_drift d
    WHERE d.kind = c.kind AND d.object_key = c.object_key
  )
)
SELECT comparison_scope, kind, count(*) AS object_count,
       md5(string_agg(object_key || '|' || canonical, E'\n'
                      ORDER BY object_key)) AS digest
FROM scoped_rows
GROUP BY comparison_scope, kind
ORDER BY comparison_scope, kind;

-- C. Known divergent objects. Production should currently return no rows;
-- Staging should return the three legacy columns, FK, and partial index.
SELECT
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname = 'product_variant'
  AND a.attname IN ('is_archived', 'archived_at', 'archived_by')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT con.conname, pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'product_variant'
  AND con.conname = 'product_variant_archived_by_fkey';

SELECT ic.relname AS index_name, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class tc ON tc.oid = i.indrelid
JOIN pg_namespace n ON n.oid = tc.relnamespace
JOIN pg_class ic ON ic.oid = i.indexrelid
WHERE n.nspname = 'public'
  AND tc.relname = 'product_variant'
  AND ic.relname = 'idx_variant_is_archived';

-- D. Required Cron function. Production currently returns no rows; Staging
-- returns one service_role-only SECURITY DEFINER function.
SELECT
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS identity,
  pg_get_function_result(p.oid) AS result_type,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proacl AS acl,
  p.proconfig AS config,
  md5(pg_get_functiondef(p.oid)) AS definition_digest
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'claim_sync_run_system'
ORDER BY identity;

COMMIT;
