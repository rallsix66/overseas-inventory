// P3-S5B4: 批量入仓 UI + 海外库存"已确认到仓"列 — 源码级静态测试
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

// ─── 1. 海外库存"已确认到仓"列 — 数据层 ──────────────────────────────────

describe('P3-S5B4: 海外库存"已确认到仓"列 — 数据层', () => {
  const actionsSrc = readSrc('src/features/inventory/actions.ts');
  const pageSrc = readSrc('src/app/dashboard/inventory/overseas/page.tsx');
  const contentSrc = readSrc('src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx');

  it('getOverseasInventory 返回类型包含 confirmedMap', () => {
    expect(actionsSrc).toMatch(/confirmedMap:\s*Record<string,\s*Record<string,\s*number>>/);
  });

  it('getOverseasInventory 调用 getConfirmedWarehousedByWarehouse 聚合', () => {
    expect(actionsSrc).toMatch(/getConfirmedWarehousedByWarehouse/);
  });

  it('getOverseasInventory 对每仓并行查询已确认数据', () => {
    expect(actionsSrc).toMatch(/Promise\.all/);
    expect(actionsSrc).toMatch(/uniqueWarehouseIds\.map/);
  });

  it('getOverseasInventory 单仓失败不阻塞页面', () => {
    // catch 块返回空聚合
    expect(actionsSrc).toMatch(/catch/);
    expect(actionsSrc).toMatch(/agg:\s*\[\]/);
  });

  it('page.tsx 传递 confirmedMap 到 OverseasPageContent', () => {
    expect(pageSrc).toMatch(/confirmedMap=\{data\.confirmedMap\}/);
  });

  it('OverseasPageContent Props 接口包含 confirmedMap', () => {
    expect(contentSrc).toMatch(/confirmedMap:\s*Record<string,\s*Record<string,\s*number>>/);
    expect(contentSrc).toMatch(/P3-S5B4.*warehouseId.*variantId.*confirmedQuantity/);
  });

  it('OverseasPageContent 接收 confirmedMap prop', () => {
    expect(contentSrc).toMatch(/confirmedMap\s*[,}]/);
  });

  it('表格新增"已确认到仓"列头', () => {
    expect(contentSrc).toMatch(/已确认到仓/);
  });

  it('已确认到仓列从 confirmedMap 查找数据', () => {
    expect(contentSrc).toMatch(/confirmedMap\[item\.warehouseId\]\?\.\[item\.variantId\]/);
  });

  it('已确认到仓列为 0 时显示 —', () => {
    expect(contentSrc).toMatch(/qty > 0 \? qty\.toLocaleString\(\) : '—'/);
  });

  it('展开行 colSpan 更新为 14（新增已确认到仓列）', () => {
    expect(contentSrc).toMatch(/colSpan=\{14\}/);
  });

  it('confirmedMap 注释说明口径（不含 BigSeller 吸收）', () => {
    // 注释说明仅 customs 或 warehoused + bigseller_absorbed_at IS NULL
    expect(contentSrc).toMatch(/P3-S5B4.*DIS 已确认到仓/);
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

  it('调用 repository.listEligibleForBatchWarehousing', () => {
    const fnStart = actionsSrc.indexOf('listEligibleForBatchWarehousingAction');
    const fnBody = actionsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/listEligibleForBatchWarehousing\(/);
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
    const fnBody = actionsSrc.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/ShipmentError/);
    expect(fnBody).toMatch(/查询批量入仓列表失败/);
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

  it('已确认到仓数据通过 getOverseasInventory action 获取', () => {
    const actionsSrc = readSrc('src/features/inventory/actions.ts');
    expect(actionsSrc).toMatch(/getConfirmedWarehousedByWarehouse/);
    // repository 调用封装在 action 内，不暴露给组件
  });
});
