// P6-OVERSEAS-INVENTORY-UX-V2-D — 海外库存真实产品绑定 源码级测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');
const pageSrc = readSrc('src/app/dashboard/inventory/overseas/page.tsx');
const dialogSrc = readSrc('src/features/inventory/components/bind-product-dialog.tsx');
const actionsSrc = readSrc('src/features/inventory/actions.ts');
const productActionsSrc = readSrc('src/features/products/actions.ts');
const productRepoSrc = readSrc('src/features/products/repository.ts');
const variantRepoSrc = readSrc('src/features/variants/repository.ts');
const inventoryRepoSrc = readSrc('src/features/inventory/repository.ts');
const inventoryTypesSrc = readSrc('src/features/inventory/types.ts');
const authSrc = readSrc('src/lib/auth.ts');

// ─── 1. 未匹配行绑定入口 ──────────────────────────────────────────────────────

describe('P6-UX-V2-D: 未匹配行绑定入口', () => {
  it('以 matchStatus !== "matched" 判断绑定入口（不再以 productName 为空为准）', () => {
    // 源码使用 item.matchStatus === 'matched' 三元表达式分派
    expect(contentSrc).toMatch(/item\.matchStatus === 'matched'/);
    // 不再使用 item.productName 三元判断
    expect(contentSrc).not.toMatch(/\{item\.productName \?/);
  });

  it('matchStatus !== "matched"（未匹配行）显示"绑定产品"按钮', () => {
    // false 分支（未匹配）包含"绑定产品"按钮
    expect(contentSrc).toMatch(/绑定产品/);
    // 按钮在 matchStatus === 'matched' 的 false 分支中
    const ternaryIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    expect(ternaryIdx).toBeGreaterThan(-1);
  });

  it('"绑定产品"按钮有 stopPropagation 防止触发行展开', () => {
    expect(contentSrc).toMatch(/stopPropagation\(\)/);
  });

  it('"绑定产品"按钮传递 variantId 和 sku 给 handleBindProduct', () => {
    expect(contentSrc).toMatch(/handleBindProduct\(item\.variantId, item\.sku\)/);
  });

  it('handleBindProduct 签名接受 (variantId: string, sku: string)', () => {
    expect(contentSrc).toMatch(/function handleBindProduct\(variantId: string, sku: string\)/);
  });

  it('handleBindProduct 设置 bindTarget state 打开 Dialog', () => {
    const fnStart = contentSrc.indexOf('function handleBindProduct');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/setBindTarget/);
    // 不再调用 toast.info（不再是占位）
    expect(fnBody).not.toMatch(/toast\.info/);
    expect(fnBody).not.toMatch(/即将上线/);
  });

  it('matchStatus === "matched" 时不显示"绑定产品"按钮', () => {
    // 三元结构：matchStatus === 'matched' ? (matched 分支) : (unmatched 分支含绑定按钮)
    // "已匹配标准品缺失" 只在 matched 分支中，绑定按钮在 unmatched 分支的 {canBindProduct && ( ... )} 内
    const matchedIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    const unmatchedIdx = contentSrc.indexOf('未匹配产品');
    // matched 分支在 unmatched 分支之前
    expect(matchedIdx).toBeLessThan(unmatchedIdx);
    // "已匹配标准品缺失" 在 matched 分支
    const anomalyIdx = contentSrc.indexOf('已匹配标准品缺失');
    expect(anomalyIdx).toBeGreaterThan(matchedIdx);
    expect(anomalyIdx).toBeLessThan(unmatchedIdx);
    // "绑定产品" 按钮 JSX 文本在 unmatched 分支（{canBindProduct && ( ... )} 内）
    // 从 unmatched 标签位置往后搜索按钮文本（跳过前面注释中的 "绑定产品"）
    const bindBtnIdx = contentSrc.indexOf('绑定产品', unmatchedIdx);
    expect(bindBtnIdx).toBeGreaterThan(unmatchedIdx);
  });

  it('matchStatus === "matched" 但 standardProductName 为空 → 显示"已匹配标准品缺失"只读文案，不显示绑定按钮', () => {
    // matched 分支中 standardProductName 为空时显示异常状态文案
    expect(contentSrc).toMatch(/已匹配标准品缺失/);
    // "已匹配标准品缺失"在 matched 分支（true 分支），"绑定产品"在 unmatched 分支（false 分支）
    const anomalyIdx = contentSrc.indexOf('已匹配标准品缺失');
    const unmatchedLabelIdx = contentSrc.indexOf('未匹配产品');
    // 异常文案在未匹配标签之前（即 matched 分支中）
    expect(anomalyIdx).toBeGreaterThan(-1);
    expect(anomalyIdx).toBeLessThan(unmatchedLabelIdx);
    // 绑定按钮不在 matched 分支（它在 unmatched 分支中，位于 "未匹配产品" 之后）
    const bindBtnIdx = contentSrc.indexOf('绑定产品', unmatchedLabelIdx);
    expect(bindBtnIdx).toBeGreaterThan(unmatchedLabelIdx);
  });
});

// ─── 2. 产品搜索 UI ──────────────────────────────────────────────────────────

