import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const normalize = (value: string) => value.replace(/\r\n/g, '\n')

describe('OPT-6 Batch 3 Production 00052 apply packet static contract', () => {
  let packet = ''
  let migration = ''

  beforeAll(() => {
    packet = normalize(readFileSync(
      resolve(process.cwd(), 'docs/reports/sql/2026-07-28-opt6-00052-production-apply.sql'),
      'utf8',
    ))
    migration = normalize(readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00052_optimize_product_rls_policy_overlap.sql'),
      'utf8',
    ))
  })

  it('keeps one transaction and locks history/sync before the migration body', () => {
    expect(packet.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(packet.match(/^COMMIT;$/gm)).toHaveLength(1)
    const bodyIndex = packet.indexOf('-- Migration 00052:')
    expect(bodyIndex).toBeGreaterThan(0)
    expect(packet.indexOf('LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE;')).toBeLessThan(bodyIndex)
    expect(packet.indexOf('LOCK TABLE public.sync_run IN SHARE MODE;')).toBeLessThan(bodyIndex)
  })

  it('rechecks exact 00001-00051 full history and active sync before policy DDL', () => {
    const bodyIndex = packet.indexOf('-- Migration 00052:')
    const preBody = packet.slice(0, bodyIndex)
    expect(preBody.match(/\('000\d{2}',/g)).toHaveLength(51)
    expect(preBody).toContain('FULL JOIN actual_history AS actual USING (version)')
    expect(preBody).toContain("array_to_string(statements, E'\\x1f')")
    expect(preBody).toContain('statement_count IS DISTINCT FROM expected.statement_count')
    expect(preBody).toContain('statement_chars IS DISTINCT FROM expected.statement_chars')
    expect(preBody).toContain('statement_digest IS DISTINCT FROM expected.statement_digest')
    expect(preBody).toContain("version = '00052'")
    expect(preBody).toContain("status = 'in_progress'")
    expect(preBody).toContain('RAISE EXCEPTION')
    expect(packet.indexOf('DROP POLICY')).toBeGreaterThan(bodyIndex)
  })

  it('guards the reviewed product policy catalog before and after the body', () => {
    expect(packet).toContain('opt6_product_apply_policy_expected')
    expect(packet).toContain('exact product policy baseline drift')
    expect(packet).toContain('product_select_admin_or_operator')
    expect(packet).toContain('product_insert_admin')
    expect(packet).toContain('product_update_admin')
    expect(packet).toContain('product_delete_admin')
    expect(packet.match(/FULL JOIN actual USING \(policy_name\)/g)).toHaveLength(2)
    expect(packet).toContain('policy_count <> 2')
    expect(packet).toContain('policy_count <> 4')
    expect(packet).toContain('mismatch_count <> 0')
  })

  it('embeds the canonical migration body exactly twice and registers one 00052 payload', () => {
    const escaped = migration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(packet.match(new RegExp(escaped, 'g'))).toHaveLength(2)
    expect(packet.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(1)
    expect(packet).toContain("SELECT '00052', '00052_optimize_product_rls_policy_overlap'")
    expect(packet).toContain('length(value) = 5786')
    expect(packet).toContain("md5(value) = '580fd279b2f8d07f6c5a550acc82812a'")
    expect(packet).not.toMatch(/VALUES\s+VALUES/)
  })

  it('repeats full old-history, payload, policy, and sync postchecks', () => {
    const bodyIndex = packet.indexOf('-- Migration 00052:')
    const postBody = packet.slice(packet.lastIndexOf('WITH body AS'))
    expect(bodyIndex).toBeLessThan(packet.lastIndexOf('WITH body AS'))
    expect(postBody).toContain('FULL JOIN actual_history AS actual USING (version)')
    expect(postBody).toContain('count(*) FROM supabase_migrations.schema_migrations) <> 52')
    expect(postBody).toContain("version = '00052' AND name = '00052_optimize_product_rls_policy_overlap'")
    expect(postBody).toContain("md5(statements[1]) = '580fd279b2f8d07f6c5a550acc82812a'")
    expect(postBody).toContain("status = 'in_progress'")
    expect(postBody).toContain('policy_count <> 4')
  })

  it('passes deterministic structural SQL sanity checks', () => {
    let depth = 0
    for (const character of packet) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
    expect(packet.match(/\$migration\$/g)).toHaveLength(2)
    expect(packet.match(/CREATE TEMP TABLE opt6_history_expected/g)).toHaveLength(1)
    expect(packet.match(/CREATE TEMP TABLE opt6_product_apply_policy_expected/g)).toHaveLength(1)
  })
})