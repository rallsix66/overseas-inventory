// P5-SY12D: Dashboard 关注区测试（阶段 D — 运营可用性收口）
//
// 验证:
// - Dashboard page 数据获取链路（Repository Pattern）
// - FollowedProductsSection 客户端组件：筛选/跳转/未匹配说明/空状态
// - 阶段 C 动态告警规则保留（alertLevel/alertReason）
// - 关注不影响同步链路
// - 禁止 any

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');
const COMPONENT_PATH = path.resolve(
  process.cwd(),
  'src/features/preferences/components/followed-products-section.tsx'
);
const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/inventory/actions.ts');

// ─── Dashboard page 数据获取链路 ──────────────────────────────────────

describe('P5-SY12D — Dashboard 数据获取链路', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
  });

  it('Dashboard 导入 preferencesRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/preferences\/repository['"]/);
  });

  it('Dashboard 调用 getFollowedVariantsBasic', () => {
    expect(src).toMatch(/getFollowedVariantsBasic/);
  });

  it('Dashboard 导入 FollowedProductsSection 客户端组件', () => {
    expect(src).toMatch(/from ['"]@\/features\/preferences\/components\/followed-products-section['"]/);
  });

  it('Dashboard 渲染 FollowedProductsSection 传递 variants + error props', () => {
    expect(src).toMatch(/<FollowedProductsSection\s+variants=/);
    expect(src).toMatch(/error=/);
  });

  it('Dashboard 使用 force-dynamic 防止静态预渲染缓存', () => {
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('Dashboard page 不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });

  it('Dashboard 通过通用 LoadResult 保留关注区错误状态', () => {
    expect(src).toMatch(/interface LoadResult<T>[\s\S]*error: string \| null/);
    expect(src).toContain('followedResult.error');
  });
});

// ─── FollowedProductsSection 组件源码检查 ─────────────────────────────

describe('P5-SY12D — FollowedProductsSection 组件', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(COMPONENT_PATH, 'utf-8');
  });

  it('组件标记为 Client Component (use client)', () => {
    expect(src).toMatch(/'use client'/);
  });

  it('组件显示"关注产品动态"标题', () => {
    expect(src).toContain('关注产品动态');
  });

  // ── 空状态 ──────────────────────────────────────────────────────

  it('空关注状态显示"暂无关注产品"', () => {
    expect(src).toContain('暂无关注产品');
  });

  it('空关注状态引导"在海外库存列表中点击星标关注您关心的 SKU"', () => {
    expect(src).toContain('星标关注您关心的 SKU');
  });

  it('查询失败显示"关注产品加载失败"', () => {
    expect(src).toContain('关注产品加载失败');
  });

  // ── 筛选 ────────────────────────────────────────────────────────

  it('包含全部 5 种筛选选项：全部/紧急/低库存/正常/数据不足', () => {
    expect(src).toContain("'all'");
    expect(src).toContain("'critical'");
    expect(src).toContain("'warning'");
    expect(src).toContain("'normal'");
    expect(src).toContain("'unknown'");
  });

  it('筛选使用 useState 管理 AlertFilter 状态', () => {
    expect(src).toMatch(/useState<AlertFilter>\('all'\)/);
  });

  it('筛选标签显示各状态计数', () => {
    expect(src).toMatch(/getFilterCount/);
  });

  it('筛选无结果时显示"当前筛选条件下无匹配的关注产品"', () => {
    expect(src).toContain('当前筛选条件下无匹配的关注产品');
  });

  it('筛选无结果时提供"查看全部"重置按钮', () => {
    expect(src).toContain('查看全部');
    expect(src).toMatch(/setFilter\('all'\)/);
  });

  // ── 表格列 ──────────────────────────────────────────────────────

  it('表格包含日销/可售天数/补货周期列（阶段 C）', () => {
    expect(src).toMatch(/日销/);
    expect(src).toMatch(/可售天数/);
    expect(src).toMatch(/补货周期/);
  });

  it('表格包含操作列（跳转入口）', () => {
    expect(src).toContain('aria-label="操作"');
  });

  // ── 状态 badge ──────────────────────────────────────────────────

  it('包含 alertLevel 状态 badge（紧急/低库存/正常/数据不足）', () => {
    expect(src).toMatch(/alertLevel === 'critical'/);
    expect(src).toMatch(/alertLevel === 'warning'/);
    expect(src).toMatch(/alertLevel === 'unknown'/);
    expect(src).toContain('紧急');
    expect(src).toContain('低库存');
    expect(src).toContain('数据不足');
    expect(src).toContain('正常');
  });

  // ── 跳转入口 ────────────────────────────────────────────────────

  it('每行包含跳转到海外库存的 ExternalLink 链接', () => {
    expect(src).toMatch(/\/dashboard\/inventory\/overseas\?search=/);
    expect(src).toMatch(/encodeURIComponent\(v\.sku\)/);
    expect(src).toContain('ExternalLink');
  });

  it('跳转链接使用 title 提示"在海外库存中查看该 SKU"', () => {
    expect(src).toContain('在海外库存中查看该 SKU');
  });

  // ── 未匹配说明 ──────────────────────────────────────────────────

  it('未匹配 SKU 显示"(未匹配)"标签', () => {
    expect(src).toContain('(未匹配)');
    expect(src).toMatch(/isUnmatched/);
  });

  it('未匹配标签包含 UNMATCHED_HINT 提示', () => {
    expect(src).toContain('UNMATCHED_HINT');
    expect(src).toContain('该 SKU 未匹配产品，不参与安全库存判断。仍可通过预计可售天数进行动态告警。');
  });

  it('数据不足 + 未匹配状态 badge 旁显示"?"辅助图标', () => {
    expect(src).toContain('?');
  });

  // ── 告警摘要 ────────────────────────────────────────────────────

  it('包含 alertReason 告警摘要条', () => {
    expect(src).toMatch(/alertReason/);
    expect(src).toMatch(/AlertTriangle/);
  });

  it('告警摘要条使用 visibleAlertItems（筛选后结果）而非全量计数', () => {
    // visibleAlertItems 从 filtered 而非 variants 计算
    expect(src).toMatch(/visibleAlertItems/);
    // 摘要条显示条件：visibleAlertItems.length > 0
    expect(src).toMatch(/visibleAlertItems\.length\s*===\s*0/);
    // "等 N 项"使用 visibleAlertItems.length
    expect(src).toMatch(/visibleAlertItems\.length\s*>\s*3/);
    // 摘要条不再使用 criticalCount + warningCount 判断显示
    expect(src).not.toMatch(/criticalCount\s*\+\s*warningCount\s*>\s*0/);
  });

  // ── TypeScript ──────────────────────────────────────────────────

  it('组件不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 阶段 C 动态告警规则保留验证 ──────────────────────────────────────

describe('P5-SY12D — 阶段 C 动态告警规则保留', () => {
  it('repository getFollowedVariantsBasic 保留动态告警规则', () => {
    const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toMatch(/阶段 C/);
    expect(repoSrc).toMatch(/daily_sales/);
    expect(repoSrc).toMatch(/estimated_days/);
    expect(repoSrc).toMatch(/lead_time_days/);
  });

  it('组件 alertLevel 使用阶段 C 动态告警数据', () => {
    const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    expect(src).toMatch(/estimatedDays/);
    expect(src).toMatch(/leadTimeDays/);
    expect(src).toMatch(/dailySales/);
  });
});

// ─── Dashboard 关注区查询路径 ──────────────────────────────────────────

describe('P5-SY12D — Dashboard 关注区查询路径', () => {
  const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
  const repoSrc = fs.readFileSync(repoPath, 'utf-8');

  it('先读取 favorited variant_id，再从 inventory 正向查询库存行', () => {
    expect(repoSrc).toMatch(/getFavoritedVariantIds\(userId\)/);
    expect(repoSrc).toMatch(/\.from\('inventory'\)/);
    expect(repoSrc).toMatch(/\.in\('variant_id'/);
  });

  it('Dashboard 查询不依赖 user_variant_preference 反向嵌套 inventory', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).not.toMatch(/from\('user_variant_preference'\)[\s\S]*inventory:inventory/);
  });

  it('getFollowedVariantsBasic warehouse 使用 !inner join 确保类型安全', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).toMatch(/warehouse:warehouse_id!inner/);
  });

  it('getFollowedVariantsBasic 防御式处理 warehouse 为 null', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).toContain("wh?.name ?? '未知仓库'");
  });
});

