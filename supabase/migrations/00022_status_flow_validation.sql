-- ============================================
-- Migration 00022: P3-S4A — 状态流转规则校验
-- ============================================
-- 覆盖 00021 的 change_shipment_status_transactional 函数：
--   新增状态流转规则 — 仅允许按顺序推进（booking→loading→departed→arrived→customs）
--   拒绝倒退（如 departed→loading）
--   拒绝跳过关键步骤（如 booking→departed）
--   保持所有现有约束：admin-only、禁用 warehoused、原子更新+轨迹插入、GET DIAGNOSTICS
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
  v_role            text;
  v_current_status  text;
  v_updated         integer;
BEGIN
  -- ============================================
  -- 权限校验：仅已启用的 admin 可调用
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 业务边界：禁用 warehoused
  -- ============================================
  IF p_status = 'warehoused' THEN
    RAISE EXCEPTION '当前不支持手动推进到入仓状态' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 0. 读取当前状态用于流转校验
  -- ============================================
  SELECT status INTO v_current_status
  FROM public.shipment
  WHERE id = p_shipment_id;

  -- 记录不存在时后续 UPDATE 也会命中 0 行并报错，此处提前给出清晰消息
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION '在途记录不存在或无权访问' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 1. 状态流转规则校验
  --    仅允许按顺序推进：booking→loading→departed→arrived→customs
  --    拒绝倒退（如 departed→loading）
  --    拒绝跳步（如 booking→departed）
  -- ============================================
  IF NOT (
    (v_current_status = 'booking'  AND p_status = 'loading')  OR
    (v_current_status = 'loading'  AND p_status = 'departed') OR
    (v_current_status = 'departed' AND p_status = 'arrived')  OR
    (v_current_status = 'arrived'  AND p_status = 'customs')
  ) THEN
    RAISE EXCEPTION '状态不可从 % 变更为 %：仅允许按顺序推进', v_current_status, p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. 更新 shipment.status（RLS 保障仓库隔离）
  -- ============================================
  UPDATE public.shipment
  SET status = p_status
  WHERE id = p_shipment_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION '在途记录不存在或无权访问' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 3. 同一事务内插入 tracking_event（RLS 保障仓库隔离）
  -- ============================================
  INSERT INTO public.tracking_event (
    shipment_id, status, description, occurred_at, created_by
  ) VALUES (
    p_shipment_id, p_status, p_description, now(), auth.uid()
  );

  RETURN TRUE;
END;
$$;

-- ─── 权限收口（保持 00021 admin-only 授权） ─────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_shipment_status_transactional(uuid, text, text) TO authenticated;
