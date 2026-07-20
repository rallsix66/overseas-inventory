import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-5 Migration 00049 static contract', () => {
  let migration = ''

  beforeAll(() => {
    migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00049_database_least_privilege_hardening.sql'),
      'utf8',
    )
  })

  it('pins all five previously mutable search paths', () => {
    const alterTargets = [
      'public.update_updated_at_column()',
      'public.update_shipment_external_updated_at()',
      'public.update_user_role_protected(uuid, uuid, uuid)',
      'public.toggle_user_active_protected(uuid, boolean, uuid)',
    ]
    for (const target of alterTargets) {
      expect(migration).toContain(`ALTER FUNCTION ${target}`)
    }
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.check_operator_profile_update\(\)[\s\S]*?SET search_path = ''/,
    )
  })

  it('schema-qualifies the trigger dependency after pinning search_path', () => {
    expect(migration).toContain("IF public.get_user_role() = 'operator' THEN")
    expect(migration).not.toMatch(/\bIF get_user_role\(\)/)
  })

  it('removes anonymous direct execution from both definer functions', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_user_role\(\)[\s\S]*?FROM PUBLIC, anon, service_role;/,
    )
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.handle_new_user\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    )
  })

  it('preserves authenticated-only invoker RPC access', () => {
    for (const signature of [
      'public.update_user_role_protected(uuid, uuid, uuid)',
      'public.toggle_user_active_protected(uuid, boolean, uuid)',
    ]) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`)
    }
    expect(migration).not.toContain('SECURITY DEFINER\nSET search_path')
  })

  it('removes direct token-cache table grants and preserves service-only RPCs', () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.provider_token_cache[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    )
    for (const rpc of ['acquire_token_lease', 'store_token_with_lease', 'release_token_lease']) {
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}[\\s\\S]*?TO service_role;`))
    }
  })

  it('does not alter RLS policies, business tables, or historical migrations', () => {
    expect(migration).not.toMatch(/\b(CREATE|DROP|ALTER)\s+POLICY\b/i)
    expect(migration).not.toMatch(/\b(CREATE|DROP|ALTER)\s+TABLE\b/i)
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM)?\s*public\./i)
  })

  it('uses bounded DDL timeouts and explicit pre/postcondition gates', () => {
    expect(migration).toContain("SET lock_timeout = '5s'")
    expect(migration).toContain("SET statement_timeout = '30s'")
    expect(migration).toContain('OPT-5 required function is missing')
    expect(migration).toContain('OPT-5 get_user_role EXECUTE matrix did not converge')
    expect(migration).toContain('OPT-5 provider_token_cache direct grants were not removed')
  })
})
