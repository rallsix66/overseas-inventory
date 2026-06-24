-- ============================================
-- 00010 — claim_sync_run_system RPC
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY10E 返工：定时 Cron 路径无法使用 claim_sync_run，
-- 因为 claim_sync_run 要求 auth.uid() 绑定用户 session。
-- Cron Route 通过 API key 鉴权，没有用户 session。
--
-- claim_sync_run_system 使用 service_role 调用，
-- 内部验证 p_triggered_by 是真实存在的激活管理员，
-- 而非依赖 auth.uid()。
--
-- 关键差异：
--   1. 无 auth.uid() 校验 — 允许 service_role 调用
--   2. 验证 p_triggered_by 对应 profiles 用户存在、is_active=true、role=admin
--   3. 仅允许 p_mode='dry_run' — 禁止 system path 触发 real_write
--   4. 复用 claim_sync_run 的并发锁、warehouse 校验、lease、僵尸回收逻辑
--   5. 无 real_write dry_run_run_id 验证分支（仅 dry_run）
--
-- 权限：
--   REVOKE FROM PUBLIC, anon, authenticated
--   GRANT TO service_role
--
-- 锁顺序（与 claim_sync_run 一致）：
--   Step 4: pg_advisory_xact_lock
--   Step 5: SELECT FOR UPDATE on sync_warehouse_lock
--   Step 5.5: SELECT FOR UPDATE on in_progress sync_run
--   Step 5.6: clock_timestamp()
--   Step 7: INSERT
--   Step 8: UPDATE sync_warehouse_lock
-- ============================================

CREATE OR REPLACE FUNCTION public.claim_sync_run_system(
  p_warehouse_id         uuid,
  p_mode                 text,
  p_run_id               uuid,
  p_lease_duration       integer,
  p_triggered_by         uuid,
  p_triggered_from       text,
  p_input_artifact_hash  text    DEFAULT NULL
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
BEGIN
  -- ============================================
  -- Step 1: 验证系统触发用户有效性
  -- 不依赖 auth.uid()，直接查询 profiles + role
  -- ============================================
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role r ON r.id = p.role_id
    WHERE p.id = p_triggered_by
      AND p.is_active = true
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION '系统触发用户无效：必须是存在的激活管理员 (id=%)', p_triggered_by
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- Step 2: 参数校验
  -- ============================================
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '无效的仓库 ID' USING ERRCODE = 'P0001';
  END IF;

  -- 仅允许 dry_run — system path 禁止触发 real_write
  IF p_mode != 'dry_run' THEN
    RAISE EXCEPTION '系统路径仅允许 dry_run 模式，实际: %', p_mode USING ERRCODE = 'P0001';
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

  -- ============================================
  -- Step 3: 校验 warehouse 存在、overseas 类型、is_active
  -- ============================================
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

  -- ============================================
  -- Step 4: pg_advisory_xact_lock（第一层防御）
  -- ============================================
  PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || p_warehouse_id));

  -- ============================================
  -- Step 5: SELECT FOR UPDATE on sync_warehouse_lock（第二层防御）
  -- ============================================
  SELECT swl.locked_by
  INTO v_locked_by
  FROM public.sync_warehouse_lock swl
  WHERE swl.warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行不存在: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- Step 5.5: SELECT FOR UPDATE on in_progress sync_run
  -- 阻止并发 heartbeat 续租：行锁保证 lease_expires_at
  -- 为锁获取时的最新值，不会被中途覆盖
  -- ============================================
  SELECT id, lease_expires_at
  INTO v_in_progress, v_lease_exp
  FROM public.sync_run
  WHERE warehouse_id = p_warehouse_id
    AND status = 'in_progress'
  FOR UPDATE;

  -- Step 5.6: 获取行锁后刷新临界区时间
  v_now := clock_timestamp();

  -- Step 5.7: 判断租约状态
  IF FOUND THEN
    IF v_lease_exp IS NOT NULL AND v_lease_exp < v_now THEN
      -- 租约已过期 → 僵尸回收
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
      -- 有效租约（含 heartbeat 续租），无法获取锁
      RETURN NULL;
    END IF;
  END IF;

  -- ============================================
  -- Step 7: INSERT 新 sync_run 记录
  -- ============================================
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
    NULL, -- system path never has dry_run_run_id
    p_input_artifact_hash, NULL,
    p_run_id, v_now + (p_lease_duration || ' seconds')::interval
  );

  -- ============================================
  -- Step 8: 更新锁表
  -- ============================================
  UPDATE public.sync_warehouse_lock
  SET locked_by = p_run_id, locked_at = v_now
  WHERE warehouse_id = p_warehouse_id;

  RETURN p_run_id;
END;
$$;

-- ============================================
-- 权限：仅 service_role 可执行
-- ============================================

REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) TO service_role;

-- ============================================
-- 静态验证注释
-- ============================================
-- [ ] claim_sync_run_system 使用 SECURITY DEFINER + SET search_path = ''
-- [ ] claim_sync_run_system 无 auth.uid() 调用（与 claim_sync_run 的关键差异）
-- [ ] claim_sync_run_system 验证 p_triggered_by 是真实存在的激活管理员
-- [ ] claim_sync_run_system 仅允许 p_mode='dry_run'（拒绝 real_write）
-- [ ] claim_sync_run_system 复用 claim_sync_run 的并发锁顺序（advisory → warehouse FOR UPDATE → sync_run FOR UPDATE → v_now → INSERT）
-- [ ] claim_sync_run_system 僵尸回收 exit_code=2 + finished_at = v_now
-- [ ] claim_sync_run_system 有效租约返回 NULL
-- [ ] claim_sync_run_system 参数校验：lease_duration [30, 900]、triggered_from web/cli
-- [ ] claim_sync_run_system warehouse 校验：存在、overseas 类型、is_active
-- [ ] claim_sync_run_system INSERT 写入 triggered_by, triggered_from, heartbeat_at, created_at
-- [ ] claim_sync_run_system 无 real_write dry_run_run_id 验证分支
-- [ ] claim_sync_run_system dry_run_run_id 固定为 NULL
-- [ ] claim_sync_run_system plan_artifact_hash 固定为 NULL（dry_run 在 release 时写入）
-- [ ] claim_sync_run_system REVOKE FROM PUBLIC, anon, authenticated
-- [ ] claim_sync_run_system GRANT TO service_role
-- [ ] claim_sync_run 未修改（仍要求 auth.uid() + admin）
-- [ ] 不修改已执行 Migration 00007/00008/00009
