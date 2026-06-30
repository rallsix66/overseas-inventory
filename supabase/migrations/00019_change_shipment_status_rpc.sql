-- ============================================
-- Migration 00019: P3-S2B 返工 — 手动状态变更事务 RPC
-- ============================================
-- 提供 change_shipment_status_transactional RPC：
--   同一事务内完成 shipment.status 更新 + tracking_event 插入
--   禁用 warehoused
--   UPDATE 必须确认命中目标记录，否则抛出"在途记录不存在或无权访问"
--   不写 inventory，不更新 warehoused_quantity
--   SECURITY INVOKER + RLS 双重保障仓库隔离
-- ============================================

CREATE OR REPLACE FUNCTION public.change_shipment_status_transactional(
  p_shipment_id   uuid,
  p_status        text,
  p_description   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role    text;
  v_updated integer;
BEGIN
  -- ============================================
  -- 权限校验：仅已启用的 admin / operator 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION '无权限：需要管理员或运营角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 业务边界：P3-S2B 禁用 warehoused
  -- ============================================
  IF p_status = 'warehoused' THEN
    RAISE EXCEPTION '当前不支持手动推进到入仓状态' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 1. 更新 shipment.status（RLS 保障仓库隔离）
  -- ============================================
  UPDATE public.shipment
  SET status = p_status
  WHERE id = p_shipment_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION '在途记录不存在或无权访问' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. 同一事务内插入 tracking_event（RLS 保障仓库隔离）
  -- ============================================
  INSERT INTO public.tracking_event (
    shipment_id, status, description, occurred_at, created_by
  ) VALUES (
    p_shipment_id, p_status, p_description, now(), auth.uid()
  );

  RETURN TRUE;
END;
$$;

-- ─── 权限收口 ──────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) TO authenticated;
