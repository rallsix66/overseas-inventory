// 用户模块 Zod 校验 schema
import { z } from 'zod';

/** 分页与筛选 */
export const listFiltersSchema = z.object({
  roleId: z.string().uuid('无效的角色 ID').optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export type ListFiltersValues = z.infer<typeof listFiltersSchema>;

/** 用户 ID */
export const userIdSchema = z.string().uuid('无效的用户 ID');

/** 切换用户角色 */
export const updateRoleSchema = z.object({
  userId: z.string().uuid('无效的用户 ID'),
  roleId: z.string().uuid('无效的角色 ID'),
});

export type UpdateRoleValues = z.infer<typeof updateRoleSchema>;

/** 切换用户状态 */
export const toggleActiveSchema = z.object({
  userId: z.string().uuid('无效的用户 ID'),
  isActive: z.boolean(),
});

export type ToggleActiveValues = z.infer<typeof toggleActiveSchema>;
