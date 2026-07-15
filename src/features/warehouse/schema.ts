import { z } from 'zod';

export const updateWarehouseReplenishmentParamsSchema = z.object({
  warehouseId: z.string().uuid('无效的仓库 ID'),
  bufferRatio: z.coerce.number().finite().min(0, '安全库存缓冲比例不能小于 0'),
  targetCoverMultiplier: z.coerce
    .number()
    .finite()
    .positive('目标覆盖倍数必须大于 0'),
});

export type UpdateWarehouseReplenishmentParamsValues = z.infer<
  typeof updateWarehouseReplenishmentParamsSchema
>;

