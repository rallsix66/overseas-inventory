-- ============================================
-- Migration 00038: 喜运达物流轨迹 API 接入 — Schema 变更
-- ============================================
-- Stage 1 P0-A
--
-- 基于 00017 外部表结构，扩展支持喜运达(golucky) provider。
-- 变更范围：
--   1. CHECK 约束扩展：provider IN ('best','golucky')
--   2. shipment_external_ref 加 shipment_id 列（两阶段绑定）
--   3. external_order_no 改为可空（喜运达仅用 waybill_no）
--   4. 旧唯一索引替换为 waybill 部分唯一索引（含历史重复预检阻断）
--   5. external_ref 仓库锁触发器（已绑定后禁止改 warehouse_id）
--   6. tracking_event_external 回填 external_event_id + NOT NULL + 唯一索引
--   7. tracking_event_external 加 external_category 字段 + CHECK
--   8. tracking_event_external provider 一致性触发器
--
-- 不改动：
--   - shipment_external_item（P0 不读写）
--   - inventory / tracking_event / shipment.status（P0 不回写）
--   - best provider 文件

-- ============================================
-- 1. 扩展 CHECK 约束：provider 新增 'golucky'
-- ============================================

-- 1.1 shipment_external_ref
ALTER TABLE public.shipment_external_ref
  DROP CONSTRAINT IF EXISTS shipment_external_ref_provider_check;

ALTER TABLE public.shipment_external_ref
  ADD CONSTRAINT shipment_external_ref_provider_check
  CHECK (provider IN ('best', 'golucky'));

-- 1.2 tracking_event_external
ALTER TABLE public.tracking_event_external
  DROP CONSTRAINT IF EXISTS tracking_event_external_provider_check;

ALTER TABLE public.tracking_event_external
  ADD CONSTRAINT tracking_event_external_provider_check
  CHECK (provider IN ('best', 'golucky'));

-- ============================================
-- 2. shipment_external_ref：shipment_id + external_order_no 可空 + 索引替换
-- ============================================

-- 2.1 新增 shipment_id 列（两阶段绑定：NULL=未绑定，非NULL=已绑定）
ALTER TABLE public.shipment_external_ref
  ADD COLUMN IF NOT EXISTS shipment_id uuid
  REFERENCES public.shipment(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_external_ref_shipment_id
  ON public.shipment_external_ref(shipment_id);

-- 2.2 external_order_no 改为可空（喜运达仅用 waybill_no 作为主标识）
ALTER TABLE public.shipment_external_ref
  ALTER COLUMN external_order_no DROP NOT NULL;

-- 2.3 删除旧 (provider, external_order_no) 唯一索引
DROP INDEX IF EXISTS idx_shipment_external_ref_provider_order;

-- 2.4 waybill 唯一索引预检：存在重复数据时中止 Migration（v8 固定唯一实现）
DO $$
DECLARE
  v_dup_group_count bigint;
  v_dup_details     jsonb;
BEGIN
  SELECT
    count(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'provider', provider,
          'waybill_no', waybill_no,
          'count', duplicate_count
        )
        ORDER BY provider, waybill_no
      ),
      '[]'::jsonb
    )
  INTO v_dup_group_count, v_dup_details
  FROM (
    SELECT
      provider,
      waybill_no,
      count(*) AS duplicate_count
    FROM public.shipment_external_ref
    WHERE waybill_no IS NOT NULL
    GROUP BY provider, waybill_no
    HAVING count(*) > 1
  ) duplicates;

  IF v_dup_group_count > 0 THEN
    RAISE EXCEPTION
      '发现 % 组重复 (provider, waybill_no)，Migration 已中止',
      v_dup_group_count
      USING
        DETAIL = v_dup_details::text,
        HINT = '请人工处理重复记录后重新执行 Migration；系统不会自动删除、合并或随机保留数据';
  END IF;
END $$;

-- 2.5 创建 waybill 部分唯一索引（仅预检通过后执行）
CREATE UNIQUE INDEX idx_shipment_external_ref_provider_waybill
  ON public.shipment_external_ref (provider, waybill_no)
  WHERE waybill_no IS NOT NULL;

-- ============================================
-- 3. external_ref 仓库锁触发器（已绑定后禁止改 warehouse_id）
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_shipment_external_ref_warehouse_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.shipment_id IS NOT NULL
     AND NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
  THEN
    RAISE EXCEPTION
      '该外部物流记录已绑定 Shipment，不支持修改仓库';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_shipment_external_ref_warehouse_lock
  ON public.shipment_external_ref;

CREATE TRIGGER tg_shipment_external_ref_warehouse_lock
  BEFORE UPDATE ON public.shipment_external_ref
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shipment_external_ref_warehouse_lock();

-- ============================================
-- 4. tracking_event_external：external_event_id 回填 + NOT NULL + 唯一索引
-- ============================================

-- 4.1 回填已有数据：基于确定性字段生成 MD5 哈希
UPDATE public.tracking_event_external
SET external_event_id = md5(
  COALESCE(provider, '') || '|' ||
  COALESCE(status, '') || '|' ||
  COALESCE(description, '') || '|' ||
  COALESCE(occurred_at::text, '') || '|' ||
  id::text
)
WHERE external_event_id IS NULL;

-- 4.2 设为 NOT NULL
ALTER TABLE public.tracking_event_external
  ALTER COLUMN external_event_id SET NOT NULL;

-- 4.3 创建 (external_ref_id, external_event_id) 唯一索引（幂等去重）
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_event_external_dedup
  ON public.tracking_event_external (external_ref_id, external_event_id);

-- ============================================
-- 5. tracking_event_external：external_category 字段 + CHECK
-- ============================================

-- 5.1 新增 external_category 列
ALTER TABLE public.tracking_event_external
  ADD COLUMN IF NOT EXISTS external_category text;

-- 5.2 回填已有数据为 'unknown'
UPDATE public.tracking_event_external
SET external_category = 'unknown'
WHERE external_category IS NULL;

-- 5.3 添加 NOT NULL + CHECK 约束
ALTER TABLE public.tracking_event_external
  ALTER COLUMN external_category SET NOT NULL;

ALTER TABLE public.tracking_event_external
  ADD CONSTRAINT tracking_event_external_category_check
  CHECK (external_category IN (
    'created', 'loaded', 'in_transit', 'customs', 'delivered', 'exception', 'unknown'
  ));

ALTER TABLE public.tracking_event_external
  ALTER COLUMN external_category SET DEFAULT 'unknown';

-- ============================================
-- 6. tracking_event_external provider 一致性触发器
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_tracking_event_external_provider_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ref_provider text;
BEGIN
  SELECT provider INTO v_ref_provider
  FROM public.shipment_external_ref
  WHERE id = NEW.external_ref_id;

  IF v_ref_provider IS NULL THEN
    RAISE EXCEPTION '外部物流记录不存在 (external_ref_id=%)', NEW.external_ref_id;
  END IF;

  IF NEW.provider IS DISTINCT FROM v_ref_provider THEN
    RAISE EXCEPTION
      'tracking_event_external.provider (%) 与父记录 provider (%) 不一致',
      NEW.provider, v_ref_provider;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_tracking_event_external_provider_consistent
  ON public.tracking_event_external;

CREATE TRIGGER tg_tracking_event_external_provider_consistent
  BEFORE INSERT OR UPDATE ON public.tracking_event_external
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_tracking_event_external_provider_consistent();
