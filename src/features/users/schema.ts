// 用户模块 Zod 校验 schema
import { z } from 'zod';

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
