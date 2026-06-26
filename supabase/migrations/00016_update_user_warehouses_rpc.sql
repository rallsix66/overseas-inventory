-- ============================================
-- 00016 — 仓库分配事务性写入 RPC
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY13B: 新增 update_user_warehouses RPC 函数，实现事务性仓库分配写入。
-- 在单个数据库事务内完成：
--   1. 校验调用者是 admin
--   2. 校验目标用户是启用的 operator
--   3. 校验所有仓库是启用的海外仓
--   4. 删除旧分配 + 插入新分配
--   5. 空 warehouseIds 表示清空分配
--   6. 自动去重 warehouseIds 避免主键冲突
--
-- 不修改已执行 Migration 00001~00015。
-- ============================================

-- ─── update_user_warehouses RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_user_warehouses(
  p_user_id UUID,
  p_warehouse_ids UUID[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role  TEXT;
  v_target_role  TEXT;
  v_target_active BOOLEAN;
  v_invalid_count INTEGER;
  v_deduped_ids  UUID[];
BEGIN
  -- 1. 校验调用者是 admin
  v_caller_role := public.get_user_role();
  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限：需要管理员角色');
  END IF;

  -- 2. 校验目标用户存在、启用、且为 operator
  SELECT r.name, p.is_active
    INTO v_target_role, v_target_active
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = p_user_id;

  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '用户不存在');
  END IF;

  IF v_target_role != 'operator' THEN
    RETURN jsonb_build_object('success', false, 'error', '只能为启用的操作员分配仓库');
  END IF;

  IF v_target_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', '只能为启用的操作员分配仓库');
  END IF;

  -- 3. 如果 warehouse_ids 非空：校验所有仓库都是活跃海外仓 + 去重
  IF p_warehouse_ids IS NOT NULL AND array_length(p_warehouse_ids, 1) > 0 THEN
    -- 去重
    SELECT array_agg(DISTINCT wid) INTO v_deduped_ids
    FROM unnest(p_warehouse_ids) AS wid;

    -- 校验
    SELECT count(*) INTO v_invalid_count
    FROM unnest(v_deduped_ids) AS wid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.warehouse w
      WHERE w.id = wid AND w.type = 'overseas' AND w.is_active = true
    );

    IF v_invalid_count > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '只能分配启用的海外仓库');
    END IF;
  END IF;

  -- 4. 事务性写入：先删后插（同一事务内）
  DELETE FROM public.user_warehouses WHERE user_id = p_user_id;

  IF v_deduped_ids IS NOT NULL AND array_length(v_deduped_ids, 1) > 0 THEN
    INSERT INTO public.user_warehouses (user_id, warehouse_id)
    SELECT p_user_id, unnest(v_deduped_ids);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 权限收口：最小化执行面 ──────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) TO authenticated;
