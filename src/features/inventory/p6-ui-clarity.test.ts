// P6-OVERSEAS-INVENTORY-UI-CLARITY — 海外库存 UI 清晰度优化 源码级测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');
const pageSrc = readSrc('src/app/dashboard/inventory/overseas/page.tsx');
const actionsSrc = readSrc('src/features/inventory/actions.ts');
const detailRowSrc = readSrc('src/features/shipments/components/in-transit-detail-row.tsx');
const typesSrc = readSrc('src/features/shipments/types.ts');
const repoSrc = readSrc('src/features/shipments/repository.ts');

// ─── 1. 已确认到仓列移除 ───────────────────────────────────────────────────

describe('P6-UI-CLARITY: 已确认到仓列移除', () => {
  it('主表不包含"已确认到仓"文本', () => {
    expect(contentSrc).not.toMatch(/已确认到仓/);
  });

  it('OverseasPageContent Props 不再包含 confirmedMap', () => {
    expect(contentSrc).not.toMatch(/confirmedMap/);
  });

  it('page.tsx 不再传递 confirmedMap', () => {
    expect(pageSrc).not.toMatch(/confirmedMap/);
  });

  it('getOverseasInventory 返回类型不再包含 confirmedMap', () => {
    expect(actionsSrc).not.toMatch(/confirmedMap:\s*Record/);
  });

  it('colSpan 已更新为 12', () => {
    expect(contentSrc).toMatch(/colSpan=\{12\}/);
    expect(contentSrc).not.toMatch(/colSpan=\{13\}/);
  });

  it('表头列数为 12', () => {
    const headMatches = contentSrc.match(/<TableHead[\s>]/g);
    expect(headMatches).not.toBeNull();
    expect(headMatches!.length).toBe(12);
  });

  it('getInTransitConfirmedAggregate RPC 仍保留（用于在途统计 + CSV 导出）', () => {
    expect(actionsSrc).toMatch(/getInTransitConfirmedAggregate/);
  });
});

// ─── 2. "绑定产品"入口 ──────────────────────────────────────────────────────

