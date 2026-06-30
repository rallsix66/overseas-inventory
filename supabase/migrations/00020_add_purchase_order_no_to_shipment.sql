-- ============================================
-- Migration 00020: P3-S2E — 新增 purchase_order_no 字段
-- ============================================
-- 1. 添加 purchase_order_no 列（nullable text，不唯一）
-- 2. 更新 create_shipment_transactional RPC 接受 p_purchase_order_no
-- ============================================

-- ─── 1. 添加 purchase_order_no 列 ───────────────────────────────────────

ALTER TABLE public.shipment
  ADD COLUMN purchase_order_no text;

COMMENT ON COLUMN public.shipment.purchase_order_no IS '采购单号（可选，不唯一，不影响历史数据）';

-- ─── 2. 更新 create_shipment_transactional RPC ──────────────────────────

-- 删除旧版 10 参数函数
DROP FUNCTION IF EXISTS public.create_shipment_transactional(
  text, text, text, text, text, text, uuid, date, text, jsonb
);

-- 创建新版 11 参数函数（新增 p_purchase_order_no）
CREATE OR REPLACE FUNCTION public.create_shipment_transactional(
  p_shipment_no        text,
  p_vessel_name        text,
  p_voyage_number      text,
  p_origin_port        text,
  p_destination_port   text,
  p_country            text,
  p_warehouse_id       uuid,
  p_estimated_arrival  date,
  p_note               text,
  p_purchase_order_no  text,
  p_items              jsonb   -- [{"variant_id": "...", "quantity": 1}, ...]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role        text;
  v_shipment_id uuid;
  v_item        jsonb;
BEGIN
  -- 权限校验：仅已启用的 admin 可调用
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  -- 输入校验：shipment_no
  IF p_shipment_no IS NULL OR trim(p_shipment_no) = '' THEN
    RAISE EXCEPTION '单号不能为空' USING ERRCODE = 'P0001';
  END IF;

  -- 输入校验：items
  IF p_items IS NULL THEN
    RAISE EXCEPTION '明细数据不能为空' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_items) != 'array' THEN
    RAISE EXCEPTION '明细数据格式错误：期望数组' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '明细数据不能为空数组' USING ERRCODE = 'P0001';
  END IF;

  -- 1. 创建 shipment 主单
  INSERT INTO public.shipment (
    shipment_no, vessel_name, voyage_number, origin_port, destination_port,
    country, warehouse_id, estimated_arrival, created_by, note, purchase_order_no
  ) VALUES (
    p_shipment_no, p_vessel_name, p_voyage_number, p_origin_port, p_destination_port,
    p_country, p_warehouse_id, p_estimated_arrival, auth.uid(), p_note,
    NULLIF(TRIM(p_purchase_order_no), '')
  )
  RETURNING id INTO v_shipment_id;

  -- 2. 批量插入 shipment_item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.shipment_item (shipment_id, variant_id, quantity)
    VALUES (
      v_shipment_id,
      (v_item->>'variant_id')::uuid,
      (v_item->>'quantity')::integer
    );
  END LOOP;

  -- 3. 创建初始 tracking_event (booking)
  INSERT INTO public.tracking_event (shipment_id, status, description, occurred_at, created_by)
  VALUES (v_shipment_id, 'booking', '订舱', now(), auth.uid());

  RETURN v_shipment_id;
END;
$$;

-- 收紧执行权限
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, text, jsonb) TO authenticated;
