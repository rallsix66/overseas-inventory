-- ============================================
-- Migration 00034: P6-UX-V2-D 字段语义修正 — RPC 增加 variant_name
-- ============================================
-- 目的：海外库存 RPC（get_overseas_inventory / get_low_stock）当前仅返回
--       p.name AS product_name（DIS 标准产品名），未返回 v.name（BigSeller 原始品名）。
--       本 migration 为两个 RPC 增加 v.name AS variant_name 字段，
--       使前端可以区分 BigSeller 原始品名与 DIS 标准产品名。
--
-- 字段语义（修正后）：
--   variant_name     = product_variant.name   → BigSeller 原始品名（海外库存主品名）
--   product_name     = product.name           → DIS 标准产品名（绑定辅助信息）
--   product_code     = product.code           → DIS 标准产品编码（绑定辅助信息）
--
-- 安全（与 Migration 00027/00028 一致）：
--   - SECURITY INVOKER（沿用 auth.uid() 身份绑定）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - p_user_id 必须 = auth.uid()
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 输入参数防御
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00033。
-- ============================================

-- ═══════════════════════════════════════════
-- RPC 1: get_overseas_inventory — 增加 v.name AS variant_name
-- ═══════════════════════════════════════════

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
      v.name   AS variant_name,        -- ★ 新增：BigSeller 原始品名
      p.name   AS product_name,         -- DIS 标准产品名（保持兼容）
      p.code   AS product_code,         -- DIS 标准产品编码（保持兼容）
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
      -- SKU / BigSeller 品名 / 标准产品名搜索
      AND (p_search IS NULL
           OR v.sku ILIKE '%' || p_search || '%'
           OR v.name ILIKE '%' || p_search || '%'
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


-- ═══════════════════════════════════════════
-- RPC 2: get_low_stock — 增加 v.name AS variant_name
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_low_stock(
  p_user_id uuid,
  p_limit   integer DEFAULT 50
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
    RAISE EXCEPTION '未登录，无法查询低库存' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  -- ═══════════════════════════════════════════
  -- 参数防御
  -- ═══════════════════════════════════════════
  p_limit := COALESCE(p_limit, 50);

  IF p_limit < 1 THEN
    p_limit := 1;
  END IF;

  IF p_limit > 200 THEN
    p_limit := 200;
  END IF;

  -- ═══════════════════════════════════════════
  -- 主查询：低库存过滤 + gap 排序 + limit
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
      v.name   AS variant_name,        -- ★ 新增：BigSeller 原始品名
      p.name   AS product_name,
      p.code   AS product_code,
      COALESCE(p.safety_stock, 0) AS safety_stock,
      w.name   AS warehouse_name,
      w.type   AS warehouse_type,
      false    AS is_favorited,
      -- 缺口 = 安全库存 - 当前库存（正数表示缺货程度）
      COALESCE(p.safety_stock, 0) - i.quantity AS gap
    FROM public.inventory i
    INNER JOIN public.product_variant v ON v.id = i.variant_id
    LEFT JOIN  public.product p ON p.id = v.product_id
    INNER JOIN public.warehouse w ON w.id = i.warehouse_id
    -- 归档排除：当前用户已归档的 variant 不显示
    LEFT JOIN  public.user_variant_preference uvp_arch
      ON uvp_arch.variant_id = i.variant_id
      AND uvp_arch.user_id = p_user_id
      AND uvp_arch.preference_type = 'archived'
    WHERE uvp_arch.variant_id IS NULL
      -- 仓库隔离：admin 看全部，operator 仅已分配仓库
      AND (
        public.get_user_role() = 'admin'
        OR i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
      -- 低库存定义：已匹配 + 正库存 + quantity <= safety_stock
      AND v.match_status = 'matched'
      AND i.quantity > 0
      AND i.quantity <= COALESCE(p.safety_stock, 0)
  )
  SELECT jsonb_build_object(
    'data', COALESCE(
      (SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT * FROM filtered
        ORDER BY gap DESC, quantity ASC
        LIMIT p_limit
      ) t),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════
-- 权限收口 — get_low_stock
-- ═══════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.get_low_stock(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_low_stock(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_low_stock(uuid, integer) TO authenticated;
