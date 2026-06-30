-- ============================================
-- Migration 00018: P3-S2B — 新增 shipment_no 字段
-- ============================================
-- 1. 先允许 NULL 添加列
-- 2. 用 ship_ + created_at 日期 + 行号回填旧数据
-- 3. 收紧为 NOT NULL + UNIQUE
-- 4. 更新 create_shipment_transactional RPC 接受 p_shipment_no
-- ============================================

-- ─── 1. 添加 shipment_no 列（先可空）──────────────────────────────────

ALTER TABLE public.shipment
  ADD COLUMN shipment_no text;

-- ─── 2. 回填旧数据 ────────────────────────────────────────────────────

-- 格式: SN-<YYYYMMDD>-<4-digit seq per date>（例如 SN-20260629-0001）
-- 按创建日期分组，每组内按 created_at 排序分配递增序号
WITH numbered AS (
  SELECT
    id,
    created_at,
    'SN-' || to_char(created_at, 'YYYYMMDD') || '-' || lpad(
      (row_number() OVER (
        PARTITION BY to_char(created_at, 'YYYYMMDD')
        ORDER BY created_at, id
      ))::text,
      4,
      '0'
    ) AS new_no
  FROM public.shipment
  WHERE shipment_no IS NULL
)
UPDATE public.shipment s
SET shipment_no = n.new_no
FROM numbered n
WHERE s.id = n.id;

-- ─── 3. 收紧约束 ──────────────────────────────────────────────────────

ALTER TABLE public.shipment
  ALTER COLUMN shipment_no SET NOT NULL;

ALTER TABLE public.shipment
  ADD CONSTRAINT shipment_no_unique UNIQUE (shipment_no);

CREATE INDEX idx_shipment_shipment_no ON public.shipment(shipment_no);

-- ─── 4. 更新 create_shipment_transactional RPC ────────────────────────

-- 删除旧版 9 参数函数
DROP FUNCTION IF EXISTS public.create_shipment_transactional(
  text, text, text, text, text, uuid, date, text, jsonb
);

-- 创建新版 10 参数函数（新增 p_shipment_no）
CREATE OR REPLACE FUNCTION public.create_shipment_transactional(
  p_shipment_no       text,
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
  -- 权限校验：仅已启用的 admin / operator 可调用
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION '无权限：需要管理员或运营角色' USING ERRCODE = 'P0001';
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
    country, warehouse_id, estimated_arrival, created_by, note
  ) VALUES (
    p_shipment_no, p_vessel_name, p_voyage_number, p_origin_port, p_destination_port,
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

-- 收紧执行权限
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_shipment_transactional(text, text, text, text, text, text, uuid, date, text, jsonb) TO authenticated;
