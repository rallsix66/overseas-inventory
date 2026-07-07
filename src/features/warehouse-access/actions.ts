'use server';

// 仓库分配权限模块 — Server Actions
// P5-SY13B: Admin-only 仓库分配管理操作
import { revalidatePath } from 'next/cache';
import { requireActiveAdmin } from '@/lib/auth';
import { warehouseAccessRepository } from './repository';
import { updateUserWarehousesSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { OperatorWithAssignments, AssignableWarehouse } from './types';

/** Admin: 获取所有 operator 及其当前仓库分配 */
export async function listOperatorsWithAssignments(): Promise<
  ActionResult<OperatorWithAssignments[]>
> {
  try {
    await requireActiveAdmin();

    const operators = await warehouseAccessRepository.listOperators();

    const result: OperatorWithAssignments[] = await Promise.all(
      operators.map(async (operator) => {
        const assignedIds = await warehouseAccessRepository.getUserWarehouseAssignments(
          operator.id,
        );
        return {
          operator,
          assignedWarehouseIds: [...assignedIds],
        };
      }),
    );

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === '无权限：需要管理员角色') {
        return { success: false, error: '无权限：需要管理员角色' };
      }
      if (error.message === '未登录或账户已停用') {
        return { success: false, error: '未登录或账户已停用' };
      }
    }
    return { success: false, error: '获取操作员列表失败，请稍后重试' };
  }
}

/** Admin: 获取可分配的活跃海外仓库列表 */
export async function getAssignableWarehouses(): Promise<
  ActionResult<AssignableWarehouse[]>
> {
  try {
    await requireActiveAdmin();

    const warehouses = await warehouseAccessRepository.getAssignableWarehouses();

    return { success: true, data: warehouses };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === '无权限：需要管理员角色') {
        return { success: false, error: '无权限：需要管理员角色' };
      }
      if (error.message === '未登录或账户已停用') {
        return { success: false, error: '未登录或账户已停用' };
      }
    }
    return { success: false, error: '获取仓库列表失败，请稍后重试' };
  }
}

/** Admin: 更新某个 operator 的仓库分配 */
export async function updateUserWarehouses(
  userId: string,
  warehouseIds: string[],
): Promise<ActionResult> {
  try {
    await requireActiveAdmin();

    // Zod 格式校验
    const parsed = updateUserWarehousesSchema.safeParse({ userId, warehouseIds });
    if (!parsed.success) {
      return { success: false, error: '参数校验失败：用户 ID 或仓库 ID 无效' };
    }

    // repository 层完成业务校验 + RPC 事务性写入
    const result = await warehouseAccessRepository.updateUserWarehouses(userId, warehouseIds);
    if (!result.success) {
      return { success: false, error: result.error ?? '更新仓库分配失败，请稍后重试' };
    }

    revalidatePath('/dashboard/users/warehouses');
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === '无权限：需要管理员角色') {
        return { success: false, error: '无权限：需要管理员角色' };
      }
      if (error.message === '未登录或账户已停用') {
        return { success: false, error: '未登录或账户已停用' };
      }
    }
    return { success: false, error: '更新仓库分配失败，请稍后重试' };
  }
}