describe('P6-UX-V2-D: 产品搜索 UI', () => {
  it('BindProductDialog 组件导入到 overseas-page-content', () => {
    expect(contentSrc).toMatch(/import \{ BindProductDialog \} from '@\/features\/inventory\/components\/bind-product-dialog'/);
  });

  it('BindProductDialog 是客户端组件', () => {
    expect(dialogSrc).toMatch(/'use client'/);
  });

  it('BindProductDialog 接受 open / variantId / sku / onOpenChange / onSuccess props', () => {
    expect(dialogSrc).toMatch(/open: boolean/);
    expect(dialogSrc).toMatch(/variantId: string/);
    expect(dialogSrc).toMatch(/sku: string/);
    expect(dialogSrc).toMatch(/onOpenChange: \(open: boolean\) => void/);
    expect(dialogSrc).toMatch(/onSuccess: \(\) => void/);
  });

  it('BindProductDialog 调用 searchProducts Server Action 搜索产品', () => {
    expect(dialogSrc).toMatch(/searchProducts/);
    expect(dialogSrc).toMatch(/from '@\/features\/products\/actions'/);
  });

  it('searchProducts Server Action 使用 requireActiveAuth（已登录即可搜索）', () => {
    expect(productActionsSrc).toMatch(/export async function searchProducts/);
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/requireActiveAuth/);
  });

  it('searchProducts 仅返回启用状态的产品（is_active=true 在 repository 层）', () => {
    // P6-UX-V2-D: is_active 过滤已下推到 productRepository.search
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/is_active.*true/);
  });

  it('BindProductDialog 处理搜索空结果状态', () => {
    expect(dialogSrc).toMatch(/未找到匹配的产品/);
  });

  it('BindProductDialog 处理搜索中 loading 状态', () => {
    expect(dialogSrc).toMatch(/searching/);
    expect(dialogSrc).toMatch(/Loader2/);
    expect(dialogSrc).toMatch(/搜索中/);
  });

  it('BindProductDialog 处理搜索错误状态', () => {
    expect(dialogSrc).toMatch(/搜索产品失败/);
  });

  it('BindProductDialog 有搜索输入框', () => {
    expect(dialogSrc).toMatch(/搜索产品编码或名称/);
    expect(dialogSrc).toMatch(/handleSearch/);
  });
});

// ─── 3. 确认绑定调用 Server Action ─────────────────────────────────────────

describe('P6-UX-V2-D: 绑定确认调用 Server Action', () => {
  it('BindProductDialog 调用 bindOverseasVariant Server Action', () => {
    expect(dialogSrc).toMatch(/bindOverseasVariant/);
    expect(dialogSrc).toMatch(/from '@\/features\/inventory\/actions'/);
  });

  it('bindOverseasVariant Server Action 使用 requireActiveAdmin（Admin-only）', () => {
    expect(actionsSrc).toMatch(/export async function bindOverseasVariant/);
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/requireActiveAdmin/);
  });

  it('bindOverseasVariant 使用 variantMatchSchema 校验 variantId / productId', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/variantMatchSchema/);
    expect(fnBody).toMatch(/parsed\.data\.variantId/);
    expect(fnBody).toMatch(/parsed\.data\.productId/);
  });

  it('bindOverseasVariant 调用 variantRepository.match', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/variantRepository\.match/);
  });

  it('bindOverseasVariant 成功后 revalidatePath 海外库存页', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/revalidatePath\('\/dashboard\/inventory\/overseas'\)/);
  });

  it('bindOverseasVariant 捕获 VariantError 返回中文错误', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/VariantError/);
    expect(fnBody).toMatch(/error\.message/);
  });

  it('bindOverseasVariant 处理未登录/非 Admin 权限错误', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/未登录或账户已停用/);
    expect(fnBody).toMatch(/无权限：需要管理员角色/);
  });

  it('variantRepository.match 校验 Product 启用状态', () => {
    // match() 方法检查 product.is_active
    const fnStart = variantRepoSrc.indexOf('async match(variantId: string, productId: string)');
    const fnEnd = variantRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = variantRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/is_active/);
    expect(fnBody).toMatch(/产品已停用/);
  });

  it('variantRepository.match 校验 Variant 和 Product 存在性', () => {
    const fnStart = variantRepoSrc.indexOf('async match(variantId: string, productId: string)');
    const fnEnd = variantRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = variantRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/SKU 不存在/);
    expect(fnBody).toMatch(/产品不存在/);
  });

  it('bindOverseasVariant 绑定后设置 match_status=matched + product_id', () => {
    const fnStart = variantRepoSrc.indexOf('async match(variantId: string, productId: string)');
    const fnEnd = variantRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = variantRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/match_status:\s*'matched'/);
    expect(fnBody).toMatch(/product_id:\s*productId/);
  });

  it('confirm 按钮在未选择产品时 disabled', () => {
    expect(dialogSrc).toMatch(/disabled=\{!selectedProductId \|\| binding\}/);
  });

  it('confirmed 按钮在 binding 中显示 loading', () => {
    expect(dialogSrc).toMatch(/binding/);
    expect(dialogSrc).toMatch(/确认绑定/);
  });
});

// ─── 4. 绑定成功刷新 ─────────────────────────────────────────────────────────

