'use server';

// SKU 模块 Server Actions
// 匹配/取消匹配操作仅 admin 可用
// Operator 被 requireAdmin() 与 RLS 双重拒绝
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { variantRepository, VariantError } from './repository';
import { variantMatchSchema } from './schema';
import type { ActionResult } from '@/types/common';

export async function matchVariant(
  variantId: string,
  productId: string
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const parsed = variantMatchSchema.safeParse({ variantId, productId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数校验失败' };
    }

    await variantRepository.match(parsed.data.variantId, parsed.data.productId);

    revalidatePath('/dashboard/variants');
    revalidatePath('/dashboard/variants/unmatched');
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath('/dashboard/products/[id]', 'page');
    return { success: true };
  } catch (error) {
    if (error instanceof VariantError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '匹配失败，请稍后重试' };
  }
}

export async function unmatchVariant(variantId: string): Promise<ActionResult> {
  try {
    await requireAdmin();

    await variantRepository.unmatch(variantId);

    revalidatePath('/dashboard/variants');
    revalidatePath('/dashboard/variants/unmatched');
    revalidatePath('/dashboard/products/[id]', 'page');
    return { success: true };
  } catch (error) {
    if (error instanceof VariantError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '取消匹配失败，请稍后重试' };
  }
}

export async function batchMatchVariants(
  variantIds: string[],
  productId: string
): Promise<ActionResult<{ matched: number }>> {
  try {
    await requireAdmin();

    if (!variantIds || variantIds.length === 0) {
      return { success: false, error: '请选择至少一个 SKU' };
    }

    const result = await variantRepository.batchMatch(variantIds, productId);

    revalidatePath('/dashboard/variants');
    revalidatePath('/dashboard/variants/unmatched');
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath('/dashboard/products/[id]', 'page');
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof VariantError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '批量匹配失败，请稍后重试' };
  }
}
