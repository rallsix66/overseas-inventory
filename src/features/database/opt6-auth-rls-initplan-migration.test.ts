import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-6 Migration 00050 static contract', () => {
  let migration = ''

  beforeAll(() => {
    migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00050_optimize_auth_rls_initplan.sql'),
      'utf8',
    )
  })

  it('rewrites exactly the six reviewed policy targets', () => {
    expect(migration.match(/DROP POLICY /g)).toHaveLength(6)
    expect(migration.match(/CREATE POLICY /g)).toHaveLength(6)
    for (const policy of [
      'operator_update_own_profile',
      'user_read_own_profile',
      'user_select_own_preferences',
      'user_insert_own_preferences',
      'user_delete_own_preferences',
      'operator_select_own_user_warehouses',
    ]) {
      expect(migration).toContain(`DROP POLICY "${policy}"`)
      expect(migration).toContain(`CREATE POLICY "${policy}"`)
    }
  })

  it('uses scalar auth.uid init plans in every replacement policy', () => {
    expect(migration.match(/\(SELECT auth\.uid\(\)\)/g)).toHaveLength(7)
  })

  it('preserves the policy commands and role predicates', () => {
    expect(migration).toMatch(
      /CREATE POLICY "operator_update_own_profile"[\s\S]*?FOR UPDATE[\s\S]*?public\.get_user_role\(\) = 'operator'/,
    )
    expect(migration).toMatch(/CREATE POLICY "user_read_own_profile"[\s\S]*?FOR SELECT/)
    expect(migration).toMatch(/CREATE POLICY "user_insert_own_preferences"[\s\S]*?FOR INSERT/)
    expect(migration).toMatch(/CREATE POLICY "user_delete_own_preferences"[\s\S]*?FOR DELETE/)
  })

  it('contains bounded execution and exact pre/postcondition gates', () => {
    expect(migration).toContain("SET lock_timeout = '5s'")
    expect(migration).toContain("SET statement_timeout = '30s'")
    expect(migration).toContain('opt6_expected_policy_baseline')
    expect(migration).toContain('OPT-6 baseline policy catalog drift')
    expect(migration).toContain('OPT-6 optimized policy catalog mismatch')
    expect(migration).toContain('pg_get_expr(policy.polqual, policy.polrelid)')
    expect(migration).toContain('pg_get_expr(policy.polwithcheck, policy.polrelid)')
    expect(migration).toContain('actual.permissive IS DISTINCT FROM expected.permissive')
    expect(migration).toContain('polroles::text')
    expect(migration).toContain('policy.polcmd AS command')
    expect(migration.match(/IS DISTINCT FROM expected\.(direct_qual|direct_with_check)/g)).toHaveLength(2)
    expect(migration.match(/IS DISTINCT FROM expected\.(optimized_qual|optimized_with_check)/g)).toHaveLength(2)
  })

  it('does not change tables, functions, grants, indexes, or business data', () => {
    expect(migration).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|INDEX)\b/i)
    expect(migration).not.toMatch(/\b(GRANT|REVOKE)\b/i)
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM)?\s*public\./i)
  })
})
