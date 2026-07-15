-- ============================================
-- Migration 00043: P1/P7 共用库存耗尽预测函数
-- ============================================
-- 纯计算函数：不访问业务表，不承担权限过滤。
-- 调用方必须先按当前用户可见仓库收集 inbound。

CREATE OR REPLACE FUNCTION public.forecast_stockout(
  p_on_hand integer,
  p_daily_sales numeric,
  p_lead_time_days integer,
  p_inbound jsonb
)
RETURNS TABLE (
  est_stockout_date date,
  effective_inbound integer,
  ds_incomplete boolean,
  lead_incomplete boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_cursor_date date := CURRENT_DATE;
  v_event record;
  v_event_date date;
  v_days integer;
  v_consume numeric;
  v_current numeric := GREATEST(COALESCE(p_on_hand, 0), 0);
  v_stockout date;
  v_inbound jsonb := COALESCE(p_inbound, '[]'::jsonb);
BEGIN
  ds_incomplete := p_daily_sales IS NULL OR p_daily_sales <= 0;
  lead_incomplete := p_lead_time_days IS NULL OR p_lead_time_days <= 0;
  effective_inbound := 0;
  est_stockout_date := NULL;

  IF jsonb_typeof(v_inbound) <> 'array' THEN
    RAISE EXCEPTION 'p_inbound 必须为 JSON 数组' USING ERRCODE = 'P0001';
  END IF;

  -- 无可靠日销时不制造虚假的断货日。
  IF ds_incomplete THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- 调用方通常已按 ETA 聚合；函数再次聚合，防止同 ETA 重复扣减销量。
  FOR v_event IN
    WITH parsed AS (
      SELECT
        (item->>'eta')::date AS eta,
        (item->>'remaining')::integer AS remaining
      FROM jsonb_array_elements(v_inbound) AS item
      WHERE item ? 'eta'
        AND item ? 'remaining'
        AND item->>'eta' IS NOT NULL
        AND item->>'eta' <> ''
        AND item->>'remaining' IS NOT NULL
        AND item->>'remaining' <> ''
    )
    SELECT eta, SUM(remaining)::integer AS total_remaining
    FROM parsed
    WHERE remaining > 0
    GROUP BY eta
    ORDER BY eta
  LOOP
    v_event_date := GREATEST(v_event.eta, v_today);
    v_days := v_event_date - v_cursor_date;

    IF v_days > 0 THEN
      v_consume := p_daily_sales * v_days;

      -- cur == consume 时先扣完再补入 ETA 当天到货；只有严格不足才提前断货。
      IF v_current < v_consume THEN
        v_stockout := v_cursor_date
          + CEIL(GREATEST(v_current, 0) / p_daily_sales)::integer;
        EXIT;
      END IF;

      v_current := v_current - v_consume;
    END IF;

    v_current := v_current + v_event.total_remaining;
    v_cursor_date := v_event_date;
  END LOOP;

  IF v_stockout IS NULL THEN
    v_stockout := v_cursor_date
      + CEIL(GREATEST(v_current, 0) / p_daily_sales)::integer;
  END IF;

  est_stockout_date := v_stockout;

  WITH parsed AS (
    SELECT
      (item->>'eta')::date AS eta,
      (item->>'remaining')::integer AS remaining
    FROM jsonb_array_elements(v_inbound) AS item
    WHERE item ? 'eta'
      AND item ? 'remaining'
      AND item->>'eta' IS NOT NULL
      AND item->>'eta' <> ''
      AND item->>'remaining' IS NOT NULL
      AND item->>'remaining' <> ''
  ), grouped AS (
    SELECT eta, SUM(remaining)::integer AS total_remaining
    FROM parsed
    WHERE remaining > 0
    GROUP BY eta
  )
  SELECT COALESCE(
    SUM(total_remaining) FILTER (WHERE eta <= v_stockout),
    0
  )::integer
  INTO effective_inbound
  FROM grouped;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.forecast_stockout(integer, numeric, integer, jsonb)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forecast_stockout(integer, numeric, integer, jsonb)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.forecast_stockout(integer, numeric, integer, jsonb)
  TO authenticated;

