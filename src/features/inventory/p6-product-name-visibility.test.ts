// P6-OVERSEAS-PRODUCT-NAME-VISIBILITY — 海外库存产品名称显示修正 源码级测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');
const repoSrc = readSrc('src/features/inventory/repository.ts');

// ─── 1. 表头列顺序 ────────────────────────────────────────────────────────

describe('P6-PRODUCT-NAME: 表头列顺序', () => {
  it('表头列顺序：国家 → 仓库 → 产品名称 → SKU → ...', () => {
    // 提取所有 <TableHead> 标签内容（不含子标签）
    const heads = contentSrc.match(/<TableHead[^>]*>([\s\S]*?)<\/TableHead>/g);
    expect(heads).not.toBeNull();
    const labels = heads!.map((h) => {
      const match = h.match(/<TableHead[^>]*>([\s\S]*?)<\/TableHead>/);
      return match ? match[1].trim() : '';
    }).filter(Boolean);

    // 找到"国家"、"仓库"、"产品名称"、"SKU"的索引位置
    const idxCountry = labels.findIndex((l) => l === '国家');
    const idxWarehouse = labels.findIndex((l) => l === '仓库');
    const idxProductName = labels.findIndex((l) => l === '产品名称');
    const idxSku = labels.findIndex((l) => l === 'SKU');

    expect(idxCountry).toBeGreaterThanOrEqual(0);
    expect(idxWarehouse).toBeGreaterThanOrEqual(0);
    expect(idxProductName).toBeGreaterThanOrEqual(0);
    expect(idxSku).toBeGreaterThanOrEqual(0);

    // 产品名称必须在 SKU 前面
    expect(idxProductName).toBeLessThan(idxSku);
    // 仓库在 SKU 前面
    expect(idxWarehouse).toBeLessThan(idxSku);
  });

  it('表头仍为 12 列（P6 移除已确认到仓，列数未增减）', () => {
    const headMatches = contentSrc.match(/<TableHead[\s>]/g);
    expect(headMatches).not.toBeNull();
    expect(headMatches!.length).toBe(12);
  });

  it('产品名称列头存在', () => {
    expect(contentSrc).toMatch(/<TableHead[^>]*>产品名称<\/TableHead>/);
  });

  it('SKU 列头存在且在 <TableHead> 中出现', () => {
    expect(contentSrc).toMatch(/<TableHead[^>]*>SKU<\/TableHead>/);
  });
});

// ─── 2. productName 显示逻辑 ──────────────────────────────────────────────

