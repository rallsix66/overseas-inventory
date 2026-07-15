-- ============================================
-- Migration 00044: P1 预测式补货读取 RPC
-- ============================================
-- 依赖：00041 warehouse 参数、00042 cancelled_at、00043 forecast_stockout。
-- 两个 RPC 均 SECURITY INVOKER，并绑定 auth.uid() 与当前用户仓库权限。

CREATE OR REPLACE FUNCTION public.get_in_transit_detail(
  p_user_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询在途明细' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'shipment_id', s.id,
        'variant_id', si.variant_id,
        'warehouse_id', s.warehouse_id,
        'status', s.status,
        'estimated_arrival', s.estimated_arrival,
        'remaining_quantity', (si.quantity - si.warehoused_quantity),
        'is_planned', (s.status = 'booking')
      )
      ORDER BY s.estimated_arrival, s.id, si.variant_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.shipment s
  JOIN public.shipment_item si ON si.shipment_id = s.id
  JOIN public.warehouse w ON w.id = s.warehouse_id
  WHERE s.warehouse_id IS NOT NULL
    AND w.type = 'overseas'
    AND w.is_active = true
    AND s.cancelled_at IS NULL
    AND s.bigseller_absorbed_at IS NULL
    AND s.status IN ('booking', 'loading', 'departed', 'arrived', 'customs')
    AND s.estimated_arrival IS NOT NULL
    AND (si.quantity - si.warehoused_quantity) > 0
    AND (p_warehouse_id IS NULL OR s.warehouse_id = p_warehouse_id)
    AND (p_variant_id IS NULL OR si.variant_id = p_variant_id)
    AND (
      public.get_user_role() = 'admin'
      OR s.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_in_transit_detail(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_in_transit_detail(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_in_transit_detail(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_replenishment_suggestions(
  p_user_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_include_zero boolean DEFAULT false,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_offset integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，无法查询补货建议' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION '用户身份不匹配' USING ERRCODE = 'P0001';
  END IF;

  p_page := GREATEST(COALESCE(p_page, 1), 1);
  p_page_size := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  p_include_zero := COALESCE(p_include_zero, false);
  p_country := NULLIF(UPPER(TRIM(p_country)), '');
  p_urgency := NULLIF(TRIM(p_urgency), '');
  p_search := NULLIF(TRIM(p_search), '');

  IF p_country IS NOT NULL AND p_country NOT IN ('TH', 'ID', 'MY', 'PH', 'VN', 'CN') THEN
    RAISE EXCEPTION '无效的国家筛选值: %', p_country USING ERRCODE = 'P0001';
  END IF;

  IF p_urgency IS NOT NULL
     AND p_urgency NOT IN ('critical', 'warning', 'ok', 'data_incomplete') THEN
    RAISE EXCEPTION '无效的紧急度筛选值: %', p_urgency USING ERRCODE = 'P0001';
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  WITH visible_inventory AS (
    SELECT
      i.variant_id,
      i.warehouse_id,
      i.quantity AS on_hand,
      i.daily_sales AS avg_daily_sales,
      v.sku,
      v.name AS variant_name,
      v.country,
      p.name AS product_name,
      p.code AS product_code,
      w.name AS warehouse_name,
      w.lead_time_days AS lead_time,
      w.buffer_ratio,
      w.target_cover_multiplier AS cover_mult
    FROM public.inventory i
    JOIN public.product_variant v ON v.id = i.variant_id
    LEFT JOIN public.product p ON p.id = v.product_id
    JOIN public.warehouse w
      ON w.id = i.warehouse_id
      AND w.type = 'overseas'
      AND w.is_active = true
    LEFT JOIN public.user_variant_preference uvp_arch
      ON uvp_arch.user_id = p_user_id
      AND uvp_arch.variant_id = i.variant_id
      AND uvp_arch.preference_type = 'archived'
    WHERE uvp_arch.variant_id IS NULL
      AND (
        public.get_user_role() = 'admin'
        OR i.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
      AND (p_variant_id IS NULL OR i.variant_id = p_variant_id)
      AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
      AND (p_country IS NULL OR v.country = p_country)
      AND (
        p_search IS NULL
        OR v.sku ILIKE '%' || p_search || '%'
        OR v.name ILIKE '%' || p_search || '%'
        OR COALESCE(p.name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(p.code, '') ILIKE '%' || p_search || '%'
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(
            regexp_split_to_array(lower(p_search), '[\s\-_/()（）,，]+')
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
  ), forecasted AS (
    SELECT
      vi.*,
      forecast.est_stockout_date,
      forecast.effective_inbound,
      CASE
        WHEN vi.avg_daily_sales IS NULL OR vi.avg_daily_sales <= 0
          OR vi.lead_time IS NULL OR vi.lead_time <= 0
          THEN NULL
        ELSE ROUND(vi.avg_daily_sales * vi.lead_time * vi.buffer_ratio)::integer
      END AS safety_stock,
      CASE
        WHEN vi.avg_daily_sales IS NULL OR vi.avg_daily_sales <= 0
          OR vi.lead_time IS NULL OR vi.lead_time <= 0
          THEN NULL
        ELSE ROUND(vi.avg_daily_sales * vi.lead_time * vi.cover_mult)::integer
      END AS target_stock
    FROM visible_inventory vi
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('eta', grouped.eta, 'remaining', grouped.remaining)
          ORDER BY grouped.eta
        ),
        '[]'::jsonb
      ) AS events
      FROM (
        SELECT
          s.estimated_arrival AS eta,
          SUM(si.quantity - si.warehoused_quantity)::integer AS remaining
        FROM public.shipment s
        JOIN public.shipment_item si ON si.shipment_id = s.id
        WHERE s.warehouse_id = vi.warehouse_id
          AND si.variant_id = vi.variant_id
          AND s.cancelled_at IS NULL
          AND s.bigseller_absorbed_at IS NULL
          AND s.status IN ('booking', 'loading', 'departed', 'arrived', 'customs')
          AND s.estimated_arrival IS NOT NULL
          AND (si.quantity - si.warehoused_quantity) > 0
        GROUP BY s.estimated_arrival
      ) grouped
    ) inbound ON true
    CROSS JOIN LATERAL public.forecast_stockout(
      vi.on_hand,
      vi.avg_daily_sales,
      vi.lead_time,
      inbound.events
    ) forecast
  ), calculated AS (
    SELECT
      f.*,
      CASE
        WHEN f.target_stock IS NULL THEN 0
        ELSE GREATEST(0, f.target_stock - (f.on_hand + f.effective_inbound))
      END::integer AS net_demand,
      CASE
        WHEN f.avg_daily_sales IS NULL OR f.avg_daily_sales <= 0
          OR f.lead_time IS NULL OR f.lead_time <= 0
          THEN NULL
        ELSE f.est_stockout_date - f.lead_time
      END AS latest_order_date
    FROM forecasted f
  ), labeled AS (
    SELECT
      c.*,
      c.net_demand AS suggest_qty,
      CASE
        WHEN c.avg_daily_sales IS NULL OR c.avg_daily_sales <= 0
          OR c.lead_time IS NULL OR c.lead_time <= 0
          THEN 'data_incomplete'
        WHEN c.latest_order_date <= CURRENT_DATE THEN 'critical'
        WHEN c.latest_order_date <= CURRENT_DATE + 3 THEN 'warning'
        ELSE 'ok'
      END AS urgency
    FROM calculated c
  ), filtered AS (
    SELECT *
    FROM labeled
    WHERE (p_include_zero OR net_demand > 0)
      AND (p_urgency IS NULL OR urgency = p_urgency)
  )
  SELECT jsonb_build_object(
    'data', COALESCE(
      (
        SELECT jsonb_agg(row_to_json(page_rows))
        FROM (
          SELECT
            variant_id,
            warehouse_id,
            sku,
            product_name,
            product_code,
            variant_name,
            country,
            warehouse_name,
            avg_daily_sales,
            lead_time,
            buffer_ratio,
            cover_mult,
            safety_stock,
            on_hand,
            effective_inbound,
            target_stock,
            net_demand,
            suggest_qty,
            est_stockout_date,
            latest_order_date,
            urgency
          FROM filtered
          ORDER BY
            CASE urgency
              WHEN 'critical' THEN 1
              WHEN 'warning' THEN 2
              WHEN 'ok' THEN 3
              ELSE 4
            END,
            net_demand DESC,
            sku,
            warehouse_name
          LIMIT p_page_size OFFSET v_offset
        ) page_rows
      ),
      '[]'::jsonb
    ),
    'total', (SELECT COUNT(*) FROM filtered)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_suggestions(
  uuid, uuid, uuid, text, text, text, boolean, integer, integer
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_replenishment_suggestions(
  uuid, uuid, uuid, text, text, text, boolean, integer, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_replenishment_suggestions(
  uuid, uuid, uuid, text, text, text, boolean, integer, integer
) TO authenticated;

