// P5-SY5G — 并发锁原子 Claim 测试（真实 PostgreSQL 双事务并发）
// 不连接生产 Supabase，使用本地 PostgreSQL 测试数据库
// Migration 00007 + 00008 RPC 适配本地 PG
//
// 返工 (V2): 全部并发场景使用双独立 pg.Client + BEGIN/COMMIT/ROLLBACK
//   PG 不可用时 fail，不 skip

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 连接配置 ──────────────────────────────────────────────

const requiredEnvVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;

const missingVars = requiredEnvVars.filter((k) => !process.env[k]);
if (missingVars.length > 0) {
  throw new Error(
    `P5-SY5G 并发测试需要显式 PG 环境变量。缺失: ${missingVars.join(', ')}\n` +
    `设置方式 (PowerShell):\n` +
    `  $env:PGHOST="127.0.0.1"; $env:PGPORT="5433"; $env:PGDATABASE="p5_sy5g_test"; $env:PGUSER="postgres"; $env:PGPASSWORD="postgres"\n` +
    `或在运行命令前设置:\n` +
    `  PGHOST=127.0.0.1 PGPORT=5433 PGDATABASE=p5_sy5g_test PGUSER=postgres PGPASSWORD=postgres npm run test -- src/features/sync/concurrency.test.ts`,
  );
}

const PG_CONFIG = {
  host: process.env.PGHOST!,
  port: parseInt(process.env.PGPORT!, 10),
  database: process.env.PGDATABASE!,
  user: process.env.PGUSER!,
  password: process.env.PGPASSWORD!,
};

// ─── 固定 UUID 常量 ─────────────────────────────────────────

const WH_PH = 'adc5ec45-cd98-42a8-a1d1-26600e80d481';
const WH_VN = 'bdc5ec45-cd98-42a8-a1d1-26600e80d482';
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

// ─── 模块加载时检查 PG 可用性 ──────────────────────────────

