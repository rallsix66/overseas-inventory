import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
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
  operator: '21000000-0000-0000-0000-000000000002',
  otherOperator: '21000000-0000-0000-0000-000000000003',
  disabled: '21000000-0000-0000-0000-000000000004',
} as const

const SETUP_SQL = String.raw`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.role (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.role(id),
  is_active boolean NOT NULL
);
CREATE TABLE public.user_variant_preference (
  id integer PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.user_warehouses (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  warehouse_id uuid NOT NULL,
  PRIMARY KEY (user_id, warehouse_id)
);

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT role.name
  FROM public.profiles profile
  JOIN public.role role ON role.id = profile.role_id
  WHERE profile.id = auth.uid() AND profile.is_active
$$;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_variant_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_warehouses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_variant_preference TO authenticated;
GRANT SELECT ON public.user_warehouses TO authenticated;
GRANT SELECT ON public.profiles, public.user_variant_preference, public.user_warehouses TO anon;

CREATE POLICY "admin_all_profiles" ON public.profiles
  FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY "operator_select_profiles" ON public.profiles
  FOR SELECT USING (public.get_user_role() = 'operator');
CREATE POLICY "operator_update_own_profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id AND public.get_user_role() = 'operator')
  WITH CHECK (auth.uid() = id AND public.get_user_role() = 'operator');
CREATE POLICY "user_read_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "admin_all_preferences" ON public.user_variant_preference
  FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY "user_select_own_preferences" ON public.user_variant_preference
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_insert_own_preferences" ON public.user_variant_preference
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_delete_own_preferences" ON public.user_variant_preference
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "admin_all_user_warehouses" ON public.user_warehouses
  FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY "operator_select_own_user_warehouses" ON public.user_warehouses
  FOR SELECT USING (auth.uid() = user_id);

INSERT INTO public.role (id, name) VALUES
  ('${ids.adminRole}', 'admin'),
  ('${ids.operatorRole}', 'operator');
INSERT INTO auth.users (id) VALUES
  ('${ids.admin}'), ('${ids.operator}'), ('${ids.otherOperator}'), ('${ids.disabled}');
INSERT INTO public.profiles (id, display_name, role_id, is_active) VALUES
  ('${ids.admin}', 'Admin', '${ids.adminRole}', true),
  ('${ids.operator}', 'Operator', '${ids.operatorRole}', true),
  ('${ids.otherOperator}', 'Other', '${ids.operatorRole}', true),
  ('${ids.disabled}', 'Disabled', '${ids.operatorRole}', false);
INSERT INTO public.user_variant_preference (id, user_id) VALUES
  (1, '${ids.admin}'), (2, '${ids.operator}'),
  (3, '${ids.otherOperator}'), (4, '${ids.disabled}');
INSERT INTO public.user_warehouses (user_id, warehouse_id) VALUES
  ('${ids.admin}', '31000000-0000-0000-0000-000000000001'),
  ('${ids.operator}', '31000000-0000-0000-0000-000000000001'),
  ('${ids.otherOperator}', '31000000-0000-0000-0000-000000000002'),
  ('${ids.disabled}', '31000000-0000-0000-0000-000000000003');
`

type MatrixRow = {
  profiles: string
  ownProfile: string
  preferences: string
  ownPreferences: string
  warehouses: string
  ownWarehouses: string
  ownProfileUpdates: string
}

async function readMatrix(role: 'anon' | 'authenticated', userId?: string): Promise<MatrixRow> {
  await client.query('BEGIN')
  try {
    await client.query(`SET LOCAL ROLE ${role}`)
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
    const updated = role === 'authenticated'
      ? await client.query(
          'UPDATE public.profiles SET display_name = display_name WHERE id = $1',
          [userId ?? '00000000-0000-0000-0000-000000000000'],
        )
      : { rowCount: 0 }
    const result = await client.query<MatrixRow>(`
      SELECT
        (SELECT count(*) FROM public.profiles)::text AS profiles,
        (SELECT count(*) FROM public.profiles WHERE id = $1)::text AS "ownProfile",
        (SELECT count(*) FROM public.user_variant_preference)::text AS preferences,
        (SELECT count(*) FROM public.user_variant_preference WHERE user_id = $1)::text AS "ownPreferences",
        (SELECT count(*) FROM public.user_warehouses)::text AS warehouses,
        (SELECT count(*) FROM public.user_warehouses WHERE user_id = $1)::text AS "ownWarehouses"
    `, [userId ?? '00000000-0000-0000-0000-000000000000'])
    return { ...result.rows[0], ownProfileUpdates: String(updated.rowCount ?? 0) }
  } finally {
    await client.query('ROLLBACK')
  }
}

async function snapshotMatrix(): Promise<Record<string, MatrixRow>> {
  return {
    anon: await readMatrix('anon'),
    admin: await readMatrix('authenticated', ids.admin),
    operator: await readMatrix('authenticated', ids.operator),
    otherOperator: await readMatrix('authenticated', ids.otherOperator),
    disabled: await readMatrix('authenticated', ids.disabled),
  }
}

describe('OPT-6 Migration 00050 PostgreSQL behavior contract', () => {
  beforeAll(async () => {
    await client.connect()
    await client.query(SETUP_SQL)
  })

  afterAll(async () => {
    await client.end()
  })

  it('preserves the complete identity and cross-user RLS matrix', async () => {
    const before = await snapshotMatrix()
    expect(before).toEqual({
      anon: {
        profiles: '0', ownProfile: '0', preferences: '0', ownPreferences: '0',
        warehouses: '0', ownWarehouses: '0', ownProfileUpdates: '0',
      },
      admin: {
        profiles: '4', ownProfile: '1', preferences: '4', ownPreferences: '1',
        warehouses: '4', ownWarehouses: '1', ownProfileUpdates: '1',
      },
      operator: {
        profiles: '4', ownProfile: '1', preferences: '1', ownPreferences: '1',
        warehouses: '1', ownWarehouses: '1', ownProfileUpdates: '1',
      },
      otherOperator: {
        profiles: '4', ownProfile: '1', preferences: '1', ownPreferences: '1',
        warehouses: '1', ownWarehouses: '1', ownProfileUpdates: '1',
      },
      disabled: {
        profiles: '1', ownProfile: '1', preferences: '1', ownPreferences: '1',
        warehouses: '1', ownWarehouses: '1', ownProfileUpdates: '0',
      },
    })

    await client.query(readFileSync(
      resolve(process.cwd(), 'supabase/migrations/00050_optimize_auth_rls_initplan.sql'),
      'utf8',
    ))

    expect(await snapshotMatrix()).toEqual(before)
  })
})
