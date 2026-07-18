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
  adminRole: '10000000-0000-0000-0000-000000000001',
  operatorRole: '10000000-0000-0000-0000-000000000002',
  admin: '20000000-0000-0000-0000-000000000001',
  operator: '20000000-0000-0000-0000-000000000002',
  disabled: '20000000-0000-0000-0000-000000000003',
  warehouseA: '30000000-0000-0000-0000-000000000001',
  warehouseB: '30000000-0000-0000-0000-000000000002',
  product: '40000000-0000-0000-0000-000000000001',
  sharedVariant: '50000000-0000-0000-0000-000000000001',
  warehouseBVariant: '50000000-0000-0000-0000-000000000002',
  archivedVariant: '50000000-0000-0000-0000-000000000003',
  shipmentA: '60000000-0000-0000-0000-000000000001',
  shipmentB: '60000000-0000-0000-0000-000000000002',
} as const

const BASE_SCHEMA_SQL = String.raw`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.role (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name IN ('admin', 'operator'))
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.role(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.product (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  safety_stock integer NOT NULL DEFAULT 0
);

CREATE TABLE public.product_variant (
  id uuid PRIMARY KEY,
  product_id uuid REFERENCES public.product(id),
  sku text NOT NULL,
  country text NOT NULL,
  name text NOT NULL,
  match_status text NOT NULL DEFAULT 'unmatched'
);

CREATE TABLE public.warehouse (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  country text NOT NULL,
  type text NOT NULL CHECK (type IN ('domestic', 'overseas')),
  is_active boolean NOT NULL DEFAULT true,
  lead_time_days integer
);

CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variant(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouse(id),
  quantity integer NOT NULL DEFAULT 0,
  daily_sales numeric,
  estimated_days numeric,
  UNIQUE (variant_id, warehouse_id)
);

CREATE TABLE public.shipment (
  id uuid PRIMARY KEY,
  warehouse_id uuid REFERENCES public.warehouse(id),
  status text NOT NULL,
  estimated_arrival date,
  bigseller_absorbed_at timestamptz
);

CREATE TABLE public.shipment_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipment(id),
  variant_id uuid NOT NULL REFERENCES public.product_variant(id),
  quantity integer NOT NULL,
  warehoused_quantity integer NOT NULL DEFAULT 0
);

CREATE TABLE public.user_variant_preference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  variant_id uuid NOT NULL REFERENCES public.product_variant(id),
  preference_type text NOT NULL CHECK (preference_type IN ('archived', 'favorited')),
  UNIQUE (user_id, variant_id, preference_type)
);

CREATE TABLE public.user_warehouses (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouse(id),
  PRIMARY KEY (user_id, warehouse_id)
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

CREATE OR REPLACE FUNCTION public.get_assigned_warehouse_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT warehouse_id
  FROM public.user_warehouses
  WHERE user_id = auth.uid();
$$;

ALTER TABLE public.role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_variant_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_admin ON public.role FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY role_operator ON public.role FOR SELECT USING (public.get_user_role() = 'operator');
CREATE POLICY profiles_admin ON public.profiles FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY profiles_operator ON public.profiles FOR SELECT USING (public.get_user_role() = 'operator');
CREATE POLICY profiles_own ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY product_admin ON public.product FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY product_operator ON public.product FOR SELECT USING (public.get_user_role() = 'operator');
CREATE POLICY variant_admin ON public.product_variant FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY variant_operator ON public.product_variant FOR SELECT USING (
  public.get_user_role() = 'operator'
  AND EXISTS (
    SELECT 1 FROM public.inventory i
    WHERE i.variant_id = product_variant.id
      AND i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  )
);
CREATE POLICY warehouse_admin ON public.warehouse FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY warehouse_operator ON public.warehouse FOR SELECT USING (
  public.get_user_role() = 'operator'
  AND id IN (SELECT public.get_assigned_warehouse_ids())
);
CREATE POLICY inventory_admin ON public.inventory FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY inventory_operator ON public.inventory FOR SELECT USING (
  public.get_user_role() = 'operator'
  AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
);
CREATE POLICY shipment_admin ON public.shipment FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY shipment_operator ON public.shipment FOR SELECT USING (
  public.get_user_role() = 'operator'
  AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
);
CREATE POLICY shipment_item_admin ON public.shipment_item FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY shipment_item_operator ON public.shipment_item FOR SELECT USING (
  public.get_user_role() = 'operator'
  AND EXISTS (
    SELECT 1 FROM public.shipment s
    WHERE s.id = shipment_item.shipment_id
      AND s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  )
);
CREATE POLICY preference_admin ON public.user_variant_preference FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY preference_own ON public.user_variant_preference FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY assignments_admin ON public.user_warehouses FOR ALL USING (public.get_user_role() = 'admin');
CREATE POLICY assignments_own ON public.user_warehouses FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_assigned_warehouse_ids() TO authenticated;
`

