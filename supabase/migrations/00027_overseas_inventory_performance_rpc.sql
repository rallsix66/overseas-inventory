-- ============================================
-- Migration 00027: PERF-S1A — 海外库存性能优化 RPC
-- ============================================
-- 目的：将 getOverseasList / getOverseasStats / getLowStock 的 JS 全量过滤、
--       排序、分页逻辑下推到 SQL 层；合并 getInTransitByVariantAndWarehouse
--       与 getConfirmedWarehousedByWarehouse 的 JS/N+1 查询为单次 RPC。
--
-- 业务规则（与现有 Repository 保持一致）：
--   - inventory.quantity 唯一事实来源是 BigSeller 同步，DIS 入仓不写它
--   - 在途 = 非 warehoused shipment 的 (quantity - warehoused_quantity)
--   - 已确认到仓 = customs 或 (warehoused + bigseller_absorbed_at IS NULL)
--     的 warehoused_quantity 聚合
--   - 用户归档/关注按 user_variant_preference 每人独立
--   - Admin 看全部海外仓，Operator 仅看已分配仓库
--   - 已匹配 variant 才参与低库存统计
--
-- 安全：
--   - SECURITY INVOKER（沿用 auth.uid() 身份绑定）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - p_user_id 必须 = auth.uid()
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 输入参数防御（COALESCE NULL 防御、page/page_size 归一化、stock_status 白名单）
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00026。
-- ============================================

-- ============================================
-- RPC 1: get_overseas_inventory
-- ============================================
-- 替代 inventoryRepository.getOverseasList() 的 JS 全量过滤分页。
-- SQL 层完成：overseas 过滤、country/warehouse/search/stock_status 筛选、
--            用户归档排除、关注标记、favorited_only 筛选、
--            Admin/Operator 仓库隔离、排序（关注置顶 → quantity ASC）、
--            LIMIT/OFFSET 分页、COUNT(*) OVER() 真实 total。
-- ============================================

