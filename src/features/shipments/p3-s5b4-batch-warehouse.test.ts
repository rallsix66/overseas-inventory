// P3-S5B4: 批量入仓 UI + 海外库存"已确认到仓"列 — 源码级静态测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

// ─── 1. 海外库存"已确认到仓"列 — P6 已从主表移除 ──────────────────────────

describe('P3-S5B4 → P6: 海外库存主表已移除"已确认到仓"列', () => {
  const actionsSrc = readSrc('src/features/inventory/actions.ts');
  const pageSrc = readSrc('src/app/dashboard/inventory/overseas/page.tsx');
  const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');

  it('getOverseasInventory 返回类型不再包含 confirmedMap', () => {
    expect(actionsSrc).not.toMatch(/confirmedMap:\s*Record<string,\s*Record<string,\s*number>>/);
  });

  it('getOverseasInventory — PERF-S1B: 仍调用 getInTransitConfirmedAggregate（用于在途数据）', () => {
    expect(actionsSrc).toMatch(/getInTransitConfirmedAggregate/);
    // 不再出现旧的 N+1 循环模式
    expect(actionsSrc).not.toMatch(/uniqueWarehouseIds/);
    expect(actionsSrc).not.toMatch(/getConfirmedWarehousedByWarehouse/);
  });

  it('getOverseasInventory — 不再构建 confirmedMap（P6 移除）', () => {
    expect(actionsSrc).not.toMatch(/confirmedMap\[row\.warehouse_id\]/);
    expect(actionsSrc).not.toMatch(/row\.confirmed_quantity/);
    // getInTransitConfirmedAggregate 仍被调用（用于在途数据），但 confirmedMap 构建块已移除
  });

  it('getOverseasInventory — 聚合 RPC 失败由 repository throw，不再 per-warehouse catch', () => {
    const invRepoSrc = readSrc('src/features/inventory/repository.ts');
    expect(invRepoSrc).toMatch(/async getInTransitConfirmedAggregate/);
  });

  it('page.tsx 不再传递 confirmedMap 到 OverseasPageContent', () => {
    expect(pageSrc).not.toMatch(/confirmedMap/);
  });

  it('OverseasPageContent Props 接口不再包含 confirmedMap', () => {
    expect(contentSrc).not.toMatch(/confirmedMap:\s*Record<string,\s*Record<string,\s*number>>/);
  });

  it('OverseasPageContent 不再接收 confirmedMap prop', () => {
    expect(contentSrc).not.toMatch(/confirmedMap/);
  });

  it('表格不包含"已确认到仓"列头', () => {
    expect(contentSrc).not.toMatch(/已确认到仓/);
  });

  it('已确认到仓列的 confirmedMap 查找逻辑已移除', () => {
    expect(contentSrc).not.toMatch(/confirmedMap\[item\.warehouseId\]\?\.\[item\.variantId\]/);
  });

  it('colSpan 已从 13 更新为 12（移除 confirmed 列后）', () => {
    expect(contentSrc).not.toMatch(/colSpan=\{13\}/);
    expect(contentSrc).toMatch(/colSpan=\{12\}/);
  });

  it('表头实际列数为 12（colSpan 不得与列数不一致）', () => {
    const headMatches = contentSrc.match(/<TableHead[\s>]/g);
    expect(headMatches).not.toBeNull();
    expect(headMatches!.length).toBe(12);
  });

  it('已确认到仓口径在在途管理/批量入仓内部保留（不在此页）', () => {
    // RPC get_in_transit_confirmed_aggregate 仍存在（for CSV 导出 + 在途数据）
    const invRepoSrc = readSrc('src/features/inventory/repository.ts');
    expect(invRepoSrc).toMatch(/getInTransitConfirmedAggregate/);
  });
});

// ─── 2. 批量 UI 页 — Server Component ──────────────────────────────────────