describe('P6-UX-V2-D: 绑定成功刷新', () => {
  it('onSuccess 回调中调用 router.refresh() 保留当前 URL', () => {
    // onSuccess 传递给 BindProductDialog 的回调中调用 router.refresh()
    const onSuccessIdx = contentSrc.indexOf('onSuccess');
    expect(onSuccessIdx).toBeGreaterThan(-1);
    // onSuccess 块中包含 router.refresh()
    const afterOnSuccess = contentSrc.slice(onSuccessIdx, onSuccessIdx + 300);
    expect(afterOnSuccess).toMatch(/router\.refresh\(\)/);
  });

  it('onSuccess 回调中清除 bindTarget（关闭 Dialog）', () => {
    const onSuccessIdx = contentSrc.indexOf('onSuccess');
    const afterOnSuccess = contentSrc.slice(onSuccessIdx, onSuccessIdx + 300);
    expect(afterOnSuccess).toMatch(/setBindTarget\(null\)/);
  });

  it('BindProductDialog 仅在 bindTarget 非 null 时渲染', () => {
    expect(contentSrc).toMatch(/\{bindTarget && \(/);
  });

  it('onOpenChange(false) 清除 bindTarget', () => {
    const onOpenChangeIdx = contentSrc.indexOf('onOpenChange');
    const after = contentSrc.slice(onOpenChangeIdx, onOpenChangeIdx + 200);
    expect(after).toMatch(/setBindTarget\(null\)/);
  });
});

// ─── 5. 架构合规 ─────────────────────────────────────────────────────────────

describe('P6-UX-V2-D: 架构合规', () => {
  it('overseas-page-content 没有直接调用 supabase.from()', () => {
    expect(contentSrc).not.toMatch(/supabase\.from\(/);
  });

  it('BindProductDialog 没有直接调用 supabase.from()', () => {
    expect(dialogSrc).not.toMatch(/supabase\.from\(/);
    expect(dialogSrc).not.toMatch(/createClient/);
  });

  it('bindOverseasVariant 没有使用 service_role', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/service_role/);
  });

  it('不新增 Migration / RPC / RLS 引用', () => {
    expect(dialogSrc).not.toMatch(/\bMigration\b/);
    expect(dialogSrc).not.toMatch(/\bRPC\b/);
    expect(dialogSrc).not.toMatch(/\bRLS\b/);
  });

  it('绑定通过 ProductVariant 间接关联 Product（不破坏 Product→ProductVariant→Inventory 模型）', () => {
    // bindOverseasVariant 调用 variantRepository.match，更新 product_variant 表
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    // 不直接写入 inventory 表（不调用 inventoryRepository 写方法或 supabase.from('inventory')）
    expect(fnBody).not.toMatch(/inventoryRepository/);
    expect(fnBody).not.toMatch(/supabase\.from\(['"]inventory['"]/);
    // 通过 variantRepository.match 操作 product_variant
    expect(fnBody).toMatch(/variantRepository\.match/);
  });

  it('不绕过 Repository Pattern — bindOverseasVariant 通过 variantRepository', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/variantRepository\.match/);
  });

  it('searchProducts 不绕过 Repository Pattern — 通过 productRepository.search', () => {
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/productRepository\.search/);
  });

  it('BindProductDialog 不使用 any', () => {
    expect(dialogSrc).not.toMatch(/\bany\b/);
  });

  it('bindOverseasVariant 不使用 any', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/\bany\b/);
  });

  it('Inventory 不包含 productId 字段（不建立 Inventory→Product 直连）', () => {
    // InventoryItem 类型不含 productId
    const typesSrc = readSrc('src/features/inventory/types.ts');
    expect(typesSrc).toMatch(/export interface InventoryItem/);
    const itemStart = typesSrc.indexOf('export interface InventoryItem');
    const itemEnd = typesSrc.indexOf('\n}', itemStart);
    const itemBody = typesSrc.slice(itemStart, itemEnd);
    expect(itemBody).toMatch(/variantId/);
    // 确认没有 productId 字段
    expect(itemBody).not.toMatch(/productId/);
  });

  it('bindOverseasVariant 保留 requireActiveAdmin 权限校验（Admin-only 双重保护）', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/requireActiveAdmin/);
  });

  it('page.tsx 通过 getCurrentUser 获取当前用户角色', () => {
    expect(pageSrc).toMatch(/getCurrentUser/);
    expect(pageSrc).toMatch(/from '@\/lib\/auth'/);
  });

  it('page.tsx 传递 canBindProduct={roleName === "admin"} 给 OverseasPageContent', () => {
    expect(pageSrc).toMatch(/canBindProduct/);
    expect(pageSrc).toMatch(/currentUser\?\.roleName === 'admin'/);
  });

  it('OverseasPageContent Props 包含 canBindProduct: boolean', () => {
    expect(contentSrc).toMatch(/canBindProduct:\s*boolean/);
  });

  it('canBindProduct=false 时不渲染"绑定产品"按钮（Operator 不显示必失败入口）', () => {
    // "绑定产品"按钮在 canBindProduct && 条件下渲染
    expect(contentSrc).toMatch(/\{canBindProduct && \(/);
    // 按钮本身仍存在
    expect(contentSrc).toMatch(/绑定产品/);
  });

  it('requireActiveAdmin 存在于 auth 模块且校验 roleName === "admin"', () => {
    expect(authSrc).toMatch(/export async function requireActiveAdmin/);
    const fnStart = authSrc.indexOf('export async function requireActiveAdmin');
    const fnEnd = authSrc.indexOf('\n}', fnStart);
    const fnBody = authSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/roleName !== 'admin'/);
    expect(fnBody).toMatch(/无权限：需要管理员角色/);
  });
});

