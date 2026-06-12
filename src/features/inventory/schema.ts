// 库存模块 Zod 校验 schema
import { z } from 'zod';

/** 库存数量更新 */
export const inventoryUpdateSchema = z.object({
  quantity: z
    .number()
    .int('库存数量必须为整数')
    .min(0, '库存数量不能为负数'),
});

export type InventoryUpdateValues = z.infer<typeof inventoryUpdateSchema>;

/** 库存筛选参数 */
export const inventorySearchSchema = z.object({
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']).optional(),
  warehouseType: z.enum(['domestic', 'overseas']).optional(),
  warehouseId: z.string().uuid().optional(),
  stockStatus: z.enum(['low', 'normal', 'out_of_stock']).optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});