describe('P3-S5B4: 批量入仓 UI — Server Component', () => {
  const batchPageSrc = readSrc('src/app/dashboard/shipments/batch/page.tsx');

  it('batch 路由页存在', () => {
    expect(batchPageSrc).toBeTruthy();
    expect(batchPageSrc).toContain('BatchWarehousePageRoute');
  });

  it('Server Component 使用 getCurrentActiveUser 校验身份', () => {
    expect(batchPageSrc).toMatch(/getCurrentActiveUser/);
  });

  it('非 Admin 重定向到 /dashboard/shipments', () => {
    expect(batchPageSrc).toMatch(/roleName !== 'admin'/);
    expect(batchPageSrc).toMatch(/redirect\('\/dashboard\/shipments'\)/);
  });

  it('Server Component 调用 listEligibleForBatchWarehousing 加载首屏数据', () => {
    expect(batchPageSrc).toMatch(/listEligibleForBatchWarehousing/);
  });

  it('传递 initialData 到 BatchWarehousePage 客户端组件', () => {
    expect(batchPageSrc).toMatch(/BatchWarehousePage/);
    expect(batchPageSrc).toMatch(/initialData=\{initialData\}/);
  });
});

// ─── 3. 批量 UI 页 — Client Component ──────────────────────────────────────

