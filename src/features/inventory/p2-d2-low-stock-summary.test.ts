// P2-D2: Dashboard 低库存汇总 — 测试
// 覆盖：Dashboard 数据获取链路、组件结构、空状态/错误状态、仓库分组、
//        SKU 跳转链接、MAX_DISPLAY 控制、关注与低库存隔离、架构合规
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf-8');
}

// ─── 1. Dashboard 数据获取链路 ──────────────────────────────────

describe('P2-D2 — Dashboard 低库存数据获取', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/page.tsx');
  });

  it('Dashboard 导入 LowStockSummarySection 组件', () => {
    expect(page).toContain('LowStockSummarySection');
    expect(page).toContain("from './_components/low-stock-summary-section'");
  });

  it('Dashboard 导入 LowStockSummaryItem 类型', () => {
    expect(page).toContain('LowStockSummaryItem');
  });

  it('Dashboard 调用 inventoryRepository.getLowStock（LOW-STOCK-PAGINATION 对象参数）', () => {
    expect(page).toContain('getLowStock');
    expect(page).toContain("from '@/features/inventory/repository'");
    // 新签名：getLowStock({ userId: user.id })
    expect(page).toMatch(/getLowStock\s*\(\s*\{/);
    expect(page).toMatch(/userId:\s*user\.id/);
  });

  it('getLowStock 失败不崩溃 Dashboard', () => {
    expect(page).toContain('lowStockError');
    // .catch() 返回结构化结果 { data, error }，Promise.all 之后赋值 lowStockError
    expect(page).toContain("'低库存数据加载失败'");
    expect(page).toContain('lowStockError = lsResult.error');
  });

  it('未登录（无 user.id）时不调用 getLowStock', () => {
    // getLowStock 调用仅发生在 if (user?.id) 内
    const body = page;
    expect(body).toContain('if (user?.id)');
  });

  it('gap 计算为 Math.max(safetyStock - quantity, 0)，非负', () => {
    expect(page).toContain('Math.max(item.safetyStock - item.quantity, 0)');
  });

  it('按缺口降序、库存升序排序', () => {
    // b.gap - a.gap（缺口大优先），a.quantity - b.quantity（库存小优先）
    expect(page).toContain('b.gap - a.gap');
    expect(page).toContain('a.quantity - b.quantity');
  });

  it('lowStockError 为 null 时不传 error prop', () => {
    // 检查 JSX 中 <LowStockSummarySection items={lowStockItems} error={lowStockError} />
    expect(page).toContain('<LowStockSummarySection');
    expect(page).toContain('items={lowStockItems}');
    expect(page).toContain('error={lowStockError}');
  });
});

// ─── 2. LowStockSummarySection 组件结构 ───────────────────────────

