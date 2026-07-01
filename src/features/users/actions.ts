'use server';

// 用户模块 Server Actions
// 管理员维护用户状态与角色；运营不可访问用户管理
import { revalidatePath } from 'next/cache';
import { requireActiveAuth } from '@/lib/auth';
import { userRepository } from './repository';
import { UserError } from './types';
import {
  listFiltersSchema,
  userIdSchema,
  updateRoleSchema,
  toggleActiveSchema,
} from './schema';
import type { ActionResult, PaginatedResult } from '@/types/common';
import type { UserItem } from './types';

// ─── 读操作 ─────────────────────────────────────────────────

/** Admin 分页查询用户列表 */
export async function listUsers(
  filters: { roleId?: string; isActive?: boolean; page?: number; pageSize?: number } = {},
): Promise<ActionResult<PaginatedResult<UserItem>>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可查看用户列表' };
    }

    const parsed = listFiltersSchema.safeParse(filters);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '筛选参数无效' };
    }

    const result = await userRepository.list(parsed.data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof UserError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询用户列表失败，请稍后重试' };
  }
}

/** Admin 查询单个用户详情 */
export async function getUserById(
  id: string,
): Promise<ActionResult<UserItem>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可查看用户详情' };
    }

    const parsed = userIdSchema.safeParse(id);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数无效' };
    }

    const target = await userRepository.getById(parsed.data);
    if (!target) {
      return { success: false, error: '用户不存在' };
    }

    return { success: true, data: target };
  } catch (error) {
    if (error instanceof UserError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询用户详情失败，请稍后重试' };
  }
}

/** Admin 获取角色列表（供筛选下拉使用） */
export async function listRoles(): Promise<ActionResult<{ id: string; name: string }[]>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可查看角色列表' };
    }

    const roles = await userRepository.listRoles();
    return { success: true, data: roles };
  } catch (error) {
    if (error instanceof UserError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询角色列表失败，请稍后重试' };
  }
}

// ─── 写操作 ─────────────────────────────────────────────────

/** Admin 切换用户角色
 *  自保护规则（在 update_user_role_protected RPC 中原子执行）：
 *  - 不允许将自己的角色改为非管理员
 *  - 不允许移除最后一个活跃管理员 */
export async function updateUserRole(
  userId: string,
  roleId: string,
): Promise<ActionResult> {
  try {
    const currentUser = await requireActiveAuth();

    if (currentUser.roleName !== 'admin') {
      return { success: false, error: '仅管理员可修改用户角色' };
    }

    const parsed = updateRoleSchema.safeParse({ userId, roleId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数校验失败' };
    }

    // 自保护与最后管理员保护已收口至 RPC（原子化消除 TOCTOU 竞态）
    await userRepository.updateRole(parsed.data.userId, parsed.data.roleId, currentUser.id);

    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error) {
    if (error instanceof UserError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: '更新角色失败，请稍后重试' };
  }
}

/** Admin 启用/禁用用户
 *  自保护规则（在 toggle_user_active_protected RPC 中原子执行）：
 *  - 不允许禁用自己
 *  - 不允许禁用最后一个活跃管理员 */
export async function toggleUserActive(
  userId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const currentUser = await requireActiveAuth();

    if (currentUser.roleName !== 'admin') {
      return { success: false, error: '仅管理员可修改用户状态' };
    }

    const parsed = toggleActiveSchema.safeParse({ userId, isActive });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数校验失败' };
    }

    // 自保护与最后管理员保护已收口至 RPC（原子化消除 TOCTOU 竞态）
    await userRepository.toggleActive(parsed.data.userId, parsed.data.isActive, currentUser.id);

    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error) {
    if (error instanceof UserError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: '操作失败，请稍后重试' };
  }
}
