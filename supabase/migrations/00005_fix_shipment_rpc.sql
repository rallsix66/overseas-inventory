-- ============================================
-- 00005 — 修复 create_shipment_transactional RPC 安全
-- 移除无鉴权 SECURITY DEFINER，改为 SECURITY INVOKER
-- 调用者必须有 admin 或 operator 角色且处于启用状态
-- created_by 强制使用 auth.uid()，不信任客户端传入值
-- ============================================

-- 1. 删除旧版 10 参数函数（含 p_created_by uuid）
DROP FUNCTION IF EXISTS public.create_shipment_transactional(
  text, text, text, text, text, uuid, date, text, uuid, jsonb
);

-- 2. 创建新版 9 参数函数（SECURITY INVOKER，显式角色校验）
CREATE OR REPLACE FUNCTION public.create_shipment_transactional(
  p_vessel_name       text,
  p_voyage_number     text,
  p_origin_port       text,
  p_destination_port  text,
  p_country           text,
  p_warehouse_id      uuid,
  p_estimated_arrival date,
  p_note              text,
  p_items             jsonb   -- [{"variant_id": "...", "quantity": 1}, ...]
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
  -- ============================================
  -- 权限校验：仅已启用的 admin / operator 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION '无权限：需要管理员或运营角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 输入校验：拒绝 NULL、非数组、空数组
  -- ============================================
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
    vessel_name, voyage_number, origin_port, destination_port,
    country, warehouse_id, estimated_arrival, created_by, note
  ) VALUES (
    p_vessel_name, p_voyage_number, p_origin_port, p_destination_port,
    p_country, p_warehouse_id, p_estimated_arrival, auth.uid(), p_note
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

-- 3. 收紧执行权限
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, uuid, date, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, uuid, date, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, uuid, date, text, jsonb) TO authenticated;