describe('P2-D2 — LowStockSummarySection 组件结构', () => {
  let component: string;

  beforeAll(() => {
    component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
  });

  it('组件为 Client Component（use client 声明）', () => {
    expect(component).toContain("'use client'");
  });

  it('导出 LowStockSummaryItem 接口', () => {
    expect(component).toContain('export interface LowStockSummaryItem');
  });

  it('导出 LowStockSummarySection 函数组件', () => {
    expect(component).toContain('export function LowStockSummarySection');
  });

  it('Props 包含 items: LowStockSummaryItem[] 和 error?: string | null', () => {
    expect(component).toContain('items: LowStockSummaryItem[]');
    expect(component).toContain('error?: string | null');
  });

  it('定义 MAX_DISPLAY 常量控制展示数量', () => {
    expect(component).toContain('MAX_DISPLAY');
    expect(component).toContain('= 15');
  });

  it('不导入 supabase / createClient / service_role', () => {
    expect(component).not.toMatch(/supabase\.from\(/);
    expect(component).not.toMatch(/supabase\.rpc\(/);
    expect(component).not.toContain('createClient');
    expect(component).not.toContain('service_role');
    expect(component).not.toContain('createServiceClient');
  });

  it('不导入 inventoryRepository / preferencesRepository / shipmentRepository', () => {
    expect(component).not.toContain('Repository');
  });

  it('不导入 Server Actions', () => {
    expect(component).not.toContain("from '@/features/");
    expect(component).not.toContain("'@/features/inventory/actions'");
    expect(component).not.toContain("'@/features/preferences/actions'");
  });

  it('使用 shadcn/ui Table 组件', () => {
    expect(component).toContain('@/components/ui/table');
    expect(component).toContain('<Table');
    expect(component).toContain('<TableHeader');
    expect(component).toContain('<TableBody');
  });
});

// ─── 3. 空状态与错误状态 ─────────────────────────────────────────

describe('P2-D2 — 空状态与错误状态', () => {
  let component: string;

  beforeAll(() => {
    component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
  });

  it('error 存在时渲染错误区块（红色边框）', () => {
    expect(component).toContain('if (error)');
    expect(component).toContain('border-red-200');
    expect(component).toContain('低库存数据加载失败');
  });

  it('items 为空时渲染库存正常区块（绿色边框）', () => {
    // items.length === 0 而非 !items
    expect(component).toContain('items.length === 0');
    expect(component).toContain('border-green-200');
    expect(component).toContain('库存正常');
    expect(component).toContain('当前所有海外仓库存均高于安全库存线');
  });

  it('items > 0 时渲染低库存列表', () => {
    expect(component).toContain('低库存汇总');
    // 红色告警图标
    expect(component).toContain('AlertTriangle');
    expect(component).toContain('text-red-500');
  });

  it('还有 N 项剩余时显示提示文案', () => {
    expect(component).toContain('remaining > 0');
    expect(component).toContain('还有');
    expect(component).toContain('项未展示');
    expect(component).toContain('查看全部低库存');
  });
});

// ─── 4. 仓库分组 ─────────────────────────────────────────────────

describe('P2-D2 — 仓库分组', () => {
  let component: string;

  beforeAll(() => {
    component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
  });

  it('定义 groupByWarehouse 函数按 warehouseId 分组', () => {
    expect(component).toContain('function groupByWarehouse');
    expect(component).toContain('warehouseId');
  });

  it('每组显示仓库名 + 国家 + 项数', () => {
    expect(component).toContain('低库存');
    expect(component).toContain('group.country');
    expect(component).toContain('group.name');
  });

  it('表格列包含 SKU / 产品 / 库存 / 安全库存 / 缺口', () => {
    expect(component).toContain('SKU');
    expect(component).toContain('产品');
    // Rendered in table header as "安全库存" text
  });

  it('缺口列使用红色字体（text-red-600）', () => {
    expect(component).toContain('text-red-600');
  });
});

// ─── 5. SKU 跳转链接 ─────────────────────────────────────────────

describe('P2-D2 — SKU 跳转链接', () => {
  let component: string;

  beforeAll(() => {
    component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
  });

  it('SKU 链接到海外库存页 search 参数', () => {
    expect(component).toContain('/dashboard/inventory/overseas?search=');
    expect(component).toContain('encodeURIComponent(item.sku)');
  });

  it('区块顶部"查看全部"链接到海外库存低库存筛选', () => {
    expect(component).toContain('/dashboard/inventory/overseas?stockStatus=low');
  });

  it('"还有 N 项"也链接到海外库存低库存筛选', () => {
    // remaining > 0 分支内含 Link to /dashboard/inventory/overseas?stockStatus=low
    const remainingSection = component.slice(component.indexOf('remaining > 0'));
    expect(remainingSection).toContain('/dashboard/inventory/overseas?stockStatus=low');
  });

  it('不包含 router.refresh 或 useRouter', () => {
    expect(component).not.toMatch(/router\.refresh\(\)/);
    expect(component).not.toContain("from 'next/navigation'");
  });
});

// ─── 6. 关注与低库存隔离 ─────────────────────────────────────────

describe('P2-D2 — 关注与低库存隔离', () => {
  let page: string;
  let component: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/page.tsx');
    component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
  });

  it('Dashboard 中 getLowStock 和 getFollowedVariantsBasic 各自有独立错误处理', () => {
    // PERF-C1: 两者在同一个 Promise.all 中并行执行，各自通过 .then()+.catch() 返回结构化结果
    // getLowStock 失败 → lsResult.error 赋值给 lowStockError
    // getFollowedVariantsBasic 失败 → fvResult.error 赋值给 followedError
    const lowStockIdx = page.indexOf('getLowStock');
    const followedIdx = page.indexOf('getFollowedVariantsBasic');
    expect(lowStockIdx).toBeGreaterThan(0);
    expect(followedIdx).toBeGreaterThan(0);
    // Promise.all 确保并行执行
    expect(page).toContain('Promise.all');
    // 每个查询有独立的 .catch() 返回结构化结果
    expect(page).toContain('followedError = fvResult.error');
    expect(page).toContain('lowStockError = lsResult.error');
  });

  it('LowStockSummarySection 不引用 FollowedProductsSection', () => {
    expect(component).not.toContain('FollowedProductsSection');
  });

  it('LowStockSummarySection 不引用 preferencesRepository 或关注相关类型', () => {
    expect(component).not.toContain('favorited');
    expect(component).not.toContain('followed');
    expect(component).not.toContain('preferences');
    expect(component).not.toContain('isFavorited');
  });

  it('LowStockSummarySection 不导入 user_variant_preference 相关', () => {
    expect(component).not.toContain('user_variant_preference');
  });
});

