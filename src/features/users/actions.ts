'use server';

// 用户模块 Server Actions
// 所有用户管理操作仅 admin 可用
import { revalidatePath } from 'next/cache';
import { requireAdmin, getCurrentUser } from '@/lib/auth';
import { userRepository } from './repository';
import { updateRoleSchema } from './schema';
import type { ActionResult } from '@/types/common';

export async function updateUserRole(
  userId: string,
  roleId: string
): Promise<ActionResult> {
  try {
    const currentUser = await requireAdmin();

    // 不允许将自己的角色改为非 admin（防止锁死）
    if (userId === currentUser.id) {
      // 查询目标角色名
      const targetUser = await userRepository.getById(userId);
      if (targetUser && targetUser.roleName !== 'admin') {
        return { success: false, error: '不允许将自己的角色改为非管理员' };
      }
    }

    const parsed = updateRoleSchema.safeParse({ userId, roleId });
    if (!parsed.success) {
      return { success: false, error: '参数校验失败' };
    }

    const ok = await userRepository.updateRole(userId, roleId);
    if (!ok) {
      return { success: false, error: '更新角色失败' };
    }

    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '更新角色失败，请稍后重试' };
  }
}

export async function toggleUserActive(
  userId: string,
  isActive: boolean
): Promise<ActionResult> {
  try {
    const currentUser = await requireAdmin();

    // 不允许禁用自己
    if (userId === currentUser.id && !isActive) {
      return { success: false, error: '不允许禁用自己的账号' };
    }

    const ok = await userRepository.toggleActive(userId, isActive);
    if (!ok) {
      return { success: false, error: '操作失败' };
    }

    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '操作失败，请稍后重试' };
  }
}
