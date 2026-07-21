-- OPT-6 Batch 2 / 00051 Production exact preflight (read-only).
-- Target project: hzlhqyditalumhnxbaim (DIS Project / Production).
--
-- This packet contains SELECT statements only. It does not begin a write
-- transaction, execute a Migration, alter policy, or register 00051. Run it
-- only as the Production preflight before a separately reviewed maintenance
-- window. A false result is a hard stop.

WITH history AS (
  SELECT version, name, statements
  FROM supabase_migrations.schema_migrations
),
history_check AS (
  SELECT
    count(*) = 50 AS rows_50,
    count(DISTINCT version) = 50 AS unique_versions,
    count(DISTINCT name) = 50 AS unique_names,
    min(version) = '00001' AS min_00001,
    max(version) = '00050' AS max_00050,
    count(*) FILTER (WHERE version !~ '^[0-9]{5}$') = 0 AS no_timestamp_versions,
    array_agg(version ORDER BY version) IS NOT DISTINCT FROM
      ARRAY(
        SELECT lpad(i::text, 5, '0')
        FROM generate_series(1, 50) AS series(i)
      ) AS exact_version_set,
    NOT EXISTS (
      SELECT 1 FROM history WHERE version = '00051'
    ) AS no_00051,
    md5(string_agg(version || '|' || name, E'\n' ORDER BY version))
      AS version_name_digest,
    md5(string_agg(name || '|' || coalesce(statements[1], ''), E'\n' ORDER BY version))
      AS name_statements_digest
  FROM history
),
actual_role_policy AS (
  SELECT
    policy.polname AS policy_name,
    policy.polpermissive AS permissive,
    policy.polroles::text AS roles,
    policy.polcmd::text AS command,
    regexp_replace(
      coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''),
      '\s+', '', 'g'
    ) AS using_expression,
    regexp_replace(
      coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''),
      '\s+', '', 'g'
    ) AS with_check_expression
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'role'
),
expected_role_policy(policy_name, permissive, roles, command, using_expression, with_check_expression) AS (
  VALUES
    ('admin_all_role', true, '{0}', '*', '(get_user_role()=''admin''::text)', ''),
    ('operator_select_role', true, '{0}', 'r', '(get_user_role()=''operator''::text)', '')
),
role_check AS (
  SELECT
    (SELECT count(*) FROM actual_role_policy) = 2 AS role_policy_count_2,
    (
      SELECT count(*)
      FROM expected_role_policy AS expected
      LEFT JOIN actual_role_policy AS actual USING (policy_name)
      WHERE actual.policy_name IS NULL
         OR actual.permissive IS DISTINCT FROM expected.permissive
         OR actual.roles IS DISTINCT FROM expected.roles
         OR actual.command IS DISTINCT FROM expected.command
         OR actual.using_expression IS DISTINCT FROM expected.using_expression
         OR actual.with_check_expression IS DISTINCT FROM expected.with_check_expression
    ) = 0 AS exact_role_policies,
    md5(
      (
        SELECT string_agg(
          policy_name || '|' || permissive || '|' || roles || '|' || command || '|'
            || using_expression || '|' || with_check_expression,
          E'\n' ORDER BY policy_name
        )
        FROM actual_role_policy
      )
    ) AS role_policy_digest
)
SELECT
  history_check.*,
  role_check.*,
  (
    SELECT count(*) FROM public.sync_run WHERE status = 'in_progress'
  ) AS in_progress_sync_runs;
