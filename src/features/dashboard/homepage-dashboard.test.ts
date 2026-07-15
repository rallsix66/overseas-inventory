import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateInTransitKpis, countSyncErrors } from './metrics';
import type { InTransitDetail } from '@/features/shipments/types';
import type { SyncWarehouseOverviewItem } from '@/features/sync/types';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8');

const sources = {
  migration: read('supabase/migrations/00047_dashboard_warehouse_health_overview.sql'),
  inventoryRepository: read('src/features/inventory/repository.ts'),
  shipmentRepository: read('src/features/shipments/repository.ts'),
  shipmentTypes: read('src/features/shipments/types.ts'),
  page: read('src/app/dashboard/page.tsx'),
  loading: read('src/app/dashboard/loading.tsx'),
  lowStock: read('src/app/dashboard/_components/low-stock-summary-section.tsx'),
  followed: read('src/features/preferences/components/followed-products-section.tsx'),
  kpis: read('src/app/dashboard/_components/dashboard-kpi-cards.tsx'),
  warehouseHealth: read('src/app/dashboard/_components/warehouse-health-card.tsx'),
  upcoming: read('src/app/dashboard/_components/upcoming-arrivals.tsx'),
  metrics: read('src/features/dashboard/metrics.ts'),
};

interface Check {
  name: string;
  source: keyof typeof sources;
  pattern: RegExp;
  absent?: boolean;
}

