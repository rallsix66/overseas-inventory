import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-6 Migration 00051 static contract', () => {
  let migration = ''

  beforeAll(() => {
    migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00051_optimize_role_rls_policy_overlap.sql'),
      'utf8',
    )
  })

  it('replaces only the reviewed role-table overlap', () => {
    expect(migration.match(/DROP POLICY /g)).toHaveLength(2)
    expect(migration.match(/CREATE POLICY /g)).toHaveLength(4)
    expect(migration).toContain('DROP POLICY "admin_all_role" ON public.role')
    expect(migration).toContain('DROP POLICY "operator_select_role" ON public.role')
    expect(migration).toContain('CREATE POLICY "role_select_admin_or_operator" ON public.role')
    expect(migration).toContain('CREATE POLICY "role_insert_admin" ON public.role')
    expect(migration).toContain('CREATE POLICY "role_update_admin" ON public.role')
    expect(migration).toContain('CREATE POLICY "role_delete_admin" ON public.role')
  })

  it('makes exactly one permissive policy applicable to each role-table command', () => {
    expect(migration).toMatch(/role_select_admin_or_operator[\s\S]*?FOR SELECT[\s\S]*?'admin'[\s\S]*?'operator'/)
    expect(migration).toMatch(/role_insert_admin[\s\S]*?FOR INSERT[\s\S]*?WITH CHECK/)
    expect(migration).toMatch(/role_update_admin[\s\S]*?FOR UPDATE[\s\S]*?USING[\s\S]*?WITH CHECK/)
    expect(migration).toMatch(/role_delete_admin[\s\S]*?FOR DELETE[\s\S]*?USING/)
  })

  it('has bounded exact pre/post catalog gates and rejects extra role policies', () => {
    expect(migration).toContain("SET lock_timeout = '5s'")
    expect(migration).toContain("SET statement_timeout = '30s'")
    expect(migration).toContain('opt6_role_policy_expected')
    expect(migration).toContain('OPT-6 role policy baseline drift')
    expect(migration).toContain('OPT-6 role policy optimized catalog mismatch')
    expect(migration).toContain("namespace.nspname = 'public' AND relation.relname = 'role'")
    expect(migration).toContain('pg_get_expr(policy.polqual, policy.polrelid)')
    expect(migration).toContain('pg_get_expr(policy.polwithcheck, policy.polrelid)')
    expect(migration).toContain('actual_count <> 2')
    expect(migration).toContain('actual_count <> 4')
  })

  it('does not change tables, functions, grants, indexes, or business data', () => {
    expect(migration).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|INDEX)\b/i)
    expect(migration).not.toMatch(/\b(GRANT|REVOKE)\b/i)
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM)?\s*public\./i)
  })
})
