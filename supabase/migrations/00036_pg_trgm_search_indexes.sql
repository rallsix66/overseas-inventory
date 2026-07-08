-- ============================================
-- Migration 00036: P6-UX-V2 搜索性能 — pg_trgm 三元组索引
-- ============================================
-- 目的：00035 的搜索有两条路径，数据量增大后全表扫描成本高。
--       本 migration 启用 pg_trgm 并为两条路径分别建 GIN 三元组索引。
--
-- 00035 搜索路径分析：
--   路径 A（连续子串 ILIKE，快速路径）：
--     v.sku ILIKE '%' || p_search || '%'
--     v.name ILIKE '%' || p_search || '%'
--     p.name ILIKE '%' || p_search || '%'
--     p.code ILIKE '%' || p_search || '%'
--     → 需要：bare column trigram index
--
--   路径 B（分词 AND，lower-coalesce LIKE）：
--     lower(COALESCE(v.sku, ''))  LIKE '%' || token || '%'
--     lower(COALESCE(v.name, '')) LIKE '%' || token || '%'
--     lower(COALESCE(p.name, '')) LIKE '%' || token || '%'
--     lower(COALESCE(p.code, '')) LIKE '%' || token || '%'
--     → 需要：expression trigram index ON lower(COALESCE(col, ''))
--
-- 设计决策：
--   - 00035 解决搜索准确性（连续子串 + 分词 AND 语义），本轮不修改 00035
--   - 00036 通过 trigram index 优化两条路径的模糊搜索性能，不改变搜索逻辑
--   - 索引表达式与 SQL 中实际使用的表达式严格一致
--   - 未来如果数据量继续增大，再考虑 dedicated search_vector / materialized
--     search_text，不在本轮实现
--
-- 安全：
--   - pg_trgm 是 PostgreSQL 官方扩展，不引入外部依赖
--   - GIN 索引不改变查询语义，仅加速 ILIKE/LIKE 模式匹配
--   - 不修改已执行 Migration 00001~00035
--   - 不修改 RPC 函数签名、不修改 RLS、不修改权限模型
-- ============================================

-- ═══════════════════════════════════════════
-- 1. 启用 pg_trgm 扩展
-- ═══════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ═══════════════════════════════════════════
-- 2. 路径 A：bare column trigram 索引（加速 ILIKE 快速路径）
-- ═══════════════════════════════════════════
-- 不使用 CONCURRENTLY：Supabase Migration 在事务内执行，CONCURRENTLY 不可在事务内运行

CREATE INDEX IF NOT EXISTS idx_variant_sku_trgm
  ON public.product_variant USING gin (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_variant_name_trgm
  ON public.product_variant USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_name_trgm
  ON public.product USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_code_trgm
  ON public.product USING gin (code gin_trgm_ops);

-- ═══════════════════════════════════════════
-- 3. 路径 B：expression trigram 索引（加速 lower-coalesce LIKE 分词路径）
-- ═══════════════════════════════════════════
-- 表达式与 00035 分词路径中使用的 lower(COALESCE(col, '')) 严格一致

CREATE INDEX IF NOT EXISTS idx_variant_sku_lower_trgm
  ON public.product_variant USING gin (lower(COALESCE(sku, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_variant_name_lower_trgm
  ON public.product_variant USING gin (lower(COALESCE(name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_name_lower_trgm
  ON public.product USING gin (lower(COALESCE(name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_code_lower_trgm
  ON public.product USING gin (lower(COALESCE(code, '')) gin_trgm_ops);
