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
 * 获取海外库存数据 — 统计、仓库列表、分页列表
 * 查询失败时抛出错误，由页面 error.tsx 边界处理
 */
export async function getOverseasInventory(filters: InventoryFilters): Promise<{
  stats: OverseasStats;
  warehouses: WarehouseOption[];
  result: { data: InventoryItem[]; total: number; page: number; pageSize: number };
}> {
  await requireAuth();

  const parsed = inventorySearchSchema.safeParse({
    ...filters,
    warehouseType: 'overseas' as const,
  });
  if (!parsed.success) {
    throw new Error('筛选参数校验失败');
  }

  const [stats, warehouses, result] = await Promise.all([
    inventoryRepository.getOverseasStats(),
    inventoryRepository.getOverseasWarehouses(),
    inventoryRepository.getOverseasList(parsed.data),
  ]);

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
