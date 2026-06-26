// 仓库分配权限模块 — Zod 校验
// P5-SY13B: Warehouse assignment management schemas
import { z } from 'zod';

/** 更新用户仓库分配 */
export const updateUserWarehousesSchema = z.object({
  userId: z.string().uuid('无效的用户 ID'),
  warehouseIds: z
    .array(z.string().uuid('无效的仓库 ID'))
    .max(50, '仓库数量不能超过 50'),
});

export type UpdateUserWarehousesValues = z.infer<typeof updateUserWarehousesSchema>;
