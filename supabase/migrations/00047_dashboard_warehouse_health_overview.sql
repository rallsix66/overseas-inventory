-- ============================================
-- Migration 00047: 首页仓库库存健康度 RPC
-- ============================================
-- inventory_position（warehouse_id + variant_id）为唯一统计粒度。
-- 当前用户已归档 Variant 在分类和聚合前排除。

CREATE OR REPLACE FUNCTION public.get_warehouse_health_overview(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询库存健康度' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.name
  INTO v_role
  FROM public.profiles profile
  JOIN public.role r ON r.id = profile.role_id
  WHERE profile.id = auth.uid()
    AND profile.is_active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION '账户已停用或无权查询库存健康度' USING ERRCODE = 'P0001';
  END IF;

  WITH visible_scope AS (
    SELECT
      warehouse.id,
      warehouse.name,
      warehouse.country,
      warehouse.lead_time_days
    FROM public.warehouse warehouse
    WHERE warehouse.type = 'overseas'
      AND warehouse.is_active = true
      AND (
        v_role = 'admin'
        OR (
          v_role = 'operator'
          AND warehouse.id IN (SELECT public.get_assigned_warehouse_ids())
        )
      )
  ), inventory_positions AS (
    SELECT
      inventory.variant_id,
      inventory.warehouse_id,
      inventory.quantity,
      warehouse.name AS warehouse_name,
      warehouse.country,
      warehouse.lead_time_days,
      CASE
        WHEN inventory.quantity = 0 THEN 'out_of_stock'
        WHEN variant.product_id IS NULL OR variant.match_status <> 'matched' THEN 'unmatched'
        WHEN inventory.quantity <= product.safety_stock THEN 'low'
        ELSE 'normal'
      END AS health_status
    FROM public.inventory inventory
    JOIN visible_scope warehouse ON warehouse.id = inventory.warehouse_id
    JOIN public.product_variant variant ON variant.id = inventory.variant_id
    LEFT JOIN public.product product ON product.id = variant.product_id
    LEFT JOIN public.user_variant_preference uvp_arch
      ON uvp_arch.user_id = p_user_id
      AND uvp_arch.variant_id = inventory.variant_id
      AND uvp_arch.preference_type = 'archived'
    WHERE uvp_arch.variant_id IS NULL
  ), warehouse_rollup AS (
    SELECT
      warehouse_id,
      warehouse_name,
      country,
      lead_time_days,
      COUNT(*)::bigint AS total_position_count,
      COUNT(*) FILTER (WHERE health_status = 'normal')::bigint AS normal_count,
      COUNT(*) FILTER (WHERE health_status = 'low')::bigint AS low_stock_count,
      COUNT(*) FILTER (WHERE health_status = 'out_of_stock')::bigint AS out_of_stock_count,
      COUNT(*) FILTER (WHERE health_status = 'unmatched')::bigint AS unmatched_count
    FROM inventory_positions
    GROUP BY warehouse_id, warehouse_name, country, lead_time_days
  ), warehouse_labeled AS (
    SELECT
      warehouse_rollup.*,
      CASE
        WHEN normal_count + low_stock_count + out_of_stock_count = 0 THEN NULL
        ELSE ROUND(
          normal_count * 100.0 / (normal_count + low_stock_count + out_of_stock_count),
          1
        )
      END AS health_rate
    FROM warehouse_rollup
  ), summary AS (
    SELECT jsonb_build_object(
      'distinct_variant_count', COUNT(DISTINCT variant_id),
      'total_position_count', COUNT(*),
      'normal_count', COUNT(*) FILTER (WHERE health_status = 'normal'),
      'low_stock_count', COUNT(*) FILTER (WHERE health_status = 'low'),
      'out_of_stock_count', COUNT(*) FILTER (WHERE health_status = 'out_of_stock'),
      'unmatched_count', COUNT(*) FILTER (WHERE health_status = 'unmatched'),
      'health_rate', CASE
        WHEN COUNT(*) FILTER (
          WHERE health_status IN ('normal', 'low', 'out_of_stock')
        ) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE health_status = 'normal') * 100.0
            / COUNT(*) FILTER (
              WHERE health_status IN ('normal', 'low', 'out_of_stock')
            ),
          1
        )
      END,
      'total_quantity', COALESCE(SUM(quantity), 0)
    ) AS value
    FROM inventory_positions
  ), warehouses AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'warehouse_id', warehouse_id,
          'warehouse_name', warehouse_name,
          'country', country,
          'total_position_count', total_position_count,
          'normal_count', normal_count,
          'low_stock_count', low_stock_count,
          'out_of_stock_count', out_of_stock_count,
          'unmatched_count', unmatched_count,
          'health_rate', health_rate,
          'lead_time_days', lead_time_days
        )
        ORDER BY
          (health_rate IS NULL),
          health_rate ASC,
          out_of_stock_count DESC,
          low_stock_count DESC,
          warehouse_name ASC
      ),
      '[]'::jsonb
    ) AS value
    FROM warehouse_labeled
  )
  SELECT jsonb_build_object(
    'summary', (SELECT value FROM summary),
    'warehouses', (SELECT value FROM warehouses)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_warehouse_health_overview(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_warehouse_health_overview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_warehouse_health_overview(uuid) TO authenticated;

-- 回滚：DROP FUNCTION IF EXISTS public.get_warehouse_health_overview(uuid);
