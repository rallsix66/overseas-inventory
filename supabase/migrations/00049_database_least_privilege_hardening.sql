-- Migration 00049: database least-privilege hardening
--
-- Scope:
--   1. Pin search_path for five existing invoker/trigger functions.
--   2. Remove direct API-role EXECUTE from trigger-only functions.
--   3. Keep get_user_role() available only to authenticated callers/RLS.
--   4. Keep user-management RPCs invoker-only and authenticated-only.
--   5. Remove direct service_role table access to provider_token_cache;
--      the existing service-role-only SECURITY DEFINER lease RPCs remain the
--      sole application access path.
--
-- This migration does not change function SECURITY mode, RLS policies,
-- business tables, business data, or existing function bodies except for
-- schema-qualifying get_user_role() inside the operator profile trigger.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE
  required_regprocedure text;
BEGIN
  FOREACH required_regprocedure IN ARRAY ARRAY[
    'public.get_user_role()',
    'public.handle_new_user()',
    'public.update_updated_at_column()',
    'public.update_shipment_external_updated_at()',
    'public.check_operator_profile_update()',
    'public.update_user_role_protected(uuid,uuid,uuid)',
    'public.toggle_user_active_protected(uuid,boolean,uuid)',
    'public.acquire_token_lease(text,uuid)',
    'public.store_token_with_lease(text,text,timestamp with time zone,uuid)',
    'public.release_token_lease(text,uuid)'
  ]
  LOOP
    IF to_regprocedure(required_regprocedure) IS NULL THEN
      RAISE EXCEPTION 'OPT-5 required function is missing: %', required_regprocedure;
    END IF;
  END LOOP;

  IF to_regclass('public.provider_token_cache') IS NULL THEN
    RAISE EXCEPTION 'OPT-5 required table is missing: public.provider_token_cache';
  END IF;
END;
$$;

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = '';

ALTER FUNCTION public.update_shipment_external_updated_at()
  SET search_path = '';

ALTER FUNCTION public.update_user_role_protected(uuid, uuid, uuid)
  SET search_path = '';

ALTER FUNCTION public.toggle_user_active_protected(uuid, boolean, uuid)
  SET search_path = '';

CREATE OR REPLACE FUNCTION public.check_operator_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF public.get_user_role() = 'operator' THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION '不允许修改自己的角色';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION '不允许修改自己的启用状态';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- get_user_role() must remain SECURITY DEFINER because RLS policies use it to
-- read the caller's active profile without policy recursion. Direct anonymous
-- and system-role calls are unnecessary; authenticated is the only API role.
REVOKE EXECUTE ON FUNCTION public.get_user_role()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role()
  TO authenticated;

-- Auth and table triggers execute these functions through their trigger
-- bindings. None is a direct PostgREST RPC surface.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_shipment_external_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_operator_profile_update()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing SECURITY INVOKER + auth.uid() identity model.
REVOKE EXECUTE ON FUNCTION public.update_user_role_protected(uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_role_protected(uuid, uuid, uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.toggle_user_active_protected(uuid, boolean, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_user_active_protected(uuid, boolean, uuid)
  TO authenticated;

-- The application uses only the audited lease RPCs. Removing direct table
-- grants prevents service_role callers from bypassing lease ownership rules.
REVOKE ALL PRIVILEGES ON TABLE public.provider_token_cache
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_token_lease(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_token_lease(text, uuid)
  TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.get_user_role()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_user_role()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_user_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'OPT-5 get_user_role EXECUTE matrix did not converge';
  END IF;

  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'OPT-5 handle_new_user must be trigger-only';
  END IF;

  IF has_table_privilege('service_role', 'public.provider_token_cache', 'SELECT')
     OR has_table_privilege('service_role', 'public.provider_token_cache', 'INSERT')
     OR has_table_privilege('service_role', 'public.provider_token_cache', 'UPDATE')
     OR has_table_privilege('service_role', 'public.provider_token_cache', 'DELETE') THEN
    RAISE EXCEPTION 'OPT-5 provider_token_cache direct grants were not removed';
  END IF;

  IF NOT has_function_privilege(
      'service_role', 'public.acquire_token_lease(text,uuid)', 'EXECUTE'
    ) OR has_function_privilege(
      'authenticated', 'public.acquire_token_lease(text,uuid)', 'EXECUTE'
    ) OR has_function_privilege(
      'anon', 'public.acquire_token_lease(text,uuid)', 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'OPT-5 token lease RPC EXECUTE matrix did not converge';
  END IF;
END;
$$;
