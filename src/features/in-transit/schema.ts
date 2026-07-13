import { z } from 'zod';

export const externalProviderSchema = z.enum(['best', 'golucky'], {
  error: '不支持的外部供应商',
});

export const externalCountrySchema = z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'], {
  error: '无效的国家代码',
});

export const externalSyncStatusSchema = z.enum(['active', 'stale', 'error'], {
  error: '无效的同步状态',
});

/** 外部在途主单写入校验 */
export const shipmentExternalRefSchema = z.object({
  provider: externalProviderSchema,
  external_order_no: z.string().min(1, '外部订单号不能为空'),
  waybill_no: z.string().optional().nullable(),
  country: externalCountrySchema,
  warehouse_id: z.string().uuid().optional().nullable(),
  sync_status: externalSyncStatusSchema.optional(),
  last_synced_at: z.string().optional().nullable(),
});

export type ShipmentExternalRefValues = z.infer<typeof shipmentExternalRefSchema>;

/** 外部在途商品明细校验 */
export const shipmentExternalItemSchema = z.object({
  external_ref_id: z.string().uuid(),
  external_sku: z.string().min(1, '外部SKU不能为空'),
  external_product_name: z.string().optional().nullable(),
  quantity: z.number().int().min(1, '数量最少为 1'),
  matched_variant_id: z.string().uuid().optional().nullable(),
});

export type ShipmentExternalItemValues = z.infer<typeof shipmentExternalItemSchema>;

/** 外部物流轨迹校验 */
export const trackingEventExternalSchema = z.object({
  external_ref_id: z.string().uuid(),
  provider: externalProviderSchema,
  external_event_id: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  occurred_at: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});

export type TrackingEventExternalValues = z.infer<typeof trackingEventExternalSchema>;
