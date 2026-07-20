import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type QueryResultRow } from 'pg'
import { readFileSync } from 'node:fs'
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

const ids = {
  adminRole: '11000000-0000-0000-0000-000000000001',
  operatorRole: '11000000-0000-0000-0000-000000000002',
  admin: '21000000-0000-0000-0000-000000000001',
  secondAdmin: '21000000-0000-0000-0000-000000000002',
  operator: '21000000-0000-0000-0000-000000000003',
  disabled: '21000000-0000-0000-0000-000000000004',
  newUser: '21000000-0000-0000-0000-000000000005',
} as const

const SETUP_SQL = String.raw`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

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

CREATE TABLE public.role (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name IN ('admin', 'operator'))
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.role(id),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_external_ref (
  id uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_external_item (
  id uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_shipment_external_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.name
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND p.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  operator_role_id uuid;
BEGIN
  SELECT id INTO operator_role_id
  FROM public.role
  WHERE name = 'operator';

  INSERT INTO public.profiles (id, display_name, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    operator_role_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_role_protected(uuid, uuid, uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN RETURN; END; $$;

CREATE OR REPLACE FUNCTION public.toggle_user_active_protected(uuid, boolean, uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN RETURN; END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tg_shipment_external_ref_updated_at
  BEFORE UPDATE ON public.shipment_external_ref
  FOR EACH ROW EXECUTE FUNCTION public.update_shipment_external_updated_at();

CREATE TRIGGER tg_shipment_external_item_updated_at
  BEFORE UPDATE ON public.shipment_external_item
  FOR EACH ROW EXECUTE FUNCTION public.update_shipment_external_updated_at();

INSERT INTO public.role (id, name) VALUES
  ('${ids.adminRole}', 'admin'),
  ('${ids.operatorRole}', 'operator');

INSERT INTO auth.users (id, email) VALUES
  ('${ids.admin}', 'admin@example.test'),
  ('${ids.secondAdmin}', 'admin2@example.test'),
  ('${ids.operator}', 'operator@example.test'),
  ('${ids.disabled}', 'disabled@example.test');

UPDATE public.profiles SET role_id = '${ids.adminRole}'
WHERE id IN ('${ids.admin}', '${ids.secondAdmin}');
UPDATE public.profiles SET is_active = false WHERE id = '${ids.disabled}';

ALTER TABLE public.role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Supabase's existing table grants include UPDATE. The RPC's historical
-- JOIN ... FOR UPDATE locks the joined role row as well as profiles, so the
-- fixture must mirror that current grant even though RLS still denies role DML.
GRANT SELECT, UPDATE ON public.role TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

CREATE POLICY role_admin_all ON public.role
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY role_operator_select ON public.role
  FOR SELECT TO authenticated USING (public.get_user_role() = 'operator');
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY profiles_own_select ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_operator_own_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'operator' AND auth.uid() = id)
  WITH CHECK (public.get_user_role() = 'operator' AND auth.uid() = id);

INSERT INTO public.shipment_external_ref (id)
VALUES ('31000000-0000-0000-0000-000000000001');
INSERT INTO public.shipment_external_item (id)
VALUES ('31000000-0000-0000-0000-000000000002');
`

function migrationSql(number: number, name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'supabase', 'migrations', `${number.toString().padStart(5, '0')}_${name}.sql`),
    'utf8',
  )
}

async function queryAs<T extends QueryResultRow>(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  await client.query('BEGIN')
  try {
    await client.query(`SET LOCAL ROLE ${role}`)
    if (userId !== null) {
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
    }
    const result = await client.query<T>(sql, [...values])
    await client.query('ROLLBACK')
    return result.rows
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  }
}