async function checkPgAvailable(): Promise<void> {
  const client = new Client({ ...PG_CONFIG, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PostgreSQL 连接失败 (${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}): ${msg}`);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// checkPgAvailable 内部 throw 若 PG 不可用，执行流不会到达此处
await checkPgAvailable();

// ─── Schema SQL（从 Migration 00007 + 00008 适配本地 PG）───

const SETUP_SQL = `
-- auth schema mock（替换 Supabase auth.uid()）
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN current_setting('app.user_id', true)::uuid;
END;
$$;

-- 基础表
CREATE TABLE IF NOT EXISTS public.warehouse (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'overseas',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY,
  display_name text NOT NULL
);

-- 用户角色函数
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'admin';
END;
$$;

-- sync_run 表（完整列 + 11 CHECK + 索引）
CREATE TABLE IF NOT EXISTS public.sync_run (
  id                      uuid PRIMARY KEY,
  warehouse_id            uuid NOT NULL REFERENCES public.warehouse(id) ON DELETE CASCADE,
  mode                    text NOT NULL CHECK (mode IN ('dry_run', 'real_write')),
  status                  text NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed', 'failed')),
  triggered_by            uuid NOT NULL REFERENCES public.profiles(id),
  triggered_from          text NOT NULL CHECK (triggered_from IN ('web', 'cli')),
  started_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz,
  heartbeat_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  exit_code               integer,
  error_message           text,
  result_summary          jsonb,
  plan_drift_check        text CHECK (plan_drift_check IN ('PASS', 'DRIFT_DETECTED')),
  plan_drift_count        integer CHECK (plan_drift_count >= 0),
  plan_drift_differences  jsonb,
  dry_run_run_id          uuid REFERENCES public.sync_run(id),
  input_artifact_hash     text,
  plan_artifact_hash      text,
  locked_by               uuid,
  lease_expires_at        timestamptz,

  CONSTRAINT sync_run_time_check
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CONSTRAINT real_write_requires_dry_run
    CHECK (mode != 'real_write' OR dry_run_run_id IS NOT NULL),
  CONSTRAINT real_write_requires_artifacts
    CHECK (mode != 'real_write' OR (input_artifact_hash IS NOT NULL AND plan_artifact_hash IS NOT NULL)),
  CONSTRAINT dry_run_requires_input_artifact
    CHECK (mode != 'dry_run' OR input_artifact_hash IS NOT NULL),
  CONSTRAINT completed_requires_fields
    CHECK (status != 'completed' OR (
      finished_at IS NOT NULL
      AND exit_code IS NOT NULL
      AND result_summary IS NOT NULL
      AND plan_drift_check IS NOT NULL
      AND plan_drift_count IS NOT NULL
      AND plan_drift_differences IS NOT NULL
    )),
  CONSTRAINT plan_drift_check_enum
    CHECK (plan_drift_check IS NULL OR plan_drift_check IN ('PASS', 'DRIFT_DETECTED')),
  CONSTRAINT plan_drift_count_non_negative
    CHECK (plan_drift_count IS NULL OR plan_drift_count >= 0),
  CONSTRAINT failed_requires_fields
    CHECK (status != 'failed' OR (
      finished_at IS NOT NULL
      AND error_message IS NOT NULL
      AND exit_code IN (1, 2)
    )),
  CONSTRAINT completed_exit_code_zero
    CHECK (status != 'completed' OR exit_code = 0),
  CONSTRAINT plan_drift_differences_length
    CHECK (
      plan_drift_differences IS NULL
      OR plan_drift_count IS NULL
      OR jsonb_array_length(plan_drift_differences) = plan_drift_count
    ),
  CONSTRAINT completed_dry_run_requires_plan_artifact
    CHECK (
      NOT (status = 'completed' AND mode = 'dry_run')
      OR plan_artifact_hash IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_run_one_in_progress
  ON public.sync_run(warehouse_id)
  WHERE status = 'in_progress';

-- sync_warehouse_lock 表
CREATE TABLE IF NOT EXISTS public.sync_warehouse_lock (
  warehouse_id uuid PRIMARY KEY REFERENCES public.warehouse(id) ON DELETE CASCADE,
  locked_by    uuid REFERENCES public.sync_run(id) ON DELETE SET NULL,
  locked_at    timestamptz
);

-- Trigger 函数
CREATE OR REPLACE FUNCTION public.trg_sync_warehouse_lock_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.sync_warehouse_lock (warehouse_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_create_lock ON public.warehouse;
CREATE TRIGGER trg_warehouse_create_lock
  AFTER INSERT ON public.warehouse
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_warehouse_lock_insert();
`;

// ─── claim_sync_run RPC（含 00008 FOR UPDATE）────────────────

const CLAIM_SYNC_RUN_SQL = `
CREATE OR REPLACE FUNCTION public.claim_sync_run(
  p_warehouse_id         uuid,
  p_mode                 text,
  p_run_id               uuid,
  p_lease_duration       integer,
  p_triggered_by         uuid,
  p_triggered_from       text,
  p_dry_run_run_id       uuid    DEFAULT NULL,
  p_input_artifact_hash  text    DEFAULT NULL,
  p_plan_artifact_hash   text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wh_type      text;
  v_wh_active    boolean;
  v_in_progress  uuid;
  v_locked_by    uuid;
  v_lease_exp    timestamptz;
  v_now          timestamptz;
  v_dr_mode      text;
  v_dr_status    text;
  v_dr_plan_chk  text;
  v_dr_finished  timestamptz;
  v_dr_input_h   text;
  v_dr_plan_h    text;
  v_dr_wh_id     uuid;
BEGIN
  -- Step 1: Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
  END IF;

  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  IF p_triggered_by IS NULL OR p_triggered_by != auth.uid() THEN
    RAISE EXCEPTION 'triggered_by 必须为当前登录用户' USING ERRCODE = 'P0001';
  END IF;

  -- Step 2: Param validation
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '无效的仓库 ID' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode NOT IN ('dry_run', 'real_write') THEN
    RAISE EXCEPTION '无效的同步模式: %', p_mode USING ERRCODE = 'P0001';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION '无效的运行 ID' USING ERRCODE = 'P0001';
  END IF;

  IF p_lease_duration IS NULL OR p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'lease_duration 必须在 [30, 900] 范围内，收到: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  IF p_triggered_from NOT IN ('web', 'cli') THEN
    RAISE EXCEPTION '无效的触发来源: %', p_triggered_from USING ERRCODE = 'P0001';
  END IF;

  IF p_mode = 'real_write' AND p_dry_run_run_id IS NULL THEN
    RAISE EXCEPTION 'Real Write 模式必须提供 dry_run_run_id' USING ERRCODE = 'P0001';
  END IF;

  -- Step 3 (V5.5.1): pg_advisory_xact_lock (Layer 1)
  -- 移到 Step 4 warehouse 验证之前，关闭 is_active 检查的 TOCTOU 窗口
  PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || p_warehouse_id));

  -- Step 4: Validate warehouse（在 advisory lock 保护区内）
  SELECT type, is_active
  INTO v_wh_type, v_wh_active
  FROM public.warehouse
  WHERE id = p_warehouse_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse 不存在: %', p_warehouse_id USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_type != 'overseas' THEN
    RAISE EXCEPTION 'Warehouse 类型必须为 overseas，实际: %', v_wh_type
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_active THEN
    RAISE EXCEPTION 'Warehouse 已停用: %', p_warehouse_id USING ERRCODE = 'P0001';
  END IF;

  -- Step 5: SELECT FOR UPDATE on sync_warehouse_lock (Layer 2)
  SELECT swl.locked_by
  INTO v_locked_by
  FROM public.sync_warehouse_lock swl
  WHERE swl.warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行不存在: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Step 5.5 (V5.5): SELECT FOR UPDATE on in_progress sync_run
  SELECT id, lease_expires_at
  INTO v_in_progress, v_lease_exp
  FROM public.sync_run
  WHERE warehouse_id = p_warehouse_id
    AND status = 'in_progress'
  FOR UPDATE;

  -- Step 5.6: clock_timestamp after all locks
  v_now := clock_timestamp();

  -- Step 5.7: Lease judgment
  IF FOUND THEN
    IF v_lease_exp IS NOT NULL AND v_lease_exp < v_now THEN
      UPDATE public.sync_run
      SET status          = 'failed',
          exit_code       = 2,
          error_message   = '租约过期，自动清理（被新 claim 回收）',
          finished_at     = v_now
      WHERE id = v_in_progress;

      UPDATE public.sync_warehouse_lock
      SET locked_by = NULL, locked_at = NULL
      WHERE warehouse_id = p_warehouse_id
        AND locked_by = v_in_progress;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  -- Step 6 (V5.5.1): real_write - atomic dry_run_run_id validation
  -- FOR UPDATE 锁定 dry_run 行，关闭 TOCTOU 窗口
  IF p_mode = 'real_write' THEN
    SELECT mode, status, plan_drift_check, finished_at,
           input_artifact_hash, plan_artifact_hash, warehouse_id
    INTO v_dr_mode, v_dr_status, v_dr_plan_chk, v_dr_finished,
         v_dr_input_h, v_dr_plan_h, v_dr_wh_id
    FROM public.sync_run
    WHERE id = p_dry_run_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'dry_run_run_id 对应的运行不存在: %', p_dry_run_run_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_dr_wh_id != p_warehouse_id THEN
      RAISE EXCEPTION 'Dry Run warehouse 不匹配: 期望 %, 实际 %',
        p_warehouse_id, v_dr_wh_id USING ERRCODE = 'P0001';
    END IF;

    IF v_dr_mode != 'dry_run' THEN
      RAISE EXCEPTION 'dry_run_run_id 对应运行 mode 不是 dry_run: %', v_dr_mode
        USING ERRCODE = 'P0001';
    END IF;

    IF v_dr_status != 'completed' THEN
      RAISE EXCEPTION 'Dry Run 状态必须是 completed，实际: %', v_dr_status
        USING ERRCODE = 'P0001';
    END IF;

    IF v_dr_plan_chk != 'PASS' THEN
      RAISE EXCEPTION 'Dry Run plan_drift_check 必须是 PASS，实际: %', v_dr_plan_chk
        USING ERRCODE = 'P0001';
    END IF;

    IF v_dr_finished IS NULL OR v_dr_finished <= v_now - INTERVAL '60 minutes' THEN
      RAISE EXCEPTION 'Dry Run 已完成达到或超过 60 分钟，已过期 (finished_at: %)', v_dr_finished
        USING ERRCODE = 'P0001';
    END IF;

    IF p_input_artifact_hash IS NULL OR p_input_artifact_hash != v_dr_input_h THEN
      RAISE EXCEPTION 'input_artifact_hash 不匹配' USING ERRCODE = 'P0001';
    END IF;

    IF p_plan_artifact_hash IS NULL OR p_plan_artifact_hash != v_dr_plan_h THEN
      RAISE EXCEPTION 'plan_artifact_hash 不匹配' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Step 7: INSERT
  INSERT INTO public.sync_run (
    id, warehouse_id, mode, status,
    triggered_by, triggered_from,
    started_at, heartbeat_at, created_at,
    dry_run_run_id,
    input_artifact_hash, plan_artifact_hash,
    locked_by, lease_expires_at
  ) VALUES (
    p_run_id, p_warehouse_id, p_mode, 'in_progress',
    p_triggered_by, p_triggered_from,
    v_now, v_now, v_now,
    p_dry_run_run_id,
    p_input_artifact_hash, p_plan_artifact_hash,
    p_run_id, v_now + (p_lease_duration || ' seconds')::interval
  );

  -- Step 8: Update lock table
  UPDATE public.sync_warehouse_lock
  SET locked_by = p_run_id, locked_at = v_now
  WHERE warehouse_id = p_warehouse_id;

  RETURN p_run_id;
END;
$$;
`;

// ─── release_sync_run RPC（从 00007 适配）──────────────────

const RELEASE_SYNC_RUN_SQL = `
CREATE OR REPLACE FUNCTION public.release_sync_run(
  p_run_id                uuid,
  p_status                text,
  p_exit_code             integer,
  p_error_message         text       DEFAULT NULL,
  p_result_summary        jsonb      DEFAULT NULL,
  p_plan_drift_check      text       DEFAULT NULL,
  p_plan_drift_count      integer    DEFAULT NULL,
  p_plan_drift_differences jsonb     DEFAULT NULL,
  p_plan_artifact_hash    text       DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pre_wh_id     uuid;
  v_post_wh_id    uuid;
  v_mode          text;
  v_cur_status    text;
  v_lock_exists   boolean;
  v_now           timestamptz;
BEGIN
  SELECT warehouse_id
  INTO v_pre_wh_id
  FROM public.sync_run
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 不存在: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || v_pre_wh_id));

  SELECT EXISTS (
    SELECT 1 FROM public.sync_warehouse_lock
    WHERE warehouse_id = v_pre_wh_id
    FOR UPDATE
  ) INTO v_lock_exists;

  IF NOT v_lock_exists THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行不存在: %', v_pre_wh_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT warehouse_id, mode, status
  INTO v_post_wh_id, v_mode, v_cur_status
  FROM public.sync_run
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 在锁定后消失: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  IF v_pre_wh_id IS DISTINCT FROM v_post_wh_id THEN
    RAISE EXCEPTION 'warehouse_id 在锁前/锁后不一致: 锁前=%, 锁后=%', v_pre_wh_id, v_post_wh_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_cur_status != 'in_progress' THEN
    RAISE EXCEPTION '只能从 in_progress 状态释放，当前已进入终态: %', v_cur_status
      USING ERRCODE = 'P0001';
  END IF;

  v_now := clock_timestamp();

  IF p_status = 'completed' THEN
    IF p_plan_drift_check IS NULL OR p_plan_drift_check NOT IN ('PASS', 'DRIFT_DETECTED') THEN
      RAISE EXCEPTION 'completed 必须提供有效的 plan_drift_check (PASS 或 DRIFT_DETECTED)，收到: %',
        p_plan_drift_check USING ERRCODE = 'P0001';
    END IF;

    IF p_plan_drift_count IS NULL OR p_plan_drift_count < 0 THEN
      RAISE EXCEPTION 'completed 必须提供非负 plan_drift_count，收到: %',
        p_plan_drift_count USING ERRCODE = 'P0001';
    END IF;

    IF p_plan_drift_differences IS NULL THEN
      RAISE EXCEPTION 'completed 必须提供 plan_drift_differences' USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_typeof(p_plan_drift_differences) != 'array' THEN
      RAISE EXCEPTION 'plan_drift_differences 必须是 JSON 数组' USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_array_length(p_plan_drift_differences) != p_plan_drift_count THEN
      RAISE EXCEPTION 'plan_drift_differences 数组长度 (%) 不等于 plan_drift_count (%)',
        jsonb_array_length(p_plan_drift_differences), p_plan_drift_count
        USING ERRCODE = 'P0001';
    END IF;

    IF p_exit_code IS NULL OR p_exit_code != 0 THEN
      RAISE EXCEPTION 'completed 必须 exit_code=0，收到: %', p_exit_code
        USING ERRCODE = 'P0001';
    END IF;

    IF p_result_summary IS NULL THEN
      RAISE EXCEPTION 'completed 必须提供 result_summary' USING ERRCODE = 'P0001';
    END IF;

    IF v_mode = 'dry_run' AND p_plan_artifact_hash IS NULL THEN
      RAISE EXCEPTION 'Dry Run completed 必须提供 plan_artifact_hash'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.sync_run
    SET status                = 'completed',
        exit_code             = 0,
        finished_at           = v_now,
        result_summary        = p_result_summary,
        plan_drift_check      = p_plan_drift_check,
        plan_drift_count      = p_plan_drift_count,
        plan_drift_differences = p_plan_drift_differences,
        plan_artifact_hash    = COALESCE(p_plan_artifact_hash, plan_artifact_hash),
        locked_by             = NULL,
        lease_expires_at      = NULL,
        heartbeat_at          = NULL
    WHERE id = p_run_id;

  ELSIF p_status = 'failed' THEN
    IF p_error_message IS NULL THEN
      RAISE EXCEPTION 'failed 必须提供 error_message' USING ERRCODE = 'P0001';
    END IF;

    IF p_exit_code IS NULL OR p_exit_code NOT IN (1, 2) THEN
      RAISE EXCEPTION 'failed exit_code 必须为 1 或 2，收到: %', p_exit_code
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.sync_run
    SET status          = 'failed',
        exit_code       = p_exit_code,
        error_message   = p_error_message,
        result_summary  = p_result_summary,
        finished_at     = v_now,
        locked_by       = NULL,
        lease_expires_at = NULL,
        heartbeat_at    = NULL
    WHERE id = p_run_id;

  ELSE
    RAISE EXCEPTION '无效的状态: %（仅允许 completed 或 failed）', p_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.sync_warehouse_lock
  SET locked_by = NULL, locked_at = NULL
  WHERE warehouse_id = v_post_wh_id
    AND locked_by = p_run_id;
END;
$$;
`;

// ─── heartbeat_sync_run RPC（从 00007 适配）────────────────

const HEARTBEAT_SYNC_RUN_SQL = `
CREATE OR REPLACE FUNCTION public.heartbeat_sync_run(
  p_run_id          uuid,
  p_lease_duration  integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_now   timestamptz;
BEGIN
  IF p_lease_duration IS NULL OR p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'lease_duration 必须在 [30, 900] 范围内，收到: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  v_now := clock_timestamp();

  UPDATE public.sync_run
  SET lease_expires_at = v_now + (p_lease_duration || ' seconds')::interval,
      heartbeat_at     = v_now
  WHERE id = p_run_id
    AND status = 'in_progress';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'heartbeat 失败: sync_run 不存在或已非 in_progress 状态 (id=%)',
      p_run_id USING ERRCODE = 'P0001';
  END IF;
END;
$$;
`;

// ─── cleanup_expired_sync_runs RPC（从 00007 适配）─────────

const CLEANUP_EXPIRED_SYNC_RUNS_SQL = `
CREATE OR REPLACE FUNCTION public.cleanup_expired_sync_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_row   record;
  v_count      integer;
  v_total      integer := 0;
BEGIN
  FOR v_lock_row IN
    SELECT DISTINCT sr.warehouse_id
    FROM public.sync_run sr
    WHERE sr.status = 'in_progress'
      AND sr.lease_expires_at IS NOT NULL
      AND sr.lease_expires_at < now()
    ORDER BY sr.warehouse_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || v_lock_row.warehouse_id));

    PERFORM 1
    FROM public.sync_warehouse_lock
    WHERE warehouse_id = v_lock_row.warehouse_id
    FOR UPDATE;

    WITH expired AS (
      UPDATE public.sync_run
      SET status        = 'failed',
          exit_code     = 2,
          error_message = '租约过期，自动清理',
          finished_at   = now()
      WHERE warehouse_id = v_lock_row.warehouse_id
        AND status = 'in_progress'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
      RETURNING id
    ),
    cleared AS (
      UPDATE public.sync_warehouse_lock
      SET locked_by = NULL, locked_at = NULL
      WHERE warehouse_id = v_lock_row.warehouse_id
        AND locked_by IN (SELECT id FROM expired)
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM expired;

    v_total := v_total + v_count;
  END LOOP;

  RETURN v_total;
END;
$$;
`;

const ALL_RPC_SQL = [
  CLAIM_SYNC_RUN_SQL,
  RELEASE_SYNC_RUN_SQL,
  HEARTBEAT_SYNC_RUN_SQL,
  CLEANUP_EXPIRED_SYNC_RUNS_SQL,
].join('\n');

// ─── Test Helpers ──────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Create a new pg Client */
function createClient(): Client {
  return new Client(PG_CONFIG);
}

/** Connect client and set auth user */
async function connectClient(client: Client, userId: string): Promise<void> {
  await client.connect();
  await client.query("SELECT set_config('app.user_id', $1, false)", [userId]);
}

/** Safely end a client */
async function endClient(client: Client): Promise<void> {
  try {
    try { await client.query('ROLLBACK'); } catch { /* not in tx */ }
    await client.end();
  } catch { /* ignore */ }
}

/** Connect two clients */
async function connectBoth(a: Client, b: Client, userId = ADMIN_ID): Promise<void> {
  await Promise.all([connectClient(a, userId), connectClient(b, userId)]);
}

/** End two clients */
async function endBoth(a: Client, b: Client): Promise<void> {
  await Promise.all([endClient(a), endClient(b)]);
}

// ─── 静态验证：测试 SQL 与 Migration 一致 ─────────────────

describe('静态验证: 测试 SQL 与 Migration 00007/00008 关键结构一致', () => {
  // 读取 migration SQL
  const migrationDir = path.resolve(__dirname, '../../..', 'supabase/migrations');
  const migration07 = fs.readFileSync(path.join(migrationDir, '00007_sync_run.sql'), 'utf-8');
  const migration08 = fs.readFileSync(path.join(migrationDir, '00008_sync_run_for_update_dry_run.sql'), 'utf-8');
  const combinedMigration = migration07 + '\n' + migration08;

  it('claim_sync_run 参数签名一致', () => {
    // 从 migration 提取参数签名
    const mParamMatch = combinedMigration.match(
      /CREATE OR REPLACE FUNCTION public\.claim_sync_run\(([\s\S]*?)\)\s+RETURNS uuid/s,
    );
    expect(mParamMatch).not.toBeNull();

    // 从测试 SQL 提取参数签名
    const tParamMatch = CLAIM_SYNC_RUN_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.claim_sync_run\(([\s\S]*?)\)\s+RETURNS uuid/s,
    );
    expect(tParamMatch).not.toBeNull();

    const mParams = mParamMatch![1]
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 0);
    const tParams = tParamMatch![1]
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 0);

    // 参数个数一致
    expect(tParams.length).toBe(mParams.length);

    // 每个参数的名称和类型一致
    for (let i = 0; i < mParams.length; i++) {
      const mParam = mParams[i].replace(/\s+DEFAULT\s+.*$/, '').trim();
      const tParam = tParams[i].replace(/\s+DEFAULT\s+.*$/, '').trim();
      expect(tParam).toBe(mParam);
    }
  });

  it('release_sync_run 参数签名一致', () => {
    const mFunc = combinedMigration.match(
      /CREATE OR REPLACE FUNCTION public\.release_sync_run\(([\s\S]*?)\)\s+RETURNS void/s,
    );
    const tFunc = RELEASE_SYNC_RUN_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.release_sync_run\(([\s\S]*?)\)\s+RETURNS void/s,
    );
    expect(mFunc).not.toBeNull();
    expect(tFunc).not.toBeNull();

    const mParamNames = mFunc![1].match(/p_\w+/g) || [];
    const tParamNames = tFunc![1].match(/p_\w+/g) || [];
    expect(tParamNames).toEqual(mParamNames);
  });

  it('heartbeat_sync_run 参数签名一致', () => {
    const mFunc = combinedMigration.match(
      /CREATE OR REPLACE FUNCTION public\.heartbeat_sync_run\(([\s\S]*?)\)\s+RETURNS void/s,
    );
    const tFunc = HEARTBEAT_SYNC_RUN_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.heartbeat_sync_run\(([\s\S]*?)\)\s+RETURNS void/s,
    );
    expect(mFunc).not.toBeNull();
    expect(tFunc).not.toBeNull();

    const mParamNames = mFunc![1].match(/p_\w+/g) || [];
    const tParamNames = tFunc![1].match(/p_\w+/g) || [];
    expect(tParamNames).toEqual(mParamNames);
  });

  it('cleanup_expired_sync_runs 签名一致', () => {
    const mFunc = combinedMigration.match(
      /CREATE OR REPLACE FUNCTION public\.cleanup_expired_sync_runs\(\)[\s\S]*?RETURNS integer/s,
    );
    const tFunc = CLEANUP_EXPIRED_SYNC_RUNS_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.cleanup_expired_sync_runs\(\)[\s\S]*?RETURNS integer/s,
    );
    expect(mFunc).not.toBeNull();
    expect(tFunc).not.toBeNull();
  });

  it('claim_sync_run 锁顺序：Step 3 advisory→4 validate warehouse→5 wh FOR UPDATE→5.5 sr FOR UPDATE→5.6 clock→6 dry_run FOR UPDATE→7 INSERT', () => {
    const sql = CLAIM_SYNC_RUN_SQL;

    // Step 3 advisory lock 在最前（V5.5.1: 移到 warehouse 验证之前）
    const advLockIdx = sql.indexOf("pg_advisory_xact_lock(hashtext('sync_run:'");
    expect(advLockIdx).toBeGreaterThan(0);

    // Step 4 warehouse validation (is_active check) 在 advisory lock 之后
    const whValidateIdx = sql.indexOf("v_wh_active", advLockIdx);
    expect(whValidateIdx).toBeGreaterThan(advLockIdx);

    // Step 5 FOR UPDATE on sync_warehouse_lock 在 warehouse validation 之后
    const whLockIdx = sql.indexOf('public.sync_warehouse_lock swl');
    expect(whLockIdx).toBeGreaterThan(whValidateIdx);

    // Step 5.5 FOR UPDATE on in_progress sync_run 在 wh lock 之后
    const srLockIdx = sql.indexOf("status = 'in_progress'", whLockIdx + 50);
    const forUpdateSrIdx = sql.indexOf('FOR UPDATE', srLockIdx);
    expect(forUpdateSrIdx).toBeGreaterThan(whLockIdx);

    // Step 5.6 clock_timestamp 在 sync_run FOR UPDATE 之后
    const clockIdx = sql.indexOf('clock_timestamp()', forUpdateSrIdx);
    expect(clockIdx).toBeGreaterThan(forUpdateSrIdx);

    // Step 6 FOR UPDATE on dry_run row 在 clock_timestamp 之后（V5.5.1）
    const dryRunLockIdx = sql.indexOf("id = p_dry_run_run_id", clockIdx);
    const dryRunForUpdateIdx = sql.indexOf('FOR UPDATE', dryRunLockIdx);
    expect(dryRunForUpdateIdx).toBeGreaterThan(clockIdx);

    // Step 7 INSERT 在 dry_run FOR UPDATE 之后
    const insertIdx = sql.indexOf('INSERT INTO public.sync_run', dryRunForUpdateIdx);
    expect(insertIdx).toBeGreaterThan(dryRunForUpdateIdx);
  });

  it('sync_run 表 11 CHECK 约束名称一致', () => {
    const checkPattern = /CONSTRAINT\s+(\w+)\s+CHECK\s*\(/g;
    let match: RegExpExecArray | null;
    const mChecks = new Set<string>();
    while ((match = checkPattern.exec(migration07)) !== null) {
      mChecks.add(match[1]);
    }
    const tChecks = new Set<string>();
    while ((match = checkPattern.exec(SETUP_SQL)) !== null) {
      tChecks.add(match[1]);
    }

    // 测试 SQL 必须包含 migration 中全部 CHECK 约束名称
    for (const c of mChecks) {
      expect(tChecks.has(c)).toBe(true);
    }
  });

  it('sync_run 部分唯一索引名称一致', () => {
    expect(migration07.includes('idx_sync_run_one_in_progress')).toBe(true);
    expect(SETUP_SQL.includes('idx_sync_run_one_in_progress')).toBe(true);

    const mPartial = migration07.match(/CREATE UNIQUE INDEX.*?idx_sync_run_one_in_progress[\s\S]*?WHERE\s+(status\s*=\s*'in_progress')/);
    const tPartial = SETUP_SQL.match(/CREATE UNIQUE INDEX.*?idx_sync_run_one_in_progress[\s\S]*?WHERE\s+(status\s*=\s*'in_progress')/);
    expect(mPartial).not.toBeNull();
    expect(tPartial).not.toBeNull();
    // 关键 WHERE 子句一致
    expect(tPartial![1].replace(/\s+/g, ' ')).toBe(mPartial![1].replace(/\s+/g, ' '));
  });

  it('release_sync_run 锁顺序：advisory → warehouse FOR UPDATE → sync_run FOR UPDATE → clock_timestamp', () => {
    const sql = RELEASE_SYNC_RUN_SQL;

    const advLock = sql.indexOf("hashtext('sync_run:'");
    expect(advLock).toBeGreaterThan(0);

    const whLock = sql.indexOf('EXISTS (', advLock);
    const whForUpdate = sql.indexOf('FOR UPDATE', whLock);
    expect(whForUpdate).toBeGreaterThan(advLock);

    const srLock = sql.indexOf('v_cur_status', whForUpdate);
    const srForUpdate = sql.indexOf('FOR UPDATE', srLock);
    expect(srForUpdate).toBeGreaterThan(whForUpdate);

    const clock = sql.indexOf('clock_timestamp()', srForUpdate);
    expect(clock).toBeGreaterThan(srForUpdate);
  });

  it('cleanup_expired_sync_runs 锁顺序：ORDER BY warehouse_id → advisory → FOR UPDATE', () => {
    const sql = CLEANUP_EXPIRED_SYNC_RUNS_SQL;

    const orderByIdx = sql.indexOf('ORDER BY sr.warehouse_id');
    expect(orderByIdx).toBeGreaterThan(0);

    const advLock = sql.indexOf('pg_advisory_xact_lock', orderByIdx);
    expect(advLock).toBeGreaterThan(orderByIdx);

    const whForUpdate = sql.indexOf('FOR UPDATE', advLock);
    expect(whForUpdate).toBeGreaterThan(advLock);
  });
});

// ─── Test Suite ────────────────────────────────────────────

describe('P5-SY5G 并发锁原子 Claim 测试 (真实 PostgreSQL 双事务)', { timeout: 120000 }, () => {
  let adminClient: Client;

  beforeAll(async () => {
    adminClient = createClient();
    await connectClient(adminClient, ADMIN_ID);

    // 清理上次运行残留的连接（防止 DDL 被阻塞）
    try {
      await adminClient.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
      );
    } catch { /* ignore */ }

    // 应用 Schema（幂等）
    await adminClient.query(SETUP_SQL);
    await adminClient.query(ALL_RPC_SQL);
  }, 60000);

  afterAll(async () => {
    if (adminClient) {
      try {
        await adminClient.query('DELETE FROM public.sync_run');
        await adminClient.query('DELETE FROM public.sync_warehouse_lock');
        await adminClient.query('DELETE FROM public.warehouse');
        await adminClient.query('DELETE FROM public.profiles');
      } catch { /* ignore */ }
      await endClient(adminClient);
    }
  }, 30000);

  // ─── seed / cleanup ──────────────────────────────────────

  async function seedBase(client: Client): Promise<void> {
    await client.query(
      `INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Admin User') ON CONFLICT DO NOTHING`,
      [ADMIN_ID],
    );
    // ON CONFLICT DO UPDATE 确保仓库始终 active（防止 G1 残留）
    await client.query(
      `INSERT INTO public.warehouse (id, name, type, is_active)
       VALUES ($1, '菲律宾-新创启辰自建仓', 'overseas', true)
       ON CONFLICT (id) DO UPDATE SET is_active = true, type = 'overseas'`,
      [WH_PH],
    );
    await client.query(
      `INSERT INTO public.sync_warehouse_lock (warehouse_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [WH_PH],
    );
    await client.query(
      `INSERT INTO public.warehouse (id, name, type, is_active)
       VALUES ($1, '越南青林湾仓库', 'overseas', true)
       ON CONFLICT (id) DO UPDATE SET is_active = true, type = 'overseas'`,
      [WH_VN],
    );
    await client.query(
      `INSERT INTO public.sync_warehouse_lock (warehouse_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [WH_VN],
    );
  }

  async function cleanup(): Promise<void> {
    await adminClient.query('DELETE FROM public.sync_run');
    await adminClient.query(
      'UPDATE public.sync_warehouse_lock SET locked_by = NULL, locked_at = NULL',
    );
  }

  // ─── 辅助：创建 completed Dry Run ────────────────────────

  async function createCompletedDryRun(
    dryRunId: string,
    overrides: {
      whId?: string;
      mode?: string;
      status?: string;
      planDriftCheck?: string;
      finishedAtOffset?: string;
      inputHash?: string;
      planHash?: string;
      exitCode?: number;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    const whId = overrides.whId ?? WH_PH;
    const mode = overrides.mode ?? 'dry_run';
    const status = overrides.status ?? 'completed';
    const planDriftCheck = overrides.planDriftCheck ?? 'PASS';
    const exitCode = overrides.exitCode ?? (status === 'failed' ? 1 : 0);
    const errorMessage = overrides.errorMessage ?? (status === 'failed' ? 'test error' : null);
    const finishedAtExpr = overrides.finishedAtOffset
      ? (() => {
          const m = overrides.finishedAtOffset.match(/^(-?\d+)\s*minutes?$/);
          if (m) {
            const mins = parseInt(m[1], 10);
            return mins >= 0
              ? `now() + INTERVAL '${mins} minutes'`
              : `now() - INTERVAL '${-mins} minutes'`;
          }
          throw new Error(`无法解析 finishedAtOffset: ${overrides.finishedAtOffset}`);
        })()
      : 'now()';
    const startedAtExpr = overrides.finishedAtOffset
      ? `${finishedAtExpr} - INTERVAL '5 minutes'`
      : 'now()';
    const createdAtExpr = overrides.finishedAtOffset ? startedAtExpr : 'now()';
    const inputHash = overrides.inputHash ?? 'input-hash-001';
    const planHash = overrides.planHash ?? 'plan-hash-001';

    await adminClient.query(
      `INSERT INTO public.sync_run (
        id, warehouse_id, mode, status, triggered_by, triggered_from,
        started_at, finished_at, created_at, exit_code,
        result_summary, plan_drift_check, plan_drift_count,
        plan_drift_differences, input_artifact_hash, plan_artifact_hash
        ${status === 'failed' ? ', error_message' : ''}
      ) VALUES (
        $1, $2, $3, $4, $5, 'web',
        ${startedAtExpr}, ${finishedAtExpr}, ${createdAtExpr}, $6,
        '{"ok":true}'::jsonb, $7, 0,
        '[]'::jsonb, $8, $9
        ${status === 'failed' ? ', $10' : ''}
      )`,
      status === 'failed'
        ? [dryRunId, whId, mode, status, ADMIN_ID, exitCode, planDriftCheck, inputHash, planHash, errorMessage]
        : [dryRunId, whId, mode, status, ADMIN_ID, exitCode, planDriftCheck, inputHash, planHash],
    );
  }

  // ============================================================
  // 组 A: claim 基础并发
  // ============================================================
  describe('组 A: claim 基础并发', () => {
    it('A1: 双 claim 阻塞 — 第二个 claim 在 advisory lock 上阻塞并返回 NULL (双 Client)', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // Client A: BEGIN + claim（持有 advisory lock）
        await clientA.query('BEGIN');
        const resA = await clientA.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId1, ADMIN_ID],
        );
        expect(resA.rows[0].id).toBe(runId1);

        // Client B: BEGIN + claim（将在 advisory lock 上阻塞）
        await clientB.query('BEGIN');
        const bPromise = clientB.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
          [WH_PH, runId2, ADMIN_ID],
        );

        // 短暂等待确保 B 进入阻塞
        await sleep(1000);

        // 验证 B 尚未创建任何 sync_run（仍在阻塞）
        const midCheck = await adminClient.query(
          'SELECT count(*) as c FROM public.sync_run WHERE id = $1',
          [runId2],
        );
        expect(parseInt(midCheck.rows[0].c)).toBe(0);

        // A 提交 → advisory lock 释放 → B 解除阻塞
        await clientA.query('COMMIT');

        // B 应该返回 NULL（A 的 in_progress 可见，租约有效）
        const resB = await bPromise;
        expect(resB.rows[0].id).toBeNull();
        await clientB.query('COMMIT');

        // 最终验证：仅一个 in_progress 运行
        const finalCheck = await adminClient.query(
          "SELECT count(*) as c FROM public.sync_run WHERE warehouse_id = $1 AND status = 'in_progress'",
          [WH_PH],
        );
        expect(parseInt(finalCheck.rows[0].c)).toBe(1);
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });

    it('A2: 租约过期回收 — 新 claim 回收过期租约并成功', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 30, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId1, ADMIN_ID],
      );
      // 手动过期租约
      await adminClient.query(
        "UPDATE public.sync_run SET lease_expires_at = now() - INTERVAL '1 second' WHERE id = $1",
        [runId1],
      );

      // 新 claim 回收过期租约
      const res2 = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
        [WH_PH, runId2, ADMIN_ID],
      );
      expect(res2.rows[0].id).toBe(runId2);

      const old = await adminClient.query(
        'SELECT status, exit_code FROM public.sync_run WHERE id = $1',
        [runId1],
      );
      expect(old.rows[0].status).toBe('failed');
      expect(old.rows[0].exit_code).toBe(2);
      await cleanup();
    });

    it('A3: cleanup 不影响有效租约', async () => {
      await seedBase(adminClient);
      const runId = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId, ADMIN_ID],
      );

      const cleaned = await adminClient.query('SELECT public.cleanup_expired_sync_runs() AS count');
      expect(parseInt(cleaned.rows[0].count)).toBe(0);

      const run = await adminClient.query(
        'SELECT status FROM public.sync_run WHERE id = $1',
        [runId],
      );
      expect(run.rows[0].status).toBe('in_progress');
      await cleanup();
    });

    it('A4: heartbeat 续租 — lease_expires_at 已更新', async () => {
      await seedBase(adminClient);
      const runId = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 30, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId, ADMIN_ID],
      );

      const before = await adminClient.query(
        'SELECT lease_expires_at FROM public.sync_run WHERE id = $1',
        [runId],
      );
      const originalExpiry = new Date(before.rows[0].lease_expires_at).getTime();

      await adminClient.query('SELECT public.heartbeat_sync_run($1, 600)', [runId]);

      const after = await adminClient.query(
        'SELECT lease_expires_at, heartbeat_at FROM public.sync_run WHERE id = $1',
        [runId],
      );
      const newExpiry = new Date(after.rows[0].lease_expires_at).getTime();
      expect(newExpiry).toBeGreaterThan(originalExpiry);
      expect(after.rows[0].heartbeat_at).not.toBeNull();
      await cleanup();
    });

    it('A5: release 释放锁 — 后续 claim 成功', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId1, ADMIN_ID],
      );
      await adminClient.query(
        `SELECT public.release_sync_run($1, 'completed', 0, NULL,
          '{"ok":true}'::jsonb, 'PASS', 0, '[]'::jsonb, 'plan-hash-01')`,
        [runId1],
      );

      const lock = await adminClient.query(
        'SELECT locked_by FROM public.sync_warehouse_lock WHERE warehouse_id = $1',
        [WH_PH],
      );
      expect(lock.rows[0].locked_by).toBeNull();

      const res2 = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
        [WH_PH, runId2, ADMIN_ID],
      );
      expect(res2.rows[0].id).toBe(runId2);
      await cleanup();
    });

    it('A6: 部分唯一索引守卫 — 双 INSERT 违反 idx_sync_run_one_in_progress', async () => {
      await seedBase(adminClient);
      await adminClient.query(
        `INSERT INTO public.sync_run (id, warehouse_id, mode, status, triggered_by, triggered_from, input_artifact_hash)
         VALUES ('b6b6b6b6-1001-4000-8000-000000000001', $1, 'dry_run', 'in_progress', $2, 'web', 'hash01')`,
        [WH_PH, ADMIN_ID],
      );

      await expect(
        adminClient.query(
          `INSERT INTO public.sync_run (id, warehouse_id, mode, status, triggered_by, triggered_from, input_artifact_hash)
           VALUES ('b6b6b6b6-1002-4000-8000-000000000002', $1, 'dry_run', 'in_progress', $2, 'web', 'hash02')`,
          [WH_PH, ADMIN_ID],
        ),
      ).rejects.toThrow(/unique|duplicate|idx_sync_run_one_in_progress/i);
      await cleanup();
    });
  });

  // ============================================================
  // 组 B: claim-vs-release/cleanup 无死锁（双 Client）
  // ============================================================
  describe('组 B: claim-vs-release/cleanup 无 deadlock (双 Client)', () => {
    it('B1: claim-vs-release 无 deadlock — release 后 claim 成功 (双 Client)', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: claim + release
        await clientA.query('BEGIN');
        await clientA.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId1, ADMIN_ID],
        );
        await clientA.query(
          `SELECT public.release_sync_run($1, 'completed', 0, NULL,
            '{"ok":true}'::jsonb, 'PASS', 0, '[]'::jsonb, 'plan-hash')`,
          [runId1],
        );
        await clientA.query('COMMIT');

        // B: claim（A 已释放）
        await clientB.query('BEGIN');
        const resB = await clientB.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
          [WH_PH, runId2, ADMIN_ID],
        );
        expect(resB.rows[0].id).toBe(runId2);
        await clientB.query('COMMIT');

        // 验证结果为 claim→release→claim，无死锁
        const runs = await adminClient.query(
          'SELECT id, status FROM public.sync_run WHERE warehouse_id = $1 ORDER BY started_at',
          [WH_PH],
        );
        expect(runs.rows.length).toBe(2);
        expect(runs.rows[0].status).toBe('completed');
        expect(runs.rows[1].status).toBe('in_progress');
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });

    it('B2: claim-vs-cleanup 无 deadlock — cleanup 回收后 claim 成功 (双 Client)', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: claim（短租约 30s）
        await clientA.query('BEGIN');
        await clientA.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 30, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId1, ADMIN_ID],
        );
        await clientA.query('COMMIT');

        // 手动过期
        await adminClient.query(
          "UPDATE public.sync_run SET lease_expires_at = now() - INTERVAL '1 second' WHERE id = $1",
          [runId1],
        );

        // A: cleanup 回收过期
        await clientA.query('BEGIN');
        const cleaned = await clientA.query('SELECT public.cleanup_expired_sync_runs() AS count');
        expect(parseInt(cleaned.rows[0].count)).toBe(1);
        await clientA.query('COMMIT');

        // B: claim 应成功（cleanup 已清锁）
        await clientB.query('BEGIN');
        const resB = await clientB.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
          [WH_PH, runId2, ADMIN_ID],
        );
        expect(resB.rows[0].id).toBe(runId2);
        await clientB.query('COMMIT');

        // 验证旧运行被标记 failed
        const oldRun = await adminClient.query(
          'SELECT status, exit_code FROM public.sync_run WHERE id = $1',
          [runId1],
        );
        expect(oldRun.rows[0].status).toBe('failed');
        expect(oldRun.rows[0].exit_code).toBe(2);
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });
  });

  // ============================================================
  // 组 C: Real Write dry_run_run_id 原子验证
  // ============================================================
  describe('组 C: Real Write atomic dry_run_run_id 验证', () => {
    it('C1: warehouse 不匹配 → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { whId: WH_PH });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_VN, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/warehouse 不匹配/);
      await cleanup();
    });

    it('C2: Dry Run mode 不是 dry_run → 拒绝', async () => {
      await seedBase(adminClient);
      const refDryRunId = uuid();
      await createCompletedDryRun(refDryRunId);
      const rwRefId = uuid();
      await adminClient.query(
        `INSERT INTO public.sync_run (
          id, warehouse_id, mode, status, triggered_by, triggered_from,
          started_at, finished_at, created_at, exit_code,
          result_summary, plan_drift_check, plan_drift_count,
          plan_drift_differences, input_artifact_hash, plan_artifact_hash,
          dry_run_run_id
        ) VALUES (
          $1, $2, 'real_write', 'completed', $3, 'web',
          now() - INTERVAL '10 minutes', now() - INTERVAL '5 minutes', now() - INTERVAL '10 minutes', 0,
          '{"ok":true}'::jsonb, 'PASS', 0,
          '[]'::jsonb, 'input-hash-001', 'plan-hash-001',
          $4
        )`,
        [rwRefId, WH_PH, ADMIN_ID, refDryRunId],
      );
      const rwRunId = uuid();

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, rwRefId],
        ),
      ).rejects.toThrow(/mode 不是 dry_run/);
      await cleanup();
    });

    it('C3: Dry Run status 不是 completed → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { status: 'failed' });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/状态必须是 completed/);
      await cleanup();
    });

    it('C4: plan_drift_check 不是 PASS → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { planDriftCheck: 'DRIFT_DETECTED' });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/plan_drift_check 必须是 PASS/);
      await cleanup();
    });

    it('C5: finished_at > 60 分钟 → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { finishedAtOffset: '-61 minutes' });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/已过期/);
      await cleanup();
    });

    it('C6: input_artifact_hash 不匹配 → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { inputHash: 'correct-input-hash' });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'wrong-input-hash', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/input_artifact_hash 不匹配/);
      await cleanup();
    });

    it('C7: plan_artifact_hash 不匹配 → 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { planHash: 'correct-plan-hash' });

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'wrong-plan-hash') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/plan_artifact_hash 不匹配/);
      await cleanup();
    });

    it('C8: 全部 7 条件通过 → claim 成功', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { finishedAtOffset: '-5 minutes' });

      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
        [WH_PH, rwRunId, ADMIN_ID, dryRunId],
      );
      expect(result.rows[0].id).toBe(rwRunId);

      const run = await adminClient.query(
        'SELECT mode, dry_run_run_id FROM public.sync_run WHERE id = $1',
        [rwRunId],
      );
      expect(run.rows[0].mode).toBe('real_write');
      expect(run.rows[0].dry_run_run_id).toBe(dryRunId);
      await cleanup();
    });
  });

  // ============================================================
  // 组 D: 执行顺序验证 + TOCTOU 保护（双 Client）
  // ============================================================
  describe('组 D: 执行顺序验证 + TOCTOU 保护 (双 Client)', () => {
    it('D1: dry_run_run_id 验证在 advisory lock 之后 — claim_sync_run 在锁释放后才执行验证 (双 Client)', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createCompletedDryRun(dryRunId, { finishedAtOffset: '-5 minutes' });

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: 手动获取 advisory lock 并保持事务打开
        await clientA.query('BEGIN');
        await clientA.query(
          "SELECT pg_advisory_xact_lock(hashtext('sync_run:' || $1))",
          [WH_PH],
        );

        // B: 尝试 claim_sync_run real_write → 将阻塞在 advisory lock
        await clientB.query('BEGIN');
        const bPromise = clientB.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        );

        await sleep(1000); // 确保 B 已阻塞

        // 验证 B 尚未创建 sync_run（仍在等锁）
        const midCheck = await adminClient.query(
          'SELECT count(*) as c FROM public.sync_run WHERE id = $1',
          [rwRunId],
        );
        expect(parseInt(midCheck.rows[0].c)).toBe(0);

        // A 释放锁
        await clientA.query('COMMIT');

        // B 解除阻塞，dry_run 验证通过，claim 成功
        const resB = await bPromise;
        expect(resB.rows[0].id).toBe(rwRunId);
        await clientB.query('COMMIT');

        // 验证创建成功
        const finalCheck = await adminClient.query(
          'SELECT mode, dry_run_run_id FROM public.sync_run WHERE id = $1',
          [rwRunId],
        );
        expect(finalCheck.rows[0].mode).toBe('real_write');
        expect(finalCheck.rows[0].dry_run_run_id).toBe(dryRunId);
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });

    it('D2: FOR UPDATE 行锁保护 dry_run — 显式锁持有期间并发 UPDATE 确定被阻塞 (双 Client)', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      await createCompletedDryRun(dryRunId, { finishedAtOffset: '-5 minutes' });

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: 显式 SELECT ... FOR UPDATE 持有 dry_run 行锁
        await clientA.query('BEGIN');
        await clientA.query(
          'SELECT id FROM public.sync_run WHERE id = $1 FOR UPDATE',
          [dryRunId],
        );
        // A 的事务现在持有 FOR UPDATE 行锁 on dry_run

        // B: 尝试 UPDATE 同一 dry_run 行 → 必须被阻塞
        await clientB.query('BEGIN');
        await clientB.query("SET LOCAL lock_timeout = '3s'");

        // 确定性断言: B 在 FOR UPDATE 锁持有期间必须触发 lock_timeout
        await expect(
          clientB.query(
            "UPDATE public.sync_run SET plan_drift_check = 'DRIFT_DETECTED' WHERE id = $1",
            [dryRunId],
          ),
        ).rejects.toThrow(/lock|timeout|cancel|锁|超时|取消/i);
        await clientB.query('ROLLBACK');

        // 验证 dry_run 的 plan_drift_check 未被篡改 (A 的锁保护生效)
        const drDuring = await adminClient.query(
          'SELECT plan_drift_check FROM public.sync_run WHERE id = $1',
          [dryRunId],
        );
        expect(drDuring.rows[0].plan_drift_check).toBe('PASS');

        // A: 释放 FOR UPDATE 锁
        await clientA.query('COMMIT');

        // 锁释放后 B 可以成功 UPDATE（证明阻塞根源是 FOR UPDATE 锁）
        await clientB.query('BEGIN');
        await clientB.query(
          "UPDATE public.sync_run SET plan_drift_check = 'DRIFT_DETECTED' WHERE id = $1",
          [dryRunId],
        );
        await clientB.query('COMMIT');

        const drAfter = await adminClient.query(
          'SELECT plan_drift_check FROM public.sync_run WHERE id = $1',
          [dryRunId],
        );
        expect(drAfter.rows[0].plan_drift_check).toBe('DRIFT_DETECTED');
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });
  });

  // ============================================================
  // 组 E: 时钟边界
  // ============================================================
  describe('组 E: 时钟边界', () => {
    async function createDryRunWithFinishedAge(dryRunId: string, ageMinutes: number): Promise<void> {
      await adminClient.query(
        `INSERT INTO public.sync_run (
          id, warehouse_id, mode, status, triggered_by, triggered_from,
          started_at, created_at, exit_code,
          result_summary, plan_drift_check, plan_drift_count,
          plan_drift_differences, input_artifact_hash, plan_artifact_hash,
          finished_at
        ) VALUES (
          $1, $2, 'dry_run', 'completed', $3, 'web',
          now() - ($4 || ' minutes')::interval - INTERVAL '1 minute',
          now() - ($4 || ' minutes')::interval, 0,
          '{"ok":true}'::jsonb, 'PASS', 0,
          '[]'::jsonb, 'input-hash', 'plan-hash',
          now() - ($4 || ' minutes')::interval
        )`,
        [dryRunId, WH_PH, ADMIN_ID, String(ageMinutes)],
      );
    }

    it('E1: finished_at = 59 分钟前 → claim 成功（边界内）', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createDryRunWithFinishedAge(dryRunId, 59);

      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash', 'plan-hash') AS id`,
        [WH_PH, rwRunId, ADMIN_ID, dryRunId],
      );
      expect(result.rows[0].id).toBe(rwRunId);
      await cleanup();
    });

    it('E2: finished_at = 61 分钟前 → claim 拒绝（边界外）', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();
      await createDryRunWithFinishedAge(dryRunId, 61);

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash', 'plan-hash') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/已过期/);
      await cleanup();
    });
  });

  // ============================================================
  // 组 F: heartbeat vs claim 并发 (V5.5)
  // ============================================================
  describe('组 F: heartbeat vs claim 并发 (V5.5)', () => {
    it('F1: heartbeat 续租后 claim 读到最新 lease_expires_at — 不回收', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 30, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId1, ADMIN_ID],
      );
      await adminClient.query('SELECT public.heartbeat_sync_run($1, 900)', [runId1]);

      const run = await adminClient.query(
        'SELECT lease_expires_at FROM public.sync_run WHERE id = $1',
        [runId1],
      );
      const expiry = new Date(run.rows[0].lease_expires_at);
      const diffSeconds = (expiry.getTime() - Date.now()) / 1000;
      expect(diffSeconds).toBeGreaterThan(800);

      const res2 = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
        [WH_PH, runId2, ADMIN_ID],
      );
      expect(res2.rows[0].id).toBeNull();
      await cleanup();
    });

    it('F2: heartbeat vs claim 真实并发 — FOR UPDATE 行锁阻止并发 heartbeat UPDATE (双 Client)', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: claim 创建 in_progress sync_run
        await clientA.query('BEGIN');
        await clientA.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId1, ADMIN_ID],
        );
        await clientA.query('COMMIT');

        // 验证 runId1 已创建
        const runCheck = await adminClient.query(
          'SELECT status FROM public.sync_run WHERE id = $1',
          [runId1],
        );
        expect(runCheck.rows[0].status).toBe('in_progress');

        // B: 显式 SELECT ... FOR UPDATE 持有 A 的 in_progress run 行锁
        await clientB.query('BEGIN');
        await clientB.query(
          'SELECT id FROM public.sync_run WHERE id = $1 FOR UPDATE',
          [runId1],
        );
        // B 的事务现在持有 FOR UPDATE on runId1

        // A: 尝试 heartbeat → UPDATE 需要行锁，被 B 的 FOR UPDATE 阻塞
        await clientA.query('BEGIN');
        await clientA.query("SET LOCAL lock_timeout = '3s'");

        // 确定性断言: heartbeat 在 FOR UPDATE 锁持有期间必须触发 lock_timeout
        await expect(
          clientA.query('SELECT public.heartbeat_sync_run($1, 900)', [runId1]),
        ).rejects.toThrow(/lock|timeout|cancel|锁|超时|取消/i);
        await clientA.query('ROLLBACK');

        // B: 释放 FOR UPDATE 锁
        await clientB.query('COMMIT');

        // 锁释放后 heartbeat 可以成功（不抛异常即为成功，函数 RETURNS void）
        await clientA.query('BEGIN');
        await clientA.query(
          'SELECT public.heartbeat_sync_run($1, 900)', [runId1],
        );
        await clientA.query('COMMIT');

        // 验证 runId1 仍为 in_progress 且租约已刷新
        const finalRun = await adminClient.query(
          'SELECT status, lease_expires_at FROM public.sync_run WHERE id = $1',
          [runId1],
        );
        expect(finalRun.rows[0].status).toBe('in_progress');
        expect(finalRun.rows[0].lease_expires_at).not.toBeNull();
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });
  });

  // ============================================================
  // 组 G: 仓库停用 vs claim 并发 (V5.5)（双 Client）
  // ============================================================
  describe('组 G: 仓库停用 vs claim 并发 (V5.5) (双 Client)', () => {
    it('G1: lock 等待期间仓库被停用 → claim 失败且不创建 sync_run (双 Client)', async () => {
      await seedBase(adminClient);
      const runId = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: 手动获取 advisory lock 并保持事务打开
        await clientA.query('BEGIN');
        await clientA.query(
          "SELECT pg_advisory_xact_lock(hashtext('sync_run:' || $1))",
          [WH_PH],
        );

        // B: 尝试 claim → 阻塞在 advisory lock
        await clientB.query('BEGIN');
        const bPromise = clientB.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId, ADMIN_ID],
        );

        await sleep(1000); // 确保 B 已阻塞

        // A: 在 B 等待期间停用仓库
        await clientA.query(
          'UPDATE public.warehouse SET is_active = false WHERE id = $1',
          [WH_PH],
        );
        await clientA.query('COMMIT');

        try {
          // B: 解除阻塞 → claim_sync_run 验证 is_active → 拒绝
          await expect(bPromise).rejects.toThrow(/已停用/);
          try { await clientB.query('ROLLBACK'); } catch { /* ignore */ }

          // 验证没有创建 sync_run
          const runs = await adminClient.query(
            'SELECT count(*) as c FROM public.sync_run WHERE warehouse_id = $1',
            [WH_PH],
          );
          expect(parseInt(runs.rows[0].c)).toBe(0);
        } finally {
          // 恢复仓库状态（即使断言失败也要恢复）
          await adminClient.query(
            'UPDATE public.warehouse SET is_active = true WHERE id = $1',
            [WH_PH],
          );
        }
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });
  });

  // ============================================================
  // 组 H: lease_duration 边界
  // ============================================================
  describe('组 H: lease_duration 边界', () => {
    it('H1: NULL → 拒绝', async () => {
      await seedBase(adminClient);
      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0001-4000-8000-000000000001', NULL, $2, 'web') AS id`,
          [WH_PH, ADMIN_ID],
        ),
      ).rejects.toThrow(/lease_duration 必须在/);
      await cleanup();
    });

    it('H2: 29 → 拒绝', async () => {
      await seedBase(adminClient);
      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0002-4000-8000-000000000001', 29, $2, 'web', NULL, 'hash', NULL) AS id`,
          [WH_PH, ADMIN_ID],
        ),
      ).rejects.toThrow(/lease_duration 必须在/);
      await cleanup();
    });

    it('H3: 30 → 接受', async () => {
      await seedBase(adminClient);
      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0003-4000-8000-000000000001', 30, $2, 'web', NULL, 'hash', NULL) AS id`,
        [WH_PH, ADMIN_ID],
      );
      expect(result.rows[0].id).toBe('ffffffff-0003-4000-8000-000000000001');
      await cleanup();
    });

    it('H4: 300 → 接受', async () => {
      await seedBase(adminClient);
      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0004-4000-8000-000000000001', 300, $2, 'web', NULL, 'hash', NULL) AS id`,
        [WH_PH, ADMIN_ID],
      );
      expect(result.rows[0].id).toBe('ffffffff-0004-4000-8000-000000000001');
      await cleanup();
    });

    it('H5: 900 → 接受', async () => {
      await seedBase(adminClient);
      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0005-4000-8000-000000000001', 900, $2, 'web', NULL, 'hash', NULL) AS id`,
        [WH_PH, ADMIN_ID],
      );
      expect(result.rows[0].id).toBe('ffffffff-0005-4000-8000-000000000001');
      await cleanup();
    });

    it('H6: 901 → 拒绝', async () => {
      await seedBase(adminClient);
      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'dry_run', 'ffffffff-0006-4000-8000-000000000001', 901, $2, 'web', NULL, 'hash', NULL) AS id`,
          [WH_PH, ADMIN_ID],
        ),
      ).rejects.toThrow(/lease_duration 必须在/);
      await cleanup();
    });
  });

  // ============================================================
  // 组 I: release 锁管理
  // ============================================================
  describe('组 I: release 锁管理', () => {
    it('I1: release 使用 hashtext 键获取 advisory lock', async () => {
      await seedBase(adminClient);
      const runId = uuid();

      await adminClient.query(
        `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash01', NULL) AS id`,
        [WH_PH, runId, ADMIN_ID],
      );
      await adminClient.query(
        `SELECT public.release_sync_run($1, 'completed', 0, NULL,
          '{"ok":true}'::jsonb, 'PASS', 0, '[]'::jsonb, 'plan-hash')`,
        [runId],
      );

      const run = await adminClient.query(
        'SELECT status, exit_code FROM public.sync_run WHERE id = $1',
        [runId],
      );
      expect(run.rows[0].status).toBe('completed');
      expect(run.rows[0].exit_code).toBe(0);
      await cleanup();
    });

    it('I2: cleanup 按 warehouse_id 排序遍历', async () => {
      await seedBase(adminClient);
      await adminClient.query(
        `INSERT INTO public.sync_run (id, warehouse_id, mode, status, triggered_by, triggered_from,
          lease_expires_at, started_at, created_at, input_artifact_hash)
         VALUES
         ('f2f2f2f2-1001-4000-8000-000000000001', $1, 'dry_run', 'in_progress', $3, 'web',
          now() - INTERVAL '1 hour', now() - INTERVAL '1 hour', now() - INTERVAL '1 hour', 'hash'),
         ('f2f2f2f2-1002-4000-8000-000000000002', $2, 'dry_run', 'in_progress', $3, 'web',
          now() - INTERVAL '1 hour', now() - INTERVAL '1 hour', now() - INTERVAL '1 hour', 'hash')`,
        [WH_PH, WH_VN, ADMIN_ID],
      );

      const cleaned = await adminClient.query('SELECT public.cleanup_expired_sync_runs() AS count');
      expect(parseInt(cleaned.rows[0].count)).toBe(2);
      await cleanup();
    });
  });

  // ============================================================
  // 组 J: GC vs Claim 安全（双 Client）
  // ============================================================
  describe('组 J: GC vs Claim 安全 (双 Client)', () => {
    it('J1: artifact.createdAt 与 finished_at 独立验证', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      await adminClient.query(
        `INSERT INTO public.sync_run (
          id, warehouse_id, mode, status, triggered_by, triggered_from,
          started_at, finished_at, created_at, exit_code,
          result_summary, plan_drift_check, plan_drift_count,
          plan_drift_differences, input_artifact_hash, plan_artifact_hash
        ) VALUES (
          $1, $2, 'dry_run', 'completed', $3, 'web',
          now() - INTERVAL '8 days', now() - INTERVAL '30 minutes',
          now() - INTERVAL '8 days', 0,
          '{"ok":true}'::jsonb, 'PASS', 0,
          '[]'::jsonb, 'input-hash-001', 'plan-hash-001'
        )`,
        [dryRunId, WH_PH, ADMIN_ID],
      );

      const dr = await adminClient.query(
        'SELECT finished_at, created_at FROM public.sync_run WHERE id = $1',
        [dryRunId],
      );
      const finishedAt = new Date(dr.rows[0].finished_at);
      const createdAt = new Date(dr.rows[0].created_at);
      const diffMs = finishedAt.getTime() - createdAt.getTime();
      expect(diffMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);

      const rwRunId = uuid();
      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
        [WH_PH, rwRunId, ADMIN_ID, dryRunId],
      );
      expect(result.rows[0].id).toBe(rwRunId);
      await cleanup();
    });

    it('J2: Dry Run 超 60 分钟被 Real Write 引用 → claim 拒绝', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();

      await adminClient.query(
        `INSERT INTO public.sync_run (
          id, warehouse_id, mode, status, triggered_by, triggered_from,
          started_at, finished_at, created_at, exit_code,
          result_summary, plan_drift_check, plan_drift_count,
          plan_drift_differences, input_artifact_hash, plan_artifact_hash
        ) VALUES (
          $1, $2, 'dry_run', 'completed', $3, 'web',
          now() - INTERVAL '2 hours', now() - INTERVAL '90 minutes',
          now() - INTERVAL '2 hours', 0,
          '{"ok":true}'::jsonb, 'PASS', 0,
          '[]'::jsonb, 'input-hash-001', 'plan-hash-001'
        )`,
        [dryRunId, WH_PH, ADMIN_ID],
      );

      await expect(
        adminClient.query(
          `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
          [WH_PH, rwRunId, ADMIN_ID, dryRunId],
        ),
      ).rejects.toThrow(/已过期/);
      await cleanup();
    });

    it('J3: Dry Run 刚完成（5 分钟）→ claim 成功', async () => {
      await seedBase(adminClient);
      const dryRunId = uuid();
      const rwRunId = uuid();

      await adminClient.query(
        `INSERT INTO public.sync_run (
          id, warehouse_id, mode, status, triggered_by, triggered_from,
          started_at, finished_at, created_at, exit_code,
          result_summary, plan_drift_check, plan_drift_count,
          plan_drift_differences, input_artifact_hash, plan_artifact_hash
        ) VALUES (
          $1, $2, 'dry_run', 'completed', $3, 'web',
          now() - INTERVAL '10 minutes', now() - INTERVAL '5 minutes',
          now() - INTERVAL '10 minutes', 0,
          '{"ok":true}'::jsonb, 'PASS', 0,
          '[]'::jsonb, 'input-hash-001', 'plan-hash-001'
        )`,
        [dryRunId, WH_PH, ADMIN_ID],
      );

      const result = await adminClient.query(
        `SELECT public.claim_sync_run($1, 'real_write', $2, 300, $3, 'web', $4, 'input-hash-001', 'plan-hash-001') AS id`,
        [WH_PH, rwRunId, ADMIN_ID, dryRunId],
      );
      expect(result.rows[0].id).toBe(rwRunId);
      await cleanup();
    });

    it('J4: cleanup 回收过期 → lock 清除 → claim 可重新获取 (双 Client)', async () => {
      await seedBase(adminClient);
      const runId1 = uuid();
      const runId2 = uuid();

      const clientA = createClient();
      const clientB = createClient();

      try {
        await connectBoth(clientA, clientB);

        // A: claim 过期 + cleanup 回收
        await clientA.query('BEGIN');
        await clientA.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 30, $3, 'web', NULL, 'hash01', NULL) AS id`,
          [WH_PH, runId1, ADMIN_ID],
        );
        await clientA.query('COMMIT');

        // 手动过期
        await adminClient.query(
          "UPDATE public.sync_run SET lease_expires_at = now() - INTERVAL '1 hour' WHERE id = $1",
          [runId1],
        );

        // Cleanup 回收
        const cleaned = await adminClient.query('SELECT public.cleanup_expired_sync_runs() AS count');
        expect(parseInt(cleaned.rows[0].count)).toBe(1);

        // 验证锁已清除
        const lock = await adminClient.query(
          'SELECT locked_by FROM public.sync_warehouse_lock WHERE warehouse_id = $1',
          [WH_PH],
        );
        expect(lock.rows[0].locked_by).toBeNull();

        // B: 重新 claim 成功
        await clientB.query('BEGIN');
        const resB = await clientB.query(
          `SELECT public.claim_sync_run($1, 'dry_run', $2, 300, $3, 'web', NULL, 'hash02', NULL) AS id`,
          [WH_PH, runId2, ADMIN_ID],
        );
        expect(resB.rows[0].id).toBe(runId2);
        await clientB.query('COMMIT');
      } finally {
        await endBoth(clientA, clientB);
        await cleanup();
      }
    });
  });
});
