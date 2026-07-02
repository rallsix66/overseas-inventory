'use server';

// 库存模块 Server Actions
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { inventoryRepository } from './repository';
import { shipmentRepository } from '@/features/shipments/repository';
import { inventoryUpdateSchema, inventorySearchSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { InventoryFilters, OverseasStats, WarehouseOption, InventoryItem } from './types';

// re-export for page use
export type { InventoryItem, OverseasStats, WarehouseOption } from './types';

/**
 * 获取海外库存数据 — 统计、仓库列表、分页列表 + 当前用户关注状态 + P3-S2C 在途数量
 * + P3-S5B4 已确认到仓数量
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

  // P3-S2D: 加载按仓库维度的在途聚合数据（与库存查询并行）
  const whInTransitMap = await shipmentRepository.getInTransitByVariantAndWarehouse(userId);

  // 从仓库维度在途 Map 计算 variant 总在途（供统计卡片使用）
  const variantTotalMap = new Map<string, number>();
  for (const [variantId, whMap] of whInTransitMap) {
    let total = 0;
    for (const [, qty] of whMap) {
      total += qty;
    }
    if (total > 0) variantTotalMap.set(variantId, total);
  }

  // getOverseasList 内部已完成：归档过滤 → 关注标记 → 排序（关注置顶）→ 分页
  const [stats, warehouses, result] = await Promise.all([
    inventoryRepository.getOverseasStats(userId, variantTotalMap),
    inventoryRepository.getOverseasWarehouses(),
    inventoryRepository.getOverseasList({ ...parsed.data, userId }),
  ]);

  // P3-S2D: 按仓库维度合并在途数量到每个分页项
  for (const item of result.data) {
    item.inTransitQuantity = whInTransitMap.get(item.variantId)?.get(item.warehouseId) ?? 0;
  }

  // P3-S5B4: 加载各仓库已确认到仓数量（并行查询所有出现过的仓库）
  const confirmedMap: Record<string, Record<string, number>> = {};
  const uniqueWarehouseIds = [...new Set(result.data.map((item) => item.warehouseId))];
  if (uniqueWarehouseIds.length > 0) {
    const confirmedResults = await Promise.all(
      uniqueWarehouseIds.map(async (whId) => {
        try {
          const agg = await shipmentRepository.getConfirmedWarehousedByWarehouse(whId);
          return { warehouseId: whId, agg };
        } catch {
          // 单仓查询失败不阻塞页面，返回空聚合
          return { warehouseId: whId, agg: [] as { variantId: string; confirmedQuantity: number }[] };
        }
      }),
    );
    for (const { warehouseId, agg } of confirmedResults) {
      const variantMap: Record<string, number> = {};
      for (const { variantId, confirmedQuantity } of agg) {
        variantMap[variantId] = confirmedQuantity;
      }
      confirmedMap[warehouseId] = variantMap;
    }
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
