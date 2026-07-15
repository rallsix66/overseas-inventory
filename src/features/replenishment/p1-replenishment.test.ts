import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generatePlannedShipmentNo,
  normalizeWarehouseCountry,
  resolvePlannedEstimatedArrival,
} from '@/features/shipments/planned-shipment';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8');

const sources = {
  m41: read('supabase/migrations/00041_replenishment_warehouse_params.sql'),
  m42: read('supabase/migrations/00042_replenishment_cancellation.sql'),
  m43: read('supabase/migrations/00043_forecast_stockout.sql'),
  m44: read('supabase/migrations/00044_replenishment_rpcs.sql'),
  shipmentActions: read('src/features/shipments/actions.ts'),
  shipmentRepository: read('src/features/shipments/repository.ts'),
  replenishmentRepository: read('src/features/replenishment/repository.ts'),
  replenishmentPage: read('src/app/dashboard/replenishment/page.tsx'),
  replenishmentUi: read(
    'src/app/dashboard/replenishment/_components/replenishment-page-content.tsx',
  ),
  productPage: read('src/app/dashboard/products/[id]/page.tsx'),
  warehouseActions: read('src/features/warehouse/actions.ts'),
  warehouseRepository: read('src/features/warehouse/repository.ts'),
};

interface SourceCheck {
  name: string;
  source: keyof typeof sources;
  pattern: RegExp;
  absent?: boolean;
}