describe('OPT-5 Migration 00049 PostgreSQL privilege contract', () => {
  beforeAll(async () => {
    await client.connect()
    await client.query(SETUP_SQL)
    await client.query(migrationSql(25, 'rpc_caller_identity_binding'))
    await client.query(migrationSql(40, 'golucky_token_cache'))

    // Supabase grants service_role direct table privileges by default. Mirror
    // the true remote preflight so 00049 proves it removes those privileges.
    await client.query('GRANT ALL PRIVILEGES ON public.provider_token_cache TO service_role')
    await client.query(migrationSql(49, 'database_least_privilege_hardening'))
  }, 30_000)

  afterAll(async () => {
    await client.end()
  })

  it('pins the five target search paths without changing SECURITY mode', async () => {
    const result = await client.query<{
      proname: string
      prosecdef: boolean
      proconfig: string[] | null
    }>(`
      SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'update_updated_at_column', 'update_shipment_external_updated_at',
          'check_operator_profile_update', 'update_user_role_protected',
          'toggle_user_active_protected'
        )
      ORDER BY p.proname
    `)

    expect(result.rows).toHaveLength(5)
    for (const row of result.rows) {
      expect(row.prosecdef, row.proname).toBe(false)
      expect(row.proconfig, row.proname).toEqual(['search_path=""'])
    }
  })

  it('keeps get_user_role definer available only to authenticated', async () => {
    const result = await client.query<{
      authenticated_execute: boolean
      anon_execute: boolean
      service_execute: boolean
      is_definer: boolean
    }>(`
      SELECT
        has_function_privilege('authenticated', 'public.get_user_role()', 'EXECUTE') AS authenticated_execute,
        has_function_privilege('anon', 'public.get_user_role()', 'EXECUTE') AS anon_execute,
        has_function_privilege('service_role', 'public.get_user_role()', 'EXECUTE') AS service_execute,
        (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.get_user_role()'::regprocedure) AS is_definer
    `)
    expect(result.rows[0]).toEqual({
      authenticated_execute: true,
      anon_execute: false,
      service_execute: false,
      is_definer: true,
    })
  })

  it('makes trigger functions non-callable while preserving trigger execution', async () => {
    const result = await client.query<{ proname: string; role_name: string; can_execute: boolean }>(`
      SELECT p.proname, r.role_name,
        has_function_privilege(r.role_name, p.oid, 'EXECUTE') AS can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'handle_new_user', 'update_updated_at_column',
          'update_shipment_external_updated_at', 'check_operator_profile_update'
        )
      ORDER BY p.proname, r.role_name
    `)
    expect(result.rows).toHaveLength(12)
    expect(result.rows.every((row) => row.can_execute === false)).toBe(true)

    await client.query(
      'INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
      [ids.newUser, 'new@example.test', { display_name: 'New Operator' }],
    )
    const profile = await client.query<{ display_name: string; role_id: string }>(
      'SELECT display_name, role_id::text FROM public.profiles WHERE id = $1',
      [ids.newUser],
    )
    expect(profile.rows).toEqual([{ display_name: 'New Operator', role_id: ids.operatorRole }])
  })

  it('keeps both user-management RPCs authenticated-only invokers', async () => {
    const result = await client.query<{
      proname: string
      prosecdef: boolean
      authenticated_execute: boolean
      anon_execute: boolean
      service_execute: boolean
    }>(`
      SELECT p.proname, p.prosecdef,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('update_user_role_protected', 'toggle_user_active_protected')
      ORDER BY p.proname
    `)
    expect(result.rows).toHaveLength(2)
    for (const row of result.rows) {
      expect(row.prosecdef, row.proname).toBe(false)
      expect(row.authenticated_execute, row.proname).toBe(true)
      expect(row.anon_execute, row.proname).toBe(false)
      expect(row.service_execute, row.proname).toBe(false)
    }
  })

  it('allows an active Admin RPC and rejects Operator, disabled, mismatched and anon callers', async () => {
    await expect(queryAs(
      'authenticated', ids.admin,
      'SELECT public.update_user_role_protected($1, $2, $3)',
      [ids.operator, ids.operatorRole, ids.admin],
    )).resolves.toHaveLength(1)

    await expect(queryAs(
      'authenticated', ids.operator,
      'SELECT public.update_user_role_protected($1, $2, $3)',
      [ids.secondAdmin, ids.operatorRole, ids.operator],
    )).rejects.toThrow()

    await expect(queryAs(
      'authenticated', ids.disabled,
      'SELECT public.toggle_user_active_protected($1, $2, $3)',
      [ids.operator, false, ids.disabled],
    )).rejects.toThrow()

    await expect(queryAs(
      'authenticated', ids.admin,
      'SELECT public.toggle_user_active_protected($1, $2, $3)',
      [ids.operator, false, ids.secondAdmin],
    )).rejects.toThrow()

    await expect(queryAs(
      'anon', null,
      'SELECT public.update_user_role_protected($1, $2, $3)',
      [ids.operator, ids.operatorRole, ids.admin],
    )).rejects.toThrow(/permission denied/i)
  })

  it('keeps the operator profile trigger effective with an empty search_path', async () => {
    await expect(queryAs(
      'authenticated', ids.operator,
      'UPDATE public.profiles SET role_id = $1 WHERE id = $2',
      [ids.adminRole, ids.operator],
    )).rejects.toThrow(/不允许修改自己的角色/)
  })

  it('keeps timestamp triggers functional after removing direct EXECUTE', async () => {
    const oldTime = '2000-01-01T00:00:00.000Z'
    await client.query('UPDATE public.profiles SET updated_at = $1 WHERE id = $2', [oldTime, ids.admin])
    const profile = await client.query<{ updated_at: Date }>(
      'SELECT updated_at FROM public.profiles WHERE id = $1', [ids.admin],
    )
    expect(profile.rows[0].updated_at.toISOString()).not.toBe(oldTime)

    await client.query(
      'UPDATE public.shipment_external_ref SET updated_at = $1 WHERE id = $2',
      [oldTime, '31000000-0000-0000-0000-000000000001'],
    )
    const external = await client.query<{ updated_at: Date }>(
      'SELECT updated_at FROM public.shipment_external_ref WHERE id = $1',
      ['31000000-0000-0000-0000-000000000001'],
    )
    expect(external.rows[0].updated_at.toISOString()).not.toBe(oldTime)
  })

  it('removes direct token-cache table access but preserves service lease RPC access', async () => {
    const privileges = await client.query<{
      direct_select: boolean
      direct_insert: boolean
      acquire_execute: boolean
      authenticated_acquire: boolean
      anon_acquire: boolean
    }>(`
      SELECT
        has_table_privilege('service_role', 'public.provider_token_cache', 'SELECT') AS direct_select,
        has_table_privilege('service_role', 'public.provider_token_cache', 'INSERT') AS direct_insert,
        has_function_privilege('service_role', 'public.acquire_token_lease(text,uuid)', 'EXECUTE') AS acquire_execute,
        has_function_privilege('authenticated', 'public.acquire_token_lease(text,uuid)', 'EXECUTE') AS authenticated_acquire,
        has_function_privilege('anon', 'public.acquire_token_lease(text,uuid)', 'EXECUTE') AS anon_acquire
    `)
    expect(privileges.rows[0]).toEqual({
      direct_select: false,
      direct_insert: false,
      acquire_execute: true,
      authenticated_acquire: false,
      anon_acquire: false,
    })

    const lease = await queryAs<{ result: Record<string, unknown> }>(
      'service_role', null,
      'SELECT public.acquire_token_lease($1, $2) AS result',
      ['golucky', '41000000-0000-0000-0000-000000000001'],
    )
    expect(lease[0].result.action).toBe('first_time')

    await expect(queryAs(
      'service_role', null,
      'SELECT * FROM public.provider_token_cache',
    )).rejects.toThrow(/permission denied/i)
  })

  it('keeps provider_token_cache RLS enabled with no ordinary-user policies', async () => {
    const result = await client.query<{ relrowsecurity: boolean; policies: string }>(`
      SELECT c.relrowsecurity,
        (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'provider_token_cache')::text AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'provider_token_cache'
    `)
    expect(result.rows).toEqual([{ relrowsecurity: true, policies: '0' }])
  })
})
