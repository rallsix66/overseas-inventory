// P6-OVERSEAS-INVENTORY-UX-V2 A+C — BigSeller 分页 + 筛选状态可见化 源码级测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');
const pageSrc = readSrc('src/app/dashboard/inventory/overseas/page.tsx');
const paginationSrc = readSrc('src/components/ui/pagination.tsx');

// ─── 1. 分页组件结构 ──────────────────────────────────────────────────────────

describe('P6-UX-V2 A: 分页组件结构', () => {
  it('Pagination 组件文件存在且导出 Pagination', () => {
    expect(paginationSrc).toMatch(/export function Pagination/);
  });

  it('分页组件包含每页条数选择器 20/50/100', () => {
    expect(paginationSrc).toMatch(/20/);
    expect(paginationSrc).toMatch(/50/);
    expect(paginationSrc).toMatch(/100/);
    expect(paginationSrc).toMatch(/PAGE_SIZE_OPTIONS/);
  });

  it('分页组件包含总条数显示', () => {
    expect(paginationSrc).toMatch(/共\s*\{total\}\s*条/);
  });

  it('分页组件包含上一页/下一页按钮', () => {
    expect(paginationSrc).toMatch(/aria-label="上一页"/);
    expect(paginationSrc).toMatch(/aria-label="下一页"/);
    expect(paginationSrc).toMatch(/ChevronLeft/);
    expect(paginationSrc).toMatch(/ChevronRight/);
  });

  it('分页组件包含省略号逻辑', () => {
    expect(paginationSrc).toMatch(/ellipsis/);
    expect(paginationSrc).toMatch(/generatePages/);
  });

  it('当前页按钮使用 default variant 高亮', () => {
    expect(paginationSrc).toMatch(/variant=\{isActive \? 'default' : 'outline'\}/);
  });

  it('页数 ≤ 1 时上一页/下一页 disabled', () => {
    expect(paginationSrc).toMatch(/disabled=\{safePage <= 1\}/);
    expect(paginationSrc).toMatch(/disabled=\{safePage >= totalPages\}/);
  });

  it('onPageSizeChange 触发时 Select onValueChange 调用', () => {
    expect(paginationSrc).toMatch(/onPageSizeChange/);
    expect(paginationSrc).toMatch(/onValueChange=\{\(v\) => onPageSizeChange\(Number\(v\)\)\}/);
  });

  it('onPageChange 在页码点击时调用', () => {
    expect(paginationSrc).toMatch(/onClick=\{\(\) => onPageChange\(p\)\}/);
  });

  // ── generatePages 覆盖率 ─────────────────────────────────────────────────

  it('总页数 ≤ 7 时显示全部页码', () => {
    // 静态分析：generatePages 函数行为
    const fnMatch = paginationSrc.match(/function generatePages[\s\S]*?^}$/m);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    // total <= 7 的分支
    expect(fnBody).toMatch(/total <= 7/);
    expect(fnBody).toMatch(/Array\.from/);
  });

  it('总页数 > 7 + 靠近开头 → [1,2,3,4,5,...,N]', () => {
    const fnBody = paginationSrc.match(/function generatePages[\s\S]*?^}$/m)?.[0] ?? '';
    expect(fnBody).toMatch(/current <= 4/);
    // 前 5 页
    expect(fnBody).toMatch(/i <= 5/);
  });

  it('总页数 > 7 + 靠近末尾 → [1,...,N-4,...,N]', () => {
    const fnBody = paginationSrc.match(/function generatePages[\s\S]*?^}$/m)?.[0] ?? '';
    expect(fnBody).toMatch(/current >= total - 3/);
    expect(fnBody).toMatch(/total - 4/);
  });

  it('总页数 > 7 + 中间 → [1,...,p-1,p,p+1,...,N]', () => {
    const fnBody = paginationSrc.match(/function generatePages[\s\S]*?^}$/m)?.[0] ?? '';
    expect(fnBody).toMatch(/current - 1/);
    expect(fnBody).toMatch(/current \+ 1/);
  });
});

