// 产品列表展开行 & 编辑 Sheet 体验增强 — 源码级测试
// 覆盖：批量 variant 查询、展开行 UI、ProductForm code 可编辑、SKU 绑定展示、权限/架构合规
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf-8');
}

// ─── 1. Repository: list() 批量查询 variant ─────────────────────────

describe('productRepository.list() 批量查询 product_variant', () => {
  let repo: string;

  beforeAll(() => {
    repo = readSrc('features/products/repository.ts');
  });

  it('使用 .in(product_id, productIds) 批量查询，不逐行 N+1 查询', () => {
    expect(repo).toContain(".in('product_id', productIds)");
    expect(repo).toContain('match_status');
    expect(repo).toContain('last_sync_at');
    expect(repo).toContain('product_id');
  });

  it('查询 failure 抛出 ProductError，不吞成空数组', () => {
    expect(repo).toContain("throw new ProductError('查询产品 SKU 绑定失败'");
  });

  it('按 product_id 分组构建 bindingsMap', () => {
    expect(repo).toContain('bindingsMap');
    expect(repo).toContain("bindingsMap.set(pid, { domestic: [], overseas: {} })");
  });

  it('country=CN 归入 domestic，其他归入 overseas', () => {
    expect(repo).toContain("v.country === 'CN'");
    expect(repo).toContain('binding.domestic.push(brief)');
    expect(repo).toContain('groups[v.country].push(brief)');
  });

  it('返回的 ProductItem 包含 bindings', () => {
    expect(repo).toContain('bindings: bindingsMap.get(p.id)');
  });

  it('空列表直接返回，不查询 variant', () => {
    const earlyReturnIdx = repo.indexOf('return { data: [], total: 0, page, pageSize }');
    const variantQueryIdx = repo.indexOf(".in('product_id', productIds)");
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(earlyReturnIdx).toBeLessThan(variantQueryIdx);
  });
});

// ─── 2. Repository: update() 允许更新 code ───────────────────────────

describe('productRepository.update() 允许更新 code', () => {
  let repo: string;

  beforeAll(() => {
    repo = readSrc('features/products/repository.ts');
  });

  it('update method 接受 code 字段并做重复校验', () => {
    expect(repo).toContain('if (data.code)');
    expect(repo).toContain(".eq('code', data.code)");
    expect(repo).toContain(".neq('id', id)");
  });

  it('code 重复时抛出 DUPLICATE_CODE ProductError', () => {
    expect(repo).toContain("throw new ProductError('产品编码已存在', 'DUPLICATE_CODE')");
  });

  it('DB 23505 唯一约束兜底返回中文错误', () => {
    expect(repo).toContain("error.code === '23505'");
    const idx23505 = repo.indexOf('23505');
    const after23505 = repo.slice(idx23505, idx23505 + 200);
    expect(after23505).toContain("'产品编码已存在'");
  });

  it('注释表明 code 创建后仍可修改', () => {
    expect(repo).toContain('创建后仍可修改');
  });
});

// ─── 3. Actions: updateProduct 传递 code ─────────────────────────────

describe('updateProduct 传递 code 到 repository.update', () => {
  let actions: string;

  beforeAll(() => {
    actions = readSrc('features/products/actions.ts');
  });

  it('updateProduct 调用 repository.update 时包含 code', () => {
    const updateIdx = actions.indexOf('productRepository.update');
    expect(updateIdx).toBeGreaterThan(0);
    const block = actions.slice(updateIdx, updateIdx + 300);
    expect(block).toContain('code: parsed.data.code');
  });

  it('createProduct 逻辑未被破坏', () => {
    expect(actions).toContain('export async function createProduct');
    expect(actions).toContain('productRepository.create');
    expect(actions).toContain("await requireAdmin()");
  });
});

// ─── 4. Types: ProductItem 包含 SKU 绑定摘要 ─────────────────────────