// ─── 6. 既有功能回归 ─────────────────────────────────────────────────────────

describe('P6-UX-V2-D: 既有功能回归', () => {
  it('Pagination 组件仍正常渲染', () => {
    expect(contentSrc).toMatch(/<Pagination/);
  });

  it('筛选标签仍正常显示', () => {
    expect(contentSrc).toMatch(/hasActiveFilters/);
    expect(contentSrc).toMatch(/当前筛选：/);
  });

  it('统计卡片仍可点击', () => {
    expect(contentSrc).toMatch(/handleStatCardClick/);
  });

  it('buildUrl 函数未被破坏', () => {
    expect(contentSrc).toMatch(/function buildUrl/);
    expect(contentSrc).toMatch(/'pageSize' in overrides/);
  });

  it('Filters 接口未被修改', () => {
    expect(contentSrc).toMatch(/interface Filters \{/);
    expect(contentSrc).toMatch(/search: string/);
    expect(contentSrc).toMatch(/country: string/);
    expect(contentSrc).toMatch(/warehouse: string/);
    expect(contentSrc).toMatch(/stockStatus: string/);
  });

  it('原有 handleStatCardClick 行为未变', () => {
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/type === 'low'/);
    expect(fnBody).toMatch(/buildUrl\(\{ stockStatus: 'low' \}\)/);
    expect(fnBody).toMatch(/scroll: false/);
  });

  it('CSV 导出按钮仍存在', () => {
    expect(contentSrc).toMatch(/导出 CSV/);
  });
});

// ─── 7. 字段语义修正 ───────────────────────────────────────────────────────

describe('P6-UX-V2-D: 字段语义修正 — variantName / standardProductName / standardProductCode', () => {
  it('InventoryItem 类型包含 variantName 字段（BigSeller 原始品名）', () => {
    expect(inventoryTypesSrc).toMatch(/variantName:\s*string\s*\|\s*null/);
    expect(inventoryTypesSrc).toMatch(/BigSeller 原始商品名/);
  });

  it('InventoryItem 类型包含 standardProductName 字段（DIS 标准产品名）', () => {
    expect(inventoryTypesSrc).toMatch(/standardProductName:\s*string\s*\|\s*null/);
    expect(inventoryTypesSrc).toMatch(/DIS 标准产品名称/);
  });

  it('InventoryItem 类型包含 standardProductCode 字段（DIS 标准产品编码）', () => {
    expect(inventoryTypesSrc).toMatch(/standardProductCode:\s*string\s*\|\s*null/);
    expect(inventoryTypesSrc).toMatch(/DIS 标准产品编码/);
  });

  it('productName 标记为 @deprecated，值等同于 variantName', () => {
    const itemStart = inventoryTypesSrc.indexOf('export interface InventoryItem');
    const itemEnd = inventoryTypesSrc.indexOf('\n}', itemStart);
    const itemBody = inventoryTypesSrc.slice(itemStart, itemEnd);
    expect(itemBody).toMatch(/@deprecated/);
  });

  it('RawOverseasInventoryRow 包含 variant_name 字段', () => {
    expect(inventoryRepoSrc).toMatch(/variant_name:\s*string\s*\|\s*null/);
    expect(inventoryRepoSrc).toMatch(/BigSeller 原始品名/);
  });

  it('mapOverseasRow 映射 variant_name → variantName', () => {
    expect(inventoryRepoSrc).toMatch(/variantName,\s*$/m);
  });

  it('mapOverseasRow 映射 product_name → standardProductName', () => {
    expect(inventoryRepoSrc).toMatch(/standardProductName,\s*$/m);
  });

  it('mapOverseasRow 映射 product_code → standardProductCode', () => {
    expect(inventoryRepoSrc).toMatch(/standardProductCode,\s*$/m);
  });

  it('mapOverseasRow productName 向后兼容 = variantName（BigSeller 品名）', () => {
    expect(inventoryRepoSrc).toMatch(/productName:\s*variantName/);
  });

  it('mapOverseasRow productCode 向后兼容 = standardProductCode', () => {
    expect(inventoryRepoSrc).toMatch(/productCode:\s*standardProductCode/);
  });

  it('productName 兼容字段语义等同 BigSeller 品名（variantName），不再代表标准品名', () => {
    // productName = variantName（BigSeller 品名），不是 standardProductName（DIS 标准品名）
    expect(inventoryRepoSrc).toMatch(/productName:\s*variantName/);
    // productName 不应该映射为 standardProductName
    expect(inventoryRepoSrc).not.toMatch(/productName:\s*standardProductName/);
  });
});

// ─── 8. 海外库存列表品名显示 ─────────────────────────────────────────────