describe('P6-PRODUCT-NAME: productName 显示逻辑', () => {
  it('productName 有值时直接渲染 item.productName', () => {
    // 三元表达式：item.productName ? ... item.productName ... :
    // JSX 可能跨行，用 [\s\S] 匹配
    expect(contentSrc).toMatch(/item\.productName\s*\?[\s\S]*?item\.productName/);
  });

  it('productName 为空时显示"未匹配产品"文字', () => {
    expect(contentSrc).toMatch(/未匹配产品/);
  });

  it('productName 为空时显示"未匹配" Badge', () => {
    // 应该有一个 "未匹配" 的 Badge 标记
    // 查找 "未匹配" 在 Badge 上下文中（bg-yellow-50 text-yellow-700）
    expect(contentSrc).toMatch(/bg-yellow-50 text-yellow-700/);
  });

  it('productName 为空时的 fallback 不在同一处重复"未匹配"作为文字', () => {
    // "未匹配产品" 文本 + "未匹配" Badge 是两种不同的展示（完整中文短语 + 标签）
    // 验证两者同时出现（不是只有旧的 "未匹配" 灰色文字）
    const hasUnmatchedProduct = contentSrc.includes('未匹配产品');
    const hasYellowBadge = /bg-yellow-50/.test(contentSrc) && /text-yellow-700/.test(contentSrc);
    expect(hasUnmatchedProduct).toBe(true);
    expect(hasYellowBadge).toBe(true);
  });

  it('productName 列使用 truncate 防止撑破表格', () => {
    // productName 渲染的 TableCell 必须有 truncate class
    // 在三元表达式之前的 TableCell 包含 truncate
    expect(contentSrc).toMatch(/max-w-\[180px\]\s+truncate/);
  });

  it('SKU 列使用 font-mono 样式', () => {
    // SKU 单元格保持等宽字体
    const skuCells = contentSrc.match(/font-mono text-xs.*\{item\.sku\}/g);
    expect(skuCells).not.toBeNull();
    expect(skuCells!.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 3. Repository 映射 ───────────────────────────────────────────────────

describe('P6-PRODUCT-NAME: Repository product_name → productName 映射', () => {
  it('mapOverseasRow 正确映射 product_name → productName', () => {
    expect(repoSrc).toMatch(/productName:\s*row\.product_name\s*\?\?\s*null/);
  });

  it('mapOverseasRow 映射 product_code → productCode', () => {
    expect(repoSrc).toMatch(/productCode:\s*row\.product_code\s*\?\?\s*null/);
  });

  it('getOverseasList 返回类型包含 productName 字段', () => {
    // RawOverseasInventoryRow 包含 product_name
    expect(repoSrc).toMatch(/product_name:\s*string\s*\|\s*null/);
  });

  it('mapOverseasRow 未丢失其他关键字段', () => {
    // 确保重构 Column 顺序时没有意外丢失其他字段映射
    expect(repoSrc).toMatch(/id:\s*row\.id/);
    expect(repoSrc).toMatch(/variantId:\s*row\.variant_id/);
    expect(repoSrc).toMatch(/sku:\s*row\.sku/);
    expect(repoSrc).toMatch(/country:\s*row\.country/);
    expect(repoSrc).toMatch(/quantity:\s*row\.quantity/);
    expect(repoSrc).toMatch(/safetyStock:\s*row\.safety_stock/);
    expect(repoSrc).toMatch(/matchStatus:\s*row\.match_status/);
  });
});

// ─── 4. 搜索 placeholder ──────────────────────────────────────────────────

describe('P6-PRODUCT-NAME: 搜索', () => {
  it('搜索 placeholder 支持 SKU 或产品名称', () => {
    expect(contentSrc).toMatch(/搜索 SKU 或产品名称/);
  });

  it('搜索表单使用 search 参数', () => {
    expect(contentSrc).toMatch(/name="search"/);
    expect(contentSrc).toMatch(/placeholder="搜索 SKU 或产品名称..."/);
  });
});

// ─── 5. 架构合规 ──────────────────────────────────────────────────────────

describe('P6-PRODUCT-NAME: 架构合规', () => {
  it('overseas-page-content.tsx 不直接调用 supabase.from()', () => {
    expect(contentSrc).not.toMatch(/supabase\.from\(/);
  });

  it('overseas-page-content.tsx 不直接调用 supabase.rpc()', () => {
    expect(contentSrc).not.toMatch(/supabase\.rpc\(/);
  });

  it('overseas-page-content.tsx 不导入 service_role', () => {
    expect(contentSrc).not.toMatch(/service_role/);
  });

  it('overseas-page-content.tsx 不导入 createClient', () => {
    expect(contentSrc).not.toMatch(/createClient/);
    expect(contentSrc).not.toMatch(/createServerClient/);
  });

  it('overseas-page-content.tsx 不新增 Migration / RPC / RLS 引用', () => {
    expect(contentSrc).not.toMatch(/Migration/);
    // \b 边界避免 URLSearchParams 中的 "RLS" 子串匹配
    expect(contentSrc).not.toMatch(/\bRLS\b/);
  });
});

// ─── 6. 回归 — 其他列未丢失 ──────────────────────────────────────────────

describe('P6-PRODUCT-NAME: 回归检查', () => {
  it('展开箭头列保留', () => {
    expect(contentSrc).toMatch(/ChevronRight/);
  });

  it('关注 Star 列保留', () => {
    expect(contentSrc).toMatch(/FavoriteStar/);
  });

  it('国家列保留', () => {
    expect(contentSrc).toMatch(/\{item\.country\}/);
  });

  it('仓库名列保留', () => {
    expect(contentSrc).toMatch(/\{item\.warehouseName\}/);
  });

  it('当前库存列保留', () => {
    expect(contentSrc).toMatch(/当前库存/);
    expect(contentSrc).toMatch(/\{item\.quantity\}/);
  });

  it('在途列保留', () => {
    expect(contentSrc).toMatch(/在途/);
    expect(contentSrc).toMatch(/\{item\.inTransitQuantity/);
  });

  it('P6: 已确认到仓列已从主表移除', () => {
    expect(contentSrc).not.toMatch(/已确认到仓/);
    expect(contentSrc).not.toMatch(/confirmedMap/);
  });

  it('库存+在途列保留', () => {
    expect(contentSrc).toMatch(/库存\+在途/);
  });

  it('安全库存列保留', () => {
    expect(contentSrc).toMatch(/安全库存/);
    expect(contentSrc).toMatch(/item\.safetyStock/);
  });

  it('库存状态列保留', () => {
    expect(contentSrc).toMatch(/库存状态/);
    expect(contentSrc).toMatch(/getStatusBadge\(item\)/);
  });

  it('同步状态列保留', () => {
    expect(contentSrc).toMatch(/同步状态/);
    expect(contentSrc).toMatch(/SyncStatusBadge/);
  });

  it('展开行 colSpan 已更新为 12（P6 移除已确认到仓）', () => {
    expect(contentSrc).not.toMatch(/colSpan=\{13\}/);
    expect(contentSrc).toMatch(/colSpan=\{12\}/);
  });

  it('导出 CSV 按钮保留', () => {
    expect(contentSrc).toMatch(/导出 CSV/);
    expect(contentSrc).toMatch(/handleExportCsv/);
  });
});