const checks: Check[] = [
  { name: '01 首页健康度使用 00047 Migration', source: 'migration', pattern: /Migration 00047/ },
  { name: '02 健康度 RPC 返回 JSONB', source: 'migration', pattern: /get_warehouse_health_overview[\s\S]*RETURNS jsonb/ },
  { name: '03 健康度 RPC 绑定 auth uid', source: 'migration', pattern: /p_user_id <> auth\.uid\(\)/ },
  { name: '04 健康度 RPC 拒绝未登录', source: 'migration', pattern: /auth\.uid\(\) IS NULL/ },
  { name: '05 健康度 RPC 校验 active profile', source: 'migration', pattern: /profile\.is_active = true/ },
  { name: '06 健康度 RPC 只允许 admin operator', source: 'migration', pattern: /NOT IN \('admin', 'operator'\)/ },
  { name: '07 Admin 只看 active overseas', source: 'migration', pattern: /warehouse\.type = 'overseas'[\s\S]*warehouse\.is_active = true[\s\S]*v_role = 'admin'/ },
  { name: '08 Operator 使用 assigned 仓库交集', source: 'migration', pattern: /v_role = 'operator'[\s\S]*get_assigned_warehouse_ids/ },
  { name: '09 inventory 是健康度驱动表', source: 'migration', pattern: /FROM public\.inventory inventory/ },
  { name: '10 safety_stock 从 product 取得', source: 'migration', pattern: /product\.safety_stock[\s\S]*LEFT JOIN public\.product product/ },
  { name: '11 归档过滤在 position 集合中执行', source: 'migration', pattern: /LEFT JOIN public\.user_variant_preference uvp_arch[\s\S]*preference_type = 'archived'[\s\S]*WHERE uvp_arch\.variant_id IS NULL/ },
  { name: '12 quantity 0 仅归缺货', source: 'migration', pattern: /WHEN inventory\.quantity = 0 THEN 'out_of_stock'/ },
  { name: '13 unmatched 在 low 前判断', source: 'migration', pattern: /match_status <> 'matched'[\s\S]*quantity <= product\.safety_stock/ },
  { name: '14 summary 使用 distinct_variant_count', source: 'migration', pattern: /'distinct_variant_count', COUNT\(DISTINCT variant_id\)/ },
  { name: '15 summary 使用 total_position_count', source: 'migration', pattern: /'total_position_count', COUNT\(\*\)/ },
  { name: '16 summary 不使用 total_skus', source: 'migration', pattern: /total_skus/, absent: true },
  { name: '17 健康率分母排除 unmatched', source: 'migration', pattern: /health_status IN \('normal', 'low', 'out_of_stock'\)/ },
  { name: '18 无可评估数据健康率为 NULL', source: 'migration', pattern: /\) = 0 THEN NULL/ },
  { name: '19 summary 包含 total_quantity', source: 'migration', pattern: /'total_quantity', COALESCE\(SUM\(quantity\), 0\)/ },
  { name: '20 仓库数量动态 JSON 聚合', source: 'migration', pattern: /jsonb_agg\([\s\S]*warehouse_id/ },
  { name: '21 仓库风险排序 NULL 最后', source: 'migration', pattern: /\(health_rate IS NULL\)[\s\S]*health_rate ASC/ },
  { name: '22 健康度 RPC 是 SECURITY INVOKER', source: 'migration', pattern: /SECURITY INVOKER/ },
  { name: '23 健康度 RPC 固定空 search_path', source: 'migration', pattern: /SET search_path = ''/ },
  { name: '24 健康度 RPC 撤销 PUBLIC anon', source: 'migration', pattern: /FROM PUBLIC;[\s\S]*FROM anon;/ },
  { name: '25 健康度 RPC 仅授权 authenticated', source: 'migration', pattern: /TO authenticated;/ },
  { name: '26 Inventory Repository 调健康 RPC', source: 'inventoryRepository', pattern: /getWarehouseHealthOverview[\s\S]*\.rpc\('get_warehouse_health_overview'/ },
  { name: '27 首页近期到港 days 限制 1..30', source: 'shipmentRepository', pattern: /days < 1 \|\| days > 30/ },
  { name: '28 近期到港先获取可见仓库', source: 'shipmentRepository', pattern: /getUpcomingArrivals[\s\S]*getAccessibleWarehouseIds\(userId\)/ },
  { name: '29 近期到港显式 warehouse IN 过滤', source: 'shipmentRepository', pattern: /\.in\('warehouse_id', \[\.\.\.accessibleIds\]\)/ },
  { name: '30 近期到港只含三种已发货状态', source: 'shipmentRepository', pattern: /\.in\('status', \['departed', 'arrived', 'customs'\]\)/ },
  { name: '31 近期到港排除取消', source: 'shipmentRepository', pattern: /\.is\('cancelled_at', null\)/ },
  { name: '32 近期到港排除已吸收', source: 'shipmentRepository', pattern: /\.is\('bigseller_absorbed_at', null\)/ },
  { name: '33 近期到港按 UTC 日期边界', source: 'shipmentRepository', pattern: /setUTCDate[\s\S]*\.gte\('estimated_arrival', startDate\)[\s\S]*\.lte\('estimated_arrival', endDate\)/ },
  { name: '34 remaining 只统计正数 item', source: 'shipmentRepository', pattern: /quantity - item\.warehoused_quantity > 0/ },
  { name: '35 无剩余整单不占 Top4', source: 'shipmentRepository', pattern: /if \(remainingQuantity <= 0\) continue/ },
  { name: '36 到港按 ETA 与单号稳定排序', source: 'shipmentRepository', pattern: /estimatedArrival\.localeCompare[\s\S]*shipmentNo\.localeCompare/ },
  { name: '37 Top4 在过滤排序后 slice', source: 'shipmentRepository', pattern: /arrivals\.sort[\s\S]*return arrivals\.slice\(0, 4\)/ },
  { name: '38 UpcomingArrival 固定 itemNames 数组', source: 'shipmentTypes', pattern: /interface UpcomingArrival[\s\S]*itemNames: string\[\]/ },
  { name: '39 首页使用 requireActiveAuth', source: 'page', pattern: /requireActiveAuth\(\)/ },
  { name: '40 首页六项查询处于同一 Promise.all', source: 'page', pattern: /Promise\.all\(\[[\s\S]*getWarehouseHealthOverview[\s\S]*getInTransitDetail[\s\S]*getLowStock[\s\S]*getFollowedVariantsBasic[\s\S]*getUpcomingArrivals[\s\S]*getSyncWarehouseOverview/ },
  { name: '41 首页不再调用 getOverseasStats', source: 'page', pattern: /getOverseasStats/, absent: true },
  { name: '42 首页不再调用旧 getInTransitByVariant', source: 'page', pattern: /getInTransitByVariant/, absent: true },
  { name: '43 首页无筛选调用 getInTransitDetail user id', source: 'page', pattern: /getInTransitDetail\(user\.id\)/ },
  { name: '44 每项查询保留独立错误结构', source: 'page', pattern: /function load<[\s\S]*error: errorMessage/ },
  { name: '45 同步异常只看最新两种 failed 状态', source: 'metrics', pattern: /latestDryRun\?\.status === 'failed'[\s\S]*latestRealWrite\?\.status === 'failed'/ },
  { name: '46 未来 7 日总数由有效明细 shipment 去重', source: 'metrics', pattern: /futureShipments\.add\(row\.shipmentId\)[\s\S]*future7dArrivalCount: futureShipments\.size/ },
  { name: '47 低库存组件支持 limit compact', source: 'lowStock', pattern: /limit = MAX_DISPLAY[\s\S]*compact = false/ },
  { name: '48 关注组件支持 limit compact', source: 'followed', pattern: /limit,[\s\S]*compact = false/ },
  { name: '49 首页传低库存 5 关注 4', source: 'page', pattern: /limit=\{5\}[\s\S]*limit=\{4\}/ },
  { name: '50 首页快捷动作链接 P1 P7 同步', source: 'page', pattern: /\/dashboard\/sync[\s\S]*\/dashboard\/replenishment[\s\S]*\/dashboard\/products\/overview/ },
  { name: '51 首页提供页面级 loading Skeleton', source: 'loading', pattern: /DashboardLoading[\s\S]*Skeleton/ },
];

describe('首页决策看板 — 51 项结构、安全与契约测试', () => {
  expect(checks).toHaveLength(51);
  for (const check of checks) {
    it(check.name, () => {
      if (check.absent) expect(sources[check.source]).not.toMatch(check.pattern);
      else expect(sources[check.source]).toMatch(check.pattern);
    });
  }
});

const transitRows: InTransitDetail[] = [
  { shipmentId: 's1', variantId: 'v1', warehouseId: 'w1', status: 'departed', estimatedArrival: '2026-07-15', remainingQuantity: 10, isPlanned: false },
  { shipmentId: 's1', variantId: 'v2', warehouseId: 'w1', status: 'departed', estimatedArrival: '2026-07-15', remainingQuantity: 20, isPlanned: false },
  { shipmentId: 's2', variantId: 'v1', warehouseId: 'w1', status: 'customs', estimatedArrival: '2026-07-22', remainingQuantity: 5, isPlanned: false },
  { shipmentId: 's3', variantId: 'v3', warehouseId: 'w1', status: 'booking', estimatedArrival: '2026-07-17', remainingQuantity: 7, isPlanned: true },
  { shipmentId: 's4', variantId: 'v4', warehouseId: 'w1', status: 'arrived', estimatedArrival: '2026-07-23', remainingQuantity: 8, isPlanned: false },
];

describe('首页决策看板 — 8 项聚合行为测试', () => {
  const result = aggregateInTransitKpis(transitRows, '2026-07-15');

  it('52 有效在途数量汇总全部明细', () => expect(result.activeInTransitQuantity).toBe(50));
  it('53 SKU 数按 variant 去重', () => expect(result.activeInTransitSkuCount).toBe(4));
  it('54 Shipment 数按 shipment 去重', () => expect(result.activeInTransitShipmentCount).toBe(4));
  it('55 未来到港排除 booking', () => expect(result.future7dArrivalCount).toBe(2));
  it('56 ETA 今天边界包含', () => expect(result.future7dArrivalCount).toBeGreaterThan(0));
  it('57 ETA 第七天边界包含', () => expect(aggregateInTransitKpis([transitRows[2]!], '2026-07-15').future7dArrivalCount).toBe(1));
  it('58 同一 Shipment 多 item 只计一单', () => expect(aggregateInTransitKpis(transitRows.slice(0, 2), '2026-07-15').future7dArrivalCount).toBe(1));
  it('59 同步异常只统计 latest failed 且从未同步不计', () => {
    const syncRows: SyncWarehouseOverviewItem[] = [
      { warehouseId: 'w1', warehouseName: 'A', country: 'TH', latestDryRun: { status: 'failed', time: null, runId: 'r1' }, latestRealWrite: null, lastSuccessTime: null, lastFailureReason: 'x' },
      { warehouseId: 'w2', warehouseName: 'B', country: 'PH', latestDryRun: null, latestRealWrite: { status: 'completed', time: null, runId: 'r2' }, lastSuccessTime: null, lastFailureReason: 'old' },
      { warehouseId: 'w3', warehouseName: 'C', country: 'VN', latestDryRun: null, latestRealWrite: null, lastSuccessTime: null, lastFailureReason: null },
    ];
    expect(countSyncErrors(syncRows)).toBe(1);
  });
});
