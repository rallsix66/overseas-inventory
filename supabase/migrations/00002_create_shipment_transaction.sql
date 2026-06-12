-- ============================================
-- 00002 — Shipment 创建事务化
-- 将 shipment + shipment_item + tracking_event 三步写入包装为原子操作
-- 解决应用层手动回滚可能失败的数据完整性风险
-- ============================================

CREATE OR REPLACE FUNCTION create_shipment_transactional(
  p_vessel_name       text,
  p_voyage_number     text,
  p_origin_port       text,
  p_destination_port  text,
  p_country           text,
  p_warehouse_id      uuid,
  p_estimated_arrival date,
  p_note              text,
  p_created_by        uuid,
  p_items             jsonb   -- [{"variant_id": "...", "quantity": 1}, ...]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment_id uuid;
  v_item        jsonb;
BEGIN
  -- 1. 创建 shipment 主单
  INSERT INTO public.shipment (
    vessel_name, voyage_number, origin_port, destination_port,
    country, warehouse_id, estimated_arrival, created_by, note
  ) VALUES (
    p_vessel_name, p_voyage_number, p_origin_port, p_destination_port,
    p_country, p_warehouse_id, p_estimated_arrival, p_created_by, p_note
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
  VALUES (v_shipment_id, 'booking', '订舱', now(), p_created_by);

  RETURN v_shipment_id;
END;
$$;