describe('P3-S5B4: 批量入仓 UI — Client Component', () => {
  const src = readSrc('src/features/shipments/components/batch-warehouse-page.tsx');

  it('使用原生 checkbox（非 shadcn Checkbox）', () => {
    expect(src).toMatch(/type="checkbox"/);
    expect(src).not.toMatch(/<Checkbox/);
  });

  it('使用 batchWarehouseShipments action', () => {
    expect(src).toMatch(/batchWarehouseShipments/);
  });

  it('使用 listEligibleForBatchWarehousingAction 分页加载', () => {
    expect(src).toMatch(/listEligibleForBatchWarehousingAction/);
  });

  it('使用 getShipmentDetail 加载展开行产品明细', () => {
    expect(src).toMatch(/getShipmentDetail/);
  });

  it('管理 selectedIds Set 状态', () => {
    expect(src).toMatch(/selectedIds.*Set<string>/);
  });

  it('管理 expandedId 单项展开', () => {
    expect(src).toMatch(/expandedId.*string \| null/);
  });

  it('管理 itemsCache 缓存已加载明细', () => {
    expect(src).toMatch(/itemsCache.*Record<string,\s*ShipmentItemDetail\[\]>/);
  });

  it('管理 quantities 按 `${shipmentId}:${itemId}` key 存储原始字符串', () => {
    expect(src).toMatch(/quantities.*Record<string,\s*string>/);
  });

  it('管理 fieldErrors 字段级错误', () => {
    expect(src).toMatch(/fieldErrors.*Record<string,\s*string>/);
  });

  it('toggleSelectAll 全选/取消全选', () => {
    expect(src).toMatch(/toggleSelectAll/);
  });

  it('toggleExpand 展开行 → 若无缓存则调 getShipmentDetail', () => {
    expect(src).toMatch(/toggleExpand/);
    expect(src).toMatch(/itemsCache\[shipment\.id\]/);
  });

  it('handleQuantityChange 清除字段错误', () => {
    expect(src).toMatch(/handleQuantityChange/);
    expect(src).toMatch(/delete next\[key\]/);
  });

  it('fillAllRemaining 一键全额填入所有 item 在途余量', () => {
    expect(src).toMatch(/fillAllRemaining/);
    expect(src).toMatch(/String\(remaining\)/);
  });

  it('validateEntry 校验逻辑与 PartialWarehouseDialog 一致', () => {
    // 小数检测
    expect(src).toMatch(/不支持小数/);
    // 负数
    expect(src).toMatch(/不能为负数/);
    // 零值
    expect(src).toMatch(/必须大于 0/);
    // 超量
    expect(src).toMatch(/超过在途余量/);
    // 正则检测整数
    expect(src).toMatch(/\/\^\\d\+\$\/\.test/);
  });

  it('handleSubmit 逐条收集配置好的 shipment items', () => {
    expect(src).toMatch(/handleSubmit/);
    expect(src).toMatch(/entryItems\.push/);
  });

  it('handleSubmit 调用 batchWarehouseShipments', () => {
    expect(src).toMatch(/batchWarehouseShipments\(\{ shipments \}\)/);
  });

  it('提交后清除已成功 shipment 的缓存和输入', () => {
    expect(src).toMatch(/successIds/);
    expect(src).toMatch(/delete next\[id\]/);
  });

  it('提交后刷新列表', () => {
    expect(src).toMatch(/loadPage\(page\)/);
  });

  it('提交按钮 disabled 条件：submitting || !hasConfiguredShipments', () => {
    expect(src).toMatch(/disabled=\{submitting \|\| !hasConfiguredShipments\}/);
  });

  it('显示已选记录数', () => {
    expect(src).toMatch(/已选.*selectedIds\.size.*条记录/);
  });

  it('空数据状态 — 无待入仓在途记录', () => {
    expect(src).toMatch(/暂无待入仓的在途记录/);
  });

  it('有分页控制：上一页/下一页', () => {
    expect(src).toMatch(/上一页/);
    expect(src).toMatch(/下一页/);
    expect(src).toMatch(/共.*total.*条/);
  });

  it('提交中显示 Loader2Icon 动画 + "提交中…"', () => {
    expect(src).toMatch(/Loader2Icon/);
    expect(src).toMatch(/提交中…/);
  });

  it('结果汇总显示每笔成功/失败状态', () => {
    expect(src).toMatch(/results.*map/);
    expect(src).toMatch(/r\.success \? '入仓成功'/);
  });

  it('全局错误显示在页面顶部', () => {
    expect(src).toMatch(/globalError/);
    expect(src).toMatch(/bg-red-50/);
  });

  it('展开行含"全额确认"按钮', () => {
    expect(src).toMatch(/全额确认/);
  });

  it('返回按钮链接到 /dashboard/shipments', () => {
    expect(src).toMatch(/\/dashboard\/shipments/);
    expect(src).toMatch(/返回在途管理/);
  });

  it('页面不直接调用 supabase.from() 或 supabase.rpc()', () => {
    expect(src).not.toMatch(/supabase\.from\(/);
    expect(src).not.toMatch(/supabase\.rpc\(/);
    expect(src).not.toMatch(/createClient\(\)/);
  });
});

// ─── 4. listEligibleForBatchWarehousingAction — 行为检查 ────────────────────

describe('P3-S5B4: listEligibleForBatchWarehousingAction', () => {
  const actionsSrc = readSrc('src/features/shipments/actions.ts');

  it('actions.ts 导入 eligibleShipmentFiltersSchema', () => {
    expect(actionsSrc).toMatch(/eligibleShipmentFiltersSchema/);
  });

  it('listEligibleForBatchWarehousingAction 函数存在', () => {
    expect(actionsSrc).toMatch(/export async function listEligibleForBatchWarehousingAction/);
  });

  it('Admin-only — roleName !== admin 拒绝', () => {
    // 在函数体中有 roleName !== 'admin' 检查
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/roleName\s*!==\s*'admin'/);
  });

  it('使用 requireActiveAuth 认证', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/requireActiveAuth\(\)/);
  });

  it('调用 repository.listEligibleForBatchWarehousing 并传入 parsed.data', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 1000);
    expect(fnBody).toMatch(/listEligibleForBatchWarehousing\(/);
    // P3-S5B4 返修：safeParse 后使用 parsed.data 而非原始 filters
    expect(fnBody).toMatch(/safeParse/);
    expect(fnBody).toMatch(/parsed\.data/);
  });

  it('传递 userId 实现仓库隔离', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/user\.id/);
  });

  it('返回 ActionResult<PaginatedResult<EligibleShipmentItem>>', () => {
    expect(actionsSrc).toMatch(/ActionResult<PaginatedResult<EligibleShipmentItem>>/);
  });

  it('catch ShipmentError 返回中文错误', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 1000);
    expect(fnBody).toMatch(/ShipmentError/);
    expect(fnBody).toMatch(/查询批量入仓列表失败/);
  });

  it('Zod 校验失败返回中文错误不进入 repository', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 1000);
    // safeParse 失败 → 返回中文错误
    expect(fnBody).toMatch(/!parsed\.success/);
    expect(fnBody).toMatch(/筛选参数无效/);
    // safeParse 失败路径不调用 repository（在 return 之后）
  });
});

// ─── 4B. eligibleShipmentFiltersSchema — Zod 校验 ─────────────────────────────