describe('P6-UI-CLARITY: "绑定产品"UI 占位入口', () => {
  it('包含"绑定产品"按钮', () => {
    expect(contentSrc).toMatch(/绑定产品/);
  });

  it('"绑定产品"按钮以 matchStatus !== "matched" 为入口（P6-UX-V2-D 修正：不再以 productName 为空为准）', () => {
    // 源码使用 item.matchStatus === 'matched' 三元分派
    expect(contentSrc).toMatch(/item\.matchStatus === 'matched'/);
    // 不再使用 item.productName 三元判断
    expect(contentSrc).not.toMatch(/\{item\.productName \?/);
  });

  it('matchStatus === "matched" 但 standardProductName 为空 → 显示"已匹配标准品缺失"只读异常状态', () => {
    expect(contentSrc).toMatch(/已匹配标准品缺失/);
  });

  it('handleBindProduct 设置 bindTarget 打开 BindProductDialog（P6-UX-V2-D 真实绑定）', () => {
    // P6-UX-V2-D: 替代了 P6-UI-CLARITY 的 toast 占位实现
    expect(contentSrc).toMatch(/function handleBindProduct/);
    const fnStart = contentSrc.indexOf('function handleBindProduct');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    // 设置 bindTarget 状态，不再使用 toast.info
    expect(fnBody).toMatch(/setBindTarget/);
    expect(fnBody).not.toMatch(/toast\.info/);
    expect(fnBody).not.toMatch(/即将上线/);
  });

  it('handleBindProduct 不在页面内直接调用 binding API（通过 Dialog 组件间接调用 Server Action）', () => {
    // handleBindProduct 仅负责打开 Dialog，绑定逻辑委托给 BindProductDialog
    const fnStart = contentSrc.indexOf('function handleBindProduct');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    // 不直接调 supabase / Server Action / repository
    expect(fnBody).not.toMatch(/supabase/);
    expect(fnBody).not.toMatch(/createClient/);
    expect(fnBody).not.toMatch(/repository/);
    expect(fnBody).not.toMatch(/bindOverseasVariant/);
  });

  it('"绑定产品"按钮有 stopPropagation 防止触发行展开', () => {
    expect(contentSrc).toMatch(/stopPropagation\(\)/);
  });
});

// ─── 3. 筛选器中文化 ────────────────────────────────────────────────────────

describe('P6-UI-CLARITY: 筛选器中文化', () => {
  it('国家筛选 placeholder 为"全部国家"', () => {
    expect(contentSrc).toMatch(/placeholder="全部国家"/);
  });

  it('仓库筛选 placeholder 为"全部仓库"', () => {
    expect(contentSrc).toMatch(/placeholder="全部仓库"/);
  });

  it('状态筛选 placeholder 为"全部状态"', () => {
    expect(contentSrc).toMatch(/placeholder="全部状态"/);
  });

  it('不包含裸 placeholder="国家"（已更新为全部国家）', () => {
    expect(contentSrc).not.toMatch(/placeholder="国家"/);
    expect(contentSrc).not.toMatch(/placeholder="仓库"/);
    expect(contentSrc).not.toMatch(/placeholder="状态"/);
  });
});

// ─── 4. 统计卡片可点击 ──────────────────────────────────────────────────────

describe('P6-UI-CLARITY: 统计卡片可点击', () => {
  it('StatCard 支持 onClick prop', () => {
    expect(contentSrc).toMatch(/onClick\?:\s*\(\)\s*=>\s*void/);
  });

  it('StatCard 包含 cursor-pointer + hover 样式', () => {
    expect(contentSrc).toMatch(/cursor-pointer/);
    expect(contentSrc).toMatch(/hover:shadow-md/);
  });

  it('库存总量卡片可点击 → 清除筛选', () => {
    // 库存总量卡片有 onClick={() => handleStatCardClick('all')}
    const allCards = (contentSrc.match(/handleStatCardClick\('all'\)/g) || []).length;
    expect(allCards).toBeGreaterThanOrEqual(1); // 库存总量 + SKU 数量
  });

  it('低库存卡片可点击 → stockStatus=low', () => {
    expect(contentSrc).toMatch(/handleStatCardClick\('low'\)/);
  });

  it('最后同步卡片不可点击（无 onClick）', () => {
    // 最后同步卡片 label="最后同步" 对应的 StatCard 调用没有 onClick
    // 统计 StatCard 调用中，最后同步卡片的 onClick 缺失
    const statCardCalls = contentSrc.match(/<StatCard[\s\S]*?\/>/g);
    expect(statCardCalls).not.toBeNull();
    // 至少有一个 StatCard 没有 onClick
    const withoutOnClick = statCardCalls!.filter((c) => !c.includes('onClick'));
    expect(withoutOnClick.length).toBeGreaterThanOrEqual(1);
  });

  it('在途库存卡片不可点击（在途不对应 inventory 库存状态筛选维度）', () => {
    // 在途卡片不调用 handleStatCardClick
    const afterInTransit = contentSrc.slice(contentSrc.indexOf('在途库存'));
    const nextOnClickIdx = afterInTransit.indexOf('onClick');
    const nextSlash = afterInTransit.indexOf('/>');
    // 如果在途卡片的 /> 在下一个 onClick 之前，说明它没有 onClick
    if (nextOnClickIdx === -1) {
      // 没有任何更多 onClick，在途卡片肯定没有
      expect(true).toBe(true);
    } else {
      expect(nextSlash).toBeLessThan(nextOnClickIdx);
    }
  });

  it('handleStatCardClick 函数存在', () => {
    expect(contentSrc).toMatch(/function handleStatCardClick/);
  });
});

// ─── 5. 防页面跳顶 (scroll: false) ──────────────────────────────────────────

describe('P6-UI-CLARITY: 防页面跳顶', () => {
  it('router.push 包含 scroll: false', () => {
    const pushCalls = contentSrc.match(/router\.push\([^)]+\)/g);
    expect(pushCalls).not.toBeNull();
    // 至少有一个 router.push 调用包含 { scroll: false }
    const scrollFalseCalls = contentSrc.match(/\{\s*scroll:\s*false\s*\}/g);
    expect(scrollFalseCalls).not.toBeNull();
    expect(scrollFalseCalls!.length).toBeGreaterThanOrEqual(1);
  });

  it('分页按钮使用 scroll: false', () => {
    // P6-UX-V2: Pagination 组件 onPageChange / onPageSizeChange 回调均使用 scroll: false
    const onPageChangeIdx = contentSrc.indexOf('onPageChange');
    const onPageSizeChangeIdx = contentSrc.indexOf('onPageSizeChange');
    expect(onPageChangeIdx).toBeGreaterThan(-1);
    expect(onPageSizeChangeIdx).toBeGreaterThan(-1);
    // 两个回调行都应包含 scroll: false
    const pageChangeLine = contentSrc.slice(onPageChangeIdx, onPageChangeIdx + 160);
    const sizeChangeLine = contentSrc.slice(onPageSizeChangeIdx, onPageSizeChangeIdx + 160);
    expect(pageChangeLine).toMatch(/\{\s*scroll:\s*false\s*\}/);
    expect(sizeChangeLine).toMatch(/\{\s*scroll:\s*false\s*\}/);
  });

  it('筛选器变更使用 scroll: false', () => {
    // Select onValueChange 回调中 router.push 带 scroll: false
    const scrollInSelect = contentSrc.match(/onValueChange=.*scroll:\s*false/g);
    expect(scrollInSelect).not.toBeNull();
    expect(scrollInSelect!.length).toBeGreaterThanOrEqual(3); // country/warehouse/stockStatus
  });

  it('搜索提交使用 scroll: false', () => {
    expect(contentSrc).toMatch(/router\.push\(buildUrl\(\{ search: q \}\), \{ scroll: false \}\)/);
  });
});

