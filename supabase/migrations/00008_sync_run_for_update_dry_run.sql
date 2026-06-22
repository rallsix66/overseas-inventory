-- ============================================
-- 00008 — claim_sync_run: FOR UPDATE on dry_run row
-- 严格前向一次性 Migration
-- ============================================
-- V5.5.1: Step 6 dry_run_run_id 验证增加 FOR UPDATE
--   关闭 TOCTOU 窗口：防止并发 service_role 直接 UPDATE
--   dry_run 行的 plan_drift_check / artifact_hash
--   在 claim_sync_run 验证通过后、INSERT 前被篡改。
--
--   锁顺序（更新后）：
--     Step 4: pg_advisory_xact_lock
--     Step 5: SELECT FOR UPDATE on sync_warehouse_lock
--     Step 5.5: SELECT FOR UPDATE on in_progress sync_run
--     Step 5.6: clock_timestamp()
--     Step 6: SELECT FOR UPDATE on dry_run row (NEW)
--     Step 7: INSERT
-- ============================================

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
  -- 移到 warehouse 验证之前，关闭 is_active 检查 TOCTOU 窗口
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

-- ============================================
-- 锁顺序验证 (V5.5.1)
-- ============================================
-- 锁顺序 (V5.5.1 更新)：
-- Step 3 (V5.5.1): PERFORM pg_advisory_xact_lock（第一层，移到 warehouse 验证前）
-- Step 4: Validate warehouse — is_active 检查在 advisory lock 保护区内
-- Step 5: SELECT FOR UPDATE on sync_warehouse_lock（第二层）
-- Step 5.5 (V5.5): SELECT FOR UPDATE on in_progress sync_run（行锁护租约）
-- Step 5.6: clock_timestamp() 刷新临界区时间
-- Step 6 (V5.5.1): SELECT FOR UPDATE on dry_run row（关闭 TOCTOU）
-- Step 7: INSERT sync_run（第三层：idx_sync_run_one_in_progress 兜底）
-- 确认：dry_run 行 FOR UPDATE 在 advisory lock 之后、INSERT 之前 ✓
-- 确认：FOR UPDATE 阻止并发修改 plan_drift_check / artifact_hash ✓
-- 确认：is_active 在锁后检查，关闭仓库停用 TOCTOU 窗口 ✓