describe('P3-S5B4: eligibleShipmentFiltersSchema — Zod 校验', () => {
  const schemaSrc = readSrc('src/features/shipments/schema.ts');

  it('eligibleShipmentFiltersSchema 已定义并导出', () => {
    expect(schemaSrc).toMatch(/export const eligibleShipmentFiltersSchema/);
  });

  it('country 字段为可选 enum', () => {
    expect(schemaSrc).toMatch(/country:\s*z\.enum\(\[.*'TH'.*'ID'.*'MY'.*'PH'.*'VN'.*'CN'.*\]\)\.optional\(\)/);
  });

  it('warehouseId 字段为可选 uuid', () => {
    expect(schemaSrc).toMatch(/warehouseId:\s*z\.string\(\)\.uuid\(/);
    expect(schemaSrc).toMatch(/warehouseId.*optional\(\)/);
  });

  it('page 字段为 coerce int min(1) default(1)', () => {
    expect(schemaSrc).toMatch(/page:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.default\(1\)/);
  });

  it('pageSize 字段为 coerce int min(1) max(100) default(20)', () => {
    expect(schemaSrc).toMatch(/pageSize:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.default\(20\)/);
  });

  it('EligibleShipmentFiltersValues 类型已导出', () => {
    expect(schemaSrc).toMatch(/export type EligibleShipmentFiltersValues/);
  });
});

// ─── 5. 侧边栏 — 批量入仓入口 ─────────────────────────────────────────────

describe('P3-S5B4: 侧边栏 — 批量入仓入口', () => {
  const sidebarSrc = readSrc('src/app/dashboard/_components/sidebar-nav.tsx');

  it('侧边栏包含"批量入仓"入口', () => {
    expect(sidebarSrc).toMatch(/批量入仓/);
  });

  it('批量入仓位于"物流"组下（group.label === 物流 条件中）', () => {
    // "批量入仓" 只在 SidebarNav 渲染中出现一次，与 `group.label === '物流'` 在同一表达式
    expect(sidebarSrc).toMatch(/label === '物流'[\s\S]*批量入仓/);
  });

  it('批量入仓仅 Admin 可见（isAdmin 条件）', () => {
    // isAdmin && renderItem 与批量入仓在同一 JSX 表达式中
    expect(sidebarSrc).toMatch(/isAdmin[\s\S]*批量入仓/);
  });

  it('批量入仓使用 PackageCheck 图标', () => {
    expect(sidebarSrc).toMatch(/PackageCheck/);
  });

  it('批量入仓链接到 /dashboard/shipments/batch', () => {
    expect(sidebarSrc).toMatch(/\/dashboard\/shipments\/batch/);
  });
});

// ─── 6. 架构合规 — 页面/组件无直接 Supabase 调用 ──────────────────────────

describe('P3-S5B4: 架构合规检查', () => {
  const batchCompSrc = readSrc('src/features/shipments/components/batch-warehouse-page.tsx');
  const overseasContentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');

  it('BatchWarehousePage 不直接调用 supabase', () => {
    expect(batchCompSrc).not.toMatch(/supabase\.from\(/);
    expect(batchCompSrc).not.toMatch(/supabase\.rpc\(/);
    expect(batchCompSrc).not.toMatch(/createClient/);
  });

  it('OverseasPageContent 不直接调用 supabase', () => {
    expect(overseasContentSrc).not.toMatch(/supabase\.from\(/);
    expect(overseasContentSrc).not.toMatch(/supabase\.rpc\(/);
    expect(overseasContentSrc).not.toMatch(/createClient/);
  });

  it('BatchWarehousePage 通过 Server Actions 操作数据', () => {
    // import 跨行（多函数），检查路径字符串
    expect(batchCompSrc).toContain('@/features/shipments/actions');
    expect(batchCompSrc).toMatch(/batchWarehouseShipments/);
    expect(batchCompSrc).toMatch(/getShipmentDetail/);
  });

  it('已确认到仓数据 — PERF-S1B: 通过 getInTransitConfirmedAggregate 一次性获取', () => {
    const actionsSrc = readSrc('src/features/inventory/actions.ts');
    expect(actionsSrc).toMatch(/getInTransitConfirmedAggregate/);
    // 单次 RPC 聚合替代 N+1 循环，action 内不暴露给组件直接调用
  });
});

// ─── PERF-C2A: 海外库存 getOverseasInventory 查询编排优化 ──────────────

describe('PERF-C2A — getOverseasInventory 查询编排', () => {
  const actionsSrc = readSrc('src/features/inventory/actions.ts');

  it('seal helper 存在，防止提前启动的 promise 产生 unhandledRejection', () => {
    expect(actionsSrc).toMatch(/function seal/);
    expect(actionsSrc).toContain('p.catch(() => {');
  });

  it('aggregate / warehouses / list 三个 promise 提前并行启动', () => {
    // aggregatePromise = getInTransitConfirmedAggregate
    expect(actionsSrc).toMatch(/aggregatePromise\s*=\s*inventoryRepository\.getInTransitConfirmedAggregate/);
    // warehousesPromise = getOverseasWarehouses（用 seal 包装）
    expect(actionsSrc).toMatch(/warehousesPromise\s*=\s*seal\(inventoryRepository\.getOverseasWarehouses/);
    // listPromise = getOverseasList（用 seal 包装）
    expect(actionsSrc).toMatch(/listPromise\s*=\s*seal\(inventoryRepository\.getOverseasList/);
  });

  it('aggregate 先 await，构建 variantTotalMap 后再启动 stats', () => {
    // aggregateRows = await aggregatePromise 在 stats 启动之前
    const aggregateAwaitIdx = actionsSrc.indexOf('await aggregatePromise');
    const statsStartIdx = actionsSrc.indexOf('statsPromise = inventoryRepository.getOverseasStats');
    expect(aggregateAwaitIdx).toBeGreaterThan(0);
    expect(statsStartIdx).toBeGreaterThan(aggregateAwaitIdx);
  });

  it('variantTotalMap 仍从 aggregateRows 构建', () => {
    expect(actionsSrc).toContain('variantTotalMap');
    expect(actionsSrc).toMatch(/variantTotalMap\.set\(/);
  });

  it('P6: confirmedMap 已从 getOverseasInventory 移除（不再构建）', () => {
    expect(actionsSrc).not.toMatch(/confirmedMap\[row\.warehouse_id\]/);
  });

  it('stats / warehouses / list 在第二轮 Promise.all 中并行 await', () => {
    // statsPromise + warehousesPromise + listPromise 一起 await
    const promiseAllIdx = actionsSrc.indexOf('Promise.all([');
    expect(promiseAllIdx).toBeGreaterThan(0);
    const promiseAllBlock = actionsSrc.slice(promiseAllIdx, promiseAllIdx + 200);
    expect(promiseAllBlock).toContain('statsPromise');
    expect(promiseAllBlock).toContain('warehousesPromise');
    expect(promiseAllBlock).toContain('listPromise');
  });

  it('inTransitQuantity 注入仍在 result 返回后执行', () => {
    // Promise.all 之后的 for loop 注入 inTransitQuantity
    const injectIdx = actionsSrc.indexOf('whInTransitMap.get(item.variantId)');
    const promiseAllIdx = actionsSrc.indexOf('Promise.all([');
    expect(injectIdx).toBeGreaterThan(promiseAllIdx);
    expect(actionsSrc).toContain('item.inTransitQuantity');
  });

  it('warehouses 和 list 不使用 seal 以外的独立的 await（不串行等待）', () => {
    // 仅检查 getOverseasInventory 函数体（不含 exportOverseasInventoryCsv 的分页循环 await）
    const fnStart = actionsSrc.indexOf('export async function getOverseasInventory');
    const nextFnStart = actionsSrc.indexOf('export async function updateInventoryQuantity');
    const fnBody = actionsSrc.slice(fnStart, nextFnStart);
    // warehouses + list 仅通过 seal() 提前启动，无独立 await getOverseasWarehouses / getOverseasList
    expect(fnBody).not.toMatch(/\bawait\s+inventoryRepository\.getOverseasWarehouses\(/);
    expect(fnBody).not.toMatch(/\bawait\s+inventoryRepository\.getOverseasList\(/);
  });

  it('不新增 per-warehouse N+1 查询模式', () => {
    // 确认仍无 uniqueWarehouseIds / getConfirmedWarehousedByWarehouse 等旧模式
    expect(actionsSrc).not.toMatch(/uniqueWarehouseIds/);
    expect(actionsSrc).not.toMatch(/getConfirmedWarehousedByWarehouse/);
  });

  it('getOverseasStats 仍使用 variantTotalMap 参数', () => {
    // stats 调用传入了从 aggregate 构建的 variantTotalMap
    expect(actionsSrc).toMatch(/getOverseasStats\(userId,\s*variantTotalMap\)/);
  });
});
