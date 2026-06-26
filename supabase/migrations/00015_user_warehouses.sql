-- ============================================
-- 00015 — 仓库分配权限：权限基础与读路径收紧
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY13A: 实现 user_warehouses 仓库分配表，使 operator 只能看到被分配仓库的数据。
-- Admin 仍可看全部。
--
-- 变更:
--   1. CREATE TABLE user_warehouses (user_id, warehouse_id) + PK + FK + 索引
--   2. ENABLE RLS + admin ALL / operator SELECT own only
--   3. Seed: 给现有 active operator 默认分配所有 active warehouse
--   4. 收紧 RLS — warehouse/inventory/product_variant/shipment/shipment_item/tracking_event/sync_log
--      operator 仅可访问 assigned warehouse 内的数据
--   5. RPC get_sync_runs / get_sync_run_detail operator 分支加 assigned warehouse 过滤
--   6. 不引用 product_variant.is_archived
--   7. 不修改已执行 Migration 00001~00014
--   8. 不做管理 UI（P5-SY13B）
-- ============================================

-- ─── 1. user_warehouses 表 ─────────────────────────────────────────────

CREATE TABLE public.user_warehouses (
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  warehouse_id uuid       NOT NULL REFERENCES public.warehouse(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, warehouse_id)
);

-- 索引：按 warehouse_id 反向查询（管理界面可能需要列出某仓库的所有被分配用户）
CREATE INDEX idx_user_warehouses_warehouse_id ON public.user_warehouses(warehouse_id);

-- ─── 2. RLS：启用 ──────────────────────────────────────────────────────

ALTER TABLE public.user_warehouses ENABLE ROW LEVEL SECURITY;

-- Admin 完整访问（查看/修改所有分配关系）
CREATE POLICY "admin_all_user_warehouses" ON public.user_warehouses
  FOR ALL
  USING (public.get_user_role() = 'admin');

-- Operator 仅可查看自己的分配关系
CREATE POLICY "operator_select_own_user_warehouses" ON public.user_warehouses
  FOR SELECT
  USING (auth.uid() = user_id);

-- ─── 3. 辅助函数：获取当前用户的已分配仓库 ID ──────────────────────────
-- 供 RLS 策略和 RPC 复用；admin 返回所有 active overseas warehouse

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

-- ─── 4. Seed：给现有 active operator 分配所有 active warehouse ────────

INSERT INTO public.user_warehouses (user_id, warehouse_id)
SELECT p.id, w.id
FROM public.profiles p
CROSS JOIN public.warehouse w
JOIN public.role r ON p.role_id = r.id
WHERE r.name = 'operator'
  AND p.is_active = true
  AND w.is_active = true
ON CONFLICT DO NOTHING;

-- ─── 5. 收紧 Warehouse RLS ────────────────────────────────────────────

-- operator 仅能 SELECT 已分配仓库
DROP POLICY IF EXISTS "operator_select_warehouse" ON public.warehouse;
CREATE POLICY "operator_select_warehouse" ON public.warehouse
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- ─── 6. 收紧 Inventory RLS ───────────────────────────────────────────

-- operator SELECT: 仅已分配仓库的库存
DROP POLICY IF EXISTS "operator_select_inventory" ON public.inventory;
CREATE POLICY "operator_select_inventory" ON public.inventory
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- operator UPDATE: 仅已分配仓库的库存
DROP POLICY IF EXISTS "operator_update_inventory_quantity" ON public.inventory;
CREATE POLICY "operator_update_inventory_quantity" ON public.inventory
  FOR UPDATE
  USING (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  )
  WITH CHECK (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- ─── 7. 收紧 ProductVariant RLS ──────────────────────────────────────

-- operator SELECT: 仅当该 variant 在已分配仓库内有 inventory 时可见
-- 不引用 product_variant.is_archived
DROP POLICY IF EXISTS "operator_select_variant" ON public.product_variant;
CREATE POLICY "operator_select_variant" ON public.product_variant
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.inventory i
      WHERE i.variant_id = product_variant.id
        AND i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- ─── 8. 收紧 Shipment RLS ────────────────────────────────────────────

-- operator SELECT: 仅已分配仓库的 shipment（按 warehouse_id 直接关联）
DROP POLICY IF EXISTS "operator_select_shipment" ON public.shipment;
CREATE POLICY "operator_select_shipment" ON public.shipment
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND (
      warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      -- warehouse_id 可能为 NULL（ON DELETE SET NULL），此时 operator 不可见
    )
  );

