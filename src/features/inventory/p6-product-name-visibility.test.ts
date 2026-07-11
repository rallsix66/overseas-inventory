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
    // 提取所有 <TableHead> 标签内容（P6-UX-V2-D: 列宽 resize 后标签内嵌 <span>）
    const heads = contentSrc.match(/<TableHead[^>]*>([\s\S]*?)<\/TableHead>/g);
    expect(heads).not.toBeNull();
    const labels = heads!.map((h) => {
      // 优先提取 <span> 内文本（新格式，含 className），回退到直接文本（旧格式/无 resize handle 的列）
      const spanMatch = h.match(/<span[^>]*>([^<]*)<\/span>/);
      if (spanMatch) return spanMatch[1].trim();
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

  it('产品名称列头存在（位于 <span> 内）', () => {
    // P6-RESIZE: TableHead 内 span 含 className（block min-w-0 truncate overflow-hidden）
    expect(contentSrc).toMatch(/<TableHead[^>]*>[\s\S]*?<span[^>]*>产品名称<\/span>/);
  });

  it('SKU 列头存在且在 <TableHead> 中出现', () => {
    expect(contentSrc).toMatch(/<TableHead[^>]*>[\s\S]*?<span[^>]*>SKU<\/span>/);
  });
});

// ─── 2. 品名显示逻辑（P6-UX-V2-D 字段语义修正） ─────────────────────────

describe('P6-PRODUCT-NAME: 品名显示逻辑', () => {
  it('主品名列使用 variantName（BigSeller 原始品名优先）', () => {
    expect(contentSrc).toMatch(/item\.variantName/);
  });

  it('matched 状态下主品名仍是 BigSeller 原始品名（variantName）', () => {
    const matchedIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    const afterMatched = contentSrc.slice(matchedIdx, matchedIdx + 300);
    expect(afterMatched).toMatch(/item\.variantName/);
  });

  it('matched 状态下不显示标准产品辅助信息（P6-OVERSEAS-PRODUCT-NAME-SIMPLIFY）', () => {
    expect(contentSrc).not.toMatch(/标准品：/);
    expect(contentSrc).not.toMatch(/已匹配标准品缺失/);
  });

  it('主品名仍使用 variantName 作为 BigSeller 原始品名', () => {
    expect(contentSrc).toMatch(/item\.variantName/);
  });

  it('unmatched 状态显示 BigSeller 品名或"未匹配产品" fallback', () => {
    expect(contentSrc).toMatch(/未匹配产品/);
  });

  it('品名列不再使用 max-w-[180px] 固定宽度（已改为 colgroup + resize 控制列宽）', () => {
    // 旧实现使用 TableCell max-w-[180px] 截断，新实现使用 colgroup 控制列宽 + min-w-0
    expect(contentSrc).not.toMatch(/max-w-\[180px\]\s+truncate/);
    // colgroup 控制产品名称列宽
    expect(contentSrc).toMatch(/col style=\{\{ width: columnWidths\.productName \}\}/);
    // 产品名称单元格使用 min-w-0 配合内部 flex truncate
    expect(contentSrc).toMatch(/min-w-0/);
  });

  it('SKU 列使用 font-mono 样式', () => {
    const skuCells = contentSrc.match(/font-mono text-xs.*\{item\.sku\}/g);
    expect(skuCells).not.toBeNull();
    expect(skuCells!.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 3. Repository 映射 ───────────────────────────────────────────────────

describe('P6-PRODUCT-NAME: Repository 字段映射', () => {
  it('mapOverseasRow 新增 variantName 映射（variant_name → variantName）', () => {
    expect(repoSrc).toMatch(/variantName,\s*$/m);
  });

  it('mapOverseasRow 新增 standardProductName 映射（product_name → standardProductName）', () => {
    expect(repoSrc).toMatch(/standardProductName,\s*$/m);
  });

  it('mapOverseasRow 新增 standardProductCode 映射（product_code → standardProductCode）', () => {
    expect(repoSrc).toMatch(/standardProductCode,\s*$/m);
  });

  it('mapOverseasRow productName 向后兼容 = variantName（BigSeller 品名）', () => {
    expect(repoSrc).toMatch(/productName:\s*variantName/);
  });

  it('mapOverseasRow productCode 向后兼容 = standardProductCode', () => {
    expect(repoSrc).toMatch(/productCode:\s*standardProductCode/);
  });

  it('RawOverseasInventoryRow 包含 variant_name 字段', () => {
    expect(repoSrc).toMatch(/variant_name:\s*string\s*\|\s*null/);
    expect(repoSrc).toMatch(/BigSeller 原始品名/);
  });

  it('RawOverseasInventoryRow product_name 注释标注为 DIS 标准产品名', () => {
    expect(repoSrc).toMatch(/product_name:.*DIS 标准产品名/);
  });

  it('mapOverseasRow 未丢失其他关键字段', () => {
    // 确保重构字段映射时没有意外丢失其他字段映射
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
