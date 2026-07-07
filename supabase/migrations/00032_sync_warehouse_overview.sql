-- ============================================
-- Migration 00032: PERF-D-OVERVIEW — 服务端全量仓库同步概览
-- ============================================
-- 目的：新增 get_sync_warehouse_overview RPC，服务端全量聚合每个
--       海外仓库的最新同步状态，替换客户端基于当前页 rows 的
--       useMemo 聚合（仅覆盖当前分页数据）。
--
-- 安全：
--   - SECURITY DEFINER + SET search_path = ''
--   - auth.uid() IS NOT NULL + public.get_user_role() 检查
--   - Admin：返回全部活跃海外仓概览
--   - Operator：仅返回已分配仓库概览（通过 user_warehouses 过滤）
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--
-- 返回结构（jsonb 数组，按 country 排序）：
--   {
--     "warehouse_id": uuid,
--     "warehouse_name": text,
--     "country": text,
--     "latest_dry_run": { status, run_id, time } | null,
--     "latest_real_write": { status, run_id, time } | null,
--     "last_success_time": timestamptz | null,
--     "last_failure_reason": text | null
--   }
--
-- 不修改已执行 Migration 00001~00031。
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sync_warehouse_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_result jsonb;
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
  -- Admin 分支：全部海外活跃仓
  -- ═══════════════════════════════════════════
  IF v_role = 'admin' THEN
    SELECT jsonb_agg(wh_data ORDER BY wh_data->>'country')
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'warehouse_id', w.id,
        'warehouse_name', w.name,
        'country', w.country,
        'latest_dry_run', (
          SELECT jsonb_build_object(
            'status', sr.status,
            'run_id', sr.id,
            'time', sr.started_at
          )
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.mode = 'dry_run'
          ORDER BY sr.started_at DESC
          LIMIT 1
        ),
        'latest_real_write', (
          SELECT jsonb_build_object(
            'status', sr.status,
            'run_id', sr.id,
            'time', sr.started_at
          )
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.mode = 'real_write'
          ORDER BY sr.started_at DESC
          LIMIT 1
        ),
        'last_success_time', (
          SELECT sr.finished_at
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.status = 'completed'
          ORDER BY sr.finished_at DESC
          LIMIT 1
        ),
        'last_failure_reason', (
          SELECT sr.error_message
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.status = 'failed'
          ORDER BY sr.started_at DESC
          LIMIT 1
        )
      ) AS wh_data
      FROM public.warehouse w
      WHERE w.type = 'overseas' AND w.is_active = true
    ) sub;

  -- ═══════════════════════════════════════════
  -- Operator 分支：仅已分配仓库
  -- ═══════════════════════════════════════════
  ELSE
    SELECT jsonb_agg(wh_data ORDER BY wh_data->>'country')
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'warehouse_id', w.id,
        'warehouse_name', w.name,
        'country', w.country,
        'latest_dry_run', (
          SELECT jsonb_build_object(
            'status', sr.status,
            'run_id', sr.id,
            'time', sr.started_at
          )
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.mode = 'dry_run'
          ORDER BY sr.started_at DESC
          LIMIT 1
        ),
        'latest_real_write', (
          SELECT jsonb_build_object(
            'status', sr.status,
            'run_id', sr.id,
            'time', sr.started_at
          )
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.mode = 'real_write'
          ORDER BY sr.started_at DESC
          LIMIT 1
        ),
        'last_success_time', (
          SELECT sr.finished_at
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.status = 'completed'
          ORDER BY sr.finished_at DESC
          LIMIT 1
        ),
        'last_failure_reason', (
          SELECT substring(sr.error_message, 1, 100)
          FROM public.sync_run sr
          WHERE sr.warehouse_id = w.id AND sr.status = 'failed'
          ORDER BY sr.started_at DESC
          LIMIT 1
        )
      ) AS wh_data
      FROM public.warehouse w
      INNER JOIN public.user_warehouses uw
        ON uw.warehouse_id = w.id AND uw.user_id = auth.uid()
      WHERE w.type = 'overseas' AND w.is_active = true
    ) sub;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_sync_warehouse_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sync_warehouse_overview() TO authenticated;