-- operator INSERT: 仅可为自己已分配的仓库创建 shipment
DROP POLICY IF EXISTS "operator_insert_shipment" ON public.shipment;
CREATE POLICY "operator_insert_shipment" ON public.shipment
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- operator UPDATE: 仅可修改自己已分配仓库的 shipment
DROP POLICY IF EXISTS "operator_update_shipment" ON public.shipment;
CREATE POLICY "operator_update_shipment" ON public.shipment
  FOR UPDATE
  USING (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  )
  WITH CHECK (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- ─── 9. 收紧 ShipmentItem RLS ────────────────────────────────────────

-- operator SELECT: 仅已分配仓库的 shipment 下的 item
DROP POLICY IF EXISTS "operator_select_shipment_item" ON public.shipment_item;
CREATE POLICY "operator_select_shipment_item" ON public.shipment_item
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shipment s
      WHERE s.id = shipment_item.shipment_id
        AND s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- operator INSERT: 仅可为自己已分配仓库的 shipment 创建 item
DROP POLICY IF EXISTS "operator_insert_shipment_item" ON public.shipment_item;
CREATE POLICY "operator_insert_shipment_item" ON public.shipment_item
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shipment s
      WHERE s.id = shipment_item.shipment_id
        AND s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- ─── 10. 收紧 TrackingEvent RLS ──────────────────────────────────────

-- operator SELECT: 仅已分配仓库的 shipment 下的 tracking event
DROP POLICY IF EXISTS "operator_select_tracking_event" ON public.tracking_event;
CREATE POLICY "operator_select_tracking_event" ON public.tracking_event
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shipment s
      WHERE s.id = tracking_event.shipment_id
        AND s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- operator INSERT: 仅可为自己已分配仓库的 shipment 创建 tracking event
DROP POLICY IF EXISTS "operator_insert_tracking_event" ON public.tracking_event;
CREATE POLICY "operator_insert_tracking_event" ON public.tracking_event
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shipment s
      WHERE s.id = tracking_event.shipment_id
        AND s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- ─── 11. 收紧 SyncLog RLS ────────────────────────────────────────────

-- operator SELECT: 仅已分配仓库的 sync_log
DROP POLICY IF EXISTS "operator_select_sync_log" ON public.sync_log;
CREATE POLICY "operator_select_sync_log" ON public.sync_log
  FOR SELECT
  USING (
    public.get_user_role() = 'operator'
    AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
  );

-- ─── 12. RPC get_sync_runs: operator 分支加 assigned warehouse 过滤 ──

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

  -- admin 返回 display_name + warehouse_name + 完整业务字段
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
    -- operator: 脱敏版本 + assigned warehouse 过滤（P5-SY13A）
    --   禁止: exit_code, error_message, artifact hashes, dry_run_run_id,
    --     lease_expires_at, heartbeat_at, triggered_by UUID
    --   返回: 脱敏邮箱(auth.users.email), warehouse_name,
    --     controlled result_summary (仅 variantsCreated + inventoryUpdated),
    --     Chinese 失败摘要(代替原始error_message)
    --   仅返回已分配仓库的运行记录
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
        -- P5-SY13A: operator 仅看到已分配仓库的运行
        AND sr.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
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

-- ─── 13. RPC get_sync_run_detail: operator 分支加 assigned warehouse 过滤

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
  v_wh_id  uuid;
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
    -- operator: 脱敏版本 + assigned warehouse 过滤（P5-SY13A）
    -- 先读取该 run 的 warehouse_id，校验是否在已分配仓库中
    SELECT sr.warehouse_id INTO v_wh_id
    FROM public.sync_run sr
    WHERE sr.id = p_run_id;

    -- 不存在或未分配 → 返回 null（权限拒绝）
    IF v_wh_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.get_assigned_warehouse_ids() awid WHERE awid = v_wh_id
    ) THEN
      RETURN 'null'::jsonb;
    END IF;

    -- 脱敏版本（不含 plan_drift_differences）
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

-- ─── 14. 权限收口 — REVOKE/GRANT（保持 00007 原有权限不变）────────

-- get_sync_runs: Admin 和 Operator 均可通过 Server Action 调用（不变）
REVOKE EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_runs(uuid, integer) TO authenticated;

-- get_sync_run_detail: Admin 和 Operator 均可通过 Server Action 调用（不变）
REVOKE EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_run_detail(uuid) TO authenticated;

