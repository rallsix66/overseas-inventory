-- ============================================
-- 00007 — sync_run 同步运行管理
-- 严格前向一次性 Migration：
--   CREATE TABLE 不用 IF NOT EXISTS
--   ALTER TABLE ADD COLUMN 不用 IF NOT EXISTS
--   仅函数使用 CREATE OR REPLACE FUNCTION
-- ============================================
-- 包含：
--   1. sync_run 表（11 CHECK + 部分唯一索引）
--   2. sync_warehouse_lock 表 + trigger + 补建
--   3. sync_log 表扩展（5 列 + FK/CHECK 约束）
--   4. RLS：sync_run 仅 service_role
--   5. 6 个 SECURITY DEFINER RPC
--   6. 完整 REVOKE/GRANT 权限收口
-- ============================================

-- ============================================
-- Part 1: sync_run 表
-- ============================================

CREATE TABLE public.sync_run (
  id                      uuid        PRIMARY KEY,
  -- id 无 DEFAULT gen_random_uuid()，由 SyncService 通过 crypto.randomUUID() 预生成

  warehouse_id            uuid        NOT NULL REFERENCES public.warehouse(id) ON DELETE CASCADE,
  mode                    text        NOT NULL CHECK (mode IN ('dry_run', 'real_write')),
  status                  text        NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed', 'failed')),

  -- 触发者审计
  triggered_by            uuid        NOT NULL REFERENCES public.profiles(id),
  triggered_from          text        NOT NULL CHECK (triggered_from IN ('web', 'cli')),

  -- 时间戳
  started_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz,
  heartbeat_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  exit_code               integer,
  error_message           text,

  -- 结构化结果摘要
  result_summary          jsonb,

  -- Dry Run 字段
  plan_drift_check        text        CHECK (plan_drift_check IN ('PASS', 'DRIFT_DETECTED')),
  plan_drift_count        integer     CHECK (plan_drift_count >= 0),
  plan_drift_differences  jsonb,

  -- Real Write 绑定
  dry_run_run_id          uuid        REFERENCES public.sync_run(id),

  -- Artifact hashes (SHA-256 hex digest)
  input_artifact_hash     text,
  plan_artifact_hash      text,

  -- 锁管理（由 claim RPC 设置，release/cleanup 清除）
  locked_by               uuid,
  lease_expires_at        timestamptz,

  -- ============================================
  -- 11 个 CHECK 约束
  -- ============================================

  -- CHK-01: 时间合理性
  CONSTRAINT sync_run_time_check
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),

  -- CHK-02: Real Write 必须绑定一个 Dry Run
  CONSTRAINT real_write_requires_dry_run
    CHECK (mode != 'real_write' OR dry_run_run_id IS NOT NULL),

  -- CHK-03: Real Write 必须同时具有 input 和 plan artifact hash
  CONSTRAINT real_write_requires_artifacts
    CHECK (mode != 'real_write' OR (input_artifact_hash IS NOT NULL AND plan_artifact_hash IS NOT NULL)),

  -- CHK-04: Dry Run 必须具有 input artifact hash
  CONSTRAINT dry_run_requires_input_artifact
    CHECK (mode != 'dry_run' OR input_artifact_hash IS NOT NULL),

  -- CHK-05: completed 状态必需全部终态字段（含 result_summary）
  CONSTRAINT completed_requires_fields
    CHECK (status != 'completed' OR (
      finished_at IS NOT NULL
      AND exit_code IS NOT NULL
      AND result_summary IS NOT NULL
      AND plan_drift_check IS NOT NULL
      AND plan_drift_count IS NOT NULL
      AND plan_drift_differences IS NOT NULL
    )),

  -- CHK-06: plan_drift_check 仅可为 PASS 或 DRIFT_DETECTED
  CONSTRAINT plan_drift_check_enum
    CHECK (plan_drift_check IS NULL OR plan_drift_check IN ('PASS', 'DRIFT_DETECTED')),

  -- CHK-07: plan_drift_count 非负
  CONSTRAINT plan_drift_count_non_negative
    CHECK (plan_drift_count IS NULL OR plan_drift_count >= 0),

  -- CHK-08: failed 状态必需 finished_at + error_message 且 exit_code ∈ {1,2}
  CONSTRAINT failed_requires_fields
    CHECK (status != 'failed' OR (
      finished_at IS NOT NULL
      AND error_message IS NOT NULL
      AND exit_code IN (1, 2)
    )),

  -- CHK-09: completed 状态 exit_code 必须为 0
  CONSTRAINT completed_exit_code_zero
    CHECK (status != 'completed' OR exit_code = 0),

  -- CHK-10: plan_drift_differences 数组长度必须等于 plan_drift_count
  CONSTRAINT plan_drift_differences_length
    CHECK (
      plan_drift_differences IS NULL
      OR plan_drift_count IS NULL
      OR jsonb_array_length(plan_drift_differences) = plan_drift_count
    ),

  -- CHK-11: completed Dry Run 必须具有 plan_artifact_hash
  -- （与 release_sync_run RPC v_mode 校验形成双重保障）
  CONSTRAINT completed_dry_run_requires_plan_artifact
    CHECK (
      NOT (status = 'completed' AND mode = 'dry_run')
      OR plan_artifact_hash IS NOT NULL
    )
);

-- 部分唯一索引：每个 warehouse 最多一个 in_progress 运行（第三层防御）
CREATE UNIQUE INDEX idx_sync_run_one_in_progress
  ON public.sync_run(warehouse_id)
  WHERE status = 'in_progress';

-- 常规索引
CREATE INDEX idx_sync_run_warehouse_id  ON public.sync_run(warehouse_id);
CREATE INDEX idx_sync_run_status        ON public.sync_run(status);
CREATE INDEX idx_sync_run_mode          ON public.sync_run(mode);
CREATE INDEX idx_sync_run_started_at    ON public.sync_run(started_at);
CREATE INDEX idx_sync_run_triggered_by  ON public.sync_run(triggered_by);
CREATE INDEX idx_sync_run_dry_run_ref   ON public.sync_run(dry_run_run_id)
  WHERE dry_run_run_id IS NOT NULL;

-- ============================================
-- Part 2: sync_warehouse_lock 表
-- ============================================

