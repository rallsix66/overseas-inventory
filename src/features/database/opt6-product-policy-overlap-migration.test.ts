import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-6 Migration 00052 static contract', () => {
  let migration = ''

  beforeAll(() => {
    migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00052_optimize_product_rls_policy_overlap.sql'),
      'utf8',
    )
  })

  it('replaces only the reviewed product-table overlap', () => {
    expect(migration.match(/DROP POLICY /g)).toHaveLength(2)
    expect(migration.match(/CREATE POLICY /g)).toHaveLength(4)
    expect(migration).toContain('DROP POLICY "admin_all_product" ON public.product')
    expect(migration).toContain('DROP POLICY "operator_select_product" ON public.product')
    expect(migration).toContain('CREATE POLICY "product_select_admin_or_operator" ON public.product')
    expect(migration).toContain('CREATE POLICY "product_insert_admin" ON public.product')
    expect(migration).toContain('CREATE POLICY "product_update_admin" ON public.product')
    expect(migration).toContain('CREATE POLICY "product_delete_admin" ON public.product')
  })

  it('makes exactly one permissive policy applicable to each product-table command', () => {
    expect(migration).toMatch(/product_select_admin_or_operator[\s\S]*?FOR SELECT[\s\S]*?'admin'[\s\S]*?'operator'/)
    expect(migration).toMatch(/product_insert_admin[\s\S]*?FOR INSERT[\s\S]*?WITH CHECK/)
    expect(migration).toMatch(/product_update_admin[\s\S]*?FOR UPDATE[\s\S]*?USING[\s\S]*?WITH CHECK/)
    expect(migration).toMatch(/product_delete_admin[\s\S]*?FOR DELETE[\s\S]*?USING/)
  })

  it('has bounded exact pre/post catalog gates and rejects extra product policies', () => {
    expect(migration).toContain("SET lock_timeout = '5s'")
    expect(migration).toContain("SET statement_timeout = '30s'")
    expect(migration).toContain('opt6_product_policy_expected')
    expect(migration).toContain('OPT-6 product policy baseline drift')
    expect(migration).toContain('OPT-6 product policy optimized catalog mismatch')
    expect(migration).toContain("namespace.nspname = 'public' AND relation.relname = 'product'")
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
