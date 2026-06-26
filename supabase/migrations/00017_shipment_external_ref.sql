-- ============================================
-- Migration 00017: 外部在途同步数据模型
-- ============================================
-- Phase 3 (在途与物流) — P3-S1A
--
-- 新增表:
--   shipment_external_ref    — 外部供应商在途主单引用
--   shipment_external_item   — 外部供应商在途商品明细
--   tracking_event_external  — 外部供应商物流轨迹（路径 B）
--
-- 设计约束:
--   百世是首个 provider，但不是唯一 provider。表名使用 external 通用语义，
--   provider 字段区分数据源。禁止 best_order / best_item 等强绑定命名。
--   新增 provider 通过后续 Migration 扩展 CHECK 约束。
--   Provider 专有字段只存 raw_payload (jsonb)，不解析为业务公共字段。
--
-- ============================================
-- 路径 B 决策说明: 新建 tracking_event_external
-- ============================================
-- 选择路径 B（新表）而非路径 A（扩展 tracking_event），原因：
--
--   1. tracking_event.shipment_id 是 NOT NULL REFERENCES shipment(id)，
--      外部事件引用 shipment_external_ref，不可共用同一 FK。
--   2. tracking_event.status 有 CHECK IN ('booking','loading','departed',
--      'arrived','customs','warehoused')，外部状态是 provider 专有字符串，
--      不可共用同一 CHECK。
--   3. tracking_event.created_by 是 NOT NULL REFERENCES profiles(id)，
--      外部事件由系统同步产生，无创建用户。
--   4. 字段集合差异大：外部轨迹需要 provider / external_event_id /
--      raw_payload / external_ref_id，与内部 tracking_event 不重叠。
--
-- 路径 A 会引入大量可空字段和松弛约束，污染内部 tracking_event 语义。
-- 路径 B 保持两表独立，各自语义清晰，后续互不影响。
-- ============================================

-- ============================================
-- 1. shipment_external_ref
-- ============================================

CREATE TABLE shipment_external_ref (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL CHECK (provider IN ('best')),
  external_order_no text        NOT NULL,
  waybill_no        text,
  country           text        NOT NULL CHECK (country IN ('TH','ID','MY','PH','VN','CN')),
  warehouse_id      uuid        REFERENCES warehouse(id) ON DELETE SET NULL,
  raw_payload       jsonb       NOT NULL DEFAULT '{}',
  sync_status       text        NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active','stale','error')),
  last_synced_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 幂等：同 provider + external_order_no 不重复
CREATE UNIQUE INDEX idx_shipment_external_ref_provider_order
  ON shipment_external_ref(provider, external_order_no);

CREATE INDEX idx_shipment_external_ref_warehouse ON shipment_external_ref(warehouse_id);
CREATE INDEX idx_shipment_external_ref_country   ON shipment_external_ref(country);
CREATE INDEX idx_shipment_external_ref_status    ON shipment_external_ref(sync_status);

-- ============================================
-- 2. shipment_external_item
-- ============================================

CREATE TABLE shipment_external_item (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref_id      uuid        NOT NULL REFERENCES shipment_external_ref(id) ON DELETE CASCADE,
  external_sku         text        NOT NULL,
  external_product_name text,
  quantity             integer     NOT NULL CHECK (quantity >= 1),
  matched_variant_id   uuid        REFERENCES product_variant(id) ON DELETE SET NULL,
  raw_payload          jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipment_ext_item_ref_id  ON shipment_external_item(external_ref_id);
CREATE INDEX idx_shipment_ext_item_variant ON shipment_external_item(matched_variant_id);
CREATE INDEX idx_shipment_ext_item_sku     ON shipment_external_item(external_sku);

-- ============================================
-- 3. tracking_event_external（路径 B）
-- ============================================

CREATE TABLE tracking_event_external (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref_id   uuid        NOT NULL REFERENCES shipment_external_ref(id) ON DELETE CASCADE,
  provider          text        NOT NULL CHECK (provider IN ('best')),
  external_event_id text,
  status            text,       -- provider 专有状态字符串，无 CHECK 限制
  description       text,
  occurred_at       timestamptz,
  location          text,       -- 轨迹位置描述（城市/网点等）
  raw_payload       jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracking_ext_ref_id       ON tracking_event_external(external_ref_id);
CREATE INDEX idx_tracking_ext_provider     ON tracking_event_external(provider);
CREATE INDEX idx_tracking_ext_occurred_at  ON tracking_event_external(occurred_at);

-- ============================================
-- 4. updated_at 自动触发器
-- ============================================

CREATE OR REPLACE FUNCTION update_shipment_external_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_shipment_external_ref_updated_at
  BEFORE UPDATE ON shipment_external_ref
  FOR EACH ROW EXECUTE FUNCTION update_shipment_external_updated_at();

CREATE TRIGGER tg_shipment_external_item_updated_at
  BEFORE UPDATE ON shipment_external_item
  FOR EACH ROW EXECUTE FUNCTION update_shipment_external_updated_at();

-- tracking_event_external 为 append-only，不需要 updated_at 触发器

-- ============================================
-- 5. RLS 策略
-- ============================================

-- 5.1 shipment_external_ref
ALTER TABLE shipment_external_ref ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_shipment_external_ref" ON shipment_external_ref
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "authenticated_select_shipment_external_ref" ON shipment_external_ref
  FOR SELECT
  USING (get_user_role() IN ('admin', 'operator'));

-- 5.2 shipment_external_item
ALTER TABLE shipment_external_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_shipment_external_item" ON shipment_external_item
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "authenticated_select_shipment_external_item" ON shipment_external_item
  FOR SELECT
  USING (get_user_role() IN ('admin', 'operator'));

-- 5.3 tracking_event_external
ALTER TABLE tracking_event_external ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_tracking_event_external" ON tracking_event_external
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "authenticated_select_tracking_event_external" ON tracking_event_external
  FOR SELECT
  USING (get_user_role() IN ('admin', 'operator'));
