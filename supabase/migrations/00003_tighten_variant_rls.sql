-- Migration 00003: 收紧 ProductVariant RLS
-- 描述：移除 operator 对 product_variant 的 UPDATE 权限
--       匹配操作仅限 admin 通过 Server Action 完成
-- 影响：operator 在 product_variant 表上仅保留 SELECT
-- 日期：2026-06-11

-- 删除 operator 的 UPDATE 策略
-- 该策略在 00001 中创建，允许 operator 更新 product_variant 任意字段
-- 移除此策略后，operator 仅可通过 admin_all_variant 策略的 admin 身份写操作
DROP POLICY IF EXISTS "operator_update_variant_match" ON product_variant;
