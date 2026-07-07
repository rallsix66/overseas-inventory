-- ============================================
-- Migration 00030: 修复 get_sync_runs_paginated Operator 仓库隔离
-- ============================================
-- 背景：
--   00029 新增分页 RPC 时保留了 Admin/Operator 脱敏矩阵，但 Operator
--   分支遗漏了 00015 引入的 assigned warehouse 过滤。
--
-- 修复：
--   - 不修改已执行 00029，使用前向 migration 重建同名函数。
--   - Admin 行为不变。
--   - Operator 的 total 与 rows 均限制为已分配仓库。
--   - p_warehouse_id 指向未分配仓库时返回 total=0 / rows=[]。
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'P0001';
  END IF;

  v_role := public.get_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION '无权限' USING ERRCODE = 'P0001';
  END IF;

  IF p_page IS NULL OR p_page < 1 THEN
    RAISE EXCEPTION 'p_page 必须 >= 1，收到: %', p_page USING ERRCODE = 'P0001';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'p_page_size 必须在 [1, 100] 范围内，收到: %', p_page_size
      USING ERRCODE = 'P0001';
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  IF v_role = 'admin' THEN
    SELECT count(*)
    INTO v_total
    FROM public.sync_run sr
    WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id);

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
    -- Operator: 脱敏版本 + assigned warehouse 过滤（P5-SY13A）
    SELECT count(*)
    INTO v_total
    FROM public.sync_run sr
    WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id)
      AND sr.warehouse_id IN (SELECT public.get_assigned_warehouse_ids());

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
        AND sr.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
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

REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_runs_paginated(uuid, integer, integer) TO authenticated;

-- 静态验证要点：
--   Operator total: sync_run + get_assigned_warehouse_ids()
--   Operator rows:  sync_run + get_assigned_warehouse_ids()
--   Admin branch:   no assigned warehouse filter
--   权限面：         authenticated only