const sourceChecks: SourceCheck[] = [
  { name: '01 Migration A 新增 buffer_ratio', source: 'm41', pattern: /ADD COLUMN buffer_ratio/ },
  { name: '02 Migration A 默认 buffer_ratio=0.25', source: 'm41', pattern: /DEFAULT 0\.25/ },
  { name: '03 Migration A 新增 target_cover_multiplier', source: 'm41', pattern: /target_cover_multiplier/ },
  { name: '04 Migration A 默认 cover=1.5', source: 'm41', pattern: /DEFAULT 1\.5/ },
  { name: '05 Migration A 约束 buffer>=0', source: 'm41', pattern: /CHECK \(buffer_ratio >= 0\)/ },
  { name: '06 Migration A 触发 updated_at', source: 'm41', pattern: /trg_warehouse_updated_at/ },

  { name: '07 Migration B 新增 cancelled_at', source: 'm42', pattern: /ADD COLUMN cancelled_at/ },
  { name: '08 cancelled_at 默认为 NULL', source: 'm42', pattern: /cancelled_at timestamptz DEFAULT NULL/ },
  { name: '09 cancelled_at 有索引', source: 'm42', pattern: /idx_shipment_cancelled_at/ },
  { name: '10 活跃补给索引排除取消', source: 'm42', pattern: /WHERE cancelled_at IS NULL/ },
  { name: '11 活跃补给索引排除已吸收', source: 'm42', pattern: /bigseller_absorbed_at IS NULL/ },
  { name: '12 活跃补给索引仅五种未入仓状态', source: 'm42', pattern: /booking.*loading.*departed.*arrived.*customs/s },

  { name: '13 forecast_stockout 由 Migration C 创建', source: 'm43', pattern: /FUNCTION public\.forecast_stockout/ },
  { name: '14 forecast_stockout 为 STABLE', source: 'm43', pattern: /STABLE/ },
  { name: '15 forecast_stockout 为 SECURITY INVOKER', source: 'm43', pattern: /SECURITY INVOKER/ },
  { name: '16 forecast_stockout 固定空 search_path', source: 'm43', pattern: /SET search_path = ''/ },
  { name: '17 daily_sales 无效标记 data incomplete', source: 'm43', pattern: /ds_incomplete := p_daily_sales IS NULL OR p_daily_sales <= 0/ },
  { name: '18 lead 无效标记 incomplete', source: 'm43', pattern: /lead_incomplete := p_lead_time_days IS NULL OR p_lead_time_days <= 0/ },
  { name: '19 daily_sales 无效时早退', source: 'm43', pattern: /IF ds_incomplete THEN[\s\S]*RETURN NEXT/ },
  { name: '20 inbound 必须为数组', source: 'm43', pattern: /jsonb_typeof\(v_inbound\) <> 'array'/ },
  { name: '21 同 ETA 先 GROUP BY', source: 'm43', pattern: /GROUP BY eta/ },
  { name: '22 同 ETA SUM remaining', source: 'm43', pattern: /SUM\(remaining\)::integer AS total_remaining/ },
  { name: '23 ETA 事件按升序', source: 'm43', pattern: /ORDER BY eta/ },
  { name: '24 过期 ETA 按今天', source: 'm43', pattern: /GREATEST\(v_event\.eta, v_today\)/ },
  { name: '25 使用游标日期差', source: 'm43', pattern: /v_event_date - v_cursor_date/ },
  { name: '26 cur==consume 不提前断货', source: 'm43', pattern: /IF v_current < v_consume THEN/ },
  { name: '27 effective inbound 只到断货日', source: 'm43', pattern: /FILTER \(WHERE eta <= v_stockout\)/ },
  { name: '28 effective inbound 空集合 COALESCE 0', source: 'm43', pattern: /COALESCE\([\s\S]*SUM\(total_remaining\)[\s\S]*0[\s\S]*\)::integer/ },

  { name: '29 明细 RPC 绑定 auth.uid', source: 'm44', pattern: /p_user_id <> auth\.uid\(\)/ },
  { name: '30 明细 RPC 是 SECURITY INVOKER', source: 'm44', pattern: /get_in_transit_detail[\s\S]*SECURITY INVOKER/ },
  { name: '31 明细排除 cancelled_at', source: 'm44', pattern: /s\.cancelled_at IS NULL/ },
  { name: '32 明细排除已吸收', source: 'm44', pattern: /s\.bigseller_absorbed_at IS NULL/ },
  { name: '33 明细排除 warehoused', source: 'm44', pattern: /s\.status IN \('booking', 'loading', 'departed', 'arrived', 'customs'\)/ },
  { name: '34 明细只保留 remaining>0', source: 'm44', pattern: /si\.quantity - si\.warehoused_quantity\) > 0/ },
  { name: '35 明细排除 NULL ETA', source: 'm44', pattern: /s\.estimated_arrival IS NOT NULL/ },
  { name: '36 明细 RPC 撤销 PUBLIC', source: 'm44', pattern: /REVOKE EXECUTE ON FUNCTION public\.get_in_transit_detail[\s\S]*FROM PUBLIC/ },
  { name: '37 建议 RPC 校验 urgency 白名单', source: 'm44', pattern: /critical.*warning.*ok.*data_incomplete/s },
  { name: '38 建议 RPC page_size 上限 100', source: 'm44', pattern: /LEAST\(GREATEST\(COALESCE\(p_page_size, 20\), 1\), 100\)/ },
  { name: '39 inventory 是驱动表', source: 'm44', pattern: /FROM public\.inventory i/ },
  { name: '40 product 使用 LEFT JOIN', source: 'm44', pattern: /LEFT JOIN public\.product p/ },
  { name: '41 operator 使用 assigned warehouse', source: 'm44', pattern: /get_assigned_warehouse_ids/ },
  { name: '42 RPC 调共用 forecast_stockout', source: 'm44', pattern: /CROSS JOIN LATERAL public\.forecast_stockout/ },
  { name: '43 target_stock 不叠加 safety_stock', source: 'm44', pattern: /ROUND\(vi\.avg_daily_sales \* vi\.lead_time \* vi\.cover_mult\)/ },

  { name: '44 ShipmentError 保留可选 meta', source: 'shipmentRepository', pattern: /public meta\?: ShipmentDbErrorMeta/ },
  { name: '45 精确识别 shipment_no_unique', source: 'shipmentRepository', pattern: /duplicate key value violates unique constraint "shipment_no_unique"/ },
  { name: '46 create 保留 DB 错误元数据', source: 'shipmentRepository', pattern: /extractShipmentDbErrorMeta\(error\)/ },
  { name: '47 取消 UPDATE 只写 cancelled_at', source: 'shipmentRepository', pattern: /\.update\(\{ cancelled_at: new Date\(\)\.toISOString\(\) \}\)/ },
  { name: '48 取消强约束 booking', source: 'shipmentRepository', pattern: /\.eq\('status', 'booking'\)/ },
  { name: '49 取消强约束未取消', source: 'shipmentRepository', pattern: /\.is\('cancelled_at', null\)/ },
  { name: '50 计划创建 admin-only', source: 'shipmentActions', pattern: /createPlannedShipment[\s\S]*requireActiveAdmin\(\)/ },
  { name: '51 仅精确 23505+约束重试', source: 'shipmentActions', pattern: /dbCode === '23505'[\s\S]*constraint === 'shipment_no_unique'/ },
  { name: '52 总尝试次数最多 3', source: 'shipmentActions', pattern: /attempt <= 3/ },
  { name: '53 创建数据不传 status', source: 'shipmentActions', pattern: /shipmentRepository\.create\(\{[\s\S]*items:/ },

  { name: '54 Server Component 直接调用 Repository', source: 'replenishmentPage', pattern: /replenishmentRepository\.getSuggestions/ },
  { name: '55 补货页面不直连 Supabase', source: 'replenishmentPage', pattern: /supabase|createClient/, absent: true },
  { name: '56 客户端不直连 Supabase', source: 'replenishmentUi', pattern: /supabase|createClient|\.rpc\(/, absent: true },
  { name: '57 页面包含建议补货量', source: 'replenishmentUi', pattern: /建议补货/ },
  { name: '58 页面包含最晚下单日', source: 'replenishmentUi', pattern: /最晚下单/ },
  { name: '59 产品详情读取 p_variant_id 路径', source: 'productPage', pattern: /getSuggestionsForVariants/ },
  { name: '60 warehouse 更新走专属 Repository', source: 'warehouseActions', pattern: /warehouseRepository\.updateReplenishmentParams/ },
];

describe('P1 预测式补货 — 60 项结构、安全与契约测试', () => {
  expect(sourceChecks).toHaveLength(60);
  for (const check of sourceChecks) {
    it(check.name, () => {
      if (check.absent) {
        expect(sources[check.source]).not.toMatch(check.pattern);
      } else {
        expect(sources[check.source]).toMatch(check.pattern);
      }
    });
  }
});

describe('P1 预测式补货 — 14 项计划单号与 ETA 行为测试', () => {
  it('61 country 小写会规范化', () => {
    expect(normalizeWarehouseCountry('th')).toBe('TH');
  });

  it('62 country 两侧空格会清理', () => {
    expect(normalizeWarehouseCountry('  ph  ')).toBe('PH');
  });

  it('63 country 中文会拒绝', () => {
    expect(() => normalizeWarehouseCountry('泰国')).toThrow('仓库国家不合法');
  });

  it('64 country 空值会拒绝', () => {
    expect(() => normalizeWarehouseCountry('')).toThrow('仓库国家不合法');
  });

  it('65 计划单号格式正确', () => {
    expect(
      generatePlannedShipmentNo(
        'TH',
        'a1b2c3d4-1111-2222-3333-444455556666',
        new Date('2026-07-15T00:00:00.000Z'),
        'X8K2P9',
      ),
    ).toBe('PLN-TH-a1b2c3d4-20260715-X8K2P9');
  });

  it('66 计划单号只含 ASCII 白名单', () => {
    expect(generatePlannedShipmentNo('VN', crypto.randomUUID())).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('67 计划单号长度不超过 50', () => {
    expect(generatePlannedShipmentNo('MY', crypto.randomUUID()).length).toBeLessThanOrEqual(50);
  });

  it('68 自定义 seq 会转大写', () => {
    expect(
      generatePlannedShipmentNo('ID', crypto.randomUUID(), new Date('2026-07-15'), 'abc123'),
    ).toMatch(/-ABC123$/);
  });

  it('69 不同随机 seq 产生不同单号', () => {
    const warehouseId = crypto.randomUUID();
    expect(generatePlannedShipmentNo('PH', warehouseId)).not.toBe(
      generatePlannedShipmentNo('PH', warehouseId),
    );
  });

  it('70 直接填写预计到达日时优先使用', () => {
    expect(resolvePlannedEstimatedArrival('2026-07-20', '2026-07-15', 12)).toBe('2026-07-20');
  });

  it('71 发出日加 lead time 推算 ETA', () => {
    expect(resolvePlannedEstimatedArrival(undefined, '2026-07-15', 12)).toBe('2026-07-27');
  });

  it('72 ETA 推算支持跨月', () => {
    expect(resolvePlannedEstimatedArrival(undefined, '2026-07-28', 7)).toBe('2026-08-04');
  });

  it('73 lead time 为 NULL 时拒绝推算', () => {
    expect(() => resolvePlannedEstimatedArrival(undefined, '2026-07-15', null)).toThrow(
      '仓库未配置有效补货周期',
    );
  });

  it('74 lead time 为 0 时拒绝推算', () => {
    expect(() => resolvePlannedEstimatedArrival(undefined, '2026-07-15', 0)).toThrow(
      '仓库未配置有效补货周期',
    );
  });
});

