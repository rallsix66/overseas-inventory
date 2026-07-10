-- ============================================
-- Migration 00037: P6-UX-V2-F — stockStatus 扩展 in_transit
-- ============================================
-- 目的：海外库存页"在途库存"统计卡片改为可点击，
--       点击后列表仅显示有在途数量的库存行。
--       复用现有 p_stock_status 参数，新增值 'in_transit'，
--       不修改函数签名、不引入新参数、不影响 PostgREST 重载。
--
-- in_transit 口径（与 get_in_transit_confirmed_aggregate 一致）：
--   非 warehoused 状态的 shipment，按当前 inventory 行的
--   (variant_id, warehouse_id) 判断，存在至少一条
--   shipment_item.quantity - warehoused_quantity > 0。
--
-- 安全（与 Migration 00035 一致）：
--   - SECURITY INVOKER（auth.uid() 身份绑定）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - p_user_id 必须 = auth.uid()
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 输入参数防御
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00036。
-- ============================================

-- ═══════════════════════════════════════════
-- RPC: get_overseas_inventory — 新增 p_stock_status = 'in_transit'
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
     AND p_stock_status NOT IN ('out_of_stock', 'low', 'normal', 'in_transit') THEN
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
        -- ★ 00037: in_transit — 当前 inventory 行对 id (variant_id, warehouse_id) 存在非 warehoused 在途
        -- 口径与 get_in_transit_confirmed_aggregate 一致：
        --   shipment.status != 'warehoused' AND shipment_item.quantity - warehoused_quantity > 0
        OR (p_stock_status = 'in_transit'
            AND EXISTS (
              SELECT 1
              FROM public.shipment s
              JOIN public.shipment_item si ON si.shipment_id = s.id
              WHERE si.variant_id = i.variant_id
                AND s.warehouse_id = i.warehouse_id
                AND s.status != 'warehoused'
                AND si.quantity - si.warehoused_quantity > 0
            ))
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
