'use server';

import { requireActiveAuth } from '@/lib/auth';
import type { ActionResult } from '@/types/common';
import { productOverviewRepository } from './repository';
import { productVariantDetailInputSchema } from './schema';
import type { ProductVariantDetail } from './types';

export async function getProductVariantDetailAction(input: {
  variantId: string;
}): Promise<ActionResult<ProductVariantDetail>> {
  try {
    const user = await requireActiveAuth();
    const parsed = productVariantDetailInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? '产品 SKU 参数无效',
      };
    }

    const data = await productOverviewRepository.getProductVariantDetail(
      user.id,
      parsed.data.variantId,
    );
    return { success: true, data };
  } catch {
    return { success: false, error: '产品详情加载失败，请稍后重试' };
  }
}