CREATE OR REPLACE FUNCTION public.get_overseas_inventory(
  p_user_id         uuid,
  p_country         text    DEFAULT NULL,
  p_warehouse_id    uuid    DEFAULT NULL,
  p_search          text    DEFAULT NULL,
  p_stock_status    text    DEFAULT NULL,
  p_favorited_only  boolean DEFAULT false,
  p_page            integer DEFAULT 1,
  p_page_size       integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_offset  integer;
  v_result  jsonb;
BEGIN
  -- ═══════════════════════════════════════════
  -- 身份绑定
  -- ═══════════════════════════════════════════
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询海外库存' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  -- ═══════════════════════════════════════════
  -- 参数防御
  -- ═══════════════════════════════════════════
  p_page := COALESCE(p_page, 1);
  p_page_size := COALESCE(p_page_size, 20);
  p_favorited_only := COALESCE(p_favorited_only, false);

  IF p_page < 1 THEN
    p_page := 1;
  END IF;

  IF p_page_size < 1 THEN
    p_page_size := 20;
  ELSIF p_page_size > 100 THEN
    p_page_size := 100;
  END IF;

  IF p_search IS NOT NULL AND p_search = '' THEN
    p_search := NULL;
  END IF;

  IF p_stock_status IS NOT NULL
     AND p_stock_status NOT IN ('out_of_stock', 'low', 'normal') THEN
    RAISE EXCEPTION '无效的库存状态筛选值: %', p_stock_status USING ERRCODE = 'P0001';
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  -- ═══════════════════════════════════════════
  -- 主查询：海外库存 + 过滤 + 排序 + 分页
  -- ═══════════════════════════════════════════
  WITH filtered AS (
    SELECT
      i.id,
      i.variant_id,
      i.warehouse_id,
      i.quantity,
      i.last_sync_at,
      v.sku,
      v.country,
      v.match_status,
      p.name   AS product_name,
      p.code   AS product_code,
      COALESCE(p.safety_stock, 0) AS safety_stock,
      w.name   AS warehouse_name,
      w.type   AS warehouse_type,
      -- 关注标记：当前用户是否已关注此 variant
      CASE WHEN uvp_fav.variant_id IS NOT NULL THEN true ELSE false END AS is_favorited
    FROM public.inventory i
    INNER JOIN public.product_variant v ON v.id = i.variant_id
    LEFT JOIN  public.product p ON p.id = v.product_id
    INNER JOIN public.warehouse w ON w.id = i.warehouse_id AND w.type = 'overseas'
    -- 归档排除：当前用户已归档的 variant 不显示
    LEFT JOIN  public.user_variant_preference uvp_arch
      ON uvp_arch.variant_id = i.variant_id
      AND uvp_arch.user_id = p_user_id
      AND uvp_arch.preference_type = 'archived'
    -- 关注标记 join
    LEFT JOIN  public.user_variant_preference uvp_fav
      ON uvp_fav.variant_id = i.variant_id
      AND uvp_fav.user_id = p_user_id
      AND uvp_fav.preference_type = 'favorited'
    -- 排除已归档
    WHERE uvp_arch.variant_id IS NULL
      -- 仓库隔离：admin 看全部，operator 仅已分配仓库
      AND (
        public.get_user_role() = 'admin'
        OR i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
      -- country 筛选
      AND (p_country IS NULL OR v.country = p_country)
      -- warehouse 筛选
      AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
      -- SKU / 产品名搜索
      AND (p_search IS NULL
           OR v.sku ILIKE '%' || p_search || '%'
           OR p.name ILIKE '%' || p_search || '%')
      -- 库存状态筛选
      AND (
        p_stock_status IS NULL
        OR (p_stock_status = 'out_of_stock' AND i.quantity = 0)
        OR (p_stock_status = 'low'    AND v.match_status = 'matched' AND i.quantity > 0 AND i.quantity <= COALESCE(p.safety_stock, 0))
        OR (p_stock_status = 'normal' AND v.match_status = 'matched' AND i.quantity > COALESCE(p.safety_stock, 0))
      )
      -- 仅关注
      AND (p_favorited_only = false OR uvp_fav.variant_id IS NOT NULL)
  )
  SELECT jsonb_build_object(
    'data', COALESCE(
      (SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT * FROM filtered
        ORDER BY
          is_favorited DESC,
          quantity ASC
        LIMIT p_page_size OFFSET v_offset
      ) t),
      '[]'::jsonb
    ),
    'total', (SELECT COUNT(*) FROM filtered)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口 — get_overseas_inventory
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_overseas_inventory(uuid, text, uuid, text, text, boolean, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_overseas_inventory(uuid, text, uuid, text, text, boolean, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_overseas_inventory(uuid, text, uuid, text, text, boolean, integer, integer) TO authenticated;

-- ============================================
-- RPC 2: get_overseas_stats
-- ============================================
-- 替代 inventoryRepository.getOverseasStats() 的 JS 全量聚合。
-- SQL 层完成：COUNT(DISTINCT variant_id)、SUM(quantity)、
--            低库存 COUNT(DISTINCT)、MAX(last_sync_at)。
-- 与列表 RPC 使用一致的 overseas/归档/仓库隔离/country/warehouse 过滤。
-- ============================================

CREATE OR REPLACE FUNCTION public.get_overseas_stats(
  p_user_id      uuid,
  p_country      text DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ═══════════════════════════════════════════
  -- 身份绑定
  -- ═══════════════════════════════════════════
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询海外库存统计' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  -- ═══════════════════════════════════════════
  -- 聚合查询
  -- ═══════════════════════════════════════════
  WITH base AS (
    SELECT
      i.variant_id,
      i.quantity,
      i.last_sync_at,
      v.match_status,
      p.safety_stock
    FROM public.inventory i
    INNER JOIN public.product_variant v ON v.id = i.variant_id
    LEFT JOIN  public.product p ON p.id = v.product_id
    INNER JOIN public.warehouse w ON w.id = i.warehouse_id AND w.type = 'overseas'
    -- 归档排除
    LEFT JOIN  public.user_variant_preference uvp_arch
      ON uvp_arch.variant_id = i.variant_id
      AND uvp_arch.user_id = p_user_id
      AND uvp_arch.preference_type = 'archived'
    WHERE uvp_arch.variant_id IS NULL
      -- 仓库隔离
      AND (
        public.get_user_role() = 'admin'
        OR i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
      -- country 筛选
      AND (p_country IS NULL OR v.country = p_country)
      -- warehouse 筛选
      AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
  )
  SELECT jsonb_build_object(
    'total_skus',        (SELECT COUNT(DISTINCT variant_id) FROM base),
    'total_quantity',    COALESCE((SELECT SUM(quantity) FROM base), 0),
    'low_stock_count',   COALESCE(
      (SELECT COUNT(DISTINCT variant_id) FROM base
       WHERE quantity > 0
         AND match_status = 'matched'
         AND quantity <= COALESCE(safety_stock, 0)),
      0
    ),
    'last_sync_at',      (SELECT MAX(last_sync_at) FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口 — get_overseas_stats
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_overseas_stats(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_overseas_stats(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_overseas_stats(uuid, text, uuid) TO authenticated;

-- ============================================
-- RPC 3: get_in_transit_confirmed_aggregate
-- ============================================
-- 合并 getInTransitByVariantAndWarehouse + getConfirmedWarehousedByWarehouse
-- 的 N+1 JS 查询为单次 SQL 聚合。
--
-- 返回 JSONB 数组，每项：
--   warehouse_id, variant_id, in_transit_quantity, confirmed_quantity
--
-- 口径：
--   - 在途 = 非 warehoused shipment 的 SUM(quantity - warehoused_quantity)
--   - 已确认到仓 = SUM(warehoused_quantity) WHERE
--       status='customs'
--       OR (status='warehoused' AND bigseller_absorbed_at IS NULL)
--   - 已 BigSeller 吸收的 warehoused shipment 不参与 confirmed_quantity
--   - 不读/写 inventory.quantity
-- ============================================

CREATE OR REPLACE FUNCTION public.get_in_transit_confirmed_aggregate(
  p_user_id       uuid,
  p_warehouse_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ═══════════════════════════════════════════
  -- 身份绑定
  -- ═══════════════════════════════════════════
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询在途与已确认到仓聚合' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  -- ═══════════════════════════════════════════
  -- 合并在途 + 已确认到仓聚合
  -- 一次扫描 shipment + shipment_item，两个聚合。
  -- ═══════════════════════════════════════════
  WITH
  -- 符合条件的 shipment（仓库隔离 + 可选仓库列表过滤）
  eligible_shipment AS (
    SELECT s.id, s.warehouse_id, s.status, s.bigseller_absorbed_at
    FROM public.shipment s
    WHERE s.warehouse_id IS NOT NULL
      -- 仓库隔离：admin 全量，operator 已分配
      AND (
        public.get_user_role() = 'admin'
        OR s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
      -- 可选：限定仓库列表
      AND (p_warehouse_ids IS NULL OR s.warehouse_id = ANY(p_warehouse_ids))
  ),
  -- 在途聚合：status != 'warehoused'
  in_transit_agg AS (
    SELECT
      es.warehouse_id,
      si.variant_id,
      SUM(si.quantity - si.warehoused_quantity)::integer AS in_transit_quantity
    FROM eligible_shipment es
    JOIN public.shipment_item si ON si.shipment_id = es.id
    WHERE es.status != 'warehoused'
    GROUP BY es.warehouse_id, si.variant_id
  ),
  -- 已确认到仓聚合：customs OR (warehoused + not absorbed)
  confirmed_agg AS (
    SELECT
      es.warehouse_id,
      si.variant_id,
      SUM(si.warehoused_quantity)::integer AS confirmed_quantity
    FROM eligible_shipment es
    JOIN public.shipment_item si ON si.shipment_id = es.id
    WHERE es.status = 'customs'
       OR (es.status = 'warehoused' AND es.bigseller_absorbed_at IS NULL)
    GROUP BY es.warehouse_id, si.variant_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'warehouse_id',        COALESCE(ita.warehouse_id, ca.warehouse_id),
        'variant_id',          COALESCE(ita.variant_id, ca.variant_id),
        'in_transit_quantity', COALESCE(ita.in_transit_quantity, 0),
        'confirmed_quantity',  COALESCE(ca.confirmed_quantity, 0)
      )
      ORDER BY
        COALESCE(ita.warehouse_id, ca.warehouse_id),
        COALESCE(ita.variant_id, ca.variant_id)
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM in_transit_agg ita
  FULL OUTER JOIN confirmed_agg ca
    ON ca.warehouse_id = ita.warehouse_id
    AND ca.variant_id = ita.variant_id;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口 — get_in_transit_confirmed_aggregate
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_in_transit_confirmed_aggregate(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_in_transit_confirmed_aggregate(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_in_transit_confirmed_aggregate(uuid, uuid[]) TO authenticated;
