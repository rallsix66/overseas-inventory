-- ============================================
-- Migration 00029: PHASE-D — 同步运行列表服务端分页
-- ============================================
-- 目的：新增 get_sync_runs_paginated RPC，支持 page/pageSize 分页
--       并返回 total 计数，替换"最多取 100 条后客户端分页"方案。
--
-- 设计决策：
--   - 新增独立 RPC（不修改已执行 Migration 00007 的 get_sync_runs）
--   - 返回 { rows: [...], total, page, pageSize } JSONB
--   - 脱敏矩阵与 get_sync_runs 完全一致（Admin/Operator 字段差异）
--   - warehouseId 筛选、started_at DESC 排序保持不变
--   - page >= 1, pageSize ∈ [1, 100]
--
-- 安全（与 Migration 00007 一致）：
--   - SECURITY DEFINER（沿用 auth.uid() 身份绑定 + RLS 兼容）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - public.get_user_role() IS NOT NULL 检查
--   - 参数显式拒绝非法值（page < 1 / pageSize < 1 / pageSize > 100）
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00028。
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sync_runs_paginated(
  p_warehouse_id uuid    DEFAULT NULL,
  p_page         integer DEFAULT 1,
  p_page_size    integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role     text;
  v_total    bigint;
  v_offset   bigint;
  v_result   jsonb;
BEGIN
  -- ═══════════════════════════════════════════
  -- 身份绑定
  -- ═══════════════════════════════════════════
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
  END IF;

  v_role := public.get_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION '无权限' USING ERRCODE = 'P0001';
  END IF;

  -- ═══════════════════════════════════════════
  -- 参数校验
  -- ═══════════════════════════════════════════
  IF p_page IS NULL OR p_page < 1 THEN
    RAISE EXCEPTION 'p_page 必须 >= 1，收到: %', p_page USING ERRCODE = 'P0001';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'p_page_size 必须在 [1, 100] 范围内，收到: %', p_page_size
      USING ERRCODE = 'P0001';
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  -- ═══════════════════════════════════════════
  -- 计数 total（不含分页）
  -- ═══════════════════════════════════════════
  SELECT count(*)
  INTO v_total
  FROM public.sync_run sr
  WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id);

  -- ═══════════════════════════════════════════
  -- Admin 分支
  -- ═══════════════════════════════════════════
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
      OFFSET v_offset
      LIMIT p_page_size
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(jsonb_agg(
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
      ), '[]'::jsonb),
      'total',    v_total,
      'page',     p_page,
      'pageSize', p_page_size
    ) INTO v_result
    FROM limited;

  ELSE
    -- ═══════════════════════════════════════════
    -- Operator 分支（脱敏）
    -- ═══════════════════════════════════════════
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
      OFFSET v_offset
      LIMIT p_page_size
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(jsonb_agg(
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
      ), '[]'::jsonb),
      'total',    v_total,
      'page',     p_page,
      'pageSize', p_page_size
    ) INTO v_result
    FROM limited;
  END IF;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) TO authenticated;

-- ═══════════════════════════════════════════
-- 静态契约注释
-- ═══════════════════════════════════════════
-- 脱敏矩阵（与 get_sync_runs 完全一致）：
--   所有角色禁止返回: input_artifact_hash, plan_artifact_hash,
--     lease_expires_at, heartbeat_at, triggered_by 原始 UUID
--   Admin: display_name (JOIN profiles), warehouse_name (JOIN warehouse),
--     exit_code, error_message, result_summary, dry_run_run_id
--   Operator: 脱敏邮箱 (auth.users.email), warehouse_name,
--     controlled result_summary (仅 variantsCreated + inventoryUpdated),
--     Chinese 失败摘要 (代替原始 error_message)
--
-- 分页行为：
--   total = COUNT(*) without LIMIT/OFFSET（全量计数）
--   rows = CTE limited → ORDER BY started_at DESC → OFFSET → LIMIT
--   page/pageSize = 输入参数原样返回
--
-- 参数校验：
--   p_page NULL / <1 → 拒绝
--   p_page_size NULL / <1 / >100 → 拒绝
--
-- 认证：
--   auth.uid() IS NULL → 拒绝
--   get_user_role() IS NULL → 拒绝
--
-- 排序：started_at DESC（与 get_sync_runs 一致）
--
-- 返回值结构：
--   jsonb_build_object('rows', [...], 'total', bigint, 'page', integer, 'pageSize', integer)
--   无匹配行时 rows=[]（不是 null）
--
-- REVOKE/GRANT：
--   REVOKE FROM PUBLIC, anon ✓
--   GRANT TO authenticated ✓
--   SECURITY DEFINER ✓
--   SET search_path = '' ✓
