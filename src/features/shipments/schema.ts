// 物流模块 Zod 校验 schema
import { z } from 'zod';

/** 新建在途主单 */
export const createShipmentSchema = z.object({
  vesselName: z.string().max(200).optional(),
  voyageNumber: z.string().max(100).optional(),
  originPort: z.string().max(100).optional(),
  destinationPort: z.string().max(100).optional(),
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'], {
    error: '请选择目的国',
  }),
  warehouseId: z.string().uuid().optional(),
  estimatedArrival: z.string().optional(),
  note: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid('无效的 SKU ID'),
        quantity: z.number().int('数量必须为整数').min(1, '数量最少为 1'),
      })
    )
    .min(1, '至少添加一个产品'),
});

export type CreateShipmentValues = z.infer<typeof createShipmentSchema>;

/** 物流状态推进 */
export const advanceStatusSchema = z.object({
  shipmentId: z.string().uuid(),
  nextStatus: z.enum(['loading', 'departed', 'arrived', 'customs', 'warehoused']),
  description: z.string().max(500).optional(),
});

export type AdvanceStatusValues = z.infer<typeof advanceStatusSchema>;