CREATE TABLE public.sync_warehouse_lock (
  warehouse_id uuid PRIMARY KEY REFERENCES public.warehouse(id) ON DELETE CASCADE,
  locked_by    uuid        REFERENCES public.sync_run(id) ON DELETE SET NULL,
  locked_at    timestamptz
);

-- Trigger 函数：新 warehouse 创建时自动插入锁行
CREATE OR REPLACE FUNCTION public.trg_sync_warehouse_lock_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.sync_warehouse_lock (warehouse_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger：warehouse INSERT 后触发
CREATE TRIGGER trg_warehouse_create_lock
  AFTER INSERT ON public.warehouse
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_warehouse_lock_insert();

-- 补建：已有海外仓且 is_active = true 的锁行
INSERT INTO public.sync_warehouse_lock (warehouse_id)
SELECT id
FROM public.warehouse
WHERE type = 'overseas'
  AND is_active = true
  AND id NOT IN (SELECT warehouse_id FROM public.sync_warehouse_lock);

-- ============================================
-- Part 3: sync_log 表扩展（5 列 + 约束）
-- ============================================

ALTER TABLE public.sync_log
  ADD COLUMN sync_run_id    uuid        REFERENCES public.sync_run(id) ON DELETE SET NULL;

ALTER TABLE public.sync_log
  ADD COLUMN triggered_by   uuid        REFERENCES public.profiles(id);

ALTER TABLE public.sync_log
  ADD COLUMN triggered_from text        NOT NULL DEFAULT 'cli'
                            CHECK (triggered_from IN ('web', 'cli'));

ALTER TABLE public.sync_log
  ADD COLUMN mode            text        NOT NULL DEFAULT 'real_write'
                            CHECK (mode = 'real_write');

ALTER TABLE public.sync_log
  ADD COLUMN exit_code       integer     CHECK (exit_code IS NULL OR exit_code IN (0, 1, 2));
-- exit_code: NULL（旧数据未回填）| 0（success）| 1（业务错误）| 2（系统清理）
-- 不设 DEFAULT：executor 必须显式传入 exit_code；
--   旧行保持 NULL（与 DEFAULT 1 明确区分，禁止 success 日志被默认写为 exit_code=1）

-- 索引
CREATE INDEX idx_sync_log_sync_run_id ON public.sync_log(sync_run_id);

-- ============================================
-- Part 4: RLS — sync_run 仅 service_role
-- ============================================

ALTER TABLE public.sync_run ENABLE ROW LEVEL SECURITY;

-- service_role 完整访问
CREATE POLICY "service_role_all_sync_run"
  ON public.sync_run
  FOR ALL
  TO service_role
  USING (true);

-- authenticated 用户不能直接 SELECT sync_run（必须通过 RPC）
-- 无需创建 authenticated 策略

-- sync_warehouse_lock RLS：仅 service_role
ALTER TABLE public.sync_warehouse_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_sync_warehouse_lock"
  ON public.sync_warehouse_lock
  FOR ALL
  TO service_role
  USING (true);

-- sync_log RLS 补充 service_role（service_role 写入 sync_log）
CREATE POLICY "service_role_all_sync_log"
  ON public.sync_log
  FOR ALL
  TO service_role
  USING (true);

-- ============================================
-- Part 5: claim_sync_run() RPC
-- ============================================
-- 三层防御：
--   第一层: pg_advisory_xact_lock（仓库级互斥）
--   第二层: SELECT FOR UPDATE on sync_warehouse_lock
--   第三层: idx_sync_run_one_in_progress 部分唯一索引
--
-- V5.4.1: real_write 模式 dry_run_run_id 行级验证在
--   advisory lock + FOR UPDATE 之后、INSERT 之前（锁保护区内）
--
-- V5.4.3 第一次聚焦返工：
--   - 新增 p_triggered_by / p_triggered_from 参数
--   - 修复 dry_run_run_id 验证 SELECT INTO 重复写入 v_dr_wh_id
--
-- V5.4.3 第五次聚焦返工：
--   - 锁顺序强化：advisory → warehouse FOR UPDATE → sync_run FOR UPDATE → v_now
--   - SELECT FOR UPDATE on in_progress sync_run 阻止并发 heartbeat 续租
--   - v_now 在 sync_run 行锁获取后生成，lease_expires_at 来自锁后行
--   - 有效租约（含 heartbeat 续租）返回 NULL，过期才标记 failed
--   - 同一 v_now 用于 Dry Run 有效期、lease 回收、新 lease 写入、
--     heartbeat_at、created_at
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
	  -- ============================================
	  -- Step 1: 仅 admin 可执行；禁止伪造审计身份
	  -- ============================================
	  IF auth.uid() IS NULL THEN
	    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
	  END IF;

	  -- IS DISTINCT FROM 拒绝 NULL role（get_user_role() 返回 NULL 时 != 'admin' 为 NULL 被当作 false）
	  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
	    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
	  END IF;

	  -- triggered_by 必须绑定 auth.uid()，禁止调用者伪造审计身份
	  IF p_triggered_by IS NULL OR p_triggered_by != auth.uid() THEN
	    RAISE EXCEPTION 'triggered_by 必须为当前登录用户' USING ERRCODE = 'P0001';
	  END IF;

	  -- ============================================
	  -- Step 2: 参数校验
	  -- ============================================
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
	  -- Step 5.5 (V5.5): SELECT FOR UPDATE on in_progress sync_run
	  -- 阻止并发 heartbeat 续租：行锁保证 lease_expires_at
	  -- 为锁获取时的最新值，不会被中途覆盖
	  -- 锁顺序：advisory → warehouse FOR UPDATE → sync_run FOR UPDATE
	  -- ============================================
	  SELECT id, lease_expires_at
	  INTO v_in_progress, v_lease_exp
	  FROM public.sync_run
	  WHERE warehouse_id = p_warehouse_id
	    AND status = 'in_progress'
	  FOR UPDATE;

	  -- Step 5.6: 获取行锁后刷新临界区时间（单次 clock_timestamp）
	  -- 同一 v_now 用于 lease 回收判断、Dry Run 有效期、
	  -- 新 lease 写入、heartbeat_at、created_at
	  v_now := clock_timestamp();

	  -- Step 5.7: 判断租约状态（使用锁后最新 lease_expires_at + v_now）
	  IF FOUND THEN
	    -- FOR UPDATE 保证 lease_expires_at 为锁获取时的最新值
	    -- 有效租约（含 heartbeat 续租）→ 返回 NULL，不回收
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
	  -- Step 6 (V5.4.1): real_write 模式 — 原子验证 dry_run_run_id
	  -- 在 advisory lock + sync_run FOR UPDATE 之后、INSERT 之前
	  -- ============================================
	  IF p_mode = 'real_write' THEN
	    SELECT mode, status, plan_drift_check, finished_at,
	           input_artifact_hash, plan_artifact_hash, warehouse_id
	    INTO v_dr_mode, v_dr_status, v_dr_plan_chk, v_dr_finished,
	         v_dr_input_h, v_dr_plan_h, v_dr_wh_id
	    FROM public.sync_run
	    WHERE id = p_dry_run_run_id;

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
	    p_dry_run_run_id,
	    p_input_artifact_hash, p_plan_artifact_hash,
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
-- Part 6: release_sync_run() RPC
-- ============================================
-- 统一锁顺序：
--   1. 读取 warehouse_id → v_pre_wh_id（用于 advisory lock）
--   2. pg_advisory_xact_lock(hashtext('sync_run:' || v_pre_wh_id))
--   3. SELECT FOR UPDATE on sync_warehouse_lock + 行存在校验
--   4. SELECT sync_run FOR UPDATE + 重新读取 warehouse_id → v_post_wh_id
--      + 重新校验 status/mode + 严格比较 v_pre_wh_id = v_post_wh_id
--      → 禁止覆盖已进入终态（completed/failed）的运行
--   4.5. v_now := clock_timestamp() 单次获取临界区时间
--   5. UPDATE sync_run（completed/failed 均使用 v_now 写入 finished_at）
--
-- 不接收 p_finished_at 参数，finished_at 由数据库在锁保护区内生成。
-- completed 校验全部必需字段（含 plan_drift_check 枚举 +
--   plan_drift_count + plan_drift_differences 数组长度 +
--   exit_code IS NULL OR != 0 + result_summary + Dry Run 强制 plan_artifact_hash）
-- failed 校验 error_message + exit_code IS NULL OR NOT IN (1,2)
-- 仅在 locked_by = p_run_id 时清锁
-- ============================================

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
  -- ============================================
  -- Step 1: 读取 warehouse_id → v_pre_wh_id（用于 advisory lock key）
  -- ============================================
  SELECT warehouse_id
  INTO v_pre_wh_id
  FROM public.sync_run
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 不存在: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- Step 2: pg_advisory_xact_lock（使用 v_pre_wh_id）
  -- ============================================
  PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || v_pre_wh_id));

  -- ============================================
  -- Step 3: SELECT FOR UPDATE on sync_warehouse_lock + 行存在校验
  -- ============================================
  SELECT EXISTS (
    SELECT 1 FROM public.sync_warehouse_lock
    WHERE warehouse_id = v_pre_wh_id
    FOR UPDATE
  ) INTO v_lock_exists;

  IF NOT v_lock_exists THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行不存在: %', v_pre_wh_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- Step 4: SELECT sync_run FOR UPDATE + 重新校验
  -- 禁止覆盖已进入终态（completed/failed）的运行
  -- 重新读取 warehouse_id → v_post_wh_id
  -- ============================================
  SELECT warehouse_id, mode, status
  INTO v_post_wh_id, v_mode, v_cur_status
  FROM public.sync_run
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 在锁定后消失: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  -- 严格比较锁前/锁后 warehouse_id
  IF v_pre_wh_id IS DISTINCT FROM v_post_wh_id THEN
    RAISE EXCEPTION 'warehouse_id 在锁前/锁后不一致: 锁前=%, 锁后=%', v_pre_wh_id, v_post_wh_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_cur_status != 'in_progress' THEN
    RAISE EXCEPTION '只能从 in_progress 状态释放，当前已进入终态: %', v_cur_status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- Step 4.5: 全部锁后单次获取临界区时间（V5.4.3 第四次聚焦返工）
  -- 同一 v_now 用于 completed 和 failed 的 finished_at
  -- ============================================
  v_now := clock_timestamp();

  -- ============================================
  -- Step 5: 按状态更新
  -- ============================================
  IF p_status = 'completed' THEN
    -- completed 全部必需字段校验
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

    -- Dry Run completed 强制 plan_artifact_hash
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
    -- failed 必需字段校验
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

  -- ============================================
  -- Step 6: 清除锁（仅当 locked_by = p_run_id，使用 v_post_wh_id）
  -- ============================================
  UPDATE public.sync_warehouse_lock
  SET locked_by = NULL, locked_at = NULL
  WHERE warehouse_id = v_post_wh_id
    AND locked_by = p_run_id;