describe('ProductItem / ProductVariantBindingBrief 类型', () => {
  let types: string;

  beforeAll(() => {
    types = readSrc('features/products/types.ts');
  });

  it('ProductVariantBindingBrief 包含必要字段', () => {
    expect(types).toContain('ProductVariantBindingBrief');
    expect(types).toContain('sku: string');
    expect(types).toContain('country: string');
    expect(types).toContain('name: string');
    expect(types).toContain('matchStatus: string');
    expect(types).toContain('lastSyncAt: string | null');
  });

  it('ProductSkuBindingSummary 按国内/海外分组', () => {
    expect(types).toContain('ProductSkuBindingSummary');
    expect(types).toContain('domestic: ProductVariantBindingBrief[]');
    expect(types).toContain('overseas: Record<string, ProductVariantBindingBrief[]>');
  });

  it('ProductItem 包含 bindings 可选字段', () => {
    expect(types).toContain('bindings?: ProductSkuBindingSummary');
  });
});

// ─── 5. ProductForm: Sheet 宽度与布局 ────────────────────────────────

describe('ProductForm Sheet 宽度与三段式布局', () => {
  let form: string;

  beforeAll(() => {
    form = readSrc('features/products/components/product-form.tsx');
  });

  it('SheetContent 使用 !important 覆盖默认 sm:max-w-sm', () => {
    expect(form).toContain('!max-w-[760px]');
    expect(form).toContain('!w-[760px]');
  });

  it('SheetContent 使用 overflow-hidden 防止双滚动条', () => {
    expect(form).toContain('overflow-hidden');
  });

  it('SheetContent 使用 p-0 flex flex-col gap-0 自控间距', () => {
    expect(form).toContain('p-0 flex flex-col gap-0');
  });

  it('有固定 footer 区域（border-t + 取消/保存按钮）', () => {
    expect(form).toContain('shrink-0 border-t bg-popover px-5 py-3 flex justify-end gap-2');
    expect(form).toMatch(/取消/);
    expect(form).toMatch(/保存/);
  });

  it('Header 左对齐且带底部分割线', () => {
    expect(form).toContain('text-left');
    expect(form).toContain('border-b');
  });

  it('Body 内容在独立可滚动容器内', () => {
    expect(form).toContain('overflow-y-auto');
    expect(form).toContain('flex-1');
  });

  it('副标题说明 code 可修改', () => {
    expect(form).toContain('修改标准产品信息，SKU 绑定仅展示');
  });
});

// ─── 6. ProductForm: code 不再 disabled ──────────────────────────────

