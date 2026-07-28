import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OPT-6 Batch 2 Production preflight static contract', () => {
  let packet = ''

  beforeAll(() => {
    packet = readFileSync(
      resolve(process.cwd(), 'docs/reports/sql/2026-07-21-opt6-00051-production-preflight.sql'),
      'utf8',
    )
  })

  it('is a single read-only SELECT packet', () => {
    const executable = packet
      .replace(/--[^\r\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(executable.match(/\bSELECT\b/gi)?.length).toBeGreaterThan(0)
    expect(executable).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i)
    expect(executable).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|INDEX|POLICY|SCHEMA|ROLE|VIEW)\b/i)
    expect(executable).not.toMatch(/\b(GRANT|REVOKE)\b/i)
  })

  it('compares the complete reviewed history baseline, not a digest-only projection', () => {
    expect(packet).toContain('expected_history(version, name, statement_count, statement_chars, statement_digest)')
    expect(packet).toContain('exact_version_name_history')
    expect(packet).toContain('exact_history_payload')
    expect(packet).toContain("array_to_string(statements, E'\\x1f')")
    expect(packet).toContain('statement_count IS DISTINCT FROM expected.statement_count')
    expect(packet).toContain('statement_chars IS DISTINCT FROM expected.statement_chars')
    expect(packet).toContain('statement_digest IS DISTINCT FROM expected.statement_digest')
    expect(packet).not.toContain('statements[1]')
  })

  it('pins all 50 reviewed version/name/payload rows and returns both sides of each digest', () => {
    expect(packet.match(/\('000\d{2}',/g)).toHaveLength(50)
    expect(packet).toContain('actual_version_name_digest')
    expect(packet).toContain('expected_version_name_digest')
    expect(packet).toContain('actual_history_payload_digest')
    expect(packet).toContain('expected_history_payload_digest')
    expect(packet).toContain('FROM history_check')
    expect(packet).toContain('CROSS JOIN history_compare')
    expect(packet).toContain('CROSS JOIN role_check')
    expect(packet).toContain("'00049_database_least_privilege_hardening'")
    expect(packet).toContain("'00050_optimize_auth_rls_initplan'")
  })
})
