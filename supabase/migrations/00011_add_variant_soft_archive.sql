-- ============================================
-- 00011 — product_variant 软归档
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY11A: ProductVariant 软归档与库存视图降噪。
--
-- 新增 is_archived 列标记已归档 Variant，从默认视图中隐藏
-- 但不删除数据、不影响同步写入链路。
--
-- 变更：
--   1. ADD COLUMN IF NOT EXISTS is_archived  boolean NOT NULL DEFAULT false
--   2. ADD COLUMN IF NOT EXISTS archived_at   timestamptz
--   3. ADD COLUMN IF NOT EXISTS archived_by   uuid REFERENCES profiles(id)
--   4. CREATE INDEX IF NOT EXISTS idx_variant_is_archived（部分索引，仅已归档行）
--   5. DROP + CREATE operator_select_variant RLS 策略（增加 AND is_archived = false）
--   6. admin_all_variant 策略保持不变
--
-- 不修改已执行 Migration 00001~00010。
-- 不删除 ProductVariant，不改变 Product → ProductVariant → Inventory 模型。
-- 同步 RPC INSERT ON CONFLICT DO NOTHING 不受影响。
-- ============================================

-- ─── 1. 新增 is_archived 列 ────────────────────────────────────────
ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- ─── 2. 新增审计列 ─────────────────────────────────────────────────
ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id);

-- ─── 3. 部分索引（仅已归档行，体积小）──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_variant_is_archived
  ON product_variant (is_archived)
  WHERE is_archived = true;

-- ─── 4. RLS：收紧 Operator SELECT ──────────────────────────────────
-- 移除 Migration 00001 中创建的宽松策略，替换为带 is_archived 过滤的策略。
-- Operator 仅可见 is_archived = false 的活跃 Variant。
DROP POLICY IF EXISTS "operator_select_variant" ON product_variant;

CREATE POLICY "operator_select_variant" ON product_variant
  FOR SELECT
  USING (get_user_role() = 'operator' AND is_archived = false);

-- admin_all_variant 保持不变（Admin 全权限，可查看全部 Variant）。
