'use server';

import { requireActiveAuth } from '@/lib/auth';
import { shipmentRepository } from '@/features/shipments/repository';
import type { ActionResult } from '@/types/common';
import { inTransitDetailInputSchema } from './schema';
import type { ReplenishmentInTransitDetail } from './types';

export async function getReplenishmentInTransitDetail(
  variantId: string,
  warehouseId: string,
): Promise<ActionResult<ReplenishmentInTransitDetail[]>> {
  try {
    const user = await requireActiveAuth();
    const parsed = inTransitDetailInputSchema.safeParse({ variantId, warehouseId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数校验失败' };
    }

    const data = await shipmentRepository.getInTransitDetail(user.id, {
      variantId: parsed.data.variantId,
      warehouseId: parsed.data.warehouseId,
    });
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '查询在途明细失败',
    };
  }
}
