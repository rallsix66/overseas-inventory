-- ============================================
-- Migration 00023: P3-S5A — 确认入仓事务 RPC
-- ============================================
-- 新增 warehouse_shipment_transactional 函数：
--   同一事务内完成：
--     1. shipment.status → 'warehoused'
--     2. shipment_item.warehoused_quantity → quantity（全部入仓）
--     3. inventory.quantity 增加对应数量（UPSERT）
--     4. tracking_event 插入 warehoused 轨迹
--   仅 customs 状态允许入仓（业务规则约束）
--   Admin-only + 禁止重复入仓 + 禁止超量入仓
--   并发安全：FOR UPDATE 锁定 shipment / shipment_item / inventory
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
  v_role             text;
  v_shipment_wh_id   uuid;
  v_shipment_status  text;
  v_item             record;
  v_existing_inv     record;
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
  --    确认存在、非 warehoused、有 warehouse_id、状态允许入仓
  -- ============================================
  SELECT id, warehouse_id, status
  INTO v_shipment_wh_id, v_shipment_wh_id, v_shipment_status
  FROM public.shipment
  WHERE id = p_shipment_id
  FOR UPDATE;

  -- shipment 不存在
  IF v_shipment_wh_id IS NULL THEN
    RAISE EXCEPTION '在途记录不存在或无权访问' USING ERRCODE = 'P0001';
  END IF;

  -- 禁止重复入仓
  IF v_shipment_status = 'warehoused' THEN
    RAISE EXCEPTION '该在途记录已完成入仓，不可重复操作' USING ERRCODE = 'P0001';
  END IF;

  -- 必须有仓库
  IF v_shipment_wh_id IS NULL THEN
    RAISE EXCEPTION '该在途记录未指定仓库，无法入仓' USING ERRCODE = 'P0001';
  END IF;

  -- 仅 customs 允许入仓（清关后货物可入库）
  IF v_shipment_status != 'customs' THEN
    RAISE EXCEPTION '当前状态为 %，仅清关后可确认入仓', v_shipment_status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. SELECT shipment_item FOR UPDATE — 排他锁定明细行
  -- ============================================
  FOR v_item IN
    SELECT id, variant_id, quantity, warehoused_quantity
    FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
    FOR UPDATE
  LOOP
    -- 超量入仓保护：warehoused_quantity 永远不会 > quantity
    -- 但已全部入仓的 item 跳过（remaining = 0）
    DECLARE
      v_remaining integer;
    BEGIN
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
      -- 3. UPSERT inventory — 增加 quantity（行锁防并发）
      -- ============================================
      SELECT id, quantity
      INTO v_existing_inv
      FROM public.inventory
      WHERE variant_id = v_item.variant_id
        AND warehouse_id = v_shipment_wh_id
      FOR UPDATE;

      IF v_existing_inv.id IS NOT NULL THEN
        -- 已存在：增加数量
        UPDATE public.inventory
        SET quantity = quantity + v_remaining,
            updated_at = now()
        WHERE id = v_existing_inv.id;
      ELSE
        -- 不存在：创建新库存记录
        INSERT INTO public.inventory (
          variant_id, warehouse_id, quantity, last_sync_at
        ) VALUES (
          v_item.variant_id, v_shipment_wh_id, v_remaining, now()
        );
      END IF;

      -- ============================================
      -- 4. 更新 shipment_item.warehoused_quantity → quantity（全部入仓）
      -- ============================================
      UPDATE public.shipment_item
      SET warehoused_quantity = quantity
      WHERE id = v_item.id;

    END;
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