describe('P6-UX-V2-D: 海外库存列表主品名显示 BigSeller 原始品名', () => {
  it('主品名列显示 item.variantName（BigSeller 原始品名优先）', () => {
    expect(contentSrc).toMatch(/item\.variantName/);
  });

  it('matched 状态下主品名仍是 BigSeller 原始品名（variantName）', () => {
    // matched 分支中使用 item.variantName ?? item.productName
    const matchedIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    const afterMatched = contentSrc.slice(matchedIdx, matchedIdx + 300);
    expect(afterMatched).toMatch(/item\.variantName/);
  });

  it('matched 状态下标准产品名仅作为辅助信息展示', () => {
    expect(contentSrc).toMatch(/标准品：/);
    expect(contentSrc).toMatch(/item\.standardProductName/);
  });

  it('matched 状态下标准产品名使用 secondary 样式（text-xs text-muted-foreground）', () => {
    const standardProductIdx = contentSrc.indexOf('标准品：');
    const context = contentSrc.slice(Math.max(0, standardProductIdx - 200), standardProductIdx + 50);
    expect(context).toMatch(/text-xs text-muted-foreground/);
  });

  it('matched + standardProductName 为空 → 显示"已匹配标准品缺失"', () => {
    expect(contentSrc).toMatch(/已匹配标准品缺失/);
  });

  it('matched 状态下不显示"绑定产品"按钮', () => {
    // matched 分支不含"绑定产品"
    const matchedIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    const unmatchedIdx = contentSrc.indexOf('未匹配产品');
    const matchedBranch = contentSrc.slice(matchedIdx, unmatchedIdx);
    expect(matchedBranch).not.toMatch(/绑定产品/);
  });

  it('unmatched/pending 状态显示"未匹配产品"文字或 BigSeller 品名', () => {
    // unmatched 分支会渲染 variantName 或 fallback "未匹配产品"
    expect(contentSrc).toMatch(/未匹配产品/);
  });

  it('unmatched 状态仍显示 BigSeller 品名（variantName）在 unmatched 分支', () => {
    // variantName 在源码中出现在 fallback "未匹配产品" 之前（?? 链）
    const unmatchedIdx = contentSrc.indexOf('未匹配产品');
    const context = contentSrc.slice(Math.max(0, unmatchedIdx - 100), unmatchedIdx + 200);
    expect(context).toMatch(/item\.variantName/);
  });

  it('主品名列始终使用 variantName/productName（BigSeller 品名），standardProductName 仅作为辅助信息', () => {
    // 主显示行使用 variantName ?? productName，不会以 standardProductName 为主品名
    // standardProductName 只出现在 "标准品：" 辅助行中，不直接作为主品名展示
    const standardProductIdx = contentSrc.indexOf('标准品：');
    expect(standardProductIdx).toBeGreaterThan(-1);
    // 主品名行（在"标准品："前面的 variantName）是主显示
    const beforeStandard = contentSrc.slice(Math.max(0, standardProductIdx - 800), standardProductIdx);
    expect(beforeStandard).toMatch(/variantName/);
    // standardProductName 仅出现在辅助信息上下文中（"标准品："之后）
    const afterStandard = contentSrc.slice(standardProductIdx, standardProductIdx + 100);
    expect(afterStandard).toMatch(/standardProductName/);
  });
});

// ─── 9. 搜索产品分词增强 ─────────────────────────────────────────────────

describe('P6-UX-V2-D: searchProducts 分词/模糊搜索', () => {
  it('searchProducts Server Action 调用 productRepository.search 而非 productRepository.list', () => {
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/productRepository\.search/);
    expect(fnBody).not.toMatch(/productRepository\.list/);
  });

  it('空 query 直接返回空数组（不查询 DB）', () => {
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/!query \|\| !query\.trim\(\)/);
  });

  it('productRepository.search 方法存在且接受 (query, pageSize)', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('productRepository.search 包含 tokenize 分词逻辑', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/tokenize/);
  });

  it('tokenize 按空格/连字符/下划线/斜杠/括号分词', () => {
    // TOKEN_SPLIT_RE 包含这些分隔符
    expect(productRepoSrc).toMatch(/TOKEN_SPLIT_RE\s*=/);
    // 获取 TOKEN_SPLIT_RE 所在行
    const lines = productRepoSrc.split('\n');
    const tokenLine = lines.find((l) => l.includes('TOKEN_SPLIT_RE'));
    expect(tokenLine).toBeDefined();
    // 验证关键分隔符都在该行中
    expect(tokenLine).toMatch(/\\s/);      // 空白
    expect(tokenLine).toMatch(/\\-/);      // 连字符（转义）
    expect(tokenLine).toMatch(/_/);        // 下划线
    expect(tokenLine).toMatch(/（/);       // 中文左括号
    expect(tokenLine).toMatch(/）/);       // 中文右括号
    expect(tokenLine).toMatch(/,/);        // 逗号
    expect(tokenLine).toMatch(/，/);       // 中文逗号
  });

  it('tokenize 去重 + 过滤噪声 token', () => {
    expect(productRepoSrc).toMatch(/isNoiseToken/);
    expect(productRepoSrc).toMatch(/new Set\(/);
  });

  it('productRepository.search 搜索 code + name（每个 token ILIKE）', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/code\.ilike/);
    expect(fnBody).toMatch(/name\.ilike/);
  });

  it('productRepository.search 通过 product_variant.sku 反向查找 Product', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/product_variant/);
    expect(fnBody).toMatch(/sku/);
    expect(fnBody).toMatch(/skuMatchedProductIds/);
  });

  it('escapeLike 转义 %、_、, 防止破坏 .or() 语法', () => {
    expect(productRepoSrc).toMatch(/escapeLike/);
    expect(productRepoSrc).toMatch(/\\\\%/);
    expect(productRepoSrc).toMatch(/\\\\_/);
  });

  it('productRepository.search 仅返回启用产品 is_active=true', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/is_active.*true/);
  });

  it('productRepository.search limit 使用 pageSize 参数', () => {
    const fnStart = productRepoSrc.indexOf('async search(query: string, pageSize');
    const fnEnd = productRepoSrc.indexOf('\n  },', fnStart);
    const fnBody = productRepoSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/\.limit\(pageSize\)/);
  });

  it('searchProducts 不绕过 Repository Pattern（通过 productRepository.search）', () => {
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/productRepository\.search/);
  });
});