END;
$$;

-- ============================================
-- Part 7: heartbeat_sync_run() RPC
-- ============================================

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
  -- 参数校验
  IF p_lease_duration IS NULL OR p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'lease_duration 必须在 [30, 900] 范围内，收到: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  -- 单次 clock_timestamp() 用于 heartbeat_at 和 lease_expires_at
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

-- ============================================
-- Part 8: cleanup_expired_sync_runs() RPC
-- ============================================
-- 统一锁顺序：按 warehouse_id 排序遍历
--   → pg_advisory_xact_lock
--   → SELECT FOR UPDATE on sync_warehouse_lock
--   → CTE UPDATE sync_run + 清锁
-- exit_code=2，返回标记 failed 的运行数（非锁行数）
-- 仅遍历存在过期 in_progress 运行的 warehouse（禁止锁定全部仓库）
-- ============================================

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
  -- 仅遍历存在过期 in_progress 运行的 warehouse（禁止锁定全部仓库）
  FOR v_lock_row IN
    SELECT DISTINCT sr.warehouse_id
    FROM public.sync_run sr
    WHERE sr.status = 'in_progress'
      AND sr.lease_expires_at IS NOT NULL
      AND sr.lease_expires_at < now()
    ORDER BY sr.warehouse_id
  LOOP
    -- advisory lock
    PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || v_lock_row.warehouse_id));

    -- SELECT FOR UPDATE on sync_warehouse_lock
    PERFORM 1
    FROM public.sync_warehouse_lock
    WHERE warehouse_id = v_lock_row.warehouse_id
    FOR UPDATE;

    -- CTE: 标记过期运行为 failed (exit_code=2) + 清除对应锁
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

