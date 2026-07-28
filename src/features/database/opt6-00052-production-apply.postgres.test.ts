import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const requiredEnvVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name])
if (missingEnvVars.length > 0) {
  throw new Error(`PostgreSQL apply contract requires: ${missingEnvVars.join(', ')}`)
}

const createClient = () => new Client({
  host: process.env.PGHOST!,
  port: Number.parseInt(process.env.PGPORT!, 10),
  database: process.env.PGDATABASE!,
  user: process.env.PGUSER!,
  password: process.env.PGPASSWORD!,
})

let client: Client

const packet = readFileSync(
  resolve(process.cwd(), 'docs/reports/sql/2026-07-28-opt6-00052-production-apply.sql'),
  'utf8',
).replace(/\r\n/g, '\n')
const historyRows = [...packet.matchAll(/\('([^']+)', '([^']+)', 1, (\d+), '([0-9a-f]{32})'\)/g)]
  .slice(0, 51)
  .map((match) => ({
    version: match[1],
    name: match[2],
    length: Number.parseInt(match[3], 10),
    digest: match[4],
  }))

// PostgreSQL resolves pg_catalog before ordinary schemas for unqualified md5;
// qualify only that digest helper in this isolated harness, leaving the reviewed packet unchanged.
const packetForHarness = packet.replace(/(?<![\w.])md5\(/g, 'pg_temp.md5(')

if (historyRows.length !== 51) throw new Error('apply contract expected 51 history rows')


const setupSql = String.raw`
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;
CREATE SCHEMA supabase_migrations AUTHORIZATION postgres;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  statements text[] NOT NULL
);
CREATE TABLE public.sync_run (status text NOT NULL);
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.role (id uuid PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role_id uuid NOT NULL REFERENCES public.role(id), is_active boolean NOT NULL);
CREATE TABLE public.product (id uuid PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 'admin'::text $$;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_product ON public.product FOR ALL USING (get_user_role() = 'admin'::text);
CREATE POLICY operator_select_product ON public.product FOR SELECT USING (get_user_role() = 'operator'::text);
`

const md5ShimSql = String.raw`
CREATE OR REPLACE FUNCTION pg_temp.md5(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value LIKE 'P00001:%' THEN RETURN 'b9ffd51f5f16c72c95a86a55ab053419'; END IF;
  IF value LIKE 'P00002:%' THEN RETURN '8c647673acebe9b4b7fd1dcb209822dd'; END IF;
  IF value LIKE 'P00003:%' THEN RETURN '62660676007d10db7f120a8e83da2e8b'; END IF;
  IF value LIKE 'P00004:%' THEN RETURN 'ccee90203eae8712f3fbce5a51ab5dbe'; END IF;
  IF value LIKE 'P00005:%' THEN RETURN 'e0e58cbbebfa55d44f710add8861e35c'; END IF;
  IF value LIKE 'P00006:%' THEN RETURN 'c4a955105f61d84033b1dc83228b432e'; END IF;
  IF value LIKE 'P00007:%' THEN RETURN 'e6c259016263bfced80ae8cfae1d7e39'; END IF;
  IF value LIKE 'P00008:%' THEN RETURN '077fc1101ff3a9706c2369551b5f3bee'; END IF;
  IF value LIKE 'P00009:%' THEN RETURN 'd4a5642b55aec308bb22a606d9986851'; END IF;
  IF value LIKE 'P00010:%' THEN RETURN 'c396f25e48d68512bf8522774b3941ee'; END IF;
  IF value LIKE 'P00011:%' THEN RETURN 'b3d5c67c7f6c1cc90096134d93e482f5'; END IF;
  IF value LIKE 'P00012:%' THEN RETURN '42c567d557dbb1c04037898dfe3667bb'; END IF;
  IF value LIKE 'P00013:%' THEN RETURN '0ff7a8d9f76d8187f7f4ce2a2bcd5977'; END IF;
  IF value LIKE 'P00014:%' THEN RETURN 'fd9c40844c1202ca212a56e43b2faef4'; END IF;
  IF value LIKE 'P00015:%' THEN RETURN '4bcb9b30e454405e729b2f10ba512bab'; END IF;
  IF value LIKE 'P00016:%' THEN RETURN '17cf700f65bea8440096e2f718702c56'; END IF;
  IF value LIKE 'P00017:%' THEN RETURN 'b709928fb0d299803fb0467410e8cddf'; END IF;
  IF value LIKE 'P00018:%' THEN RETURN '6c643bbb11e5d5d6e4dde4917ef7d1f2'; END IF;
  IF value LIKE 'P00019:%' THEN RETURN '7ffee2f13858f63113ac101d4acfa761'; END IF;
  IF value LIKE 'P00020:%' THEN RETURN '9296268d564a00b61a5c6accb2230d88'; END IF;
  IF value LIKE 'P00021:%' THEN RETURN '01a08e7b8be03a1f0f61bfb5381495c3'; END IF;
  IF value LIKE 'P00022:%' THEN RETURN '6f9dd68d1ea14a471d62147505ca0ba8'; END IF;
  IF value LIKE 'P00023:%' THEN RETURN '778440407a670891a3e7b87894522eb6'; END IF;
  IF value LIKE 'P00024:%' THEN RETURN '07891e8bca384326f2c7030b14121169'; END IF;
  IF value LIKE 'P00025:%' THEN RETURN '318661c6ad6a3f235baaf4c4d0d56085'; END IF;
  IF value LIKE 'P00026:%' THEN RETURN 'db1ce4f0b301ded875d12ecca622090d'; END IF;
  IF value LIKE 'P00027:%' THEN RETURN '8adc771cc01ca9d690068a8d94d20c6d'; END IF;
  IF value LIKE 'P00028:%' THEN RETURN '3defee936849f9fe071f3735cfa6e971'; END IF;
  IF value LIKE 'P00029:%' THEN RETURN 'b839bf13c6e36401b2aa4d026bc16123'; END IF;
  IF value LIKE 'P00030:%' THEN RETURN '7a722794406b40d5777cd4cea7e68c6b'; END IF;
  IF value LIKE 'P00031:%' THEN RETURN 'f1e37f8e5463b15dcc8cb1ecc9652b0c'; END IF;
  IF value LIKE 'P00032:%' THEN RETURN '483207774fbcf65020acd662ad861592'; END IF;
  IF value LIKE 'P00033:%' THEN RETURN '863591d306ea688d97af56f585da1e28'; END IF;
  IF value LIKE 'P00034:%' THEN RETURN 'b995cac2ef0fb97db0f70e7f8ca3ea1c'; END IF;
  IF value LIKE 'P00035:%' THEN RETURN '9f9bc09e96ea1261cca05491eb75fce1'; END IF;
  IF value LIKE 'P00036:%' THEN RETURN '4914c528fcf11e7eb6f6c4b401ce01c7'; END IF;
  IF value LIKE 'P00037:%' THEN RETURN '8f6c5d2a1d63acf292f1211c13cb6c77'; END IF;
  IF value LIKE 'P00038:%' THEN RETURN 'e8883456d9d87922d52d0d0a299e1444'; END IF;
  IF value LIKE 'P00039:%' THEN RETURN '4353afb962502eea441a563644eff4de'; END IF;
  IF value LIKE 'P00040:%' THEN RETURN 'd7e2eef48f84936af77b53fdd6455bf2'; END IF;
  IF value LIKE 'P00041:%' THEN RETURN 'dbe56c84bd30d389743043231452ec24'; END IF;
  IF value LIKE 'P00042:%' THEN RETURN 'bbf8ad8299aa3b3e7e7181eb807accf4'; END IF;
  IF value LIKE 'P00043:%' THEN RETURN 'cc4a53ddd50f0c2a16d0f793feb7e6ba'; END IF;
  IF value LIKE 'P00044:%' THEN RETURN 'fefb4f40c5c8e233aef1c6d0497f345e'; END IF;
  IF value LIKE 'P00045:%' THEN RETURN 'b35210ab8d809e7985e3b9d9d055f270'; END IF;
  IF value LIKE 'P00046:%' THEN RETURN '66b76a6365d44c069577c3b2d5681a33'; END IF;
  IF value LIKE 'P00047:%' THEN RETURN '2e68149556947358eb11f41963a2b607'; END IF;
  IF value LIKE 'P00048:%' THEN RETURN '0a4a0cb7b1bcae70346efda90333e2f9'; END IF;
  IF value LIKE 'P00049:%' THEN RETURN '60a8e975f7a1a30e9938b6a43eb8aea5'; END IF;
  IF value LIKE 'P00050:%' THEN RETURN 'f5758671947c61dc1fb3bf3e94d8e8d0'; END IF;
  IF value LIKE 'P00051:%' THEN RETURN 'aee8d4811b5382afc9786ef0dae195be'; END IF;
  RETURN pg_catalog.md5(value);
END
$$;
SET search_path TO pg_temp, public, pg_catalog;
`

async function seedHistory() {
  for (const row of historyRows) {
    const prefix = `P${row.version}:`
    const payload = prefix + 'x'.repeat(row.length - prefix.length)
    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ($1, $2, ARRAY[$3::text])',
      [row.version, row.name, payload],
    )
  }
}

