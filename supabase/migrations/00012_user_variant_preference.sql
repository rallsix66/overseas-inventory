-- ============================================
-- 00012 — 用户级 Variant 归档偏好
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY11G: 将归档从全局 product_variant.is_archived 迁移为用户级偏好。
--
-- product_variant.is_archived 是全局列（A 归档后 B 也看不到），
-- 与用户确认的语义（每人独立归档偏好）严重冲突。
--
-- 变更:
--   1. CREATE TABLE IF NOT EXISTS user_variant_preference
--      (user_id + variant_id + preference_type，预留 'favorited' 扩展)
--   2. 索引 idx_uvp_user_type / idx_uvp_variant
--   3. RLS 启用 + 4 条策略（user SELECT/INSERT/DELETE own + admin ALL）
--   4. 移除 operator_select_variant 中 is_archived = false 全局过滤
--      （用户偏好隔离改为在应用层通过 user_variant_preference 完成）
--
-- product_variant.is_archived 列保留为遗留列，所有业务代码停止读写。
-- 不修改已执行 Migration 00001~00011。
-- 不删除 ProductVariant，不改变 Product → ProductVariant → Inventory 模型。
-- 同步 RPC sync_warehouse_inventory 不受影响（不涉及 user_variant_preference）。
-- 预留 preference_type 扩展（后续实现"特别关注"时新增 'favorited'）。
-- ============================================

-- ─── 1. 新建用户 Variant 偏好表 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_variant_preference (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  variant_id      uuid        NOT NULL REFERENCES product_variant(id) ON DELETE CASCADE,
  preference_type text        NOT NULL CHECK (preference_type IN ('archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, variant_id, preference_type)
);

-- ─── 2. 索引：按用户查询偏好 ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_uvp_user_type
  ON user_variant_preference (user_id, preference_type);

-- ─── 3. 索引：按 Variant 查询 ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_uvp_variant
  ON user_variant_preference (variant_id, preference_type);

-- ─── 4. RLS：启用 ────────────────────────────────────────────────────
ALTER TABLE user_variant_preference ENABLE ROW LEVEL SECURITY;

-- ─── 5. RLS：用户可以查看自己的偏好 ──────────────────────────────────
CREATE POLICY "user_select_own_preferences" ON user_variant_preference
  FOR SELECT
  USING (auth.uid() = user_id);

-- ─── 6. RLS：用户可以插入自己的偏好 ──────────────────────────────────
CREATE POLICY "user_insert_own_preferences" ON user_variant_preference
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ─── 7. RLS：用户可以删除自己的偏好 ──────────────────────────────────
CREATE POLICY "user_delete_own_preferences" ON user_variant_preference
  FOR DELETE
  USING (auth.uid() = user_id);

-- ─── 8. Admin 全权限（技术支持/审计场景） ─────────────────────────────
CREATE POLICY "admin_all_preferences" ON user_variant_preference
  FOR ALL
  USING (get_user_role() = 'admin');

-- ─── 9. 移除 operator_select_variant 中 is_archived = false 全局过滤 ──
-- Migration 00011 加入了 is_archived = false 条件，但归档已迁移为用户级偏好。
-- Operator 应可查看全部 product_variant（用户偏好过滤在应用层完成）。
DROP POLICY IF EXISTS "operator_select_variant" ON product_variant;

CREATE POLICY "operator_select_variant" ON product_variant
  FOR SELECT
  USING (get_user_role() = 'operator');
