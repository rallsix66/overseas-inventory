-- ============================================
-- Migration 00035: P6-UX-V2-D 分词搜索增强 — get_overseas_inventory 搜索升级
-- ============================================
-- 目的：00034 的 p_search 仅支持连续子串匹配（ILIKE '%keyword%'），无法处理
--       "水杯 玻璃" → 匹配"玻璃水杯"这类分词场景。
--       本 migration 在保留连续子串匹配的基础上，增加分词 AND 语义匹配。
--
-- 搜索逻辑（增强后）：
--   1. 连续子串匹配（保留）：
--      v.sku / v.name / p.name / p.code 任一命中完整 p_search
--   2. 分词匹配（新增）：
--      - trim/lower p_search
--      - 按空白、连字符、下划线、斜杠、中/英文括号、逗号拆 token
--      - 去掉空 token
--      - NOT EXISTS: 每个 token 必须命中至少一个字段（AND 语义）
--      - p.name / p.code 使用 COALESCE 避免 LEFT JOIN NULL 破坏匹配
--
-- 字段语义（同 00034）：
--   variant_name     = product_variant.name   → BigSeller 原始品名（海外库存主品名）
--   product_name     = product.name           → DIS 标准产品名（绑定辅助信息）
--   product_code     = product.code           → DIS 标准产品编码（绑定辅助信息）
--
-- 安全（与 Migration 00027/00028/00034 一致）：
--   - SECURITY INVOKER（沿用 auth.uid() 身份绑定）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - p_user_id 必须 = auth.uid()
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 输入参数防御
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00034。
-- get_low_stock 无 p_search 参数，不需要改。
-- ============================================

-- ═══════════════════════════════════════════
-- RPC: get_overseas_inventory — 分词搜索增强
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
      v.name   AS variant_name,        -- BigSeller 原始品名
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
      -- ── 搜索：连续子串 + 分词 AND 语义 ──
      AND (
        p_search IS NULL
        -- 连续子串匹配（快速路径）
        OR v.sku ILIKE '%' || p_search || '%'
        OR v.name ILIKE '%' || p_search || '%'
        OR p.name ILIKE '%' || p_search || '%'
        OR p.code ILIKE '%' || p_search || '%'
        -- 分词匹配：所有 token 都必须命中至少一个字段
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(
            regexp_split_to_array(
              lower(trim(p_search)),
              '[\s\-_/()（）,，]+'
            )
          ) AS token
          WHERE token <> ''
            AND NOT (
              lower(COALESCE(v.sku, '')) LIKE '%' || token || '%'
              OR lower(COALESCE(v.name, '')) LIKE '%' || token || '%'
              OR lower(COALESCE(p.name, '')) LIKE '%' || token || '%'
              OR lower(COALESCE(p.code, '')) LIKE '%' || token || '%'
            )
        )
      )
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