// ─── 6. 物流更新时间 ────────────────────────────────────────────────────────

describe('P6-UI-CLARITY: 展开物流明细 — 最近物流更新时间', () => {
  it('InTransitDetailItem 类型包含 latestTrackingAt', () => {
    expect(typesSrc).toMatch(/latestTrackingAt:\s*string\s*\|\s*null/);
  });

  it('repository 查询 shipment.updated_at 字段', () => {
    // Step 1 select 包含 updated_at
    const step1 = repoSrc.match(/\.select\('id, shipment_no, purchase_order_no, estimated_arrival, updated_at'\)/);
    expect(step1).not.toBeNull();
  });

  it('repository 查询 tracking_event 取 MAX occurred_at', () => {
    expect(repoSrc).toMatch(/tracking_event/);
    expect(repoSrc).toMatch(/\.order\('occurred_at'/);
  });

  it('repository 构建 trackingMap（shipment_id → occurred_at）', () => {
    expect(repoSrc).toMatch(/trackingMap/);
    expect(repoSrc).toMatch(/trackingMap\.set\(/);
  });

  it('results.push 包含 latestTrackingAt（优先 tracking_event，fallback shipment.updated_at）', () => {
    expect(repoSrc).toMatch(/latestTrackingAt:\s*trackingMap\.get\(ship\.id\)/);
  });

  it('InTransitDetailRow 显示"最近物流更新"文本', () => {
    expect(detailRowSrc).toMatch(/最近物流更新/);
  });

  it('有 latestTrackingAt 时显示格式化时间', () => {
    expect(detailRowSrc).toMatch(/toLocaleString\('zh-CN'/);
  });

  it('无 latestTrackingAt 时显示 "—"', () => {
    expect(detailRowSrc).toMatch(/最近物流更新 —/);
  });
});

// ─── 7. 架构合规 ────────────────────────────────────────────────────────────

describe('P6-UI-CLARITY: 架构合规', () => {
  it('不新增 Migration / RPC / RLS 引用', () => {
    expect(contentSrc).not.toMatch(/Migration/);
    expect(contentSrc).not.toMatch(/\bRPC\b/);
    expect(contentSrc).not.toMatch(/\bRLS\b/);
  });

  it('不直接调用 supabase.from()', () => {
    expect(contentSrc).not.toMatch(/supabase\.from\(/);
  });

  it('不导入 service_role', () => {
    expect(contentSrc).not.toMatch(/service_role/);
  });

  it('不修改 inventoryRepository 签名', () => {
    // getOverseasList / getOverseasStats / getInTransitConfirmedAggregate 签名不变
    const invRepoSrc = readSrc('src/features/inventory/repository.ts');
    expect(invRepoSrc).toMatch(/async getOverseasList/);
    expect(invRepoSrc).toMatch(/async getOverseasStats/);
    expect(invRepoSrc).toMatch(/async getInTransitConfirmedAggregate/);
  });

  it('"绑定产品"功能已升级为真实绑定（P6-UX-V2-D）', () => {
    // handleBindProduct 通过 setBindTarget 打开 Dialog，绑定逻辑经 Server Action 完成
    // 页面内 handleBindProduct 不直接调 await/fetch/createClient
    const fnStart = contentSrc.indexOf('function handleBindProduct');
    const fnEnd = contentSrc.indexOf('\n  }', fnStart);
    const fnBody = contentSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/await/);
    expect(fnBody).not.toMatch(/fetch/);
    expect(fnBody).not.toMatch(/createClient/);
    // 绑定通过 BindProductDialog → bindOverseasVariant Server Action 完成
    expect(contentSrc).toMatch(/BindProductDialog/);
    expect(contentSrc).toMatch(/onSuccess/);
  });
});
