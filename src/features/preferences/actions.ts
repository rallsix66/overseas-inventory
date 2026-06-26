'use server';

// 用户偏好模块 Server Actions
// P5-SY12: 特别关注阶段 B — toggleFavoriteAction
// 所有登录用户均可关注/取消关注（requireActiveAuth）
import { revalidatePath } from 'next/cache';
import { requireActiveAuth } from '@/lib/auth';
import { preferencesRepository } from './repository';
import { warehouseAccessRepository } from '@/features/warehouse-access/repository';
import { toggleFavoriteSchema } from './schema';
import { preferenceErrorMessage } from './types';
import type { ActionResult } from '@/types/common';

export type ToggleFavoriteResult = ActionResult<{ isFavorited: boolean }>;

/**
 * 切换关注状态 — 所有已登录用户均可操作
 *
 * 阶段 B 不做仓库权限校验（阶段 D 才引入 user_warehouses）。
 * operator 可关注任何 variant，Dashboard 显示其关注列表。
 *
 * 失败路径不调用 revalidatePath（仅确认写入成功后刷新页面）。
 */
export async function toggleFavoriteAction(variantId: string): Promise<ToggleFavoriteResult> {
  try {
    const user = await requireActiveAuth();

    // 1. Zod 校验
    const parsed = toggleFavoriteSchema.safeParse({ variantId });
    if (!parsed.success) {
      return { success: false, error: '无效的 SKU ID' };
    }

    // 2. P5-SY13A: 仓库权限校验 — operator 不可关注不可访问仓库的 SKU
    const canAccess = await warehouseAccessRepository.canAccessVariant(user.id, parsed.data.variantId);
    if (!canAccess) {
      return { success: false, error: '无权操作该仓库 SKU' };
    }

    // 3. 执行关注切换
    const result = await preferencesRepository.toggleFavorite(user.id, parsed.data.variantId);

    // 4. 操作失败 → 返回中文错误，不刷新页面
    if (!result.success) {
      return {
        success: false,
        error: preferenceErrorMessage(result.error.code),
      };
    }

    // 5. 只有真实成功后刷新相关页面
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/inventory/overseas');

    return { success: true, data: { isFavorited: result.data.favorited } };
  } catch (error) {
    if (error instanceof Error && error.message === '未登录或账户已停用') {
      return { success: false, error: '未登录或账户已停用' };
    }
    return { success: false, error: '操作失败，请稍后重试' };
  }
}