-- ============================================
-- Part 9: get_sync_runs() RPC
-- ============================================
-- 直接读取 public.sync_run（不通过 VIEW）
-- 完全限定 public.get_user_role()
-- p_limit 显式拒绝 NULL / <1 / >100
-- 先在 CTE 中 ORDER BY + LIMIT，外层 jsonb_agg(... ORDER BY started_at DESC)
-- 脱敏矩阵：
--   所有角色禁止返回: input_artifact_hash, plan_artifact_hash,
--     lease_expires_at, heartbeat_at, triggered_by 原始 UUID
--   Admin: 返回 display_name (JOIN profiles), warehouse_name (JOIN warehouse),
--     exit_code, error_message, result_summary, dry_run_run_id
--   Operator: 返回脱敏邮箱 (auth.users.email), warehouse_name,
--     controlled result_summary (仅 variantsCreated + inventoryUpdated),
--     Chinese 失败摘要 (无原始 error_message)
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sync_runs(
  p_warehouse_id uuid DEFAULT NULL,
  p_limit        integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role   text;
  v_result jsonb;
BEGIN
  -- 认证检查
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
  END IF;

  v_role := public.get_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION '无权限' USING ERRCODE = 'P0001';
  END IF;

  -- p_limit 显式拒绝 NULL / <1 / >100（不再静默钳制）
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit 必须在 [1, 100] 范围内，收到: %', p_limit
      USING ERRCODE = 'P0001';
  END IF;

  -- admin 返回 display_name + warehouse_name + 完整业务字段；operator 脱敏
  IF v_role = 'admin' THEN
    WITH limited AS (
      SELECT sr.id, sr.warehouse_id, sr.mode, sr.status,
             sr.triggered_from,
             sr.started_at, sr.finished_at, sr.created_at,
             sr.exit_code, sr.error_message,
             sr.result_summary,
             sr.plan_drift_check, sr.plan_drift_count,
             sr.dry_run_run_id,
             p.display_name,
             w.name AS warehouse_name
      FROM public.sync_run sr
      LEFT JOIN public.profiles p ON sr.triggered_by = p.id
      LEFT JOIN public.warehouse w ON sr.warehouse_id = w.id
      WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id)
      ORDER BY sr.started_at DESC
      LIMIT p_limit
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    limited.id,
        'warehouse_id',          limited.warehouse_id,
        'warehouse_name',        limited.warehouse_name,
        'mode',                  limited.mode,
        'status',                limited.status,
        'display_name',          limited.display_name,
        'triggered_from',        limited.triggered_from,
        'started_at',            limited.started_at,
        'finished_at',           limited.finished_at,
        'created_at',            limited.created_at,
        'exit_code',             limited.exit_code,
        'error_message',         limited.error_message,
        'result_summary',        limited.result_summary,
        'plan_drift_check',      limited.plan_drift_check,
        'plan_drift_count',      limited.plan_drift_count,
        'dry_run_run_id',        limited.dry_run_run_id
      )
      ORDER BY limited.started_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM limited;

  ELSE
    -- operator: 脱敏版本
    --   禁止: exit_code, error_message, artifact hashes, dry_run_run_id,
    --     lease_expires_at, heartbeat_at, triggered_by UUID
    --   返回: 脱敏邮箱(auth.users.email), warehouse_name,
    --     controlled result_summary (仅 variantsCreated + inventoryUpdated),
    --     Chinese 失败摘要(代替原始error_message)
    WITH limited AS (
      SELECT sr.id, sr.warehouse_id, sr.mode, sr.status,
             sr.triggered_from,
             sr.started_at, sr.finished_at, sr.created_at,
             sr.exit_code,
             sr.result_summary,
             sr.plan_drift_check, sr.plan_drift_count,
             u.email,
             w.name AS warehouse_name
      FROM public.sync_run sr
      LEFT JOIN auth.users u ON sr.triggered_by = u.id
      LEFT JOIN public.warehouse w ON sr.warehouse_id = w.id
      WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id)
      ORDER BY sr.started_at DESC
      LIMIT p_limit
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    limited.id,
        'warehouse_id',          limited.warehouse_id,
        'warehouse_name',        limited.warehouse_name,
        'mode',                  limited.mode,
        'status',                limited.status,
        'triggered_by_email',    CASE
                                   WHEN limited.email IS NULL THEN NULL
                                   ELSE regexp_replace(limited.email, '^(.{1}).*(@.*)$', '\1***\2')
                                 END,
        'triggered_from',        limited.triggered_from,
        'started_at',            limited.started_at,
        'finished_at',           limited.finished_at,
        'created_at',            limited.created_at,
        'plan_drift_check',      limited.plan_drift_check,
        'plan_drift_count',      limited.plan_drift_count,
        'result_summary',        CASE
                                   WHEN limited.result_summary IS NULL THEN NULL
                                   ELSE jsonb_build_object(
                                     'variantsCreated',  limited.result_summary->'variantsCreated',
                                     'inventoryUpdated', limited.result_summary->'inventoryUpdated'
                                   )
                                 END,
        'failure_summary',       CASE
                                   WHEN limited.status = 'failed' THEN
                                     CASE
                                       WHEN limited.exit_code = 1 THEN '同步失败（业务错误）'
                                       WHEN limited.exit_code = 2 THEN '同步失败（系统清理）'
                                       ELSE '同步失败'
                                     END
                                   ELSE NULL
                                 END
      )
      ORDER BY limited.started_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM limited;
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================
-- Part 10: get_sync_run_detail() RPC
-- ============================================
-- 脱敏矩阵同 get_sync_runs:
--   所有角色禁止返回: input_artifact_hash, plan_artifact_hash,
--     lease_expires_at, heartbeat_at, triggered_by 原始 UUID
--   Admin: display_name (JOIN profiles) + warehouse_name + 完整业务字段
--   Operator: 脱敏邮箱 (auth.users.email) + warehouse_name +
--     controlled result_summary (仅 variantsCreated + inventoryUpdated) +
--     Chinese 失败摘要 + 不含 plan_drift_differences
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sync_run_detail(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role   text;
  v_result jsonb;
BEGIN
  -- 认证检查
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
  END IF;

  v_role := public.get_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION '无权限' USING ERRCODE = 'P0001';
  END IF;

  -- admin 返回 display_name + warehouse_name + 完整业务字段
  IF v_role = 'admin' THEN
    SELECT jsonb_build_object(
      'id',                     sr.id,
      'warehouse_id',           sr.warehouse_id,
      'warehouse_name',         w.name,
      'mode',                   sr.mode,
      'status',                 sr.status,
      'display_name',           p.display_name,
      'triggered_from',         sr.triggered_from,
      'started_at',             sr.started_at,
      'finished_at',            sr.finished_at,
      'created_at',             sr.created_at,
      'exit_code',              sr.exit_code,
      'error_message',          sr.error_message,
      'result_summary',         sr.result_summary,
      'plan_drift_check',       sr.plan_drift_check,
      'plan_drift_count',       sr.plan_drift_count,
      'plan_drift_differences', sr.plan_drift_differences,
      'dry_run_run_id',         sr.dry_run_run_id
    ) INTO v_result
    FROM public.sync_run sr
    LEFT JOIN public.profiles p ON sr.triggered_by = p.id
    LEFT JOIN public.warehouse w ON sr.warehouse_id = w.id
    WHERE sr.id = p_run_id;

  ELSE
    -- operator: 脱敏版本（不含 plan_drift_differences）
    SELECT jsonb_build_object(
      'id',                    sr.id,
      'warehouse_id',          sr.warehouse_id,
      'warehouse_name',        w.name,
      'mode',                  sr.mode,
      'status',                sr.status,
      'triggered_by_email',    CASE
                                 WHEN u.email IS NULL THEN NULL
                                 ELSE regexp_replace(u.email, '^(.{1}).*(@.*)$', '\1***\2')
                               END,
      'triggered_from',        sr.triggered_from,
      'started_at',            sr.started_at,
      'finished_at',           sr.finished_at,
      'created_at',            sr.created_at,
      'plan_drift_check',      sr.plan_drift_check,
      'plan_drift_count',      sr.plan_drift_count,
      'result_summary',        CASE
                                 WHEN sr.result_summary IS NULL THEN NULL
                                 ELSE jsonb_build_object(
                                   'variantsCreated',  sr.result_summary->'variantsCreated',
                                   'inventoryUpdated', sr.result_summary->'inventoryUpdated'
                                 )
                               END,
      'failure_summary',       CASE
                                 WHEN sr.status = 'failed' THEN
                                   CASE
                                     WHEN sr.exit_code = 1 THEN '同步失败（业务错误）'
                                     WHEN sr.exit_code = 2 THEN '同步失败（系统清理）'
                                     ELSE '同步失败'
                                   END
                                 ELSE NULL
                               END
    ) INTO v_result
    FROM public.sync_run sr
    LEFT JOIN auth.users u ON sr.triggered_by = u.id
    LEFT JOIN public.warehouse w ON sr.warehouse_id = w.id
    WHERE sr.id = p_run_id;
  END IF;

  -- 不存在返回 null
  IF v_result IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================
-- Part 11: 权限收口 — REVOKE/GRANT
-- ============================================

-- claim_sync_run: Admin 通过 Server Action 调用
REVOKE EXECUTE ON FUNCTION public.claim_sync_run(uuid, text, uuid, integer, uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_sync_run(uuid, text, uuid, integer, uuid, text, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_sync_run(uuid, text, uuid, integer, uuid, text, uuid, text, text) TO authenticated;

-- release_sync_run: 内部函数，仅 service_role 可执行
REVOKE EXECUTE ON FUNCTION public.release_sync_run(uuid, text, integer, text, jsonb, text, integer, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_sync_run(uuid, text, integer, text, jsonb, text, integer, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_sync_run(uuid, text, integer, text, jsonb, text, integer, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_sync_run(uuid, text, integer, text, jsonb, text, integer, jsonb, text) TO service_role;

-- heartbeat_sync_run: 内部函数，仅 service_role 可执行
REVOKE EXECUTE ON FUNCTION public.heartbeat_sync_run(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.heartbeat_sync_run(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_sync_run(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_sync_run(uuid, integer) TO service_role;

-- cleanup_expired_sync_runs: 内部函数，仅 service_role 可执行
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sync_runs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sync_runs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sync_runs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sync_runs() TO service_role;

-- get_sync_runs: Admin 和 Operator 均可通过 Server Action 调用
REVOKE EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) TO authenticated;

-- get_sync_run_detail: Admin 和 Operator 均可通过 Server Action 调用
REVOKE EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) TO authenticated;

-- trigger 函数不需要显式 GRANT（由 trigger 机制自动执行）
REVOKE EXECUTE ON FUNCTION public.trg_sync_warehouse_lock_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_warehouse_lock_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_sync_warehouse_lock_insert() FROM authenticated;

-- ============================================
-- SQL 静态注释验证场景（不连接数据库，仅静态审查）
-- ============================================
-- 场景说明：以下 SQL 片段用于验证 DDL 语义正确性，不实际执行。
-- 通过静态审查确认 CHECK 约束、权限收口、锁顺序和函数签名。
--
-- CHECK 约束验证：
--   CHK-01 (sync_run_time_check):
--     finished_at < started_at → 违反 → 拒绝
--     finished_at >= started_at → 通过
--     finished_at IS NULL → 通过（约束仅校验两者均非 NULL 时）
--   CHK-02 (real_write_requires_dry_run):
--     mode='real_write' + dry_run_run_id IS NULL → 违反
--     mode='real_write' + dry_run_run_id = <uuid> → 通过
--   CHK-03 (real_write_requires_artifacts):
--     mode='real_write' + input_artifact_hash IS NULL → 违反
--     mode='real_write' + plan_artifact_hash IS NULL → 违反
--   CHK-04 (dry_run_requires_input_artifact):
--     mode='dry_run' + input_artifact_hash IS NULL → 违反
--   CHK-05 (completed_requires_fields):
--     status='completed' + finished_at IS NULL → 违反
--     status='completed' + exit_code IS NULL → 违反
--     status='completed' + result_summary IS NULL → 违反
--     status='completed' + plan_drift_check IS NULL → 违反
--     status='completed' + plan_drift_count IS NULL → 违反
--     status='completed' + plan_drift_differences IS NULL → 违反
--   CHK-06 (plan_drift_check_enum):
--     plan_drift_check='INVALID' → 违反
--     plan_drift_check='PASS' → 通过
--     plan_drift_check='DRIFT_DETECTED' → 通过
--   CHK-07 (plan_drift_count_non_negative):
--     plan_drift_count=-1 → 违反
--     plan_drift_count=0 → 通过
--   CHK-08 (failed_requires_fields):
--     status='failed' + finished_at IS NULL → 违反
--     status='failed' + error_message IS NULL → 违反
--     status='failed' + exit_code=0 → 违反（必须是 1 或 2）
--     status='failed' + exit_code=3 → 违反
--     status='failed' + finished_at=<ts> + exit_code=1 + error_message='err' → 通过
--     status='failed' + finished_at=<ts> + exit_code=2 + error_message='err' → 通过
--   CHK-09 (completed_exit_code_zero):
--     status='completed' + exit_code=1 → 违反
--     status='completed' + exit_code=0 → 通过
--   CHK-10 (plan_drift_differences_length):
--     plan_drift_count=2 + plan_drift_differences=['a','b','c'] → 违反（长度 3≠2）
--     plan_drift_count=2 + plan_drift_differences=['a','b'] → 通过
--   CHK-11 (completed_dry_run_requires_plan_artifact):
--     status='completed' + mode='dry_run' + plan_artifact_hash IS NULL → 违反
--     status='completed' + mode='dry_run' + plan_artifact_hash='<hash>' → 通过
--     status='completed' + mode='real_write' + plan_artifact_hash IS NULL → 通过（不触发）
--
-- 部分唯一索引验证：
--   同一 warehouse_id 插入两条 status='in_progress' → 第二条违反 idx_sync_run_one_in_progress
--   同一 warehouse_id 插入 status='completed' + status='in_progress' → 通过（completed 不触发索引）
--
-- 权限收口验证：
--   anon 调用 claim_sync_run → REVOKE 生效 → permission denied
--   anon 调用 get_sync_runs → REVOKE 生效 → permission denied
--   authenticated 调用 release_sync_run → REVOKE 生效 → permission denied
--   authenticated operator 调用 claim_sync_run → 内部角色检查拒绝 → '无权限：需要管理员角色'
--   authenticated admin 调用 get_sync_runs → 返回完整字段（含 exit_code）
--   authenticated operator 调用 get_sync_runs → 返回脱敏字段（无 exit_code）
--   service_role 调用 release_sync_run → GRANT 生效 → 可执行
--   service_role 调用 heartbeat_sync_run → GRANT 生效 → 可执行
--   service_role 调用 cleanup_expired_sync_runs → GRANT 生效 → 可执行
--
-- 锁顺序验证（静态审查 claim_sync_run 函数体）V5.5：
--   Step 4: PERFORM pg_advisory_xact_lock（第一层）
--   Step 5: SELECT FOR UPDATE on sync_warehouse_lock（第二层）
--   Step 5.5 (V5.5): SELECT FOR UPDATE on in_progress sync_run（行锁护租约）
--   Step 5.6: clock_timestamp() 刷新临界区时间
--   Step 5.7: lease 判断（使用锁后最新 lease_expires_at + v_now）
--   Step 6: dry_run_run_id 验证（在锁保护区内）← V5.4.1
--   Step 7: INSERT sync_run（第三层：idx_sync_run_one_in_progress 兜底）
--   确认：sync_run FOR UPDATE 在 v_now 之前 ✓
--   确认：FOR UPDATE 阻止并发 heartbeat 续租 ✓
--   确认：有效租约（含 heartbeat 续租）返回 NULL，不回收 ✓
--   确认：dry_run_run_id 验证在 advisory lock 之后、INSERT 之前 ✓
--
-- release_sync_run 锁顺序：
--   Step 1: SELECT warehouse_id → v_pre_wh_id（仅用于 advisory lock key）
--   Step 2: PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || v_pre_wh_id))
--   Step 3: SELECT EXISTS (FOR UPDATE sync_warehouse_lock) + 行存在校验
--   Step 4: SELECT sync_run FOR UPDATE + warehouse_id → v_post_wh_id
--           + 严格比较 v_pre_wh_id IS DISTINCT FROM v_post_wh_id
--           + 重新校验 status（禁止覆盖终态）
--   Step 4.5: v_now := clock_timestamp() 单次获取临界区时间
--   Step 5: UPDATE sync_run（completed/failed 均使用 v_now 写入 finished_at）
--   Step 6: UPDATE sync_warehouse_lock（使用 v_post_wh_id）
--   确认：统一锁顺序（advisory → FOR UPDATE warehouse_lock → sync_run FOR UPDATE → v_now → UPDATE） ✓
--   确认：release 不接收 p_finished_at，finished_at 由数据库在锁后生成 ✓
--   确认：release 在锁后重新校验 status，禁止覆盖终态运行 ✓
--   确认：锁前/锁后 warehouse_id 独立变量并严格比较 ✓
--   确认：warehouse lock 行缺失明确失败 ✓
--
-- cleanup_expired_sync_runs 锁顺序：
--   FOR LOOP: ORDER BY warehouse_id
--   Step: PERFORM pg_advisory_xact_lock
--   Step: SELECT FOR UPDATE on sync_warehouse_lock
--   Step: CTE expired (UPDATE sync_run) + cleared (UPDATE lock)
--   确认：ORDER BY warehouse_id 避免死锁 ✓
--   确认：exit_code=2 ✓
--   确认：返回标记 failed 的运行数 ✓
--
-- dry_run_run_id 验证位置验证（V5.4.1）：
--   claim_sync_run 函数体内：
--   — advisory lock (Step 4) 在 dry_run_run_id 验证 (Step 6) 之前
--   — FOR UPDATE (Step 5) 在 dry_run_run_id 验证 (Step 6) 之前
--   — clock_timestamp() (Step 5.5) 在 dry_run_run_id 验证 (Step 6) 之前
--   — INSERT (Step 8) 在 dry_run_run_id 验证 (Step 6) 之后
--   确认：验证在锁保护区内，消除 TOCTOU 窗口 ✓
--
-- sync_log 约束验证：
--   triggered_by REFERENCES public.profiles(id) → FK 约束
--   triggered_from CHECK (IN ('web', 'cli')) → 拒绝非法值
--   mode CHECK (mode = 'real_write') → 仅允许 real_write
--   exit_code CHECK (IS NULL OR IN (0, 1, 2)) → 无 DEFAULT
--     旧数据 backfill: 旧行保持 NULL
--     executor 必须显式传入 exit_code: 0=success, 1=业务错误, 2=系统清理
--
-- get_sync_runs 验证：
--   p_limit 显式拒绝 NULL / <1 / >100（不再 GREATEST/LEAST 静默钳制）
--   CTE "limited" 先 ORDER BY started_at DESC + LIMIT p_limit
--   外层 SELECT jsonb_agg(... ORDER BY limited.started_at DESC) FROM limited
--   确认：LIMIT 在 jsonb_agg 之前应用 ✓
--   确认：jsonb_agg 显式 ORDER BY 确保数组顺序 ✓
--
-- claim_sync_run 权限验证（V5.4.3 第二次聚焦返工）：
--   IS DISTINCT FROM 'admin' 拒绝 NULL role（!= 'admin' 对 NULL 返回 NULL→false）
--   p_triggered_by 必须 = auth.uid()，禁止伪造审计身份
--   新增 p_triggered_by, p_triggered_from 参数
--   INSERT 写入 triggered_by, triggered_from, heartbeat_at, created_at
--   确认：全部新字段写入 ✓
--   确认：IS DISTINCT FROM 优于 !=  ✓
--   确认：triggered_by = auth.uid() ✓
--
-- claim_sync_run dry_run 过期判断（V5.4.3 第四次聚焦返工）：
--   v_dr_finished IS NULL OR v_dr_finished <= v_now - INTERVAL '60 minutes' → 拒绝
--   恰好 60 分钟时拒绝（≤ 替代 <）
--   确认：NULL finished_at 拒绝 ✓
--   确认：恰好 60 分钟拒绝 ✓
--
-- claim_sync_run 租约回收竞态修复（V5.4.3 第五次聚焦返工）：
--   Step 5.5: SELECT FOR UPDATE on in_progress sync_run
--   Step 5.6: v_now := clock_timestamp()（在 sync_run FOR UPDATE 之后）
--   Step 5.7: 使用锁后最新 lease_expires_at + v_now 判断
--   有效租约（含 heartbeat 续租）→ 返回 NULL，不回收
--   过期才标记 failed
--   锁顺序：advisory → warehouse FOR UPDATE → sync_run FOR UPDATE → v_now
--   确认：sync_run FOR UPDATE 在 v_now 之前 ✓
--   确认：FOR UPDATE 阻止并发 heartbeat 续租 ✓
--   确认：过期回收不会无条件覆盖 heartbeat 续租 ✓
--
-- release_sync_run 显式 NULL exit_code 拒绝（V5.4.3 第五次聚焦返工）：
--   completed: p_exit_code IS NULL OR p_exit_code != 0 → 拒绝
--   failed: p_exit_code IS NULL OR p_exit_code NOT IN (1,2) → 拒绝
--   确认：completed 显式拒绝 NULL exit_code ✓
--   确认：failed 显式拒绝 NULL exit_code ✓
--
-- release_sync_run finished_at 生成（V5.4.3 第四次聚焦返工）：
--   不接收 p_finished_at 参数
--   全部锁后单次 v_now := clock_timestamp()
--   completed 和 failed 均使用 v_now 写入 finished_at
--   确认：p_finished_at 已删除 ✓
--   确认：v_now 在全部锁后生成 ✓
--   确认：completed/failed 统一时间源 ✓
--
-- 查询 RPC 脱敏矩阵验证（V5.4.3 第三次聚焦返工）：
--   所有角色禁止返回: input_artifact_hash, plan_artifact_hash,
--     lease_expires_at, heartbeat_at, triggered_by 原始 UUID
--   Admin: display_name (JOIN profiles), warehouse_name (JOIN warehouse),
--     exit_code, error_message, result_summary, dry_run_run_id
--   Operator: 脱敏邮箱 (auth.users.email), warehouse_name,
--     controlled result_summary (仅 variantsCreated + inventoryUpdated),
--     Chinese 失败摘要 (代替原始 error_message)
--     **不含 plan_drift_differences**（get_sync_run_detail operator 分支）
--   确认：get_sync_runs 脱敏矩阵 ✓
--   确认：get_sync_run_detail 脱敏矩阵 ✓
--   确认：Operator 不含 plan_drift_differences ✓
--   确认：邮箱来源为 auth.users.email ✓
--   确认：warehouse_name 存在 ✓

-- heartbeat_sync_run 验证（V5.4.3 第三次聚焦返工）：
--   v_now := clock_timestamp() 单次调用
--   heartbeat_at 和 lease_expires_at 均使用同一 v_now
--   确认：不再重复调用 now() ✓

-- get_sync_runs 验证：
--
-- cleanup_expired_sync_runs 验证（V5.4.3 第二次聚焦返工）：
--   仅遍历存在过期 in_progress 运行的 warehouse（SELECT DISTINCT FROM sync_run）
--   禁止锁定全部仓库（不再遍历全部 sync_warehouse_lock 行）
--   确认：ORDER BY warehouse_id 避免死锁 ✓
--   确认：exit_code=2 ✓
--   确认：禁止全表扫描锁 ✓
--
-- release_sync_run 验证（V5.4.3 第二次聚焦返工）：
--   v_pre_wh_id / v_post_wh_id 独立变量
--   Step 3: FOR UPDATE on sync_warehouse_lock + EXISTS 行存在校验
--   Step 4: 锁后重新读取 warehouse_id → v_post_wh_id
--   严格比较 v_pre_wh_id IS DISTINCT FROM v_post_wh_id
--   warehouse lock 行缺失 → 明确 EXCEPTION
--   确认：锁前/锁后 warehouse_id 独立变量 ✓
--   确认：warehouse lock 行缺失不会静默跳过 ✓

-- ============================================
-- 独立静态验收清单
-- ============================================
-- 以下为人工审查清单，逐项确认：
--
-- [ ] DDL 语法有效（所有 CREATE TABLE / ALTER TABLE / CREATE FUNCTION 可解析）
-- [ ] CREATE TABLE 不用 IF NOT EXISTS
-- [ ] ALTER TABLE ADD COLUMN 不用 IF NOT EXISTS（共 5 列）
-- [ ] sync_run.id 无 DEFAULT（由 SyncService 预生成 UUID）
-- [ ] 11 个 CHECK 约束全部声明
-- [ ] sync_run 包含 triggered_by (FK→profiles), triggered_from (CHECK), heartbeat_at, result_summary, created_at
-- [ ] completed_requires_fields 包含 result_summary IS NOT NULL
-- [ ] idx_sync_run_one_in_progress 部分唯一索引（WHERE status='in_progress'）
-- [ ] idx_sync_run_triggered_by 索引
-- [ ] sync_warehouse_lock trigger ON INSERT 正确
-- [ ] 补建 INSERT 覆盖已有海外仓且 is_active=true
-- [ ] sync_log 5 列扩展 + triggered_by FK→profiles + triggered_from CHECK + mode CHECK + exit_code CHECK (IS NULL OR IN (0,1,2)) 无 DEFAULT
-- [ ] sync_run RLS: 仅 service_role 策略
-- [ ] sync_warehouse_lock RLS: 仅 service_role 策略
-- [ ] sync_log RLS: 新增 service_role 策略（不破坏已有 admin/operator 策略）
-- [ ] 6 个 RPC 全部 SECURITY DEFINER + SET search_path = ''
-- [ ] 所有对象引用使用完全限定名称 public.xxx
-- [ ] claim_sync_run 使用 IS DISTINCT FROM 'admin' 拒绝 NULL role（!= 'admin' 对 NULL 返回 NULL→false）
-- [ ] claim_sync_run p_triggered_by 必须 = auth.uid()（禁止伪造审计身份）
-- [ ] claim_sync_run 接收 p_run_id + p_triggered_by + p_triggered_from 参数
-- [ ] claim_sync_run lease_duration [30, 900] + triggered_from CHECK 校验
-- [ ] claim_sync_run 三层防御顺序：advisory → warehouse FOR UPDATE → sync_run FOR UPDATE → v_now → INSERT（V5.5）
-- [ ] claim_sync_run sync_run FOR UPDATE 在 v_now := clock_timestamp() 之前（阻止并发 heartbeat 续租，V5.5）
-- [ ] claim_sync_run 有效租约（含 heartbeat 续租）返回 NULL，不回收（V5.5）
-- [ ] claim_sync_run 同一 v_now 用于 Dry Run 有效期、lease 回收 finished_at、新 lease_expires_at、heartbeat_at、created_at
-- [ ] claim_sync_run real_write dry_run_run_id 验证在 advisory lock + clock_timestamp 之后（V5.4.1）
-- [ ] claim_sync_run 僵尸回收 exit_code=2 + finished_at = v_now
-- [ ] claim_sync_run dry_run_run_id SELECT INTO 不再包含 id 列（修复重复写入 v_dr_wh_id）
-- [ ] claim_sync_run INSERT 写入 triggered_by, triggered_from, heartbeat_at, created_at
-- [ ] release_sync_run 统一锁顺序：advisory → FOR UPDATE warehouse_lock → SELECT sync_run FOR UPDATE → v_now := clock_timestamp() → UPDATE
-- [ ] release_sync_run 锁后 SELECT sync_run FOR UPDATE 重新校验 status/mode/warehouse_id
-- [ ] release_sync_run 禁止覆盖已进入终态（completed/failed）的运行
-- [ ] release_sync_run 不接收 p_finished_at 参数，finished_at 由数据库在全部锁后单次 clock_timestamp() 生成
-- [ ] release_sync_run completed 和 failed 路径均使用 v_now 写入 finished_at
-- [ ] release_sync_run completed 校验 plan_drift_check 枚举 + plan_drift_count ≥ 0 + array length + exit_code IS NULL OR != 0 + result_summary
-- [ ] release_sync_run Dry Run completed 强制 plan_artifact_hash
-- [ ] failed_requires_fields 包含 finished_at + error_message + exit_code IN (1,2)
-- [ ] release_sync_run failed 校验 error_message + exit_code IS NULL OR NOT IN (1,2)（V5.5 显式 NULL 拒绝）
-- [ ] release_sync_run 仅在 locked_by = p_run_id 时清锁
-- [ ] release_sync_run 释放时清除 heartbeat_at
-- [ ] release_sync_run v_pre_wh_id / v_post_wh_id 独立变量 + 严格比较 + warehouse lock 行存在校验
-- [ ] claim_sync_run dry_run_run_id 过期判断使用 <= 60 分钟（恰好 60 分钟拒绝，包含 NULL finished_at 拒绝）
-- [ ] heartbeat_sync_run lease_duration [30, 900] + v_now := clock_timestamp() 同时用于 heartbeat_at 和 lease_expires_at
-- [ ] cleanup_expired_sync_runs 仅遍历存在过期 in_progress 的 warehouse（禁止全表锁）
-- [ ] cleanup_expired_sync_runs ORDER BY warehouse_id + exit_code=2
-- [ ] cleanup_expired_sync_runs 仅清 expired 持有的锁（locked_by IN expired）
-- [ ] cleanup_expired_sync_runs 返回标记 failed 的运行数
-- [ ] get_sync_runs p_limit 显式拒绝 NULL / <1 / >100（不再 GREATEST/LEAST 钳制）
-- [ ] get_sync_runs CTE "limited" 先 ORDER BY + LIMIT，外层 jsonb_agg(... ORDER BY started_at DESC)
-- [ ] get_sync_runs/get_sync_run_detail 直接读取 public.sync_run + LEFT JOIN profiles/admin + LEFT JOIN auth.users + LEFT JOIN warehouse（不通过 VIEW）
-- [ ] get_sync_runs/get_sync_run_detail 使用完全限定 public.get_user_role()
-- [ ] 查询 RPC 脱敏矩阵: 禁止返回 input_artifact_hash, plan_artifact_hash, lease_expires_at, heartbeat_at, triggered_by UUID
-- [ ] Admin 返回 display_name (JOIN profiles) + warehouse_name; Operator 返回脱敏邮箱 (auth.users.email) + warehouse_name
-- [ ] Operator controlled result_summary 严格仅含 variantsCreated + inventoryUpdated（白名单）
-- [ ] Operator get_sync_run_detail 不含 plan_drift_differences
-- [ ] 全部 REVOKE FROM PUBLIC + REVOKE FROM anon
-- [ ] claim_sync_run / get_sync_runs / get_sync_run_detail GRANT TO authenticated
-- [ ] release_sync_run / heartbeat_sync_run / cleanup_expired_sync_runs GRANT TO service_role
-- [ ] claim_sync_run REVOKE/GRANT 签名含 p_triggered_by + p_triggered_from (9 参数)
-- [ ] release_sync_run REVOKE/GRANT 签名含 p_result_summary (9 参数，不含 timestamptz)
-- [ ] trigger 函数 REVOKE 来自 authenticated（仅由 trigger 机制执行）
