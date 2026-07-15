-- ============================================
-- Migration 00045: P7 全球库存作战室列表 RPC
-- ============================================
-- 依赖：00043 forecast_stockout。
-- inventory 为驱动表；权限、聚合、排序与分页全部在数据库内完成。

CREATE OR REPLACE FUNCTION public.get_product_overview(
  p_user_id uuid,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_stockout_urgency text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_offset integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询全球库存总览' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION '账户已停用或无权查询全球库存总览' USING ERRCODE = 'P0001';
  END IF;

  IF p_page IS NULL OR p_page < 1 THEN
    RAISE EXCEPTION '页码必须大于等于 1' USING ERRCODE = 'P0001';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION '每页条数必须在 1 到 100 之间' USING ERRCODE = 'P0001';
  END IF;

  p_search := NULLIF(TRIM(p_search), '');
  p_stockout_urgency := NULLIF(TRIM(p_stockout_urgency), '');
  p_country := NULLIF(UPPER(TRIM(p_country)), '');

  IF p_stockout_urgency IS NOT NULL
     AND p_stockout_urgency NOT IN ('critical', 'warning', 'ok', 'data_incomplete') THEN
    RAISE EXCEPTION '无效的断货风险筛选值' USING ERRCODE = 'P0001';
  END IF;

  IF p_country IS NOT NULL AND p_country NOT IN ('TH', 'ID', 'MY', 'PH', 'VN', 'CN') THEN
    RAISE EXCEPTION '无效的国家筛选值' USING ERRCODE = 'P0001';
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  WITH visible_scope AS (
    SELECT w.id, w.name, w.country, w.lead_time_days
    FROM public.warehouse w
    WHERE w.type = 'overseas'
      AND w.is_active = true
      AND (
        v_role = 'admin'
        OR (
          v_role = 'operator'
          AND w.id IN (SELECT public.get_assigned_warehouse_ids())
        )
      )
  ), warehouse_rows AS (
    SELECT
      variant.id AS variant_id,
      variant.product_id,
      variant.sku,
      variant.country AS variant_country,
      variant.name AS variant_name,
      variant.match_status,
      product.name AS product_name,
      product.safety_stock,
      warehouse.id AS warehouse_id,
      warehouse.name AS warehouse_name,
      warehouse.country AS warehouse_country,
      inventory.quantity AS on_hand,
      inventory.daily_sales,
      inbound.display_events AS inbound,
      inbound.visible_inbound_quantity,
      inbound.eta_missing_quantity,
      forecast.est_stockout_date,
      forecast.effective_inbound,
      forecast.ds_incomplete,
      CASE
        WHEN inventory.quantity = 0 THEN 'out_of_stock'
        WHEN variant.product_id IS NULL OR variant.match_status <> 'matched' THEN 'unmatched'
        WHEN inventory.quantity <= product.safety_stock THEN 'low'
        ELSE 'normal'
      END AS base_stock_status
    FROM public.inventory inventory
    JOIN visible_scope warehouse ON warehouse.id = inventory.warehouse_id
    JOIN public.product_variant variant ON variant.id = inventory.variant_id
    LEFT JOIN public.product product ON product.id = variant.product_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          jsonb_agg(
            jsonb_build_object('eta', grouped.eta, 'qty', grouped.remaining)
            ORDER BY grouped.eta NULLS LAST
          ),
          '[]'::jsonb
        ) AS display_events,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('eta', grouped.eta, 'remaining', grouped.remaining)
            ORDER BY grouped.eta NULLS LAST
          ),
          '[]'::jsonb
        ) AS forecast_events,
        COALESCE(SUM(grouped.remaining), 0)::integer AS visible_inbound_quantity,
        COALESCE(SUM(grouped.remaining) FILTER (WHERE grouped.eta IS NULL), 0)::integer
          AS eta_missing_quantity
      FROM (
        SELECT
          shipment.estimated_arrival AS eta,
          SUM(item.quantity - item.warehoused_quantity)::integer AS remaining
        FROM public.shipment shipment
        JOIN public.shipment_item item ON item.shipment_id = shipment.id
        WHERE shipment.warehouse_id = inventory.warehouse_id
          AND item.variant_id = inventory.variant_id
          AND shipment.cancelled_at IS NULL
          AND shipment.bigseller_absorbed_at IS NULL
          AND shipment.status IN ('booking', 'loading', 'departed', 'arrived', 'customs')
          AND (item.quantity - item.warehoused_quantity) > 0
        GROUP BY shipment.estimated_arrival
      ) grouped
    ) inbound ON true
    CROSS JOIN LATERAL public.forecast_stockout(
      inventory.quantity,
      inventory.daily_sales,
      warehouse.lead_time_days,
      inbound.forecast_events
    ) forecast
    WHERE p_country IS NULL OR warehouse.country = p_country
  ), row_aggregated AS (
    SELECT
      variant_id,
      product_id,
      sku,
      variant_country,
      product_name,
      variant_name,
      jsonb_agg(
        jsonb_build_object(
          'warehouse_id', warehouse_id,
          'warehouse_name', warehouse_name,
          'country', warehouse_country,
          'q', on_hand,
          'daily_sales', daily_sales,
          'inb', inbound,
          'base_stock_status', base_stock_status
        )
        ORDER BY warehouse_country, warehouse_name, warehouse_id
      ) AS per_warehouse,
      SUM(on_hand)::bigint AS visible_on_hand,
      SUM(visible_inbound_quantity)::bigint AS visible_inbound_quantity,
      SUM(effective_inbound)::bigint AS effective_inbound,
      SUM(eta_missing_quantity)::bigint AS eta_missing_quantity,
      (SUM(on_hand) + SUM(visible_inbound_quantity))::bigint AS visible_total_quantity,
      CASE
        WHEN BOOL_OR(base_stock_status = 'out_of_stock') THEN 'out_of_stock'
        WHEN BOOL_OR(base_stock_status = 'low') THEN 'low'
        WHEN BOOL_OR(base_stock_status = 'normal') THEN 'normal'
        ELSE 'unmatched'
      END AS base_stock_status,
      MIN(est_stockout_date) FILTER (WHERE ds_incomplete = false) AS earliest_stockout,
      (
        COUNT(*) FILTER (WHERE ds_incomplete = false) > 0
        AND COUNT(*) FILTER (WHERE ds_incomplete = true) > 0
      ) AS partial_data
    FROM warehouse_rows
    GROUP BY variant_id, product_id, sku, variant_country, product_name, variant_name
  ), row_labeled AS (
    SELECT
      row_aggregated.*,
      CASE
        WHEN earliest_stockout IS NULL THEN 'data_incomplete'
        WHEN earliest_stockout < CURRENT_DATE + 3 THEN 'critical'
        WHEN earliest_stockout <= CURRENT_DATE + 7 THEN 'warning'
        ELSE 'ok'
      END AS stockout_urgency,
      'data_unavailable'::text AS domestic_status
    FROM row_aggregated
  ), base_cohort AS (
    SELECT *
    FROM row_labeled
    WHERE p_search IS NULL
      OR sku ILIKE '%' || p_search || '%'
      OR variant_name ILIKE '%' || p_search || '%'
      OR COALESCE(product_name, '') ILIKE '%' || p_search || '%'
  ), queue_counts AS (
    SELECT jsonb_build_object(
      'critical', COUNT(*) FILTER (WHERE stockout_urgency = 'critical'),
      'warning', COUNT(*) FILTER (WHERE stockout_urgency = 'warning'),
      'ok', COUNT(*) FILTER (WHERE stockout_urgency = 'ok'),
      'data_incomplete', COUNT(*) FILTER (WHERE stockout_urgency = 'data_incomplete')
    ) AS value
    FROM base_cohort
  ), filtered_cohort AS (
    SELECT *
    FROM base_cohort
    WHERE p_stockout_urgency IS NULL OR stockout_urgency = p_stockout_urgency
  ), total_count AS (
    SELECT COUNT(*) AS value FROM filtered_cohort
  ), items AS (
    SELECT *
    FROM filtered_cohort
    ORDER BY
      CASE stockout_urgency
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'ok' THEN 3
        ELSE 4
      END,
      earliest_stockout NULLS LAST,
      variant_id
    LIMIT p_page_size OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(items))
        FROM items
      ),
      '[]'::jsonb
    ),
    'total_count', (SELECT value FROM total_count),
    'queue_counts', (SELECT value FROM queue_counts)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_product_overview(
  uuid, integer, integer, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_overview(
  uuid, integer, integer, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_overview(
  uuid, integer, integer, text, text, text
) TO authenticated;