// ─── 7. 架构合规 ─────────────────────────────────────────────────

describe('P2-D2 — 架构合规', () => {
  it('page.tsx 不新增 supabase.from / supabase.rpc 调用', () => {
    const page = readSrc('app/dashboard/page.tsx');
    // 检查 incidences: 应该为 0
    const matches = page.match(/supabase\.(from|rpc)\(/g);
    expect(matches).toBeNull();
  });

  it('page.tsx 不新增 createServiceClient import', () => {
    const page = readSrc('app/dashboard/page.tsx');
    expect(page).not.toContain('createServiceClient');
  });

  it('组件不调用 auth.admin', () => {
    const component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
    expect(component).not.toContain('auth.admin');
  });

  it('不新增 any 类型（排除注释）', () => {
    const component = readSrc('app/dashboard/_components/low-stock-summary-section.tsx');
    // 查找 // 注释行之外的 any
    const codeOnly = component.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/:\s*any\b/);
  });

  it('不修改 Migration / RLS / Server Actions', () => {
    // 仅验证本任务不涉足迁移或权限文件
    const page = readSrc('app/dashboard/page.tsx');
    expect(page).not.toContain('Migration');
    expect(page).not.toContain('RLS');
    expect(page).not.toContain('updateUserRole');
    expect(page).not.toContain('toggleUserActive');
  });
});

// ─── 8. P5-SY12D 回归 — 关注产品动态不受影响 ──────────────────────

describe('P2-D2 — 不破坏 P5-SY12D 关注产品动态', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/page.tsx');
  });

  it('仍导入 FollowedProductsSection', () => {
    expect(page).toContain('FollowedProductsSection');
    expect(page).toContain("from '@/features/preferences/components/followed-products-section'");
  });

  it('仍导入 FollowedVariantBasic 类型', () => {
    expect(page).toContain('FollowedVariantBasic');
  });

  it('仍调用 getFollowedVariantsBasic', () => {
    expect(page).toContain('getFollowedVariantsBasic');
  });

  it('仍注入 inTransitQuantity 到关注产品行', () => {
    expect(page).toContain('v.inTransitQuantity = inTransitMap.get(v.variantId)');
  });

  it('仍在 JSX 中渲染 FollowedProductsSection', () => {
    expect(page).toContain('<FollowedProductsSection');
    expect(page).toContain('variants={followedVariants}');
    expect(page).toContain('error={followedError}');
  });
});

// ─── PERF-C1: Dashboard 首页查询并行编排 ───────────────────────────

describe('PERF-C1 — Dashboard 首页并行查询', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/page.tsx');
  });

  it('使用 Promise.all 并行执行独立查询', () => {
    expect(page).toContain('Promise.all');
  });

  it('getOverseasStats 在 Promise.all 中，.catch(() => undefined) 静默失败', () => {
    // overseas stats 失败不设错误状态，返回 undefined
    expect(page).toMatch(/getOverseasStats\(user\.id\)\s*\.catch\s*\(\s*\(\)\s*=>\s*undefined\s*\)/);
  });

  it('getInTransitByVariant 在 Promise.all 中，.catch(() => new Map()) 静默失败', () => {
    // 在途数据获取失败返回空 Map，不设错误变量
    expect(page).toMatch(/getInTransitByVariant\(user\.id\)\s*\.catch\s*\(/);
  });

  it('getFollowedVariantsBasic 在 Promise.all 中，.catch() 返回结构化结果，Promise.all 后赋值 followedError', () => {
    // .then()+.catch() 返回 { data, error }，不再在 .catch() 内修改外层变量
    expect(page).toContain('getFollowedVariantsBasic(user.id)');
    expect(page).toContain("'关注产品加载失败'");
    expect(page).toContain('followedError = fvResult.error');
  });

  it('getLowStock 在 Promise.all 中，.catch() 返回结构化结果，Promise.all 后赋值 lowStockError', () => {
    // .then()+.catch() 返回 { data, error }，不再在 .catch() 内修改外层变量
    expect(page).toContain('getLowStock');
    expect(page).toContain("'低库存数据加载失败'");
    expect(page).toContain('lowStockError = lsResult.error');
  });

  it('四个查询的 .catch() 各自独立，错误互不传播', () => {
    // 每个 .catch() 设置自己的错误变量或返回默认值
    // overseas stats → undefined（无错误变量）
    // in-transit → new Map()（无错误变量）
    // followed → followedError
    // low stock → lowStockError
    expect(page).toContain('followedError');
    expect(page).toContain('lowStockError');
    // 不存在一个统一的 catch 块吞掉所有错误
  });

  it('inTransitQuantity 注入在 Promise.all 之后执行（保持字段语义）', () => {
    // followedVariants 和 inTransitMap 都可用后才注入
    const promiseAllIdx = page.indexOf('Promise.all');
    const injectIdx = page.indexOf('v.inTransitQuantity');
    expect(promiseAllIdx).toBeGreaterThan(0);
    expect(injectIdx).toBeGreaterThan(promiseAllIdx);
  });

  it('lowStockItems map + sort 在 Promise.all 之后执行', () => {
    const promiseAllIdx = page.indexOf('Promise.all');
    const mapIdx = page.indexOf('Math.max(item.safetyStock');
    expect(promiseAllIdx).toBeGreaterThan(0);
    expect(mapIdx).toBeGreaterThan(promiseAllIdx);
  });

  it('未登录时仅调用 getOverseasStats，不调用依赖 user.id 的三个查询', () => {
    // else 分支：无 user.id 时只调 overseasStats
    // 使用 } else { 精确定位 else 分支（而非 else 关键字）
    const elseIdx = page.indexOf('} else {');
    expect(elseIdx).toBeGreaterThan(0);
    const elseBlock = page.slice(elseIdx);
    expect(elseBlock).toContain('getOverseasStats');
    expect(elseBlock).not.toContain('getInTransitByVariant');
    expect(elseBlock).not.toContain('getFollowedVariantsBasic');
    expect(elseBlock).not.toContain('getLowStock');
  });

  it('user.id 存在时不使用串行 await（四个查询在单个 Promise.all 内）', () => {
    // 确认未对四个查询使用独立的 await xxxRepository.xxx 串行调用
    // 注意：getOverseasStats 在 else 分支（无 user.id 时）仍有单独 await，属预期行为
    expect(page).toContain('Promise.all');
    expect(page).not.toMatch(/\bawait\s+shipmentRepository\.getInTransitByVariant\b/);
    expect(page).not.toMatch(/\bawait\s+preferencesRepository\.getFollowedVariantsBasic\b/);
    expect(page).not.toMatch(/\bawait\s+inventoryRepository\.getLowStock\b/);
  });
});