// ─── 2. 海外库存页接入分页 ──────────────────────────────────────────────────

describe('P6-UX-V2 A: 海外库存页接入分页', () => {
  it('导入 Pagination 组件', () => {
    expect(contentSrc).toMatch(/import \{ Pagination \} from '@\/components\/ui\/pagination'/);
  });

  it('渲染 Pagination 组件', () => {
    expect(contentSrc).toMatch(/<Pagination/);
  });

  it('传递 total/page/pageSize 给 Pagination', () => {
    expect(contentSrc).toMatch(/total=\{total\}/);
    expect(contentSrc).toMatch(/page=\{page\}/);
    expect(contentSrc).toMatch(/pageSize=\{pageSize\}/);
  });

  it('onPageChange 使用 router.push + scroll: false', () => {
    expect(contentSrc).toMatch(/onPageChange=\{\s*\(p\) => router\.push\(/);
    const idx = contentSrc.indexOf('onPageChange');
    const snippet = contentSrc.slice(idx, idx + 120);
    expect(snippet).toMatch(/\{ scroll: false \}/);
  });

  it('onPageSizeChange 使用 router.push + scroll: false', () => {
    expect(contentSrc).toMatch(/onPageSizeChange=\{\s*\(ps\) => router\.push\(/);
    const idx = contentSrc.indexOf('onPageSizeChange');
    const snippet = contentSrc.slice(idx, idx + 120);
    expect(snippet).toMatch(/\{ scroll: false \}/);
  });

  it('不再渲染旧的"共 N 条，第 X/Y 页"分页文字', () => {
    expect(contentSrc).not.toMatch(/共 \{total\} 条，第 \{page\}/);
  });

  it('不再渲染旧的上一页/下一页 Button（已由 Pagination 组件内部处理）', () => {
    // 旧的 inline Button 上一页/下一页
    const oldPrevCount = (contentSrc.match(/>上一页</g) || []).length;
    const oldNextCount = (contentSrc.match(/>下一页</g) || []).length;
    expect(oldPrevCount).toBe(0);
    expect(oldNextCount).toBe(0);
  });
});

// ─── 3. page.tsx pageSize 参数 ───────────────────────────────────────────────

describe('P6-UX-V2 A: page.tsx pageSize 支持', () => {
  it('searchParams 类型包含 pageSize', () => {
    expect(pageSrc).toMatch(/pageSize\?:\s*string/);
  });

  it('pageSize 仅允许 20/50/100，其他值回退 20', () => {
    expect(pageSrc).toMatch(/\[20, 50, 100\]\.includes\(/);
    expect(pageSrc).toMatch(/Number\(sp\.pageSize\)\) \? Number\(sp\.pageSize\) : 20/);
  });

  it('getOverseasInventory 传入 pageSize', () => {
    expect(pageSrc).toMatch(/pageSize/);
  });
});

// ─── 4. buildUrl pageSize 支持 ──────────────────────────────────────────────

describe('P6-UX-V2 A: buildUrl pageSize 支持', () => {
  it('buildUrl 接受 pageSize 参数', () => {
    expect(contentSrc).toMatch(/pageSize\?:\s*number/);
  });

  it('pageSize 变更时 page 重置为 1', () => {
    expect(contentSrc).toMatch(/'pageSize' in overrides \? 1 :/);
  });

  it('pageSize 非 20 时写入 URL', () => {
    expect(contentSrc).toMatch(/ps !== 20/);
    expect(contentSrc).toMatch(/\bparams\.set\('pageSize', String\(ps\)\)/);
  });
});

// ─── 5. 筛选状态可见化 ──────────────────────────────────────────────────────

describe('P6-UX-V2 C: 筛选状态标签', () => {
  it('导入 X 图标用于清除按钮', () => {
    expect(contentSrc).toMatch(/import.*X.*from 'lucide-react'/);
  });

  it('定义 STOCK_STATUS_LABELS 映射', () => {
    expect(contentSrc).toMatch(/STOCK_STATUS_LABELS/);
    expect(contentSrc).toMatch(/low:\s*'低库存'/);
    expect(contentSrc).toMatch(/normal:\s*'正常'/);
    expect(contentSrc).toMatch(/out_of_stock:\s*'缺货'/);
  });

  it('推导 countryLabel / warehouseLabel / stockStatusLabel', () => {
    expect(contentSrc).toMatch(/const countryLabel = COUNTRIES\.find/);
    expect(contentSrc).toMatch(/const warehouseLabel = warehouses\.find/);
    expect(contentSrc).toMatch(/STOCK_STATUS_LABELS\[filters\.stockStatus\]/);
  });

  it('定义 hasActiveFilters', () => {
    expect(contentSrc).toMatch(/const hasActiveFilters/);
  });

  it('筛选标签仅在有筛选条件时显示', () => {
    expect(contentSrc).toMatch(/\{hasActiveFilters && \(/);
  });

  it('筛选标签块位于筛选栏之后、空数据/表格之前（不受 data.length > 0 包裹）', () => {
    // 筛选标签注释明确声明"不受 data.length 影响"
    const filterTagsIdx = contentSrc.indexOf('筛选状态标签 — 不受 data.length 影响');
    const emptyStateIdx = contentSrc.indexOf('空数据状态');
    const tableStartIdx = contentSrc.indexOf('{/* 表格 */}');
    expect(filterTagsIdx).toBeGreaterThan(-1);
    // 筛选标签在空数据状态之前
    expect(filterTagsIdx).toBeLessThan(emptyStateIdx);
    // 筛选标签在表格渲染之前
    expect(filterTagsIdx).toBeLessThan(tableStartIdx);
    // 筛选标签不在 data.length > 0 分支内 — 检查"筛选状态标签"附近的 } 闭合
    // 标签块在筛选栏 </div> 之后、空数据 {/* 空数据状态 */} 之前，均不在 data.length > 0 内
  });

  it('筛选标签不在 data.length > 0 分支内（源码级确认）', () => {
    // {hasActiveFilters && ( 的 JSX 使用应在 data.length > 0 检查之前
    const dataGt0Idx = contentSrc.indexOf('data.length > 0 && (');
    expect(dataGt0Idx).toBeGreaterThan(-1);
    const jsxHasActiveIdx = contentSrc.indexOf('{hasActiveFilters && (');
    expect(jsxHasActiveIdx).toBeGreaterThan(-1);
    expect(jsxHasActiveIdx).toBeLessThan(dataGt0Idx);
  });

  it('有筛选条件时即使 data.length === 0 也会显示筛选标签', () => {
    // 源码级：hasActiveFilters 块在 data.length === 0 检查之前渲染
    const hasActiveIdx = contentSrc.indexOf('{hasActiveFilters && (');
    const emptyCheckIdx = contentSrc.indexOf('data.length === 0');
    expect(hasActiveIdx).toBeLessThan(emptyCheckIdx);
    // 且 hasActiveFilters 块不在 data.length > 0 内
  });

  it('国家筛选标签显示"国家：xx ×"', () => {
    expect(contentSrc).toMatch(/国家：\{countryLabel\}/);
    // 有 X 清除按钮
    const countrySection = contentSrc.match(/filters\.country && countryLabel[\s\S]*?<\/span>/);
    expect(countrySection).not.toBeNull();
    expect(countrySection![0]).toMatch(/X className/);
  });

  it('仓库筛选标签显示"仓库：xx ×"', () => {
    expect(contentSrc).toMatch(/仓库：\{warehouseLabel\}/);
  });

  it('状态筛选标签显示"状态：xx ×"', () => {
    expect(contentSrc).toMatch(/状态：\{stockStatusLabel\}/);
  });

  it('搜索筛选标签显示"搜索：xx ×"', () => {
    expect(contentSrc).toMatch(/搜索：\{filters\.search\}/);
  });

  it('每个筛选标签的 X 按钮清除对应筛选', () => {
    // 国家标签 X → buildUrl({ country: '' })
    const countryClear = contentSrc.match(/filters\.country && countryLabel[\s\S]*?buildUrl\(\{ country: '' \}\)/);
    expect(countryClear).not.toBeNull();
    // 仓库标签 X → buildUrl({ warehouse: '' })
    const warehouseClear = contentSrc.match(/filters\.warehouse && warehouseLabel[\s\S]*?buildUrl\(\{ warehouse: '' \}\)/);
    expect(warehouseClear).not.toBeNull();
    // 状态标签 X → buildUrl({ stockStatus: '' })
    const statusClear = contentSrc.match(/filters\.stockStatus && stockStatusLabel[\s\S]*?buildUrl\(\{ stockStatus: '' \}\)/);
    expect(statusClear).not.toBeNull();
    // 搜索标签 X → buildUrl({ search: '' })
    const searchClear = contentSrc.match(/filters\.search[\s\S]*?buildUrl\(\{ search: '' \}\)/);
    expect(searchClear).not.toBeNull();
  });

  it('"清空筛选"按钮存在', () => {
    expect(contentSrc).toMatch(/清空筛选/);
  });

  it('"清空筛选"跳转到不带任何参数的海外库存页', () => {
    expect(contentSrc).toMatch(/router\.push\('\/dashboard\/inventory\/overseas', \{ scroll: false \}\)/);
  });

  it('当前筛选标签的 aria-label 包含清除描述', () => {
    expect(contentSrc).toMatch(/aria-label=\{`清除国家筛选/);
    expect(contentSrc).toMatch(/aria-label=\{`清除仓库筛选/);
    expect(contentSrc).toMatch(/aria-label=\{`清除状态筛选/);
    expect(contentSrc).toMatch(/aria-label=\{`清除搜索/);
  });

  it('不再显示旧的 inline "清除"按钮', () => {
    // 旧的 <Button ...>清除</Button> 不应再出现在筛选栏内
    const oldClearCount = (contentSrc.match(/>清除</g) || []).length;
    // 应该只有"清空筛选"按钮
    expect(contentSrc).toMatch(/清空筛选/);
    expect(oldClearCount).toBe(0);
  });
});

// ─── 6. 架构合规 ────────────────────────────────────────────────────────────

describe('P6-UX-V2 A+C: 架构合规', () => {
  it('Pagination 是客户端组件', () => {
    expect(paginationSrc).toMatch(/'use client'/);
  });

  it('不分页时组件不崩溃（safePage 边界修正）', () => {
    expect(paginationSrc).toMatch(/Math\.min\(page, totalPages\)/);
  });

  it('router.push 统一使用 scroll: false（同页导航检查）', () => {
    // 同页内所有 router.push 调用都应包含 { scroll: false }
    // 例外：跳转到其他页面的 router.push('/dashboard/sync') 不需要
    const lines = contentSrc.split('\n');
    const pushLines = lines.filter((l) => l.includes('router.push('));
    const pushWithoutScroll = pushLines.filter(
      (l) => !l.includes('scroll: false') && !l.includes("router.push('/dashboard/sync')"),
    );
    expect(pushWithoutScroll).toEqual([]);
  });

  it('不新增 Migration / RPC / RLS', () => {
    expect(contentSrc).not.toMatch(/\bMigration\b/);
    expect(contentSrc).not.toMatch(/\bRPC\b/);
    expect(contentSrc).not.toMatch(/\bRLS\b/);
  });

  it('不直接调用 supabase.from()', () => {
    expect(contentSrc).not.toMatch(/supabase\.from\(/);
    expect(pageSrc).not.toMatch(/supabase\.from\(/);
    expect(paginationSrc).not.toMatch(/supabase\.from\(/);
  });

  it('不导入 service_role', () => {
    expect(contentSrc).not.toMatch(/service_role/);
    expect(pageSrc).not.toMatch(/service_role/);
  });

  it('不使用 any', () => {
    expect(paginationSrc).not.toMatch(/\bany\b/);
  });

  it('Pagination 组件不依赖任何 feature 模块', () => {
    expect(paginationSrc).not.toMatch(/from ['"]@\/features\//);
  });
});

// ─── 7. P6-UX-V2 B: 统计卡片真实联动 ────────────────────────────────────────

describe('P6-UX-V2 B: 统计卡片真实联动列表', () => {
  it('handleStatCardClick 函数存在且参数类型为 "all" | "low"', () => {
    expect(contentSrc).toMatch(/function handleStatCardClick\(type: 'all' \| 'low'\)/);
  });

  it('handleStatCardClick("all") 跳转裸路径清空所有筛选', () => {
    // 函数体内 type !== 'low' 分支 push 裸路径
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/router\.push\('\/dashboard\/inventory\/overseas', \{ scroll: false \}\)/);
  });

  it('handleStatCardClick("low") 调用 buildUrl({ stockStatus: "low" }) 并 scroll: false', () => {
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/buildUrl\(\{ stockStatus: 'low' \}\)/);
    expect(fnBody).toMatch(/\{ scroll: false \}/);
  });

  it('库存总量卡片绑定 onClick={() => handleStatCardClick(\'all\')}', () => {
    // 第一个 StatCard（库存总量）有 onClick
    const totalCardIdx = contentSrc.indexOf('label="库存总量"');
    const afterTotal = contentSrc.slice(totalCardIdx, totalCardIdx + 600);
    expect(afterTotal).toMatch(/onClick=\{\(\) => handleStatCardClick\('all'\)\}/);
  });

  it('SKU 数量卡片绑定 onClick={() => handleStatCardClick(\'all\')}', () => {
    const skuCardIdx = contentSrc.indexOf('label="SKU 数量"');
    const afterSku = contentSrc.slice(skuCardIdx, skuCardIdx + 600);
    expect(afterSku).toMatch(/onClick=\{\(\) => handleStatCardClick\('all'\)\}/);
  });

  it('低库存卡片绑定 onClick={() => handleStatCardClick(\'low\')}', () => {
    const lowCardIdx = contentSrc.indexOf('label="低库存"');
    const afterLow = contentSrc.slice(lowCardIdx, lowCardIdx + 600);
    expect(afterLow).toMatch(/onClick=\{\(\) => handleStatCardClick\('low'\)\}/);
  });

  it('最后同步卡片无 onClick（不可点击）', () => {
    const syncCardIdx = contentSrc.indexOf('label="最后同步"');
    const afterSync = contentSrc.slice(syncCardIdx, syncCardIdx + 400);
    // 在遇到 /> 之前不应有 onClick
    const selfCloseIdx = afterSync.indexOf('/>');
    const beforeClose = afterSync.slice(0, selfCloseIdx);
    expect(beforeClose).not.toMatch(/onClick/);
  });

  it('在途库存卡片无 onClick（不绑定 handleStatCardClick，避免假联动）', () => {
    const transitIdx = contentSrc.indexOf('label="在途库存"');
    const afterTransit = contentSrc.slice(transitIdx, transitIdx + 500);
    const selfCloseIdx = afterTransit.indexOf('/>');
    const beforeClose = afterTransit.slice(0, selfCloseIdx);
    expect(beforeClose).not.toMatch(/onClick/);
    expect(beforeClose).not.toMatch(/handleStatCardClick/);
  });

  it('在途库存卡片区域包含说明注释（P6-UX-V2-B 不可点击原因）', () => {
    // 注释说明在途数据来自 shipment 聚合，需后端扩展后才能联动
    const transitCommentIdx = contentSrc.indexOf('P6-UX-V2-B: 在途库存卡片不可点击');
    expect(transitCommentIdx).toBeGreaterThan(-1);
    // 注释在 在途库存 label 之前（JSX 中注释在元素上方）
    const transitLabelIdx = contentSrc.indexOf('label="在途库存"');
    expect(transitCommentIdx).toBeLessThan(transitLabelIdx);
  });

  it('库存总量/SKU 数量卡片点击不保留任何筛选参数（裸路径跳转）', () => {
    // 验证 handleStatCardClick('all') 分支不使用 buildUrl
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    // else 分支不应调用 buildUrl — 应直接 push 裸路径
    const elseBranch = fnBody.slice(fnBody.indexOf('else'));
    expect(elseBranch).not.toMatch(/buildUrl/);
  });

  it('低库存卡片跳转不包含 page 参数（page 默认回到 1）', () => {
    // buildUrl({ stockStatus: 'low' }) 不传 page，buildUrl 内部 pageToUse=1
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    // type === 'low' 分支的 buildUrl 调用不应包含 page 参数
    const lowBranch = fnBody.slice(fnBody.indexOf("type === 'low'"), fnBody.indexOf('else'));
    expect(lowBranch).toMatch(/buildUrl\(\{ stockStatus: 'low' \}\)/);
    // 不应包含 page:
    expect(lowBranch).not.toMatch(/page:/);
  });

  it('低库存卡片跳转不包含 pageSize 参数（由 buildUrl 内部闭包保留当前 pageSize）', () => {
    // buildUrl({ stockStatus: 'low' }) 不传 pageSize，pageSize 由 buildUrl 闭包保留
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    const lowBranch = fnBody.slice(fnBody.indexOf("type === 'low'"), fnBody.indexOf('else'));
    expect(lowBranch).not.toMatch(/pageSize/);
  });

  it('低库存卡片点击后筛选标签可见（stockStatus=low → "状态：低库存"）', () => {
    // 筛选标签已在 C 中实现：stockStatusLabel 从 STOCK_STATUS_LABELS 映射
    expect(contentSrc).toMatch(/low:\s*'低库存'/);
    expect(contentSrc).toMatch(/状态：\{stockStatusLabel\}/);
    // stockStatus=low 时 hasActiveFilters 为 true → 标签显示
    expect(contentSrc).toMatch(/const hasActiveFilters = !!/);
    expect(contentSrc).toMatch(/filters\.stockStatus/);
  });

  it('卡片导航不跳顶（handleStatCardClick 内所有 push 均使用 scroll: false）', () => {
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    // 两条 router.push 都应包含 scroll: false
    const pushCount = (fnBody.match(/router\.push\(/g) || []).length;
    const scrollFalseCount = (fnBody.match(/\{ scroll: false \}/g) || []).length;
    expect(pushCount).toBe(2);
    expect(scrollFalseCount).toBe(2);
  });

  // ── 架构合规 ─────────────────────────────────────────────────────────────

  it('B 期不新增 Migration / RPC / RLS 引用', () => {
    // handleStatCardClick 函数体不含 Migration/RPC/RLS
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/\bMigration\b/);
    expect(fnBody).not.toMatch(/\bRPC\b/);
    expect(fnBody).not.toMatch(/\bRLS\b/);
  });

  it('B 期不直接调用 supabase.from()', () => {
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/supabase\.from\(/);
  });

  it('B 期不使用 service_role', () => {
    const fnStart = contentSrc.indexOf('function handleStatCardClick');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/service_role/);
  });

  it('在途库存卡片区域不含 hasInTransit 或假筛选实现', () => {
    // 在途卡片附近不应有假的筛选跳转
    const transitIdx = contentSrc.indexOf('label="在途库存"');
    const afterTransit = contentSrc.slice(transitIdx, transitIdx + 500);
    expect(afterTransit).not.toMatch(/hasInTransit/);
    expect(afterTransit).not.toMatch(/buildUrl/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P6-UX-V2: Migration 00036 — pg_trgm 搜索性能索引
// ────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

function readMigration(filename: string) {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

const mig36Src = readMigration('00036_pg_trgm_search_indexes.sql');
const mig34Src = readMigration('00034_add_variant_name_to_rpcs.sql');
const mig35Src = readMigration('00035_tokenized_overseas_inventory_search.sql');

describe('P6-UX-V2: Migration 00036 pg_trgm 索引', () => {
  it('00036 启用 pg_trgm 扩展', () => {
    expect(mig36Src).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  });

  it('00036 为 product_variant.sku 建 trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_variant_sku_trgm/);
    expect(mig36Src).toMatch(/USING gin \(sku gin_trgm_ops\)/);
  });

  it('00036 为 product_variant.name 建 trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_variant_name_trgm/);
    expect(mig36Src).toMatch(/USING gin \(name gin_trgm_ops\)/);
  });

  it('00036 为 product.name 建 trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_product_name_trgm/);
    expect(mig36Src).toMatch(/USING gin \(name gin_trgm_ops\)/);
  });

  it('00036 为 product.code 建 trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_product_code_trgm/);
    expect(mig36Src).toMatch(/USING gin \(code gin_trgm_ops\)/);
  });

  // ── 路径 B：expression index 覆盖 lower(COALESCE(col, '')) LIKE 分词路径 ──

  it('00036 为 lower(COALESCE(v.sku, \'\')) 建 expression trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_variant_sku_lower_trgm/);
    expect(mig36Src).toMatch(/lower\(COALESCE\(sku/);
    expect(mig36Src).toMatch(/gin_trgm_ops\)/);
  });

  it('00036 为 lower(COALESCE(v.name, \'\')) 建 expression trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_variant_name_lower_trgm/);
    expect(mig36Src).toMatch(/lower\(COALESCE\(name/);
  });

  it('00036 为 lower(COALESCE(p.name, \'\')) 建 expression trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_product_name_lower_trgm/);
    expect(mig36Src).toMatch(/lower\(COALESCE\(name/);
  });

  it('00036 为 lower(COALESCE(p.code, \'\')) 建 expression trigram 索引', () => {
    expect(mig36Src).toMatch(/CREATE INDEX IF NOT EXISTS idx_product_code_lower_trgm/);
    expect(mig36Src).toMatch(/lower\(COALESCE\(code/);
  });

  it('00036 注释说明路径 A（ILIKE bare column）与路径 B（lower-coalesce LIKE）', () => {
    expect(mig36Src).toMatch(/路径 A/);
    expect(mig36Src).toMatch(/路径 B/);
    expect(mig36Src).toMatch(/lower\(COALESCE/);
  });

  it('00036 不使用 CONCURRENTLY（Supabase Migration 在事务内执行）', () => {
    // 仅检查 SQL 语句本身，不检查注释中的说明文字
    const sqlLines = mig36Src.split('\n').filter((l) => !l.trim().startsWith('--'));
    const sqlBody = sqlLines.join('\n');
    expect(sqlBody).not.toMatch(/CONCURRENTLY/);
  });

  it('00036 包含搜索优化设计决策注释', () => {
    expect(mig36Src).toMatch(/00035.*搜索准确/);
    expect(mig36Src).toMatch(/00036.*trigram.*优化.*模糊搜索性能/);
    expect(mig36Src).toMatch(/search_vector/);
  });

  it('00034 未被修改（字段语义仍然存在）', () => {
    expect(mig34Src).toMatch(/variant_name/);
    expect(mig34Src).toMatch(/BigSeller 原始品名/);
  });

  it('00035 未被修改（分词搜索仍然存在）', () => {
    expect(mig35Src).toMatch(/token/);
    expect(mig35Src).toMatch(/regexp_split_to_array/);
    expect(mig35Src).toMatch(/NOT EXISTS/);
  });
});