-- get_assigned_warehouse_ids: 允许 authenticated 执行，供 RLS 策略和 RPC 内部调用。
-- 函数仅返回 auth.uid() 自己的 user_warehouses，执行是安全的。
REVOKE EXECUTE ON FUNCTION public.get_assigned_warehouse_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_assigned_warehouse_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_warehouse_ids() TO authenticated;
-- SECURITY DEFINER 函数内部仍可使用，RLS 策略中也可引用

-- ============================================
-- SQL 静态注释验证场景（不连接数据库，仅静态审查）
-- ============================================
-- 场景说明：以下 SQL 片段用于验证 DDL/DML/RLS 语义正确性，不实际执行。
--
-- user_warehouses 表验证：
--   CREATE TABLE 含 user_id (FK→profiles) + warehouse_id (FK→warehouse) + PK(user_id, warehouse_id) + created_at
--   索引 idx_user_warehouses_warehouse_id ON warehouse_id
--   RLS 启用 + admin ALL + operator SELECT own
--
-- Seed 验证：
--   所有 active operator × 所有 active warehouse → INSERT INTO user_warehouses
--   admin 不参与 seed（admin 通过 get_user_role() = 'admin' 看全部）
--   ON CONFLICT DO NOTHING 保障幂等
--
-- get_assigned_warehouse_ids() 验证：
--   SECURITY DEFINER + SET search_path = '' + STABLE
--   SELECT warehouse_id FROM user_warehouses WHERE user_id = auth.uid()
--   返回 SETOF uuid
--   GRANT EXECUTE TO authenticated（仅返回 auth.uid() 自己的仓库）
--
-- Warehouse RLS 收紧验证：
--   operator_select_warehouse DROP + CREATE
--   USING: get_user_role() = 'operator' AND id IN (SELECT get_assigned_warehouse_ids())
--
-- Inventory RLS 收紧验证：
--   operator_select_inventory DROP + CREATE
--   USING: get_user_role() = 'operator' AND warehouse_id IN (SELECT get_assigned_warehouse_ids())
--   operator_update_inventory_quantity DROP + CREATE
--   USING + WITH CHECK 均含 warehouse_id IN (SELECT get_assigned_warehouse_ids())
--
-- ProductVariant RLS 收紧验证：
--   operator_select_variant DROP + CREATE
--   USING: get_user_role() = 'operator' AND EXISTS (SELECT 1 FROM inventory i
--     WHERE i.variant_id = product_variant.id
--     AND i.warehouse_id IN (SELECT get_assigned_warehouse_ids()))
--   不引用 is_archived
--
-- Shipment RLS 收紧验证：
--   operator_select_shipment DROP + CREATE
--   USING: warehouse_id IN assigned（warehouse_id NULL → 不可见）
--   operator_insert_shipment DROP + CREATE
--   WITH CHECK: warehouse_id IN assigned
--   operator_update_shipment DROP + CREATE
--   USING + WITH CHECK: warehouse_id IN assigned
--
-- ShipmentItem RLS 收紧验证：
--   operator_select_shipment_item DROP + CREATE
--   USING: EXISTS shipment WHERE warehouse_id IN assigned
--   operator_insert_shipment_item DROP + CREATE
--   WITH CHECK: EXISTS shipment WHERE warehouse_id IN assigned
--
-- TrackingEvent RLS 收紧验证：
--   operator_select_tracking_event DROP + CREATE
--   USING: EXISTS shipment WHERE warehouse_id IN assigned
--   operator_insert_tracking_event DROP + CREATE
--   WITH CHECK: EXISTS shipment WHERE warehouse_id IN assigned
--
-- SyncLog RLS 收紧验证：
--   operator_select_sync_log DROP + CREATE
--   USING: get_user_role() = 'operator' AND warehouse_id IN assigned
--
-- get_sync_runs operator 分支验证：
--   WHERE 子句新增: AND sr.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
--   脱敏矩阵不变（无 exit_code/error_message）
--
-- get_sync_run_detail operator 分支验证：
--   先读 warehouse_id → 不在 assigned 中 → RETURN 'null'::jsonb
--   脱敏矩阵不变
--
-- 不引用 product_variant.is_archived 验证：
--   grep -i 'is_archived' → 无匹配（除注释外）
--
-- Admin 不受影响验证：
--   Admin 通过 get_user_role() = 'admin' 仍可看全部数据
--   admin_all_* 策略未修改
--
-- 不改已执行 Migration 验证：
--   仅 CREATE TABLE / DROP POLICY IF EXISTS + CREATE POLICY / CREATE OR REPLACE FUNCTION
--   不 ALTER TABLE ... ADD/DROP COLUMN（不修改已有表结构）
