import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/00051_optimize_role_rls_policy_overlap.sql'),
  'utf8',
)

const ids = {
  adminRole: '31000000-0000-0000-0000-000000000001',
  operatorRole: '31000000-0000-0000-0000-000000000002',
  admin: '41000000-0000-0000-0000-000000000001',
  operator: '41000000-0000-0000-0000-000000000002',
  disabled: '41000000-0000-0000-0000-000000000003',
} as const

const setupSql = String.raw`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE authenticated FROM anon;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.role (id uuid PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  role_id uuid NOT NULL REFERENCES public.role(id),
  is_active boolean NOT NULL
);

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT role.name
  FROM public.profiles profile
  JOIN public.role role ON role.id = profile.role_id
  WHERE profile.id = auth.uid() AND profile.is_active
$$;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role TO anon, authenticated;

INSERT INTO public.role (id, name) VALUES
  ('${ids.adminRole}', 'admin'),
  ('${ids.operatorRole}', 'operator'),
  ('51000000-0000-0000-0000-000000000010', 'temporary');
INSERT INTO auth.users (id) VALUES
  ('${ids.admin}'), ('${ids.operator}'), ('${ids.disabled}');
INSERT INTO public.profiles (id, role_id, is_active) VALUES
  ('${ids.admin}', '${ids.adminRole}', true),
  ('${ids.operator}', '${ids.operatorRole}', true),
  ('${ids.disabled}', '${ids.operatorRole}', false);

ALTER TABLE public.role ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_role" ON public.role
  FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "operator_select_role" ON public.role
  FOR SELECT USING (get_user_role() = 'operator');
`

type Attempt = { ok: boolean; rowCount: number | null; code: string | null }

async function attempt(
  databaseRole: 'anon' | 'authenticated',
  userId: string | null,
  statement: string,
): Promise<Attempt> {
  await client.query('BEGIN')
  try {
    await client.query(`SET LOCAL ROLE ${databaseRole}`)
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
    const result = await client.query(statement)
    return { ok: true, rowCount: result.rowCount, code: null }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null
    return { ok: false, rowCount: null, code }
  } finally {
    await client.query('ROLLBACK')
  }
}

async function matrixFor(userId: string | null, databaseRole: 'anon' | 'authenticated') {
  return {
    select: await attempt(databaseRole, userId, 'SELECT * FROM public.role ORDER BY name'),
    insert: await attempt(
      databaseRole,
      userId,
      "INSERT INTO public.role (id, name) VALUES (md5(random()::text)::uuid, 'ephemeral')",
    ),
    update: await attempt(databaseRole, userId, "UPDATE public.role SET name = 'temporary-updated' WHERE name = 'temporary'"),
    delete: await attempt(databaseRole, userId, "DELETE FROM public.role WHERE name = 'temporary'"),
  }
}

async function snapshotMatrix() {
  return {
    anon: await matrixFor(null, 'anon'),
    admin: await matrixFor(ids.admin, 'authenticated'),
    operator: await matrixFor(ids.operator, 'authenticated'),
    disabled: await matrixFor(ids.disabled, 'authenticated'),
  }
}

async function rolePolicyCatalog() {
  const result = await client.query(`
    SELECT policy.polname AS policy_name, policy.polpermissive, policy.polroles::text AS roles,
      policy.polcmd, coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') AS qual,
      coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'role'
    ORDER BY policy.polname
  `)
  return result.rows
}

describe('OPT-6 Migration 00051 PostgreSQL role-policy behavior contract', () => {
  beforeAll(async () => {
    await client.connect()
  })

  beforeEach(async () => {
    await client.query(setupSql)
  })

  afterAll(async () => {
    await client.end()
  })

  it('preserves anonymous, Admin, Operator, and disabled-user read/write behavior', async () => {
    const before = await snapshotMatrix()
    expect(before).toEqual({
      anon: {
        select: { ok: true, rowCount: 0, code: null },
        insert: { ok: false, rowCount: null, code: '42501' },
        update: { ok: true, rowCount: 0, code: null },
        delete: { ok: true, rowCount: 0, code: null },
      },
      admin: {
        select: { ok: true, rowCount: 3, code: null },
        insert: { ok: true, rowCount: 1, code: null },
        update: { ok: true, rowCount: 1, code: null },
        delete: { ok: true, rowCount: 1, code: null },
      },
      operator: {
        select: { ok: true, rowCount: 3, code: null },
        insert: { ok: false, rowCount: null, code: '42501' },
        update: { ok: true, rowCount: 0, code: null },
        delete: { ok: true, rowCount: 0, code: null },
      },
      disabled: {
        select: { ok: true, rowCount: 0, code: null },
        insert: { ok: false, rowCount: null, code: '42501' },
        update: { ok: true, rowCount: 0, code: null },
        delete: { ok: true, rowCount: 0, code: null },
      },
    })

    await client.query(migration)
    const after = await snapshotMatrix()
    expect(after).toEqual(before)
    expect(await rolePolicyCatalog()).toHaveLength(4)
  })

  it.each([
    [
      'an extra permissive policy',
      'CREATE POLICY "unexpected_role_select" ON public.role FOR SELECT USING (true)',
    ],
    [
      'the complete operator predicate',
      "ALTER POLICY \"operator_select_role\" ON public.role USING (get_user_role() = 'admin')",
    ],
  ])('rejects %s before dropping the reviewed baseline', async (_label, driftSql) => {
    await client.query(driftSql)
    const before = await rolePolicyCatalog()

    await expect(client.query(migration)).rejects.toThrow('OPT-6 role policy baseline drift')

    expect(await rolePolicyCatalog()).toEqual(before)
  })
})