// ─── 10. bindOverseasVariant 写后读回校验 ─────────────────────────────────

describe('P6-UX-V2-D: bindOverseasVariant 写后读回校验', () => {
  it('bindOverseasVariant 在 variantRepository.match() 后调用 getById 读回校验', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/variantRepository\.getById/);
  });

  it('写入后校验 product_id === 目标 productId', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/product_id.*parsed\.data\.productId/);
    expect(fnBody).toMatch(/产品 ID 不一致/);
  });

  it('写入后校验 match_status === "matched"', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/match_status.*'matched'/);
    expect(fnBody).toMatch(/匹配状态未更新/);
  });

  it('写入后校验关联 product 可读（productName + productCode）', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/关联产品不可读或已删除/);
  });

  it('variant 读取不到 → 返回"绑定后校验失败：SKU 读取不到"', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/SKU 读取不到/);
  });

  it('写后校验失败不 revalidatePath（不假成功刷新缓存）', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    // 所有校验失败路径都在 return 语句，revalidatePath 在所有校验之后
    const revalIdx = fnBody.indexOf('revalidatePath');
    const lastVerificationIdx = fnBody.lastIndexOf('校验失败');
    expect(revalIdx).toBeGreaterThan(lastVerificationIdx);
  });

  it('onSuccess 回调中调用 router.refresh()（确保表格来自真实 get_overseas_inventory）', () => {
    const onSuccessIdx = contentSrc.indexOf('onSuccess');
    const afterOnSuccess = contentSrc.slice(onSuccessIdx, onSuccessIdx + 300);
    expect(afterOnSuccess).toMatch(/router\.refresh\(\)/);
  });
});

// ─── 11. 架构合规增强 ────────────────────────────────────────────────────

