-- ============================================
-- 00013 — 扩展 user_variant_preference.preference_type 支持 'favorited'
-- 严格前向一次性 Migration
-- ============================================
-- P5-SY12: 特别关注阶段 B — 在 user_variant_preference 表上扩展 CHECK 约束，
-- 新增 'favorited' 偏好类型。
--
-- 不新建表（复用 P5-SY11G 的 user_variant_preference 表）。
-- 不新增 RLS 策略（复用阶段 A 已有的 4 条策略）。
-- UNIQUE (user_id, variant_id, preference_type) 已保证同一用户对同一 variant
-- 的 archived 和 favorited 可共存（preference_type 不同）。
--
-- 关注/取消关注 = INSERT/DELETE user_variant_preference WHERE preference_type='favorited'。
-- 同一用户同一 variant 可同时 archived + favorited。
--
-- 不修改已执行 Migration 00001~00012。
-- 同步 RPC sync_warehouse_inventory 不受影响。
-- 阶段 B 不新增 daily_sales/est_days/lead_time_days。
-- ============================================

-- ─── 扩展 CHECK 约束支持 'favorited' ────────────────────────────────────
ALTER TABLE user_variant_preference
  DROP CONSTRAINT IF EXISTS user_variant_preference_preference_type_check;

ALTER TABLE user_variant_preference
  ADD CONSTRAINT user_variant_preference_preference_type_check
  CHECK (preference_type IN ('archived', 'favorited'));
