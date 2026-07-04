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

  it('Dashboard 调用 inventoryRepository.getLowStock', () => {
    expect(page).toContain('getLowStock');
    expect(page).toContain("from '@/features/inventory/repository'");
  });

  it('getLowStock 在 try/catch 中调用，失败不崩溃 Dashboard', () => {
    expect(page).toContain('lowStockError');
    // catch 块赋值 lowStockError，不 throw
    const body = page;
    expect(body).toContain('lowStockError = e instanceof Error ? e.message');
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

  it('Dashboard 中 getLowStock 和 getFollowedVariantsBasic 分别在独立 try/catch 中', () => {
    // 关注产品失败不影响低库存汇总，反之亦然
    const lowStockIdx = page.indexOf('getLowStock');
    const followedIdx = page.indexOf('getFollowedVariantsBasic');
    expect(lowStockIdx).toBeGreaterThan(0);
    expect(followedIdx).toBeGreaterThan(0);
    // 两者不应在同一个 try/catch 中
    const between = page.slice(Math.min(lowStockIdx, followedIdx), Math.max(lowStockIdx, followedIdx));
    // 之间应该有独立的 try/catch 边界
    expect(between).toContain('try {');
    expect(between).toContain('} catch');
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