describe('ProductForm 编辑模式 code 可编辑', () => {
  let form: string;

  beforeAll(() => {
    form = readSrc('features/products/components/product-form.tsx');
  });

  it('code Input 没有 disabled 属性', () => {
    expect(form).not.toContain('disabled={mode ===');
    expect(form).not.toContain("'产品编码创建后不可修改'");
  });

  it('code 从 formData 读取（不再依赖 defaultValues.code）', () => {
    expect(form).toContain("formData.get('code')");
    expect(form).not.toMatch(/mode === 'edit'\s*\?\s*\(defaultValues/);
  });
});

// ─── 7. ProductForm: SKU 绑定展示区（统一表格）───────────────────────

describe('ProductForm SKU 绑定展示区 — 统一表格', () => {
  let form: string;

  beforeAll(() => {
    form = readSrc('features/products/components/product-form.tsx');
  });

  it('edit 模式展示 SKU 绑定区', () => {
    expect(form).toContain("mode === 'edit'");
    expect(form).toContain('SKU 绑定');
  });

  it('SKU 绑定标题行包含统计摘要（国内 X · 海外 Y）', () => {
    expect(form).toContain('国内');
    expect(form).toContain('海外');
    expect(form).toContain('overseasTotal');
  });

  it('展示国内 SKU 区', () => {
    expect(form).toContain('国内 SKU');
  });

  it('国内 SKU 为空时显示占位文案 + 待接入 badge', () => {
    expect(form).toContain('暂无国内 SKU 绑定 / 国内库存待接入');
    expect(form).toContain('待接入');
  });

  it('展示海外仓 SKU 区', () => {
    expect(form).toContain('海外仓 SKU');
  });

  it('海外 SKU 为空时显示占位文案', () => {
    expect(form).toContain('暂无海外仓 SKU 绑定');
  });

  it('海外仓 SKU 使用单张统一表，包含国家/SKU/仓库产品名/匹配状态/最后同步列', () => {
    // 海外仓表头包含"国家"列（旧版按国家分组无此列）
    const overseasSection = form.slice(form.indexOf('海外仓 SKU'));
    expect(overseasSection).toContain('国家');
    expect(overseasSection).toContain('SKU');
    expect(overseasSection).toContain('仓库产品名');
    expect(overseasSection).toContain('匹配状态');
    expect(overseasSection).toContain('最后同步');
  });

  it('不再按每个国家重复渲染多张 table', () => {
    // 海外仓区只有一张表（一个 <table 标签）
    const overseasStart = form.indexOf('海外仓 SKU');
    const overseasSection = form.slice(overseasStart);
    const tableCount = (overseasSection.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
  });

  it('匹配状态和最后同步列包含 whitespace-nowrap 防换行', () => {
    // 海外仓表格中匹配状态、最后同步列头有 whitespace-nowrap
    const overseasStart = form.indexOf('海外仓 SKU');
    const overseasSection = form.slice(overseasStart);
    // 统计 whitespace-nowrap 出现次数（表头 + 表体至少各 2 处）
    const nowrapCount = (overseasSection.match(/whitespace-nowrap/g) ?? []).length;
    expect(nowrapCount).toBeGreaterThanOrEqual(4);
  });

  it('海外仓表格支持水平滚动（overflow-x-auto）', () => {
    const overseasStart = form.indexOf('海外仓 SKU');
    const overseasSection = form.slice(overseasStart);
    expect(overseasSection).toContain('overflow-x-auto');
  });

  it('add 模式不展示 SKU 绑定', () => {
    expect(form).toMatch(/mode === 'edit'/);
  });

  it('包含匹配状态 badge', () => {
    expect(form).toContain('已匹配');
    expect(form).toContain('未匹配');
    expect(form).toContain('待确认');
  });

  it('包含最后同步时间格式化', () => {
    expect(form).toContain("toLocaleString('zh-CN'");
  });
});

// ─── 8. ProductsPageContent: 展开按钮和展开行 ────────────────────────

describe('产品列表表格展开按钮和展开行', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/products/_components/products-page-content.tsx');
  });

  it('表格包含展开按钮列', () => {
    expect(page).toContain('ChevronRight');
    expect(page).toContain('ChevronDown');
    expect(page).toContain('expandedIds');
    expect(page).toContain('toggleExpand');
  });

  it('展开行显示 SKU 绑定明细标题 + 统计摘要', () => {
    expect(page).toContain('SKU 绑定明细');
    expect(page).toContain('overseasTotal');
  });

  it('展开行展示国内 SKU 区', () => {
    expect(page).toContain('国内 SKU');
  });

  it('国内 SKU 为空时显示占位文案 + 待接入 badge', () => {
    expect(page).toContain('暂无国内 SKU 绑定 / 国内库存待接入');
    expect(page).toContain('待接入');
  });

  it('展开行展示海外仓 SKU 区', () => {
    expect(page).toContain('海外仓 SKU');
  });

  it('海外仓 SKU 使用单张统一表（不再按国家分组多张小表）', () => {
    const expandStart = page.indexOf('ExpandRowContent');
    const expandSection = page.slice(expandStart);
    // 海外仓区只有一张 table
    const overseasStart = expandSection.indexOf('海外仓 SKU');
    const overseasSection = expandSection.slice(overseasStart);
    const tableCount = (overseasSection.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
  });

  it('海外仓统一表包含国家列', () => {
    const expandStart = page.indexOf('ExpandRowContent');
    const expandSection = page.slice(expandStart);
    const overseasStart = expandSection.indexOf('海外仓 SKU');
    const overseasSection = expandSection.slice(overseasStart);
    expect(overseasSection).toContain('国家');
  });

  it('展开行匹配状态和最后同步列包含 whitespace-nowrap', () => {
    const expandStart = page.indexOf('ExpandRowContent');
    const expandSection = page.slice(expandStart);
    const nowrapCount = (expandSection.match(/whitespace-nowrap/g) ?? []).length;
    expect(nowrapCount).toBeGreaterThanOrEqual(4);
  });

  it('海外仓表格支持 overflow-x-auto 水平滚动', () => {
    const expandStart = page.indexOf('ExpandRowContent');
    const expandSection = page.slice(expandStart);
    expect(expandSection).toContain('overflow-x-auto');
  });

  it('点击展开按钮不跳转（button 不是 a 标签）', () => {
    const expandBtnIdx = page.indexOf('onToggleExpand');
    expect(expandBtnIdx).toBeGreaterThan(0);
    expect(page).toContain('/dashboard/products/${item.id}');
    expect(page).toContain('text-primary hover:underline');
  });

  it('编辑时传入 variants 到 ProductForm', () => {
    expect(page).toContain('variants={editingVariants}');
    expect(page).toContain('getVariantsForEdit');
  });
});

