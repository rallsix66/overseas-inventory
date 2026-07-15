import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8');

const sources = {
  listMigration: read('supabase/migrations/00045_product_overview_rpc.sql'),
  detailMigration: read('supabase/migrations/00046_war_room_variant_detail_rpc.sql'),
  types: read('src/features/product-overview/types.ts'),
  repository: read('src/features/product-overview/repository.ts'),
  actions: read('src/features/product-overview/actions.ts'),
  page: read('src/app/dashboard/products/overview/page.tsx'),
  pageUi: read(
    'src/app/dashboard/products/overview/_components/product-overview-page-content.tsx',
  ),
  modal: read('src/features/product-overview/components/product-modal.tsx'),
  sidebar: read('src/app/dashboard/_components/sidebar-nav.tsx'),
};

interface SourceCheck {
  name: string;
  source: keyof typeof sources;
  pattern: RegExp;
  absent?: boolean;
}

const checks: SourceCheck[] = [
  { name: '01 列表 RPC 使用固定函数名', source: 'listMigration', pattern: /FUNCTION public\.get_product_overview/ },
  { name: '02 列表 RPC 返回 JSONB 信封', source: 'listMigration', pattern: /RETURNS jsonb/ },
  { name: '03 列表 RPC 拒绝未登录', source: 'listMigration', pattern: /auth\.uid\(\) IS NULL/ },
  { name: '04 列表 RPC 绑定 p_user_id', source: 'listMigration', pattern: /p_user_id <> auth\.uid\(\)/ },
  { name: '05 列表 RPC 校验 active profile', source: 'listMigration', pattern: /profile\.is_active = true/ },
  { name: '06 列表 RPC 仅允许 admin operator', source: 'listMigration', pattern: /NOT IN \('admin', 'operator'\)/ },
  { name: '07 Admin 范围为全部 active overseas', source: 'listMigration', pattern: /w\.type = 'overseas'[\s\S]*w\.is_active = true[\s\S]*v_role = 'admin'/ },
  { name: '08 Operator 使用 assigned warehouse 交集', source: 'listMigration', pattern: /v_role = 'operator'[\s\S]*get_assigned_warehouse_ids/ },
  { name: '09 inventory 是列表驱动表', source: 'listMigration', pattern: /FROM public\.inventory inventory/ },
  { name: '10 product 使用 LEFT JOIN', source: 'listMigration', pattern: /LEFT JOIN public\.product product/ },
  { name: '11 quantity=0 优先 out_of_stock', source: 'listMigration', pattern: /WHEN inventory\.quantity = 0 THEN 'out_of_stock'/ },
  { name: '12 未匹配状态排在安全库存前', source: 'listMigration', pattern: /product_id IS NULL OR variant\.match_status <> 'matched'[\s\S]*inventory\.quantity <= product\.safety_stock/ },
  { name: '13 在途排除 cancelled_at', source: 'listMigration', pattern: /shipment\.cancelled_at IS NULL/ },
  { name: '14 在途排除 BigSeller 已吸收', source: 'listMigration', pattern: /shipment\.bigseller_absorbed_at IS NULL/ },
  { name: '15 在途仅五种有效状态', source: 'listMigration', pattern: /booking.*loading.*departed.*arrived.*customs/ },
  { name: '16 在途仅 remaining 大于零', source: 'listMigration', pattern: /item\.quantity - item\.warehoused_quantity\) > 0/ },
  { name: '17 ETA 缺失数量独立返回', source: 'listMigration', pattern: /eta_missing_quantity/ },
  { name: '18 列表调用共享 forecast_stockout', source: 'listMigration', pattern: /CROSS JOIN LATERAL public\.forecast_stockout/ },
  { name: '19 可见总量不使用 effective inbound', source: 'listMigration', pattern: /SUM\(on_hand\) \+ SUM\(visible_inbound_quantity\)/ },
  { name: '20 行级基础状态按严重度聚合', source: 'listMigration', pattern: /out_of_stock'[\s\S]*'low'[\s\S]*'normal'[\s\S]*'unmatched'/ },
  { name: '21 最早断货仅使用有效日销仓', source: 'listMigration', pattern: /MIN\(est_stockout_date\) FILTER \(WHERE ds_incomplete = false\)/ },
  { name: '22 partial_data 是独立布尔条件', source: 'listMigration', pattern: /COUNT\(\*\) FILTER \(WHERE ds_incomplete = false\) > 0[\s\S]*ds_incomplete = true/ },
  { name: '23 风险枚举包含四档', source: 'listMigration', pattern: /critical.*warning.*ok.*data_incomplete/s },
  { name: '24 国内状态固定 data_unavailable', source: 'listMigration', pattern: /'data_unavailable'::text AS domestic_status/ },
  { name: '25 信封含 items', source: 'listMigration', pattern: /'items'/ },
  { name: '26 信封含 total_count', source: 'listMigration', pattern: /'total_count'/ },
  { name: '27 信封含完整 queue_counts', source: 'listMigration', pattern: /'queue_counts'/ },
  { name: '28 queue_counts 从 base_cohort 统计', source: 'listMigration', pattern: /queue_counts AS \([\s\S]*FROM base_cohort/ },
  { name: '29 urgency 在 filtered_cohort 应用', source: 'listMigration', pattern: /filtered_cohort AS \([\s\S]*p_stockout_urgency/ },
  { name: '30 total_count 从 filtered_cohort 统计', source: 'listMigration', pattern: /total_count AS \([\s\S]*FROM filtered_cohort/ },
  { name: '31 稳定排序以风险开头', source: 'listMigration', pattern: /ORDER BY[\s\S]*CASE stockout_urgency/ },
  { name: '32 稳定排序包含 earliest NULLS LAST', source: 'listMigration', pattern: /earliest_stockout NULLS LAST/ },
  { name: '33 稳定排序以 variant_id 决胜', source: 'listMigration', pattern: /earliest_stockout NULLS LAST,\s*variant_id/ },
  { name: '34 分页在排序后执行', source: 'listMigration', pattern: /ORDER BY[\s\S]*LIMIT p_page_size OFFSET v_offset/ },
  { name: '35 RPC 校验页码下限', source: 'listMigration', pattern: /p_page IS NULL OR p_page < 1/ },
  { name: '36 RPC 校验 page_size 1..100', source: 'listMigration', pattern: /p_page_size < 1 OR p_page_size > 100/ },
  { name: '37 RPC 校验 urgency 白名单', source: 'listMigration', pattern: /p_stockout_urgency NOT IN/ },
  { name: '38 RPC 校验 country 白名单', source: 'listMigration', pattern: /p_country NOT IN \('TH', 'ID', 'MY', 'PH', 'VN', 'CN'\)/ },
  { name: '39 search trim 空串归一化', source: 'listMigration', pattern: /p_search := NULLIF\(TRIM\(p_search\), ''\)/ },
  { name: '40 列表 RPC 为 SECURITY INVOKER', source: 'listMigration', pattern: /SECURITY INVOKER/ },
  { name: '41 列表 RPC 固定空 search_path', source: 'listMigration', pattern: /SET search_path = ''/ },
  { name: '42 列表 RPC 撤销 PUBLIC 与 anon', source: 'listMigration', pattern: /FROM PUBLIC;[\s\S]*FROM anon;/ },
  { name: '43 列表 RPC 仅授权 authenticated', source: 'listMigration', pattern: /TO authenticated;/ },
  { name: '44 详情 RPC 使用准确双参数签名', source: 'detailMigration', pattern: /get_war_room_variant_detail\(\s*p_user_id uuid,\s*p_variant_id uuid\s*\)/ },
  { name: '45 详情 RPC 校验 variant 非空', source: 'detailMigration', pattern: /p_variant_id IS NULL/ },
  { name: '46 详情权限仍以可见 inventory 仓为准', source: 'detailMigration', pattern: /FROM public\.inventory inventory[\s\S]*inventory\.variant_id = p_variant_id/ },
  { name: '47 详情逐仓调用 P1 主 RPC', source: 'detailMigration', pattern: /get_replenishment_suggestions\(/ },
  { name: '48 P1 调用同时指定 variant 与 warehouse', source: 'detailMigration', pattern: /p_variant_id := p_variant_id,[\s\S]*p_warehouse_id := v_warehouse_id/ },
  { name: '49 P1 调用 include_zero=true', source: 'detailMigration', pattern: /p_include_zero := true/ },
  { name: '50 P1 调用限定一行', source: 'detailMigration', pattern: /p_page := 1,[\s\S]*p_page_size := 1/ },
  { name: '51 P1 缺行触发受控异常', source: 'detailMigration', pattern: /jsonb_array_length[\s\S]*补货建议数据契约异常/ },
  { name: '52 详情不复制 ROUND 行动公式', source: 'detailMigration', pattern: /ROUND\s*\(/i, absent: true },
  { name: '53 详情不复制 target-stock 差值公式', source: 'detailMigration', pattern: /target_stock\s*-/i, absent: true },
  { name: '54 P1 urgency 映射为 replenishment_urgency', source: 'detailMigration', pattern: /'replenishment_urgency', replenishment ->> 'urgency'/ },
  { name: '55 P7 stockout urgency 独立推导', source: 'detailMigration', pattern: /'stockout_urgency', CASE/ },
  { name: '56 顶层类型不含 suggestQty', source: 'types', pattern: /interface ProductVariantDetail \{[\s\S]*?suggestQty:/, absent: true },
  { name: '57 列表 Server Component 使用 active auth', source: 'page', pattern: /requireActiveAuth\(\)/ },
  { name: '58 列表首屏直接调用 Repository', source: 'page', pattern: /getProductOverview\(user\.id, filters\)/ },
  { name: '59 详情 Action 服务端取得 user.id', source: 'actions', pattern: /requireActiveAuth\(\)[\s\S]*getProductVariantDetail\(\s*user\.id/ },
  { name: '60 客户端页面与弹窗不直连 Supabase', source: 'pageUi', pattern: /supabase|createClient|\.rpc\(/, absent: true },
  { name: '61 侧边栏开放全球库存作战室', source: 'sidebar', pattern: /\/dashboard\/products\/overview.*全球库存作战室/ },
];

describe('P7 全球库存作战室 — 61 项结构、安全与契约测试', () => {
  expect(checks).toHaveLength(61);
  for (const check of checks) {
    it(check.name, () => {
      if (check.absent) {
        expect(sources[check.source]).not.toMatch(check.pattern);
      } else {
        expect(sources[check.source]).toMatch(check.pattern);
      }
    });
  }
});
