import { z } from 'zod';

const countrySchema = z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']);
const urgencySchema = z.enum(['critical', 'warning', 'ok', 'data_incomplete']);

export const replenishmentFiltersSchema = z.object({
  variantId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  country: countrySchema.optional(),
  urgency: urgencySchema.optional(),
  search: z.string().trim().max(100).optional(),
  includeZero: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const inTransitDetailInputSchema = z.object({
  variantId: z.string().uuid('无效的 SKU ID'),
  warehouseId: z.string().uuid('无效的仓库 ID'),
});

export const replenishmentSuggestionRowSchema = z.object({
  variant_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  sku: z.string(),
  product_name: z.string().nullable(),
  product_code: z.string().nullable(),
  variant_name: z.string(),
  country: z.string(),
  warehouse_name: z.string(),
  avg_daily_sales: z.coerce.number().nullable(),
  lead_time: z.coerce.number().int().nullable(),
  buffer_ratio: z.coerce.number(),
  cover_mult: z.coerce.number(),
  safety_stock: z.coerce.number().int().nullable(),
  on_hand: z.coerce.number().int(),
  effective_inbound: z.coerce.number().int(),
  target_stock: z.coerce.number().int().nullable(),
  net_demand: z.coerce.number().int(),
  suggest_qty: z.coerce.number().int(),
  est_stockout_date: z.string().nullable(),
  latest_order_date: z.string().nullable(),
  urgency: urgencySchema,
});

export const replenishmentRpcResultSchema = z.object({
  data: z.array(replenishmentSuggestionRowSchema),
  total: z.coerce.number().int().nonnegative(),
});

export const inTransitDetailRowSchema = z.object({
  shipment_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  status: z.string(),
  estimated_arrival: z.string(),
  remaining_quantity: z.coerce.number().int().positive(),
  is_planned: z.boolean(),
});

