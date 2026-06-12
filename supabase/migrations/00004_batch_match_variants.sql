-- ============================================
-- 00004 — 批量匹配 SKU 事务函数
-- 将 Product 锁定校验、Variant 存在校验、批量 UPDATE 包装为原子操作
-- SECURITY INVOKER：RLS 仍生效，函数内部显式校验 admin 角色
-- 函数内部对 p_variant_ids 去重，不依赖调用方保证唯一性
-- ============================================

-- 1. 创建函数（SECURITY INVOKER，RLS 防护）
CREATE OR REPLACE FUNCTION public.batch_match_variants(
  p_variant_ids uuid[],
  p_product_id  uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role           text;
  v_deduped_ids    uuid[];
  v_product_active boolean;
  v_expected_count integer;
  v_matched_count  integer;
BEGIN
  -- ============================================
  -- 权限校验：仅 admin 可执行
  -- ============================================
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION '无权限：需要管理员角色' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 输入校验：拒绝 NULL、空数组、包含 NULL 元素的数组
  -- ============================================
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION '无效的产品 ID' USING ERRCODE = 'P0001';
  END IF;

  IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
    RAISE EXCEPTION '请选择至少一个 SKU' USING ERRCODE = 'P0001';
  END IF;

  IF array_position(p_variant_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION '无效的 SKU ID' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 函数内部去重 — 不依赖调用方保证唯一性
  -- ============================================
  SELECT array_agg(DISTINCT id) INTO v_deduped_ids
  FROM unnest(p_variant_ids) AS t(id);

  v_expected_count := array_length(v_deduped_ids, 1);

  -- ============================================
  -- 锁定 Product 行，保证 is_active 在事务内稳定
  -- ============================================
  SELECT is_active INTO v_product_active
  FROM public.product
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '产品不存在' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_product_active THEN
    RAISE EXCEPTION '产品已停用，无法匹配' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 确认全部去重后的 Variant ID 均存在
  -- ============================================
  IF EXISTS (
    SELECT 1
    FROM unnest(v_deduped_ids) AS req(id)
    LEFT JOIN public.product_variant pv ON pv.id = req.id
    WHERE pv.id IS NULL
  ) THEN
    RAISE EXCEPTION '部分 SKU 不存在' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 全部校验通过 → 单次批量更新
  -- ============================================
  WITH updated AS (
    UPDATE public.product_variant
    SET product_id = p_product_id, match_status = 'matched'
    WHERE id = ANY(v_deduped_ids)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_matched_count FROM updated;

  -- 更新数量必须等于去重后 ID 数量，否则回滚
  IF v_matched_count != v_expected_count THEN
    RAISE EXCEPTION '批量匹配部分失败：期望 % 条，实际更新 % 条', v_expected_count, v_matched_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_matched_count;
END;
$$;

-- 2. 收紧执行权限
REVOKE EXECUTE ON FUNCTION public.batch_match_variants(uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.batch_match_variants(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.batch_match_variants(uuid[], uuid) TO authenticated;