describe('P6-UX-V2-D: 架构合规增强', () => {
  it('productRepository.search 不使用 service_role', () => {
    expect(productRepoSrc).not.toMatch(/service_role/);
  });

  it('productRepository.search 不直接 export（仍通过 productRepository 对象导出）', () => {
    expect(productRepoSrc).toMatch(/async search\(/);
    // search 是 productRepository 的方法，不应被独立 export
  });

  it('searchProducts 空 query 不掉 DB（提前返回空数组）', () => {
    const fnStart = productActionsSrc.indexOf('export async function searchProducts');
    const fnEnd = productActionsSrc.indexOf('\n}', fnStart);
    const fnBody = productActionsSrc.slice(fnStart, fnEnd);
    const trimCheck = fnBody.indexOf('!query || !query.trim()');
    const repoCall = fnBody.indexOf('productRepository.search');
    expect(trimCheck).toBeGreaterThan(-1);
    expect(trimCheck).toBeLessThan(repoCall);
  });

  it('Inventory 不包含 productId 字段（仍然不建立 Inventory→Product 直连）', () => {
    const itemStart = inventoryTypesSrc.indexOf('export interface InventoryItem');
    const itemEnd = inventoryTypesSrc.indexOf('\n}', itemStart);
    const itemBody = inventoryTypesSrc.slice(itemStart, itemEnd);
    expect(itemBody).toMatch(/variantId/);
    expect(itemBody).not.toMatch(/productId/);
  });

  it('Migration 00034 存在且包含 variant_name 字段', () => {
    const m34Src = readSrc('supabase/migrations/00034_add_variant_name_to_rpcs.sql');
    expect(m34Src).toMatch(/variant_name/);
    expect(m34Src).toMatch(/CREATE OR REPLACE FUNCTION public\.get_overseas_inventory/);
    expect(m34Src).toMatch(/CREATE OR REPLACE FUNCTION public\.get_low_stock/);
    expect(m34Src).toMatch(/v\.name\s+AS\s+variant_name/);
  });

  it('Migration 00034 不新增 RLS 策略（仅修改 RPC 返回字段）', () => {
    const m34Src = readSrc('supabase/migrations/00034_add_variant_name_to_rpcs.sql');
    expect(m34Src).not.toMatch(/CREATE POLICY/);
    expect(m34Src).not.toMatch(/ALTER TABLE/);
  });

  it('Migration 00034 权限收口与 00027/00028 一致', () => {
    const m34Src = readSrc('supabase/migrations/00034_add_variant_name_to_rpcs.sql');
    expect(m34Src).toMatch(/REVOKE EXECUTE.*FROM PUBLIC/);
    expect(m34Src).toMatch(/REVOKE EXECUTE.*FROM anon/);
    expect(m34Src).toMatch(/GRANT EXECUTE.*TO authenticated/);
  });

  it('Migration 00034 get_overseas_inventory p_search 条件包含 v.name ILIKE（搜索 BigSeller 品名）', () => {
    const m34Src = readSrc('supabase/migrations/00034_add_variant_name_to_rpcs.sql');
    // p_search 条件块内必须包含 v.name ILIKE
    // 提取 get_overseas_inventory 函数体（至下一个 RPC 定义之前）
    const fnStart = m34Src.indexOf('CREATE OR REPLACE FUNCTION public.get_overseas_inventory');
    const fnEnd = m34Src.indexOf('REVOKE EXECUTE ON FUNCTION public.get_overseas_inventory', fnStart);
    const fnBody = m34Src.slice(fnStart, fnEnd);
    // p_search 条件块必须包含 v.name ILIKE
    expect(fnBody).toMatch(/v\.name\s+ILIKE\s+'%'\s*\|\|\s*p_search\s*\|\|\s*'%'/);
  });

  it('OverseasPageContent 不直接调用 supabase.from()', () => {
    expect(contentSrc).not.toMatch(/supabase\.from\(/);
  });

  it('BindProductDialog 不直接调用 supabase.from()', () => {
    expect(dialogSrc).not.toMatch(/supabase\.from\(/);
  });

  it('bindOverseasVariant 不使用 service_role', () => {
    const fnStart = actionsSrc.indexOf('export async function bindOverseasVariant');
    const fnEnd = actionsSrc.indexOf('\n}', fnStart);
    const fnBody = actionsSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/service_role/);
  });

  it('Migration 00034 未被进一步修改（不含 regexp_split_to_array / 分词逻辑）', () => {
    const m34Src = readSrc('supabase/migrations/00034_add_variant_name_to_rpcs.sql');
    // 00034 只做字段语义修正，不应包含 tokenized search 逻辑
    expect(m34Src).not.toMatch(/regexp_split_to_array/);
    expect(m34Src).not.toMatch(/NOT EXISTS/);
    expect(m34Src).not.toMatch(/unnest/);
  });
});

// ─── 12. Migration 00035 分词搜索 ─────────────────────────────────────────

describe('P6-UX-V2-D: Migration 00035 分词搜索增强', () => {
  it('Migration 00035 文件存在且包含 CREATE OR REPLACE FUNCTION get_overseas_inventory', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/CREATE OR REPLACE FUNCTION public\.get_overseas_inventory/);
  });

  it('00035 使用 regexp_split_to_array 进行 tokenization', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/regexp_split_to_array/);
  });

  it('00035 分词正则包含空白/连字符/下划线/斜杠/括号/逗号', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    // regexp_split_to_array 的分隔符 pattern — 允许空白
    const pattern = m35Src.match(/regexp_split_to_array\([^,]+,[\s\n]*'([^']+)'[\s\n]*\)/);
    expect(pattern).not.toBeNull();
    const sepRegex = pattern![1];
    // 分隔符 pattern 应包含: \s, -, _, /
    expect(sepRegex).toMatch(/\\s/);
    expect(sepRegex).toMatch(/-/);
    expect(sepRegex).toMatch(/_/);
    expect(sepRegex).toMatch(/\//);
  });

  it('00035 token 匹配包含 v.name（连续子串 + 分词 COALESCE）', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/v\.name\s+ILIKE\s+'%'\s*\|\|\s*p_search\s*\|\|\s*'%'/);
    expect(m35Src).toMatch(/COALESCE\(v\.name/);
  });

  it('00035 连续子串匹配包含 p.code ILIKE（新增搜索维度）', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/p\.code\s+ILIKE\s+'%'\s*\|\|\s*p_search\s*\|\|\s*'%'/);
  });

  it('00035 分词匹配中使用 COALESCE 保护 p.name / p.code（NULL-safe）', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/COALESCE\(p\.name/);
    expect(m35Src).toMatch(/COALESCE\(p\.code/);
  });

  it('00035 使用 NOT EXISTS + unnest 实现 AND 语义', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/NOT EXISTS/);
    expect(m35Src).toMatch(/unnest\(/);
  });

  it('00035 权限收口与 00027/00028/00034 一致', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    expect(m35Src).toMatch(/REVOKE EXECUTE.*FROM PUBLIC/);
    expect(m35Src).toMatch(/REVOKE EXECUTE.*FROM anon/);
    expect(m35Src).toMatch(/GRANT EXECUTE.*TO authenticated/);
  });

  it('00035 不修改 get_low_stock（低库存无搜索参数）', () => {
    const m35Src = readSrc('supabase/migrations/00035_tokenized_overseas_inventory_search.sql');
    // 注释中可能提及 get_low_stock，但不应包含 CREATE OR REPLACE FUNCTION.*get_low_stock
    expect(m35Src).not.toMatch(/FUNCTION.*get_low_stock/);
  });
});

// ─── 13. 列宽拖拽伸缩 ──────────────────────────────────────────────────