const SEED_SQL = `
INSERT INTO auth.users (id) VALUES
  ('${ids.admin}'), ('${ids.operator}'), ('${ids.disabled}');

INSERT INTO public.role (id, name) VALUES
  ('${ids.adminRole}', 'admin'),
  ('${ids.operatorRole}', 'operator');

INSERT INTO public.profiles (id, display_name, role_id, is_active) VALUES
  ('${ids.admin}', 'Admin', '${ids.adminRole}', true),
  ('${ids.operator}', 'Operator', '${ids.operatorRole}', true),
  ('${ids.disabled}', 'Disabled', '${ids.operatorRole}', false);

INSERT INTO public.product (id, code, name, safety_stock) VALUES
  ('${ids.product}', 'P-001', 'Test Product', 5);

INSERT INTO public.product_variant (id, product_id, sku, country, name, match_status) VALUES
  ('${ids.sharedVariant}', '${ids.product}', 'SKU-SHARED', 'TH', 'Shared Variant', 'matched'),
  ('${ids.warehouseBVariant}', '${ids.product}', 'SKU-B-ONLY', 'VN', 'Warehouse B Variant', 'matched'),
  ('${ids.archivedVariant}', '${ids.product}', 'SKU-ARCHIVED', 'TH', 'Archived Variant', 'matched');

INSERT INTO public.warehouse (id, name, country, type, is_active, lead_time_days) VALUES
  ('${ids.warehouseA}', 'Warehouse A', 'TH', 'overseas', true, 10),
  ('${ids.warehouseB}', 'Warehouse B', 'VN', 'overseas', true, 20);

INSERT INTO public.inventory (variant_id, warehouse_id, quantity, daily_sales) VALUES
  ('${ids.sharedVariant}', '${ids.warehouseA}', 10, 2),
  ('${ids.sharedVariant}', '${ids.warehouseB}', 20, 1),
  ('${ids.warehouseBVariant}', '${ids.warehouseB}', 0, 1),
  ('${ids.archivedVariant}', '${ids.warehouseA}', 5, 1);

INSERT INTO public.user_warehouses (user_id, warehouse_id) VALUES
  ('${ids.operator}', '${ids.warehouseA}'),
  ('${ids.disabled}', '${ids.warehouseA}');

INSERT INTO public.user_variant_preference (user_id, variant_id, preference_type) VALUES
  ('${ids.operator}', '${ids.archivedVariant}', 'archived');

INSERT INTO public.shipment (id, warehouse_id, status, estimated_arrival) VALUES
  ('${ids.shipmentA}', '${ids.warehouseA}', 'booking', CURRENT_DATE + 5),
  ('${ids.shipmentB}', '${ids.warehouseB}', 'departed', CURRENT_DATE + 2);

INSERT INTO public.shipment_item (shipment_id, variant_id, quantity, warehoused_quantity) VALUES
  ('${ids.shipmentA}', '${ids.sharedVariant}', 10, 0),
  ('${ids.shipmentB}', '${ids.sharedVariant}', 5, 0);
`

