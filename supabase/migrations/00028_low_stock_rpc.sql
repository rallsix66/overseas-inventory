-- ============================================
-- Migration 00028: LOW-STOCK-PAGINATION — 低库存查询 RPC
-- ============================================
-- 目的：将 getLowStock() 的 JS 全量过滤、排序逻辑下推到 SQL 层。
--       SQL 层完成归档排除、仓库隔离、quantity <= safety_stock 过滤、
--       gap 计算、ORDER BY gap DESC, quantity ASC、LIMIT，确保
--       limit 只作用在"当前用户可见、未归档、真实低库存"的结果集之后。
--
-- 业务规则：
--   - 已匹配 variant（match_status = 'matched'）才参与低库存统计
--   - quantity > 0（正库存）
--   - quantity <= product.safety_stock → 低库存
--   - gap = safety_stock - quantity（缺口，用于排序）
--   - 用户归档按 user_variant_preference 排除
--   - Admin 看全部仓库，Operator 仅已分配仓库
--   - 返回结果按 gap DESC, quantity ASC 排序（缺口最大最优先）
--
-- 安全（与 Migration 00027 一致）：
--   - SECURITY INVOKER（沿用 auth.uid() 身份绑定）
--   - SET search_path = ''
--   - auth.uid() IS NOT NULL 检查
--   - p_user_id 必须 = auth.uid()
--   - REVOKE EXECUTE FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated
--   - 输入参数防御（COALESCE NULL 防御、limit 归一化/上限）
--   - 中文 RAISE EXCEPTION
--
-- 不修改已执行 Migration 00001~00027。
-- ============================================

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
