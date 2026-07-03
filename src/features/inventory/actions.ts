'use server';

// 库存模块 Server Actions
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { inventoryRepository } from './repository';
import { inventoryUpdateSchema, inventorySearchSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { InventoryFilters, OverseasStats, WarehouseOption, InventoryItem } from './types';

// re-export for page use
export type { InventoryItem, OverseasStats, WarehouseOption } from './types';

/**
 * 获取海外库存数据 — PERF-S1B: 统计、仓库列表、分页列表 + 在途/已确认聚合
 *
 * 在途与已确认到仓由单次 RPC（get_in_transit_confirmed_aggregate）一次性聚合返回，
 * 消除 N+1 按仓循环查询模式。
 * 查询失败时抛出错误，由页面 error.tsx 边界处理
 */
export async function getOverseasInventory(filters: InventoryFilters): Promise<{
  stats: OverseasStats;
  warehouses: WarehouseOption[];
  result: { data: InventoryItem[]; total: number; page: number; pageSize: number };
  /** P3-S5B4: warehouseId → variantId → confirmedQuantity */
  confirmedMap: Record<string, Record<string, number>>;
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

  // PERF-S1B: 单次 RPC 获取所有仓库的在途 + 已确认到仓聚合
  const aggregateRows = await inventoryRepository.getInTransitConfirmedAggregate(userId);

  // 从聚合结果构建三个数据结构
  // whInTransitMap: variantId → Map<warehouseId, inTransitQty>（用于每行 inTransitQuantity）
  const whInTransitMap = new Map<string, Map<string, number>>();
  // variantTotalMap: variantId → totalInTransit（用于统计卡片）
  const variantTotalMap = new Map<string, number>();
  // confirmedMap: warehouseId → { variantId: confirmedQuantity }
  const confirmedMap: Record<string, Record<string, number>> = {};

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

    // 已确认到仓数据
    if (row.confirmed_quantity > 0) {
      if (!confirmedMap[row.warehouse_id]) {
        confirmedMap[row.warehouse_id] = {};
      }
      confirmedMap[row.warehouse_id][row.variant_id] = row.confirmed_quantity;
    }
  }

  // getOverseasList 内部调用 get_overseas_inventory RPC（SQL 层过滤/排序/分页）
  const [stats, warehouses, result] = await Promise.all([
    inventoryRepository.getOverseasStats(userId, variantTotalMap),
    inventoryRepository.getOverseasWarehouses(),
    inventoryRepository.getOverseasList({ ...parsed.data, userId }),
  ]);

  // 按仓库维度合并在途数量到每个分页项
  for (const item of result.data) {
    item.inTransitQuantity = whInTransitMap.get(item.variantId)?.get(item.warehouseId) ?? 0;
  }

  return { stats, warehouses, result, confirmedMap };
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
