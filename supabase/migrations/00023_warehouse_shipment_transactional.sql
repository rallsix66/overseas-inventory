-- ============================================
-- Migration 00023: P3-S5A — 确认入仓事务 RPC
-- ============================================
-- 新增 warehouse_shipment_transactional 函数：
--   同一事务内完成：
--     1. shipment.status → 'warehoused'
--     2. shipment_item.warehoused_quantity → quantity（全部入仓）
--     3. inventory.quantity 增加对应数量（UPSERT via ON CONFLICT）
--     4. tracking_event 插入 warehoused 轨迹
--   仅 customs 状态允许入仓（业务规则约束）
--   Admin-only + 禁止重复入仓 + 禁止超量入仓
--   并发安全：FOR UPDATE 锁定 shipment / shipment_item
--   SECURITY INVOKER，REVOKE PUBLIC/anon，GRANT authenticated
-- ============================================

CREATE OR REPLACE FUNCTION public.warehouse_shipment_transactional(
  p_shipment_id uuid,
  p_description  text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role            text;
  v_shipment        record;
  v_item            record;
  v_remaining       integer;
BEGIN
  -- ============================================
  -- 权限校验：仅已启用的 admin 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 1. SELECT shipment FOR UPDATE — 排他锁定目标行
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

  -- 必须有仓库（此时 v_shipment.warehouse_id 是独立字段，不会与 id/status 混淆）
  IF v_shipment.warehouse_id IS NULL THEN
    RAISE EXCEPTION '该在途记录未指定仓库，无法入仓' USING ERRCODE = 'P0001';
  END IF;

  -- 仅 customs 允许入仓（清关后货物可入库）
  IF v_shipment.status != 'customs' THEN
    RAISE EXCEPTION '当前状态为 %，仅清关后可确认入仓', v_shipment.status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. 遍历 shipment_item（FOR UPDATE 锁定明细行）
  -- ============================================
  FOR v_item IN
    SELECT id, variant_id, quantity, warehoused_quantity
    FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
    FOR UPDATE
  LOOP
    -- 超量入仓保护：warehoused_quantity 永远不会 > quantity
    v_remaining := v_item.quantity - v_item.warehoused_quantity;
    IF v_remaining < 0 THEN
      -- 数据异常：warehoused_quantity > quantity（不应出现）
      RAISE EXCEPTION '数据异常：产品明细 % 已入仓数量超过总数', v_item.id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_remaining = 0 THEN
      -- 该项已全部入仓，跳过（幂等安全）
      CONTINUE;
    END IF;

    -- ============================================
    -- 3. 原子 UPSERT inventory（ON CONFLICT DO UPDATE，无 select-then-insert 窗口）
    --    FOR UPDATE 隐式由 ON CONFLICT 的行锁处理后确保并发安全
    -- ============================================
    INSERT INTO public.inventory (variant_id, warehouse_id, quantity, last_sync_at)
    VALUES (v_item.variant_id, v_shipment.warehouse_id, v_remaining, now())
    ON CONFLICT (variant_id, warehouse_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = now(),
      last_sync_at = now();

    -- ============================================
    -- 4. 更新 shipment_item.warehoused_quantity → quantity（全部入仓）
    -- ============================================
    UPDATE public.shipment_item
    SET warehoused_quantity = quantity
    WHERE id = v_item.id;

  END LOOP;

  -- ============================================
  -- 5. 更新 shipment.status → 'warehoused'
  -- ============================================
  UPDATE public.shipment
  SET status = 'warehoused'
  WHERE id = p_shipment_id;

  -- ============================================
  -- 6. 插入 tracking_event（warehoused 轨迹）
  -- ============================================
  INSERT INTO public.tracking_event (
    shipment_id, status, description, occurred_at, created_by
  ) VALUES (
    p_shipment_id,
    'warehoused',
    COALESCE(p_description, '确认入仓'),
    now(),
    auth.uid()
  );

  RETURN TRUE;
END;
$$;

-- ─── 权限收口 ────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.warehouse_shipment_transactional(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.warehouse_shipment_transactional(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.warehouse_shipment_transactional(uuid, text) TO authenticated;
