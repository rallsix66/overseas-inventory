-- ============================================
-- Migration 00046: P7 全球库存作战室详情 RPC
-- ============================================
-- 依赖：00043 forecast_stockout、00044 get_replenishment_suggestions。
-- P1 行动字段逐仓复用 P1 RPC，本 Migration 不复制补货公式。

CREATE OR REPLACE FUNCTION public.get_war_room_variant_detail(
  p_user_id uuid,
  p_variant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_warehouse_id uuid;
  v_visible_count integer := 0;
  v_p1_result jsonb;
  v_p1_row jsonb;
  v_p1_by_warehouse jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询产品详情' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION '产品 SKU 参数无效' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.name
  INTO v_role
  FROM public.profiles profile
  JOIN public.role r ON r.id = profile.role_id
  WHERE profile.id = auth.uid()
    AND profile.is_active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION '账户已停用或无权查询产品详情' USING ERRCODE = 'P0001';
  END IF;

  FOR v_warehouse_id IN
    SELECT inventory.warehouse_id
    FROM public.inventory inventory
    JOIN public.warehouse warehouse ON warehouse.id = inventory.warehouse_id
    WHERE inventory.variant_id = p_variant_id
      AND warehouse.type = 'overseas'
      AND warehouse.is_active = true
      AND (
        v_role = 'admin'
        OR (
          v_role = 'operator'
          AND warehouse.id IN (SELECT public.get_assigned_warehouse_ids())
        )
      )
    ORDER BY inventory.warehouse_id
  LOOP
    v_visible_count := v_visible_count + 1;

    SELECT public.get_replenishment_suggestions(
      p_user_id := p_user_id,
      p_variant_id := p_variant_id,
      p_warehouse_id := v_warehouse_id,
      p_country := NULL,
      p_urgency := NULL,
      p_search := NULL,
      p_include_zero := true,
      p_page := 1,
      p_page_size := 1
    )
    INTO v_p1_result;

    IF jsonb_typeof(v_p1_result -> 'data') <> 'array'
       OR jsonb_array_length(v_p1_result -> 'data') <> 1 THEN
      RAISE EXCEPTION '补货建议数据契约异常' USING ERRCODE = 'P0001';
    END IF;

    v_p1_row := v_p1_result -> 'data' -> 0;
    IF v_p1_row ->> 'warehouse_id' <> v_warehouse_id::text
       OR v_p1_row ->> 'variant_id' <> p_variant_id::text THEN
      RAISE EXCEPTION '补货建议仓库映射异常' USING ERRCODE = 'P0001';
    END IF;

    v_p1_by_warehouse := v_p1_by_warehouse
      || jsonb_build_object(v_warehouse_id::text, v_p1_row);
  END LOOP;

  IF v_visible_count = 0 THEN
    RAISE EXCEPTION '无权访问该产品或产品数据不存在' USING ERRCODE = 'P0001';
  END IF;

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
      product.safety_stock AS product_safety_stock,
      warehouse.id AS warehouse_id,
      warehouse.name AS warehouse_name,
      warehouse.country AS warehouse_country,
      inventory.quantity AS on_hand,
      inventory.daily_sales,
      inbound.events AS inbound,
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
      END AS base_stock_status,
      v_p1_by_warehouse -> warehouse.id::text AS replenishment
    FROM public.inventory inventory
    JOIN visible_scope warehouse ON warehouse.id = inventory.warehouse_id
    JOIN public.product_variant variant ON variant.id = inventory.variant_id
    LEFT JOIN public.product product ON product.id = variant.product_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          jsonb_agg(
            jsonb_build_object('eta', grouped.eta, 'remaining', grouped.remaining)
            ORDER BY grouped.eta NULLS LAST
          ),
          '[]'::jsonb
        ) AS events,
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
      inbound.events
    ) forecast
    WHERE inventory.variant_id = p_variant_id
  ), row_aggregated AS (
    SELECT
      variant_id,
      product_id,
      sku,
      variant_country,
      product_name,
      variant_name,
      SUM(on_hand)::bigint AS visible_on_hand,
      SUM(visible_inbound_quantity)::bigint AS visible_inbound_quantity,
      SUM(effective_inbound)::bigint AS effective_inbound,
      SUM(eta_missing_quantity)::bigint AS eta_missing_quantity,
      (SUM(on_hand) + SUM(visible_inbound_quantity))::bigint AS visible_total_quantity,
      MIN(est_stockout_date) FILTER (WHERE ds_incomplete = false) AS earliest_stockout,
      (
        COUNT(*) FILTER (WHERE ds_incomplete = false) > 0
        AND COUNT(*) FILTER (WHERE ds_incomplete = true) > 0
      ) AS partial_data,
      jsonb_agg(
        jsonb_build_object(
          'warehouse_id', warehouse_id,
          'warehouse_name', warehouse_name,
          'country', warehouse_country,
          'on_hand', on_hand,
          'daily_sales', daily_sales,
          'inbound', inbound,
          'visible_inbound_quantity', visible_inbound_quantity,
          'eta_missing_quantity', eta_missing_quantity,
          'est_stockout_date', replenishment ->> 'est_stockout_date',
          'effective_inbound', COALESCE((replenishment ->> 'effective_inbound')::integer, 0),
          'base_stock_status', base_stock_status,
          'safety_stock', (replenishment ->> 'safety_stock')::integer,
          'target_stock', (replenishment ->> 'target_stock')::integer,
          'net_demand', COALESCE((replenishment ->> 'net_demand')::integer, 0),
          'suggest_qty', COALESCE((replenishment ->> 'suggest_qty')::integer, 0),
          'latest_order_date', replenishment ->> 'latest_order_date',
          'replenishment_urgency', replenishment ->> 'urgency'
        )
        ORDER BY warehouse_country, warehouse_name, warehouse_id
      ) AS assigned_warehouse_detail
    FROM warehouse_rows
    GROUP BY variant_id, product_id, sku, variant_country, product_name, variant_name
  ), country_agg AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'country', country_rows.warehouse_country,
        'on_hand', country_rows.on_hand,
        'daily_sales', country_rows.daily_sales,
        'visible_inbound_quantity', country_rows.visible_inbound_quantity,
        'eta_missing_quantity', country_rows.eta_missing_quantity,
        'earliest_stockout', country_rows.earliest_stockout
      )
      ORDER BY country_rows.warehouse_country
    ) AS value
    FROM (
      SELECT
        warehouse_country,
        SUM(on_hand)::bigint AS on_hand,
        CASE
          WHEN COUNT(*) FILTER (WHERE daily_sales IS NOT NULL AND daily_sales > 0) = 0
            THEN NULL
          ELSE SUM(daily_sales) FILTER (WHERE daily_sales IS NOT NULL AND daily_sales > 0)
        END AS daily_sales,
        SUM(visible_inbound_quantity)::bigint AS visible_inbound_quantity,
        SUM(eta_missing_quantity)::bigint AS eta_missing_quantity,
        MIN(est_stockout_date) FILTER (WHERE ds_incomplete = false) AS earliest_stockout
      FROM warehouse_rows
      GROUP BY warehouse_country
    ) country_rows
  )
  SELECT jsonb_build_object(
    'variant_id', aggregated.variant_id,
    'product_id', aggregated.product_id,
    'sku', aggregated.sku,
    'variant_country', aggregated.variant_country,
    'product_name', aggregated.product_name,
    'variant_name', aggregated.variant_name,
    'visible_on_hand', aggregated.visible_on_hand,
    'visible_inbound_quantity', aggregated.visible_inbound_quantity,
    'effective_inbound', aggregated.effective_inbound,
    'eta_missing_quantity', aggregated.eta_missing_quantity,
    'visible_total_quantity', aggregated.visible_total_quantity,
    'earliest_stockout', aggregated.earliest_stockout,
    'stockout_urgency', CASE
      WHEN aggregated.earliest_stockout IS NULL THEN 'data_incomplete'
      WHEN aggregated.earliest_stockout < CURRENT_DATE + 3 THEN 'critical'
      WHEN aggregated.earliest_stockout <= CURRENT_DATE + 7 THEN 'warning'
      ELSE 'ok'
    END,
    'partial_data', aggregated.partial_data,
    'domestic_status', 'data_unavailable',
    'assigned_warehouse_detail', aggregated.assigned_warehouse_detail,
    'country_agg', COALESCE((SELECT value FROM country_agg), '[]'::jsonb)
  )
  INTO v_result
  FROM row_aggregated aggregated;

  IF v_result IS NULL THEN
    RAISE EXCEPTION '无权访问该产品或产品数据不存在' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_war_room_variant_detail(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_war_room_variant_detail(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_war_room_variant_detail(uuid, uuid) TO authenticated;
