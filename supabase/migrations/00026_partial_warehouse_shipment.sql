-- ============================================
-- Migration 00026: P3-S5B1 — 部分入仓 RPC + BigSeller 吸收确认列
-- ============================================
-- 1. 新增 shipment.bigseller_absorbed_at 列
--    Admin 手动确认 BigSeller 已吸收该在途记录的货物。
--    NULL = 未确认吸收；非 NULL = 确认时间。
--    inventory.quantity 的唯一事实来源是 BigSeller 同步链路，
--    DIS 确认到仓是运营跟踪工具，不等同于库存入账。
-- 2. 新增 partial_warehouse_shipment 函数：
--    同一事务内完成：
--      a. SELECT shipment FOR UPDATE（校验存在/非 warehoused/有仓库/customs）
--      b. 遍历 p_items JSONB 数组，逐行 FOR UPDATE shipment_item
--         - 校验 variant_id 存在于此 shipment
--         - 校验 quantity > 0 且 <= remaining
--         - UPDATE warehoused_quantity += quantity
--      c. 全部入仓时 shipment.status → 'warehoused'
--      d. INSERT tracking_event（status='warehoused' 或 'partial_warehoused'）
--    **不写入 inventory.quantity** — inventory 唯一事实来源是 BigSeller
--    SECURITY INVOKER，Admin-only
--    REVOKE PUBLIC/anon，GRANT authenticated
-- ============================================

-- 1. bigseller_absorbed_at 列
ALTER TABLE public.shipment
  ADD COLUMN IF NOT EXISTS bigseller_absorbed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.shipment.bigseller_absorbed_at
  IS 'Admin 手动确认 BigSeller 已吸收该在途记录货物的时间。NULL=未确认。';

-- 2. partial_warehouse_shipment RPC
CREATE OR REPLACE FUNCTION public.partial_warehouse_shipment(
  p_shipment_id uuid,
  p_items       jsonb,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role            text;
  v_shipment        record;
  v_item            record;
  v_request         record;
  v_remaining       integer;
  v_requested_qty   integer;
  v_items_updated   integer := 0;
  v_has_remaining   boolean;
  v_all_warehoused  boolean;
BEGIN
  -- ============================================
  -- 权限校验：仅已启用的 admin 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 1. 校验 p_items 非空
  -- ============================================
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '入仓明细不能为空' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. SELECT shipment FOR UPDATE — 排他锁定目标行
  -- ============================================
  SELECT id, warehouse_id, status
  INTO v_shipment
  FROM public.shipment
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '在途记录不存在或无权访问' USING ERRCODE = 'P0001';
  END IF;

  -- 禁止重复入仓
  IF v_shipment.status = 'warehoused' THEN
    RAISE EXCEPTION '该在途记录已完成入仓，不可重复操作' USING ERRCODE = 'P0001';
  END IF;

  -- 必须有仓库
  IF v_shipment.warehouse_id IS NULL THEN
    RAISE EXCEPTION '该在途记录未指定仓库，无法入仓' USING ERRCODE = 'P0001';
  END IF;

  -- 仅 customs 允许入仓
  IF v_shipment.status != 'customs' THEN
    RAISE EXCEPTION '当前状态为 %，仅清关后可确认入仓', v_shipment.status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 3. 遍历 p_items JSONB 数组，逐行处理
  -- ============================================
  FOR v_request IN
    SELECT
      (elem->>'variant_id')::uuid   AS variant_id,
      (elem->>'quantity')::integer  AS quantity
    FROM jsonb_array_elements(p_items) AS elem
  LOOP
    v_requested_qty := v_request.quantity;

    -- 校验请求数量 > 0
    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION '入仓数量必须大于 0，variant_id: %', v_request.variant_id
        USING ERRCODE = 'P0001';
    END IF;

    -- FOR UPDATE 锁定 shipment_item 行
    SELECT id, variant_id, quantity, warehoused_quantity
    INTO v_item
    FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
      AND variant_id = v_request.variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '在途记录中未找到 variant_id: %', v_request.variant_id
        USING ERRCODE = 'P0001';
    END IF;

    -- 超量保护
    v_remaining := v_item.quantity - v_item.warehoused_quantity;
    IF v_remaining < 0 THEN
      RAISE EXCEPTION '数据异常：产品明细 % 已入仓数量超过总数', v_item.id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_requested_qty > v_remaining THEN
      RAISE EXCEPTION '入仓数量 (%) 超过在途余量 (%)，variant_id: %',
        v_requested_qty, v_remaining, v_request.variant_id
        USING ERRCODE = 'P0001';
    END IF;

    -- 更新 warehoused_quantity（原子累加）
    UPDATE public.shipment_item
    SET warehoused_quantity = warehoused_quantity + v_requested_qty
    WHERE id = v_item.id;

    v_items_updated := v_items_updated + 1;
  END LOOP;

  -- ============================================
  -- 4. 检查是否全部入仓
  -- ============================================
  SELECT EXISTS(
    SELECT 1 FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
      AND warehoused_quantity < quantity
  ) INTO v_has_remaining;

  v_all_warehoused := NOT v_has_remaining;

  -- ============================================
  -- 5. 全部入仓时更新 shipment.status
  -- ============================================
  IF v_all_warehoused THEN
    UPDATE public.shipment
    SET status = 'warehoused'
    WHERE id = p_shipment_id;
  END IF;

  -- ============================================
  -- 6. 插入 tracking_event
  -- ============================================
  INSERT INTO public.tracking_event (
    shipment_id, status, description, occurred_at, created_by
  ) VALUES (
    p_shipment_id,
    CASE WHEN v_all_warehoused THEN 'warehoused' ELSE 'partial_warehoused' END,
    COALESCE(p_description,
      CASE WHEN v_all_warehoused THEN '确认入仓' ELSE '部分确认入仓' END),
    now(),
    auth.uid()
  );

  -- ============================================
  -- 7. 返回结果 JSONB
  -- ============================================
  RETURN jsonb_build_object(
    'success', true,
    'all_warehoused', v_all_warehoused,
    'items_updated', v_items_updated
  );
END;
$$;

-- ─── 权限收口 ────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) TO authenticated;
