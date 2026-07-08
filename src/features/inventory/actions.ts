'use server';

// 库存模块 Server Actions
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { inventoryRepository } from './repository';
import { inventoryUpdateSchema, inventorySearchSchema, exportCsvSchema } from './schema';
import { toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';
import type { ActionResult } from '@/types/common';
import type { InventoryFilters, OverseasStats, WarehouseOption, InventoryItem } from './types';

// re-export for page use
export type { InventoryItem, OverseasStats, WarehouseOption } from './types';

/** 防止 Promise 在未被 await 时产生 unhandledRejection；调用方负责 await + 错误处理 */
function seal<T>(p: Promise<T>): Promise<T> {
  p.catch(() => { /* sealed */ });
  return p;
}

/**
 * 获取海外库存数据 — PERF-C2A: 查询编排优化（aggregate/warehouses/list 提前并行启动）
 *
 * 在途与已确认到仓由单次 RPC（get_in_transit_confirmed_aggregate）一次性聚合返回，
 * 消除 N+1 按仓循环查询模式。
 * 查询失败时抛出错误，由页面 error.tsx 边界处理
 */
export async function getOverseasInventory(filters: InventoryFilters): Promise<{
  stats: OverseasStats;
  warehouses: WarehouseOption[];
  result: { data: InventoryItem[]; total: number; page: number; pageSize: number };
}> {
  const user = await requireAuth();

  const parsed = inventorySearchSchema.safeParse({
    ...filters,
    warehouseType: 'overseas' as const,
  });
  if (!parsed.success) {
    throw new Error('筛选参数校验失败');
  }

  const userId = user.id;

  // PERF-C2A: 提前启动互不依赖的查询，减少串行等待
  // aggregate（需先完成才能构建 variantTotalMap → stats）
  // warehouses + list 完全独立，尽早启动；seal 防止提前抛错时 unhandledRejection
  const aggregatePromise = inventoryRepository.getInTransitConfirmedAggregate(userId);
  const warehousesPromise = seal(inventoryRepository.getOverseasWarehouses());
  const listPromise = seal(inventoryRepository.getOverseasList({ ...parsed.data, userId }));

  // 先等 aggregate 完成，构建 stats 所需的 variantTotalMap
  // 此时 warehouses + list 已在并行执行
  const aggregateRows = await aggregatePromise;

  // 从聚合结果构建两个数据结构
  // whInTransitMap: variantId → Map<warehouseId, inTransitQty>（用于每行 inTransitQuantity）
  const whInTransitMap = new Map<string, Map<string, number>>();
  // variantTotalMap: variantId → totalInTransit（用于统计卡片）
  const variantTotalMap = new Map<string, number>();

  for (const row of aggregateRows) {
    // 在途数据
    if (row.in_transit_quantity > 0) {
      let whMap = whInTransitMap.get(row.variant_id);
      if (!whMap) {
        whMap = new Map();
        whInTransitMap.set(row.variant_id, whMap);
      }
      whMap.set(row.warehouse_id, row.in_transit_quantity);

      variantTotalMap.set(
        row.variant_id,
        (variantTotalMap.get(row.variant_id) ?? 0) + row.in_transit_quantity,
      );
    }
  }

  // stats 需要 variantTotalMap，此时才启动；warehouses + list 已在并行执行
  const statsPromise = inventoryRepository.getOverseasStats(userId, variantTotalMap);
  const [stats, warehouses, result] = await Promise.all([
    statsPromise,
    warehousesPromise,
    listPromise,
  ]);

  // 按仓库维度合并在途数量到每个分页项
  for (const item of result.data) {
    item.inTransitQuantity = whInTransitMap.get(item.variantId)?.get(item.warehouseId) ?? 0;
  }

  return { stats, warehouses, result };
}

export async function updateInventoryQuantity(
  inventoryId: string,
  quantity: number
): Promise<ActionResult> {
  try {
    await requireAuth();

    const parsed = inventoryUpdateSchema.safeParse({ quantity });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    const ok = await inventoryRepository.updateQuantity(inventoryId, quantity);
    if (!ok) {
      return { success: false, error: '更新库存失败' };
    }

    revalidatePath('/dashboard/inventory');
    revalidatePath('/dashboard/inventory/domestic');
    revalidatePath('/dashboard/inventory/overseas');
    return { success: true };
  } catch (error) {
    return { success: false, error: '更新库存失败，请稍后重试' };
  }
}

/** 导出 CSV 最大行数 */
const CSV_EXPORT_MAX_ROWS = 10000;
/** 导出分页循环每页大小（与 inventorySearchSchema.pageSize.max 一致） */
const CSV_EXPORT_PAGE_SIZE = 100;

/** 海外库存 CSV 列定义 */
const exportColumns: CsvColumn<InventoryItem>[] = [
  { header: '国家', accessor: (r) => r.country },
  { header: '仓库', accessor: (r) => r.warehouseName },
  { header: 'SKU', accessor: (r) => r.sku },
  { header: '产品名称', accessor: (r) => r.productName ?? '未匹配' },
  { header: '当前库存', accessor: (r) => r.quantity },
  { header: '在途', accessor: (r) => r.inTransitQuantity || 0 },
  { header: '库存+在途', accessor: (r) => r.quantity + (r.inTransitQuantity || 0) },
  { header: '安全库存', accessor: (r) => r.matchStatus === 'matched' ? r.safetyStock : '—' },
  { header: '库存状态', accessor: (r) => stockStatusLabel(r) },
  { header: '最后同步时间', accessor: (r) => r.lastSyncAt ?? '' },
];

function stockStatusLabel(item: InventoryItem): string {
  if (item.quantity === 0) return '缺货';
  if (item.matchStatus !== 'matched') return '未匹配';
  if (item.quantity <= item.safetyStock) return '低库存';
  return '正常';
}

/**
 * 导出海外库存为 CSV
 *
 * 使用分页循环拉取（pageSize=100），最多累计 10000 行。
 * 超过上限时返回错误提示用户缩小筛选范围。
 */
export async function exportOverseasInventoryCsv(filters: {
  country?: string;
  warehouseId?: string;
  stockStatus?: string;
  search?: string;
}): Promise<ActionResult<string>> {
  try {
    const user = await requireAuth();

    const parsed = exportCsvSchema.safeParse(filters);
    if (!parsed.success) {
      return { success: false, error: '导出参数校验失败' };
    }

    // 获取在途聚合数据，构建 variantId → Map<warehouseId, inTransitQty> 维度映射
    const aggregateRows = await inventoryRepository.getInTransitConfirmedAggregate(user.id);
    const whInTransitMap = new Map<string, Map<string, number>>();
    for (const row of aggregateRows) {
      if (row.in_transit_quantity > 0) {
        let whMap = whInTransitMap.get(row.variant_id);
        if (!whMap) {
          whMap = new Map();
          whInTransitMap.set(row.variant_id, whMap);
        }
        whMap.set(row.warehouse_id, row.in_transit_quantity);
      }
    }

    const allRows: InventoryItem[] = [];
    let page = 1;

    // 分页循环拉取
    while (true) {
      const result = await inventoryRepository.getOverseasList({
        ...parsed.data,
        userId: user.id,
        page,
        pageSize: CSV_EXPORT_PAGE_SIZE,
      });

      // 按仓库维度回填在途数量（复用 getOverseasInventory 的聚合逻辑）
      for (const item of result.data) {
        item.inTransitQuantity = whInTransitMap.get(item.variantId)?.get(item.warehouseId) ?? 0;
      }

      allRows.push(...result.data);

      // 超限保护
      if (allRows.length > CSV_EXPORT_MAX_ROWS) {
        return {
          success: false,
          error: `导出结果超过 ${CSV_EXPORT_MAX_ROWS.toLocaleString()} 行，请缩小筛选范围后重试`,
        };
      }

      // 已拉完所有数据
      if (allRows.length >= result.total) break;

      page++;
    }

    // 空数据
    if (allRows.length === 0) {
      return { success: false, error: '无数据可导出' };
    }

    const csv = toCsv(allRows, exportColumns);
    return { success: true, data: csv };
  } catch {
    return { success: false, error: '导出失败，请稍后重试' };
  }
}
