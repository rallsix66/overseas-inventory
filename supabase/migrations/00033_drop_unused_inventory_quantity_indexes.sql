-- ============================================
-- Migration 00033: PERF-H — 删除未使用的 inventory quantity 部分索引
-- ============================================
-- 目的：删除 idx_inventory_low_stock 和 idx_inventory_quantity 两个
--       在 pg_stat_user_indexes 中均观察到 idx_scan=0 的部分索引。
--
-- 背景：
--   - 两个索引最初在 Migration 00001 中创建：
--       CREATE INDEX idx_inventory_quantity  ON inventory(quantity) WHERE quantity = 0;
--       CREATE INDEX idx_inventory_low_stock ON inventory(quantity) WHERE quantity <= 500;
--   - 静态查询路径分析（PERF-G）：所有低库存查询已迁移至 RPC，
--     使用 COALESCE(safety_stock, 0) 动态参数，planner 无法证明 ≤500，
--     不会命中 idx_inventory_low_stock
--   - pg_stat_user_indexes 运行时验证：两个索引均 idx_scan=0 / idx_tup_read=0 /
--     idx_tup_fetch=0 / index_size=16 kB，当前统计窗口未观察到任何使用
--   - 综合静态分析 + 运行时统计，判断两个索引均不再需要
--
-- 注意：
--   - idx_scan=0 仅代表当前统计窗口内未观察到使用，不代表从未使用
--   - 本次删除基于静态查询路径分析 + 当前运行时统计共同判断
--   - DROP INDEX IF EXISTS 保证幂等，即使索引不存在也不会失败
--
-- 安全：
--   - 仅删除索引，不改表结构、RPC、RLS、权限
--   - 不修改已执行 Migration 00001
-- ============================================

DROP INDEX IF EXISTS public.idx_inventory_low_stock;
DROP INDEX IF EXISTS public.idx_inventory_quantity;
