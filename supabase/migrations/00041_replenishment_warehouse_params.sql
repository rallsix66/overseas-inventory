-- ============================================
-- Migration 00041: P1 预测式补货 — 仓库参数
-- ============================================
-- 新增仓库级安全库存缓冲、目标覆盖倍数与更新时间。
-- 不修改既有 RLS；写入仍由 warehouse 表既有策略保护。

ALTER TABLE public.warehouse
  ADD COLUMN buffer_ratio numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN target_cover_multiplier numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.warehouse
  ADD CONSTRAINT warehouse_buffer_ratio_check
    CHECK (buffer_ratio >= 0),
  ADD CONSTRAINT warehouse_cover_mult_check
    CHECK (target_cover_multiplier > 0);

CREATE TRIGGER trg_warehouse_updated_at
  BEFORE UPDATE ON public.warehouse
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

