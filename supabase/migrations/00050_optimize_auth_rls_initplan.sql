-- Migration 00050: optimize the six auth.uid() RLS init-plan findings.
--
-- Replacing a row-level auth.uid() call with the scalar subquery form makes
-- PostgreSQL evaluate the stable identity expression once per statement. The
-- policy commands, roles, names, and boolean predicates remain unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE
  target_count integer;
  direct_auth_count integer;
BEGIN
  SELECT count(*) INTO target_count
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND (relation.relname, policy.polname) IN (
      ('profiles', 'operator_update_own_profile'),
      ('profiles', 'user_read_own_profile'),
      ('user_variant_preference', 'user_select_own_preferences'),
      ('user_variant_preference', 'user_insert_own_preferences'),
      ('user_variant_preference', 'user_delete_own_preferences'),
      ('user_warehouses', 'operator_select_own_user_warehouses')
    );

  SELECT count(*) INTO direct_auth_count
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND (relation.relname, policy.polname) IN (
      ('profiles', 'operator_update_own_profile'),
      ('profiles', 'user_read_own_profile'),
      ('user_variant_preference', 'user_select_own_preferences'),
      ('user_variant_preference', 'user_insert_own_preferences'),
      ('user_variant_preference', 'user_delete_own_preferences'),
      ('user_warehouses', 'operator_select_own_user_warehouses')
    )
    AND concat(
      pg_get_expr(policy.polqual, policy.polrelid),
      ' ',
      pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) LIKE '%auth.uid()%';

  IF target_count <> 6 OR direct_auth_count <> 6 THEN
    RAISE EXCEPTION
      'OPT-6 expected six direct auth.uid() policy targets; found % targets and % direct expressions',
      target_count,
      direct_auth_count;
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
  optimized_count integer;
BEGIN
  SELECT count(*) INTO optimized_count
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND (relation.relname, policy.polname) IN (
      ('profiles', 'operator_update_own_profile'),
      ('profiles', 'user_read_own_profile'),
      ('user_variant_preference', 'user_select_own_preferences'),
      ('user_variant_preference', 'user_insert_own_preferences'),
      ('user_variant_preference', 'user_delete_own_preferences'),
      ('user_warehouses', 'operator_select_own_user_warehouses')
    )
    AND concat(
      pg_get_expr(policy.polqual, policy.polrelid),
      ' ',
      pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) ~* 'SELECT auth\.uid\(\)';

  IF optimized_count <> 6 THEN
    RAISE EXCEPTION
      'OPT-6 auth init-plan policy optimization did not converge: % of 6',
      optimized_count;
  END IF;
END;
$$;