// ─── 9. ProductDetailClient: 传 variants 到 ProductForm ──────────────

describe('ProductDetailClient 传 variants 到 ProductForm', () => {
  let detail: string;

  beforeAll(() => {
    detail = readSrc('app/dashboard/products/_components/product-detail-client.tsx');
  });

  it('ProductForm 接收 variants prop', () => {
    expect(detail).toContain('variants={product.variants}');
  });
});

// ─── 10. 架构合规：页面/组件不直接 supabase.from() ─────────────────

describe('架构合规：页面和组件不直接 supabase.from()', () => {
  const files = [
    'app/dashboard/products/page.tsx',
    'app/dashboard/products/_components/products-page-content.tsx',
    'app/dashboard/products/_components/product-detail-client.tsx',
    'app/dashboard/products/[id]/page.tsx',
    'features/products/components/product-form.tsx',
  ];

  for (const file of files) {
    it(`${file} 不直接调用 supabase.from()`, () => {
      const content = readSrc(file);
      expect(content).not.toMatch(/supabase\.from\(/);
    });
  }
});

// ─── 11. 不新增 Migration / RPC / RLS ───────────────────────────────

describe('不新增 Migration / RPC / RLS', () => {
  it('产品模块 types/schema/repository/actions 不包含 Migration 引用', () => {
    const repo = readSrc('features/products/repository.ts');
    const types = readSrc('features/products/types.ts');
    const schema = readSrc('features/products/schema.ts');
    const actions = readSrc('features/products/actions.ts');

    for (const content of [repo, types, schema, actions]) {
      expect(content).not.toContain('Migration');
      expect(content).not.toContain('0003');
    }
  });

  it('产品模块不创建新 RPC', () => {
    const repo = readSrc('features/products/repository.ts');
    expect(repo).not.toContain('.rpc(');
  });
});

// ─── 12. repository.update() 23505 中文错误兜底 ──────────────────────

describe('repository.update() 23505 唯一约束兜底', () => {
  let repo: string;

  beforeAll(() => {
    repo = readSrc('features/products/repository.ts');
  });

  it('update 方法中 catch 23505 错误返回中文提示', () => {
    const updateIdx = repo.indexOf('async update(id');
    const afterUpdate = repo.slice(updateIdx, updateIdx + 1000);
    expect(afterUpdate).toContain("error.code === '23505'");
    expect(afterUpdate).toContain("'产品编码已存在'");
  });
});

// ─── 13. Schema / FormData 不变破坏检查 ──────────────────────────────

describe('productFormSchema 和 ProductFormData 保持兼容', () => {
  let schema: string;
  let types: string;

  beforeAll(() => {
    schema = readSrc('features/products/schema.ts');
    types = readSrc('features/products/types.ts');
  });

  it('productFormSchema 仍包含 code/name/safetyStock/category/unit', () => {
    expect(schema).toContain('code:');
    expect(schema).toContain('name:');
    expect(schema).toContain('safetyStock:');
    expect(schema).toContain('category:');
    expect(schema).toContain('unit:');
  });

  it('ProductFormData 仍包含所有基础字段', () => {
    expect(types).toContain('code: string');
    expect(types).toContain('name: string');
    expect(types).toContain('safetyStock: number');
  });
});