function migrationSql(number: number, name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'supabase', 'migrations', `${number.toString().padStart(5, '0')}_${name}.sql`),
    'utf8',
  )
}

async function queryAs<T extends QueryResultRow>(
  role: 'anon' | 'authenticated',
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Expected a JSON object')
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected a JSON array')
  }
  return value
}

describe('migrations 00041-00047 PostgreSQL replay and behavior', () => {
  beforeAll(async () => {
    await client.connect()
    await client.query(BASE_SCHEMA_SQL)

    const migrations = [
      migrationSql(41, 'replenishment_warehouse_params'),
      migrationSql(42, 'replenishment_cancellation'),
      migrationSql(43, 'forecast_stockout'),
      migrationSql(44, 'replenishment_rpcs'),
      migrationSql(45, 'product_overview_rpc'),
      migrationSql(46, 'war_room_variant_detail_rpc'),
      migrationSql(47, 'dashboard_warehouse_health_overview'),
    ]

    for (const migration of migrations) {
      await client.query(migration)
    }

    await client.query(SEED_SQL)
  }, 30_000)

  afterAll(async () => {
    await client.end()
  })

  it('replays all seven migrations and creates their columns and RPCs', async () => {
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('warehouse', 'buffer_ratio'),
          ('warehouse', 'target_cover_multiplier'),
          ('warehouse', 'updated_at'),
          ('shipment', 'cancelled_at')
        )
      ORDER BY table_name, column_name
    `)
    expect(columns.rows).toHaveLength(4)

    const functions = await client.query<{ function_name: string | null }>(`
      SELECT unnest(ARRAY[
        to_regprocedure('public.forecast_stockout(integer,numeric,integer,jsonb)')::text,
        to_regprocedure('public.get_in_transit_detail(uuid,uuid,uuid)')::text,
        to_regprocedure('public.get_replenishment_suggestions(uuid,uuid,uuid,text,text,text,boolean,integer,integer)')::text,
        to_regprocedure('public.get_product_overview(uuid,integer,integer,text,text,text)')::text,
        to_regprocedure('public.get_war_room_variant_detail(uuid,uuid)')::text,
        to_regprocedure('public.get_warehouse_health_overview(uuid)')::text
      ]) AS function_name
    `)
    expect(functions.rows.map((row) => row.function_name)).not.toContain(null)
  })

  it('keeps RPCs security-invoker and denies anon execution', async () => {
    const privileges = await client.query<{
      function_name: string
      is_security_definer: boolean
      authenticated_execute: boolean
      anon_execute: boolean
    }>(`
      SELECT p.proname AS function_name,
        p.prosecdef AS is_security_definer,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'forecast_stockout', 'get_in_transit_detail', 'get_replenishment_suggestions',
          'get_product_overview', 'get_war_room_variant_detail', 'get_warehouse_health_overview'
        )
      ORDER BY p.proname
    `)

    expect(privileges.rows).toHaveLength(6)
    for (const row of privileges.rows) {
      expect(row.is_security_definer, row.function_name).toBe(false)
      expect(row.authenticated_execute, row.function_name).toBe(true)
      expect(row.anon_execute, row.function_name).toBe(false)
    }
  })

  it('calculates stockout boundaries with inbound events and incomplete sales data', async () => {
    const result = await queryAs<{
      est_stockout_date: string
      effective_inbound: number
      ds_incomplete: boolean
      lead_incomplete: boolean
    }>(
      'authenticated', ids.admin,
      `SELECT * FROM public.forecast_stockout(
        10, 2, 10,
        jsonb_build_array(jsonb_build_object('eta', CURRENT_DATE + 5, 'remaining', 10))
      )`,
    )

    const expectedDate = await client.query<{ value: string }>(
      "SELECT (CURRENT_DATE + 10)::text AS value",
    )
    expect(result[0].est_stockout_date).toBe(expectedDate.rows[0].value)
    expect(result[0].effective_inbound).toBe(10)
    expect(result[0].ds_incomplete).toBe(false)
    expect(result[0].lead_incomplete).toBe(false)

    const incomplete = await queryAs<{ est_stockout_date: string | null; ds_incomplete: boolean }>(
      'authenticated', ids.admin,
      "SELECT est_stockout_date, ds_incomplete FROM public.forecast_stockout(10, NULL, 10, '[]'::jsonb)",
    )
    expect(incomplete[0]).toEqual({ est_stockout_date: null, ds_incomplete: true })

    await expect(queryAs(
      'authenticated', ids.admin,
      "SELECT * FROM public.forecast_stockout(10, 2, 10, '{}'::jsonb)",
    )).rejects.toThrow()
  })

  it('enforces base RLS row sets for all required identities', async () => {
    const adminRows = await queryAs<{ warehouse_id: string }>(
      'authenticated', ids.admin,
      'SELECT warehouse_id FROM public.inventory ORDER BY warehouse_id, variant_id',
    )
    expect(adminRows).toHaveLength(4)

    const operatorRows = await queryAs<{ warehouse_id: string }>(
      'authenticated', ids.operator,
      'SELECT warehouse_id FROM public.inventory ORDER BY warehouse_id, variant_id',
    )
    expect(operatorRows).toHaveLength(2)
    expect(new Set(operatorRows.map((row) => row.warehouse_id))).toEqual(new Set([ids.warehouseA]))

    const disabledRows = await queryAs<{ warehouse_id: string }>(
      'authenticated', ids.disabled, 'SELECT warehouse_id FROM public.inventory',
    )
    expect(disabledRows).toEqual([])

    const anonRows = await queryAs<{ warehouse_id: string }>(
      'anon', null, 'SELECT warehouse_id FROM public.inventory',
    )
    expect(anonRows).toEqual([])
  })

  it('returns only visible in-transit rows for the operator', async () => {
    const admin = await queryAs<{ result: unknown }>(
      'authenticated', ids.admin,
      'SELECT public.get_in_transit_detail($1, NULL, $2) AS result',
      [ids.admin, ids.sharedVariant],
    )
    expect(asArray(admin[0].result)).toHaveLength(2)

    const operator = await queryAs<{ result: unknown }>(
      'authenticated', ids.operator,
      'SELECT public.get_in_transit_detail($1, NULL, $2) AS result',
      [ids.operator, ids.sharedVariant],
    )
    const operatorRows = asArray(operator[0].result).map(asRecord)
    expect(operatorRows).toHaveLength(1)
    expect(operatorRows[0].warehouse_id).toBe(ids.warehouseA)
  })

  it('returns P1 suggestions from visible warehouses and excludes archived variants', async () => {
    const admin = await queryAs<{ result: unknown }>(
      'authenticated', ids.admin,
      'SELECT public.get_replenishment_suggestions($1, NULL, NULL, NULL, NULL, NULL, true, 1, 100) AS result',
      [ids.admin],
    )
    expect(asRecord(admin[0].result).total).toBe(4)

    const operator = await queryAs<{ result: unknown }>(
      'authenticated', ids.operator,
      'SELECT public.get_replenishment_suggestions($1, NULL, NULL, NULL, NULL, NULL, true, 1, 100) AS result',
      [ids.operator],
    )
    const operatorResult = asRecord(operator[0].result)
    const operatorRows = asArray(operatorResult.data).map(asRecord)
    expect(operatorResult.total).toBe(1)
    expect(operatorRows[0].warehouse_id).toBe(ids.warehouseA)
    expect(operatorRows[0].variant_id).toBe(ids.sharedVariant)
  })

  it('rejects mismatched identity, disabled users, and anon RPC execution', async () => {
    await expect(queryAs(
      'authenticated', ids.operator,
      'SELECT public.get_product_overview($1, 1, 20, NULL, NULL, NULL)',
      [ids.admin],
    )).rejects.toThrow()

    await expect(queryAs(
      'authenticated', ids.disabled,
      'SELECT public.get_product_overview($1, 1, 20, NULL, NULL, NULL)',
      [ids.disabled],
    )).rejects.toThrow()

    await expect(queryAs(
      'anon', null,
      'SELECT public.get_product_overview(NULL, 1, 20, NULL, NULL, NULL)',
    )).rejects.toThrow(/permission denied/i)
  })

  it('aggregates P7 overview rows after warehouse permission filtering', async () => {
    const admin = await queryAs<{ result: unknown }>(
      'authenticated', ids.admin,
      'SELECT public.get_product_overview($1, 1, 20, NULL, NULL, NULL) AS result',
      [ids.admin],
    )
    const adminResult = asRecord(admin[0].result)
    expect(adminResult.total_count).toBe(3)
    const adminShared = asArray(adminResult.items).map(asRecord)
      .find((row) => row.sku === 'SKU-SHARED')
    expect(adminShared).toBeDefined()
    expect(asArray(adminShared?.per_warehouse)).toHaveLength(2)

    const operator = await queryAs<{ result: unknown }>(
      'authenticated', ids.operator,
      'SELECT public.get_product_overview($1, 1, 20, NULL, NULL, NULL) AS result',
      [ids.operator],
    )
    const operatorResult = asRecord(operator[0].result)
    expect(operatorResult.total_count).toBe(2)
    const operatorItems = asArray(operatorResult.items).map(asRecord)
    expect(operatorItems.map((row) => row.sku).sort()).toEqual(['SKU-ARCHIVED', 'SKU-SHARED'])
    const operatorShared = operatorItems.find((row) => row.sku === 'SKU-SHARED')
    const perWarehouse = asArray(operatorShared?.per_warehouse).map(asRecord)
    expect(perWarehouse).toHaveLength(1)
    expect(perWarehouse[0].warehouse_id).toBe(ids.warehouseA)
  })

  it('limits P7 detail to assigned warehouses and rejects cross-warehouse access', async () => {
    const detail = await queryAs<{ result: unknown }>(
      'authenticated', ids.operator,
      'SELECT public.get_war_room_variant_detail($1, $2) AS result',
      [ids.operator, ids.sharedVariant],
    )
    const result = asRecord(detail[0].result)
    const warehouses = asArray(result.assigned_warehouse_detail).map(asRecord)
    expect(warehouses).toHaveLength(1)
    expect(warehouses[0].warehouse_id).toBe(ids.warehouseA)

    await expect(queryAs(
      'authenticated', ids.operator,
      'SELECT public.get_war_room_variant_detail($1, $2)',
      [ids.operator, ids.warehouseBVariant],
    )).rejects.toThrow()
  })

  it('builds homepage health from visible, non-archived inventory positions', async () => {
    const admin = await queryAs<{ result: unknown }>(
      'authenticated', ids.admin,
      'SELECT public.get_warehouse_health_overview($1) AS result', [ids.admin],
    )
    const adminSummary = asRecord(asRecord(admin[0].result).summary)
    expect(adminSummary.total_position_count).toBe(4)
    expect(adminSummary.distinct_variant_count).toBe(3)

    const operator = await queryAs<{ result: unknown }>(
      'authenticated', ids.operator,
      'SELECT public.get_warehouse_health_overview($1) AS result', [ids.operator],
    )
    const operatorResult = asRecord(operator[0].result)
    const operatorSummary = asRecord(operatorResult.summary)
    const operatorWarehouses = asArray(operatorResult.warehouses).map(asRecord)
    expect(operatorSummary.total_position_count).toBe(1)
    expect(operatorSummary.distinct_variant_count).toBe(1)
    expect(operatorWarehouses).toHaveLength(1)
    expect(operatorWarehouses[0].warehouse_id).toBe(ids.warehouseA)
  })
})
