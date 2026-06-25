'use server';

// 库存模块 Server Actions
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { inventoryRepository } from './repository';
import { preferencesRepository } from '@/features/preferences/repository';
import { inventoryUpdateSchema, inventorySearchSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { InventoryFilters, OverseasStats, WarehouseOption, InventoryItem } from './types';

// re-export for page use
export type { InventoryItem, OverseasStats, WarehouseOption } from './types';

/**
 * 获取海外库存数据 — 统计、仓库列表、分页列表 + 当前用户关注状态
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

  const [stats, warehouses, result, favoritedVariantIds] = await Promise.all([
    inventoryRepository.getOverseasStats(userId),
    inventoryRepository.getOverseasWarehouses(),
    inventoryRepository.getOverseasList({ ...parsed.data, userId }),
    preferencesRepository.getFavoritedVariantIds(userId).catch(() => new Set<string>()),
  ]);

  // 标记当前用户关注状态
  if (favoritedVariantIds.size > 0) {
    result.data = result.data.map((item) => ({
      ...item,
      isFavorited: favoritedVariantIds.has(item.variantId),
    }));
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
