import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const requiredEnvVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name])

if (missingEnvVars.length > 0) {
  throw new Error(`PostgreSQL contract tests require: ${missingEnvVars.join(', ')}`)
}

const client = new Client({
  host: process.env.PGHOST!,
  port: Number.parseInt(process.env.PGPORT!, 10),
  database: process.env.PGDATABASE!,
  user: process.env.PGUSER!,
  password: process.env.PGPASSWORD!,
})

const SUPABASE_BOOTSTRAP_SQL = String.raw`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`

function migrationFiles(): string[] {
  const directory = resolve(process.cwd(), 'supabase', 'migrations')
  return readdirSync(directory)
    .filter((name) => /^\d{5}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => resolve(directory, name))
}

describe('fixed-width migrations 00001-00052 continuous PostgreSQL replay', () => {
  let files: string[] = []

  beforeAll(async () => {
    files = migrationFiles()
    await client.connect()
    await client.query(SUPABASE_BOOTSTRAP_SQL)
    for (const file of files) {
      await client.query(readFileSync(file, 'utf8'))
    }
  }, 60_000)

  afterAll(async () => {
    await client.end()
  })

  it('replays exactly the fixed-width 00001-00052 migration set', () => {
    expect(files).toHaveLength(52)
    expect(files[0]).toMatch(/00001_initial_schema\.sql$/)
    expect(files.at(-1)).toMatch(/00052_optimize_product_rls_policy_overlap\.sql$/)
  })

  it('keeps all public business tables protected by RLS', async () => {
    const result = await client.query<{ total: string; enabled: string }>(`
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE relrowsecurity)::text AS enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `)
    expect(result.rows).toEqual([{ total: '18', enabled: '18' }])
  })

  it('converges the 00010/00011 drift and preserves 00049 targets', async () => {
    const result = await client.query<{
      claim_function: string | null
      legacy_columns: string
      target_functions: string
    }>(`
      SELECT
        to_regprocedure(
          'public.claim_sync_run_system(uuid,text,uuid,integer,uuid,text,text)'
        )::text AS claim_function,
        (
          SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'product_variant'
            AND column_name IN ('is_archived', 'archived_at', 'archived_by')
        )::text AS legacy_columns,
        (
          SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN (
              'get_user_role', 'handle_new_user', 'update_updated_at_column',
              'update_shipment_external_updated_at', 'check_operator_profile_update',
              'update_user_role_protected', 'toggle_user_active_protected',
              'acquire_token_lease', 'store_token_with_lease', 'release_token_lease'
            )
        )::text AS target_functions
    `)
    expect(result.rows).toEqual([{
      claim_function: 'claim_sync_run_system(uuid,text,uuid,integer,uuid,text,text)',
      legacy_columns: '0',
      target_functions: '10',
    }])
  })

  it('ends with the least-privilege ACL and search-path matrix', async () => {
    const result = await client.query<{
      mutable_targets: string
      anon_get_user_role: boolean
      authenticated_get_user_role: boolean
      service_token_table_select: boolean
      service_acquire_rpc: boolean
    }>(`
      SELECT
        (
          SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN (
              'update_updated_at_column', 'update_shipment_external_updated_at',
              'check_operator_profile_update', 'update_user_role_protected',
              'toggle_user_active_protected'
            )
            AND NOT (p.proconfig @> ARRAY['search_path=""'])
        )::text AS mutable_targets,
        has_function_privilege('anon', 'public.get_user_role()', 'EXECUTE') AS anon_get_user_role,
        has_function_privilege('authenticated', 'public.get_user_role()', 'EXECUTE') AS authenticated_get_user_role,
        has_table_privilege('service_role', 'public.provider_token_cache', 'SELECT') AS service_token_table_select,
        has_function_privilege(
          'service_role', 'public.acquire_token_lease(text,uuid)', 'EXECUTE'
        ) AS service_acquire_rpc
    `)
    expect(result.rows).toEqual([{
      mutable_targets: '0',
      anon_get_user_role: false,
      authenticated_get_user_role: true,
      service_token_table_select: false,
      service_acquire_rpc: true,
    }])
  })

  it('ends with exactly six scalar-subquery auth.uid policy targets', async () => {
    const result = await client.query<{ targets: string; optimized: string }>(`
      SELECT
        count(*)::text AS targets,
        count(*) FILTER (
          WHERE concat(
            pg_get_expr(policy.polqual, policy.polrelid),
            ' ',
            pg_get_expr(policy.polwithcheck, policy.polrelid)
          ) ~* 'SELECT auth\\.uid\\(\\)'
        )::text AS optimized
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
    `)
    expect(result.rows).toEqual([{ targets: '6', optimized: '6' }])
  })

  it('ends with the reviewed four-policy product catalog', async () => {
    const result = await client.query<{ policy_name: string; command: string }>(`
      SELECT policy.polname AS policy_name, policy.polcmd AS command
      FROM pg_policy policy
      JOIN pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'product'
      ORDER BY policy.polname
    `)
    expect(result.rows).toEqual([
      { policy_name: 'product_delete_admin', command: 'd' },
      { policy_name: 'product_insert_admin', command: 'a' },
      { policy_name: 'product_select_admin_or_operator', command: 'r' },
      { policy_name: 'product_update_admin', command: 'w' },
    ])
  })
})
