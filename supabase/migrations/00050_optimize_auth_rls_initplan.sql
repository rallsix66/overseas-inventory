-- Migration 00050: optimize the six auth.uid() RLS init-plan findings.
--
-- Replacing a row-level auth.uid() call with the scalar subquery form makes
-- PostgreSQL evaluate the stable identity expression once per statement. The
-- policy commands, roles, names, permissiveness, and full predicates remain
-- unchanged. The exact 00001-00049 catalog baseline is checked before any
-- policy is dropped and the exact optimized catalog is checked afterwards.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TEMP TABLE opt6_expected_policy_baseline (
  schema_name text NOT NULL,
  table_name text NOT NULL,
  policy_name text NOT NULL,
  permissive boolean NOT NULL,
  roles text NOT NULL,
  command "char" NOT NULL,
  direct_qual text NOT NULL,
  direct_with_check text NOT NULL,
  optimized_qual text NOT NULL,
  optimized_with_check text NOT NULL,
  PRIMARY KEY (schema_name, table_name, policy_name)
) ON COMMIT DROP;

INSERT INTO opt6_expected_policy_baseline VALUES
  (
    'public', 'profiles', 'operator_update_own_profile', true, '{0}', 'w',
    '((auth.uid()=id)AND(get_user_role()=''operator''::text))',
    '((auth.uid()=id)AND(get_user_role()=''operator''::text))',
    '(((SELECTauth.uid()ASuid)=id)AND(get_user_role()=''operator''::text))',
    '(((SELECTauth.uid()ASuid)=id)AND(get_user_role()=''operator''::text))'
  ),
  (
    'public', 'profiles', 'user_read_own_profile', true, '{0}', 'r',
    '(auth.uid()=id)', '', '((SELECTauth.uid()ASuid)=id)', ''
  ),
  (
    'public', 'user_variant_preference', 'user_select_own_preferences', true, '{0}', 'r',
    '(auth.uid()=user_id)', '', '((SELECTauth.uid()ASuid)=user_id)', ''
  ),
  (
    'public', 'user_variant_preference', 'user_insert_own_preferences', true, '{0}', 'a',
    '', '(auth.uid()=user_id)', '', '((SELECTauth.uid()ASuid)=user_id)'
  ),
  (
    'public', 'user_variant_preference', 'user_delete_own_preferences', true, '{0}', 'd',
    '(auth.uid()=user_id)', '', '((SELECTauth.uid()ASuid)=user_id)', ''
  ),
  (
    'public', 'user_warehouses', 'operator_select_own_user_warehouses', true, '{0}', 'r',
    '(auth.uid()=user_id)', '', '((SELECTauth.uid()ASuid)=user_id)', ''
  );

DO $$
DECLARE
  actual_count integer;
  mismatch_count integer;
BEGIN
  WITH actual AS (
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      policy.polname AS policy_name,
      policy.polpermissive AS permissive,
      policy.polroles::text AS roles,
      policy.polcmd AS command,
      regexp_replace(coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''), '\s+', '', 'g') AS qual,
      regexp_replace(coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''), '\s+', '', 'g') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  )
  SELECT
    count(actual.policy_name),
    count(*) FILTER (
      WHERE actual.policy_name IS NULL
        OR actual.permissive IS DISTINCT FROM expected.permissive
        OR actual.roles IS DISTINCT FROM expected.roles
        OR actual.command IS DISTINCT FROM expected.command
        OR actual.qual IS DISTINCT FROM expected.direct_qual
        OR actual.with_check IS DISTINCT FROM expected.direct_with_check
    )
  INTO actual_count, mismatch_count
  FROM opt6_expected_policy_baseline expected
  LEFT JOIN actual USING (schema_name, table_name, policy_name);

  IF actual_count <> 6 OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'OPT-6 baseline policy catalog drift: found % of 6 policies with % mismatches; no policy was changed',
      actual_count,
      mismatch_count;
  END IF;
END;
$$;

DROP POLICY "operator_update_own_profile" ON public.profiles;
CREATE POLICY "operator_update_own_profile" ON public.profiles
  FOR UPDATE
  USING ((SELECT auth.uid()) = id AND public.get_user_role() = 'operator')
  WITH CHECK ((SELECT auth.uid()) = id AND public.get_user_role() = 'operator');

DROP POLICY "user_read_own_profile" ON public.profiles;
CREATE POLICY "user_read_own_profile" ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);

DROP POLICY "user_select_own_preferences" ON public.user_variant_preference;
CREATE POLICY "user_select_own_preferences" ON public.user_variant_preference
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY "user_insert_own_preferences" ON public.user_variant_preference;
CREATE POLICY "user_insert_own_preferences" ON public.user_variant_preference
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY "user_delete_own_preferences" ON public.user_variant_preference;
CREATE POLICY "user_delete_own_preferences" ON public.user_variant_preference
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY "operator_select_own_user_warehouses" ON public.user_warehouses;
CREATE POLICY "operator_select_own_user_warehouses" ON public.user_warehouses
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DO $$
DECLARE
  actual_count integer;
  mismatch_count integer;
BEGIN
  WITH actual AS (
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      policy.polname AS policy_name,
      policy.polpermissive AS permissive,
      policy.polroles::text AS roles,
      policy.polcmd AS command,
      regexp_replace(coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''), '\s+', '', 'g') AS qual,
      regexp_replace(coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''), '\s+', '', 'g') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  )
  SELECT
    count(actual.policy_name),
    count(*) FILTER (
      WHERE actual.policy_name IS NULL
        OR actual.permissive IS DISTINCT FROM expected.permissive
        OR actual.roles IS DISTINCT FROM expected.roles
        OR actual.command IS DISTINCT FROM expected.command
        OR actual.qual IS DISTINCT FROM expected.optimized_qual
        OR actual.with_check IS DISTINCT FROM expected.optimized_with_check
    )
  INTO actual_count, mismatch_count
  FROM opt6_expected_policy_baseline expected
  LEFT JOIN actual USING (schema_name, table_name, policy_name);

  IF actual_count <> 6 OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'OPT-6 optimized policy catalog mismatch: found % of 6 policies with % mismatches',
      actual_count,
      mismatch_count;
  END IF;
END;
$$;