// ─── 关注不影响同步 ─────────────────────────────────────────────────────

describe('P5-SY12D — 关注不影响同步链路', () => {
  it('inventory/actions.ts 不引用 preferencesRepository', () => {
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    expect(actionsSrc).not.toMatch(/from ['"]@\/features\/preferences\/repository['"]/);
    expect(actionsSrc).not.toMatch(/toggleFavoriteAction/);
    expect(actionsSrc).not.toMatch(/\.favorite\(|\.unfavorite\(|\.toggleFavorite\(/);
  });
});

// ─── product 为 null 时不丢弃关注项（防回归） ─────────────────────────

describe('P5-SY12D — product null 关注项不丢弃', () => {
  const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
  const repoSrc = fs.readFileSync(repoPath, 'utf-8');

  it('product 为 null 时不会 continue 跳过', () => {
    expect(repoSrc).not.toMatch(/if \(!product\) continue/);
  });

  it('productName 使用 product?.name ?? variant.sku ?? fallback 链', () => {
    expect(repoSrc).toMatch(/productName\s*=\s*product\?\.name\s*\?\?\s*variant\.sku/);
  });

  it('isLowStock 仅在 product 存在时判断', () => {
    expect(repoSrc).toMatch(/isLowStock\s*=\s*product\s*\?\s*qty\s*<\s*safetyStock\s*:\s*false/);
  });

  it('variant select 包含 sku / match_status 字段', () => {
    expect(repoSrc).toMatch(/variant:variant_id!inner\s*\(id,\s*sku,\s*match_status,\s*country/);
  });
});

// ─── FollowedVariantBasic 类型 ─────────────────────────────────────────

describe('P5-SY12D — FollowedVariantBasic 类型', () => {
  it('包含阶段 C 动态告警字段', () => {
    const typesPath = path.resolve(process.cwd(), 'src/features/preferences/types.ts');
    const typesSrc = fs.readFileSync(typesPath, 'utf-8');
    expect(typesSrc).toMatch(/sku:\s*string/);
    expect(typesSrc).toMatch(/isUnmatched:\s*boolean/);
    expect(typesSrc).toMatch(/dailySales:\s*number \| null/);
    expect(typesSrc).toMatch(/estimatedDays:\s*number \| null/);
    expect(typesSrc).toMatch(/leadTimeDays:\s*number \| null/);
    expect(typesSrc).toMatch(/alertLevel:\s*'critical' \| 'warning' \| 'normal' \| 'unknown'/);
    expect(typesSrc).toMatch(/alertReason:\s*string \| null/);
  });
});

// ─── 海外库存关注排序 ─────────────────────────────────────────────────

describe('P5-SY12D — 海外库存关注排序', () => {
  const invRepoPath = path.resolve(process.cwd(), 'src/features/inventory/repository.ts');
  const invRepoSrc = fs.readFileSync(invRepoPath, 'utf-8');

  it('getOverseasList — PERF-S1B: 排序/分页由 RPC SQL 层完成', () => {
    const fnBodyMatch = invRepoSrc.match(/async getOverseasList\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBodyMatch).not.toBeNull();
    const fnBody = fnBodyMatch![0];
    // 不再有 JS items.sort() 和 items.slice()
    expect(fnBody).not.toMatch(/items\.sort/);
    expect(fnBody).not.toMatch(/items\.slice/);
  });

  it('getOverseasList — 关注置顶排序由 RPC ORDER BY 保障', () => {
    // 迁移 00027 RPC 内置 ORDER BY is_favorited DESC, quantity ASC
    const fnBodyMatch = invRepoSrc.match(/async getOverseasList\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBodyMatch).not.toBeNull();
    const fnBody = fnBodyMatch![0];
    expect(fnBody).toMatch(/\.rpc\(['"]get_overseas_inventory['"]/);
  });
});
