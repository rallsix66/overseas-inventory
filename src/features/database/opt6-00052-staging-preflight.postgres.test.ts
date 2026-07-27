import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const required = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const
const missing = required.filter((name) => !process.env[name])
if (missing.length > 0) throw new Error('PostgreSQL preflight contract requires: ' + missing.join(', '))

const client = new Client({ host: process.env.PGHOST!, port: Number.parseInt(process.env.PGPORT!, 10), database: process.env.PGDATABASE!, user: process.env.PGUSER!, password: process.env.PGPASSWORD! })

const setup = [
  'DROP SCHEMA IF EXISTS supabase_migrations CASCADE;',
  'CREATE SCHEMA supabase_migrations;',
  'CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text NOT NULL, statements text[] NOT NULL);',
  'DROP TABLE IF EXISTS public.sync_run CASCADE; DROP TABLE IF EXISTS public.product CASCADE;',
  'CREATE TABLE public.sync_run (status text NOT NULL); CREATE TABLE public.product (id uuid PRIMARY KEY);',
  "CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'admin'::text $$;",
  'ALTER TABLE public.product ENABLE ROW LEVEL SECURITY; CREATE POLICY admin_all_product ON public.product FOR ALL USING (true); CREATE POLICY operator_select_product ON public.product FOR SELECT USING (true);',
].join(nl)

describe('OPT-6 Batch 3 Staging preflight PostgreSQL execution contract', () => {
  beforeAll(async () => { await client.connect(); await client.query(setup) })
  afterAll(async () => { await client.query('DROP SCHEMA IF EXISTS supabase_migrations CASCADE'); await client.query('DROP TABLE IF EXISTS public.sync_run CASCADE'); await client.query('DROP TABLE IF EXISTS public.product CASCADE'); await client.end() })
  it('executes the complete SELECT-only packet without syntax or CTE errors', async () => {
    const packet = readFileSync(resolve(process.cwd(), 'docs/reports/sql/2026-07-27-opt6-00052-staging-preflight.sql'), 'utf8')
    const result = await client.query(packet)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toHaveProperty('exact_version_name_history')
    expect(result.rows[0]).toHaveProperty('exact_history_payload')
    expect(result.rows[0]).toHaveProperty('exact_product_policies')
    expect(result.rows[0]).toHaveProperty('in_progress_sync_runs')
  })
})