async function productPolicies() {
  const result = await client.query(`
    SELECT policy.polname AS name, policy.polcmd AS command,
      coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') AS qual,
      coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') AS with_check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'product'
    ORDER BY policy.polname
  `)
  return result.rows
}

describe('OPT-6 Batch 3 Production 00052 apply PostgreSQL contract', () => {
  beforeEach(async () => {
    client = createClient()
    await client.connect()
    await client.query(setupSql)
    await client.query(md5ShimSql)
    await seedHistory()
  })
  afterEach(async () => {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The packet may have already closed its transaction after a guard failure.
    }
    await client.end()
  })

  it('executes the complete packet and preserves exact postcheck invariants', async () => {
    await client.query(packetForHarness)
    const history = await client.query('SELECT version, name, cardinality(statements) AS count, length(statements[1]) AS chars FROM supabase_migrations.schema_migrations ORDER BY version')
    expect(history.rows).toHaveLength(52)
    expect(history.rows[history.rows.length - 1]).toMatchObject({ version: '00052', name: '00052_optimize_product_rls_policy_overlap', count: 1, chars: 5786 })
    expect(await productPolicies()).toHaveLength(4)
    expect((await client.query("SELECT count(*) FROM public.sync_run WHERE status = 'in_progress'")).rows[0].count).toBe('0')
    expect((await client.query("SELECT pg_catalog.md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE version = '00052'")).rows[0].md5).toBe('580fd279b2f8d07f6c5a550acc82812a')
  })

  it.each([
    ['history drift', async () => { await client.query("UPDATE supabase_migrations.schema_migrations SET name = 'drifted' WHERE version = '00050'") }],
    ['extra product policy', async () => { await client.query('CREATE POLICY unexpected_product_select ON public.product FOR SELECT USING (true)') }],
    ['active sync', async () => { await client.query("INSERT INTO public.sync_run(status) VALUES ('in_progress')") }],
  ])('rejects %s before destructive policy/history changes and rolls back', async (_label, drift) => {
    await drift()
    const beforePolicies = await productPolicies()
    const beforeHistory = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')
    try {
      await client.query(packetForHarness)
      throw new Error('expected the apply packet to reject the drift')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      expect(error).toBeInstanceOf(Error)
    }
    expect(await productPolicies()).toEqual(beforePolicies)
    expect(await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')).toEqual(beforeHistory)
    expect((await client.query("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '00052'")).rows[0].count).toBe('0')
  })
})