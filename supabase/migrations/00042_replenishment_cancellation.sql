-- ============================================
-- Migration 00042: P1 预测式补货 — 计划发货取消
-- ============================================
-- booking 计划使用软取消标记；不扩展 shipment.status 枚举。

ALTER TABLE public.shipment
  ADD COLUMN cancelled_at timestamptz DEFAULT NULL;

CREATE INDEX idx_shipment_cancelled_at
  ON public.shipment(cancelled_at);

-- 补货读取始终限定未取消、未吸收、未入仓且 ETA 已知的记录。
CREATE INDEX idx_shipment_replenishment_active
  ON public.shipment(warehouse_id, estimated_arrival, id)
  WHERE cancelled_at IS NULL
    AND bigseller_absorbed_at IS NULL
    AND estimated_arrival IS NOT NULL
    AND status IN ('booking', 'loading', 'departed', 'arrived', 'customs');

