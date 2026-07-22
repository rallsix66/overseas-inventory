-- Migration 00051: remove the reviewed role-table permissive policy overlap.
--
-- The existing admin FOR ALL policy and operator SELECT policy are both
-- permissive for SELECT.  This migration preserves their union exactly while
-- leaving one policy per command: one shared read policy and three admin-only
-- write policies.  It refuses to run if the complete role-table policy catalog
-- differs from the reviewed 00001-00050 baseline.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TEMP TABLE opt6_role_policy_expected (
  policy_name text PRIMARY KEY,
  permissive boolean NOT NULL,
  roles text NOT NULL,
  command "char" NOT NULL,
  qual text NOT NULL,
  with_check text NOT NULL
) ON COMMIT DROP;

INSERT INTO opt6_role_policy_expected VALUES
  ('admin_all_role', true, '{0}', '*', '(get_user_role()=''admin''::text)', ''),
  ('operator_select_role', true, '{0}', 'r', '(get_user_role()=''operator''::text)', '');

DO $$
DECLARE
  table_policy_count integer;
  actual_count integer;
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO table_policy_count
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'role';

  WITH actual AS (
    SELECT
      policy.polname AS policy_name,
      policy.polpermissive AS permissive,
      policy.polroles::text AS roles,
      policy.polcmd AS command,
      regexp_replace(coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''), '\s+', '', 'g') AS qual,
      regexp_replace(coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''), '\s+', '', 'g') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'role'
  )
  SELECT count(actual.policy_name), count(*) FILTER (
    WHERE actual.policy_name IS NULL
      OR actual.permissive IS DISTINCT FROM expected.permissive
      OR actual.roles IS DISTINCT FROM expected.roles
      OR actual.command IS DISTINCT FROM expected.command
      OR actual.qual IS DISTINCT FROM expected.qual
      OR actual.with_check IS DISTINCT FROM expected.with_check
  )
  INTO actual_count, mismatch_count
  FROM opt6_role_policy_expected expected
  LEFT JOIN actual USING (policy_name);

  IF table_policy_count <> 2 OR actual_count <> 2 OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'OPT-6 role policy baseline drift: found % role-table policies with % reviewed-policy mismatches; no policy was changed',
      table_policy_count, mismatch_count;
  END IF;
END;
$$;

DROP POLICY "admin_all_role" ON public.role;
DROP POLICY "operator_select_role" ON public.role;

CREATE POLICY "role_select_admin_or_operator" ON public.role
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'operator'
  );

CREATE POLICY "role_insert_admin" ON public.role
  FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "role_update_admin" ON public.role
  FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "role_delete_admin" ON public.role
  FOR DELETE
  USING (public.get_user_role() = 'admin');

TRUNCATE opt6_role_policy_expected;
INSERT INTO opt6_role_policy_expected VALUES
  (
    'role_select_admin_or_operator', true, '{0}', 'r',
    '((get_user_role()=''admin''::text)OR(get_user_role()=''operator''::text))', ''
  ),
  ('role_insert_admin', true, '{0}', 'a', '', '(get_user_role()=''admin''::text)'),
  (
    'role_update_admin', true, '{0}', 'w',
    '(get_user_role()=''admin''::text)', '(get_user_role()=''admin''::text)'
  ),
  ('role_delete_admin', true, '{0}', 'd', '(get_user_role()=''admin''::text)', '');

DO $$
DECLARE
  table_policy_count integer;
  actual_count integer;
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO table_policy_count
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'role';

  WITH actual AS (
    SELECT
      policy.polname AS policy_name,
      policy.polpermissive AS permissive,
      policy.polroles::text AS roles,
      policy.polcmd AS command,
      regexp_replace(coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''), '\s+', '', 'g') AS qual,
      regexp_replace(coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''), '\s+', '', 'g') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'role'
  )
  SELECT count(actual.policy_name), count(*) FILTER (
    WHERE actual.policy_name IS NULL
      OR actual.permissive IS DISTINCT FROM expected.permissive
      OR actual.roles IS DISTINCT FROM expected.roles
      OR actual.command IS DISTINCT FROM expected.command
      OR actual.qual IS DISTINCT FROM expected.qual
      OR actual.with_check IS DISTINCT FROM expected.with_check
  )
  INTO actual_count, mismatch_count
  FROM opt6_role_policy_expected expected
  LEFT JOIN actual USING (policy_name);

  IF table_policy_count <> 4 OR actual_count <> 4 OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'OPT-6 role policy optimized catalog mismatch: found % role-table policies with % reviewed-policy mismatches',
      table_policy_count, mismatch_count;
  END IF;
END;
$$;
