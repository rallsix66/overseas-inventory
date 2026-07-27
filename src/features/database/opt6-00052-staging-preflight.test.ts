import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-6 Batch 3 Staging 00052 preflight static contract', () => {
  let packet = ''
  beforeAll(() => { packet = readFileSync(resolve(process.cwd(), 'docs/reports/sql/2026-07-27-opt6-00052-staging-preflight.sql'), 'utf8') })
  it('is one SELECT-only packet with no write or DDL verbs', () => {
    const executable = packet.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(executable.match(/\bSELECT\b/gi)?.length).toBeGreaterThan(0)
    expect(executable).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i)
    expect(executable).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|INDEX|POLICY|SCHEMA|ROLE|VIEW)\b/i)
    expect(executable).not.toMatch(/\b(GRANT|REVOKE)\b/i)
  })
  it('pins the complete 00001-00051 history and full statements payload', () => {
    expect(packet.match(/\('000\d{2}',/g)).toHaveLength(51)
    expect(packet).toContain('exact_version_name_history')
    expect(packet).toContain('exact_history_payload')
    expect(packet).toContain('statement_count IS DISTINCT FROM expected.statement_count')
    expect(packet).toContain('statement_chars IS DISTINCT FROM expected.statement_chars')
    expect(packet).toContain('statement_digest IS DISTINCT FROM expected.statement_digest')
    expect(packet).toContain('00051_optimize_role_rls_policy_overlap')
    expect(packet).toContain("version = '00052'")
    expect(packet).toContain('Staging SELECT-only preflight')
    expect(packet).not.toContain('Production preflight')
    expect(packet).not.toContain('statements[1]')
  })
  it('checks the reviewed public.product baseline and active sync hard stop', () => {
    expect(packet).toContain('actual_product_policy')
    expect(packet).not.toContain('actual_role_policy')
    expect(packet).toContain('count(DISTINCT name) = 51 AS unique_names')
    expect(packet).toContain('expected_product_policy')
    expect(packet).not.toContain('expected_role_policy')
    expect(packet).toContain('product_policy_count_2')
    expect(packet).toContain('exact_product_policies')
    expect(packet).toContain("relation.relname = 'product'")
    expect(packet).toContain("status = 'in_progress'")
  })
})