// ─── LOW-STOCK-PAGINATION — repository.ts getLowStock RPC 调用 ───────

describe('LOW-STOCK-PAGINATION — inventoryRepository.getLowStock RPC 实现', () => {
  const REPO_PATH = resolve(process.cwd(), 'src/features/inventory/repository.ts');
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = readFileSync(REPO_PATH, 'utf-8');
  });

  // 提取 getLowStock 函数体（到下一个 async 方法开始之前）
  function getLowStockBody(): string {
    const fnStart = repoSrc.indexOf('getLowStock');
    const fnEnd = repoSrc.indexOf('getByProductId', fnStart);
    return repoSrc.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
  }

  it('getLowStock 参数为对象解构 { userId, limit }', () => {
    expect(repoSrc).toMatch(/getLowStock\s*\(\s*params/);
    const fnBody = getLowStockBody();
    expect(fnBody).toContain('userId');
    expect(fnBody).toContain('limit');
  });

  it('默认 limit = 50', () => {
    expect(repoSrc).toContain('limit = 50');
  });

  it('调用 supabase.rpc(\'get_low_stock\') 而非 PostgREST .from().select()', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).toContain("supabase.rpc('get_low_stock'");
    expect(fnBody).toContain('p_user_id');
    expect(fnBody).toContain('p_limit');
    // 不应再使用 .from('inventory') 全量查询
    expect(fnBody).not.toMatch(/\.from\(['"]inventory['"]\)/);
  });

  it('不再使用 .order() + .limit() PostgREST 链式调用', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).not.toMatch(/\.order\(/);
    expect(fnBody).not.toMatch(/\.limit\(/);
  });

  it('不再 JS 层过滤 quantity <= safetyStock（已下沉 RPC）', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).not.toMatch(/quantity\s*<=\s*\w+\.safetyStock/);
  });

  it('不再调用 getUserArchivedVariantIds（归档排除已下沉 RPC）', () => {
    expect(repoSrc).not.toContain('getUserArchivedVariantIds');
  });

  it('不再 import warehouseAccessRepository（仓库隔离已下沉 RPC）', () => {
    expect(repoSrc).not.toContain('warehouseAccessRepository');
  });

  it('使用 mapOverseasRow 映射 RPC 返回行', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).toContain('mapOverseasRow');
  });

  it('!userId 时提前返回 []（不调用 RPC）', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).toContain('if (!userId)');
    expect(fnBody).toContain('return []');
  });

  it('getLowStock 返回类型为 Promise<InventoryItem[]>（非 PaginatedResult）', () => {
    const fnBody = getLowStockBody();
    expect(fnBody).toMatch(/Promise<InventoryItem\[\]>/);
    expect(fnBody).not.toMatch(/PaginatedResult/);
  });
});
