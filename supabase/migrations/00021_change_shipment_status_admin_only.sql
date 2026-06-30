-- ============================================
-- Migration 00021: P3-S2E — change_shipment_status_transactional 收紧为 admin-only
-- ============================================
-- 覆盖 00019 的函数定义，将角色检查从 admin/operator 收紧为仅 admin
-- 00019 已执行不可修改，通过新 migration 覆盖
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
  -- 权限校验：仅已启用的 admin 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
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

-- 权限收口（保留 00019 原有权限设置）
REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) TO authenticated;
