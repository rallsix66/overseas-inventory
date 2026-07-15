'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveAdmin } from '@/lib/auth';
import type { ActionResult } from '@/types/common';
import { warehouseRepository } from './repository';
import { updateWarehouseReplenishmentParamsSchema } from './schema';
import type { WarehouseReplenishmentParams } from './types';

export async function updateWarehouseParams(
  input: unknown,
): Promise<ActionResult<WarehouseReplenishmentParams>> {
  try {
    await requireActiveAdmin();
    const parsed = updateWarehouseReplenishmentParamsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数校验失败' };
    }

    const data = await warehouseRepository.updateReplenishmentParams(
      parsed.data.warehouseId,
      parsed.data.bufferRatio,
      parsed.data.targetCoverMultiplier,
    );
    revalidatePath('/dashboard/replenishment');
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '更新仓库补货参数失败',
    };
  }
}