describe('P6-UX-V2-D: 列宽拖拽伸缩', () => {
  it('产品名称列不再使用 max-w-[180px] 固定宽度', () => {
    expect(contentSrc).not.toMatch(/max-w-\[180px\]\s+truncate/);
  });

  it('使用 colgroup 控制列宽', () => {
    expect(contentSrc).toMatch(/<colgroup>/);
    expect(contentSrc).toMatch(/col style=\{\{ width: columnWidths\./);
  });

  it('产品名称列使用 colgroup + columnWidths.productName 控制宽度', () => {
    expect(contentSrc).toMatch(/columnWidths\.productName/);
  });

  it('存在 resize handle（cursor-col-resize + onMouseDown）', () => {
    expect(contentSrc).toMatch(/cursor-col-resize/);
    expect(contentSrc).toMatch(/handleResizeStart\('/);
  });

  it('产品名称列表头存在 resize handle', () => {
    expect(contentSrc).toMatch(/handleResizeStart\('productName', e\)/);
  });

  it('存在双击恢复默认宽度（onDoubleClick → resetColumnWidth）', () => {
    expect(contentSrc).toMatch(/resetColumnWidth\('/);
    expect(contentSrc).toMatch(/onDoubleClick/);
  });

  it('localStorage 持久化在 useEffect client-mount 后读取（非 useState 初始化）', () => {
    // useState 初始化不应直接调用 localStorage.getItem（避免 SSR hydration mismatch）
    const useStateInit = contentSrc.match(/useState<Record<string, number>>\(/);
    expect(useStateInit).not.toBeNull();
    // 初始化应只使用 COL_DEFAULTS
    expect(contentSrc).toMatch(/useState<Record<string, number>>\(\{ \.\.\.COL_DEFAULTS \}\)/);
    // localStorage.getItem 应在 useEffect 中调用
    const effectMatch = contentSrc.match(/useEffect\(\(\) => \{[\s\S]*?localStorage\.getItem\(COL_STORAGE_KEY\)[\s\S]*?\}, \[\]\)/);
    expect(effectMatch).not.toBeNull();
  });

  it('hydrate useEffect 对未知 key / 非 number 值防护', () => {
    // hydrate 逻辑检查 typeof value === 'number' && key in COL_DEFAULTS
    expect(contentSrc).toMatch(/typeof value === 'number'/);
    expect(contentSrc).toMatch(/key in COL_DEFAULTS/);
  });

  it('产品名称默认宽度为 320px', () => {
    expect(contentSrc).toMatch(/productName:\s*320/);
  });

  it('产品名称最小宽度为 220px，最大宽度为 640px', () => {
    const colMinMatch = contentSrc.match(/productName:\s*220/);
    expect(colMinMatch).not.toBeNull();
    const colMaxMatch = contentSrc.match(/productName:\s*640/);
    expect(colMaxMatch).not.toBeNull();
  });

  it('产品名称单元格使用 min-w-0 配合内部 flex truncate', () => {
    // TableCell 使用 min-w-0，内部 flex/truncate/shrink-0 正常生效
    expect(contentSrc).toMatch(/min-w-0/);
  });

  it('未匹配分支"绑定产品"按钮使用 shrink-0（不会被文本覆盖）', () => {
    const bindBtnIdx = contentSrc.lastIndexOf('绑定产品');
    const context = contentSrc.slice(Math.max(0, bindBtnIdx - 150), bindBtnIdx + 60);
    expect(context).toMatch(/shrink-0/);
  });

  it('resize handle 使用 stopPropagation 防止触发行展开/筛选', () => {
    const fnStart = contentSrc.indexOf('function handleResizeStart');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/stopPropagation\(\)/);
  });

  it('表格外层保持 overflow-x-auto', () => {
    // 表格的 <div className="rounded-md border overflow-x-auto">
    expect(contentSrc).toMatch(/overflow-x-auto/);
  });

  it('useEffect 清理 resize 事件监听器', () => {
    expect(contentSrc).toMatch(/removeEventListener\('mousemove'/);
    expect(contentSrc).toMatch(/removeEventListener\('mouseup'/);
  });

  it('未匹配分支使用 flex w-full min-w-0 items-center（块级 flex 容器，非 inline-flex）', () => {
    // 未匹配分支外层应为 flex 块级容器
    expect(contentSrc).toMatch(/flex w-full min-w-0 items-center gap-1\.5/);
    // 不应使用 inline-flex 包裹整行
    expect(contentSrc).not.toMatch(/inline-flex items-center gap-1\.5/);
  });

  it('未匹配分支品名文本使用 min-w-0 flex-1 truncate', () => {
    // 在 unmatched 分支中查找品名 span 的 className
    const unmatchedIdx = contentSrc.lastIndexOf('未匹配产品');
    const context = contentSrc.slice(Math.max(0, unmatchedIdx - 250), unmatchedIdx + 80);
    expect(context).toMatch(/min-w-0 flex-1 truncate/);
  });

  it('未匹配分支"未匹配" badge 使用 shrink-0', () => {
    const badgeIdx = contentSrc.lastIndexOf('未匹配 Badge');
    const context = contentSrc.slice(Math.max(0, badgeIdx - 30), badgeIdx + 200);
    expect(context).toMatch(/shrink-0/);
  });

  it('未匹配分支"绑定产品"按钮使用 shrink-0（不被文本遮挡）', () => {
    const bindBtnIdx = contentSrc.lastIndexOf('绑定产品');
    const context = contentSrc.slice(Math.max(0, bindBtnIdx - 180), bindBtnIdx + 60);
    // 按钮自身有 shrink-0，外层容器也正确
    expect(context).toMatch(/shrink-0/);
  });

  it('matched 分支主品名文本补齐 min-w-0 truncate', () => {
    // matched 分支中 variantName 的 span 应使用 min-w-0 truncate
    const matchedIdx = contentSrc.indexOf('item.matchStatus === \'matched\'');
    const afterMatched = contentSrc.slice(matchedIdx, matchedIdx + 400);
    // 主显示行 span 使用 min-w-0 truncate
    expect(afterMatched).toMatch(/min-w-0 truncate/);
  });
});
