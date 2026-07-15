import { z } from 'zod';

export const stockoutUrgencySchema = z.enum([
  'critical',
  'warning',
  'ok',
  'data_incomplete',
]);
export const baseStockStatusSchema = z.enum([
  'out_of_stock',
  'unmatched',
  'low',
  'normal',
]);
const countrySchema = z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']);

export const productOverviewParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  stockoutUrgency: stockoutUrgencySchema.optional(),
  country: countrySchema.optional(),
});

export const productVariantDetailInputSchema = z.object({
  variantId: z.string().uuid('无效的 SKU ID'),
});

const listInboundSchema = z.object({
  eta: z.string().nullable(),
  qty: z.coerce.number().int().positive(),
});

const detailInboundSchema = z.object({
  eta: z.string().nullable(),
  remaining: z.coerce.number().int().positive(),
});

const perWarehouseSchema = z.object({
  warehouse_id: z.string().uuid(),
  warehouse_name: z.string(),
  country: z.string(),
  q: z.coerce.number().int().nonnegative(),
  daily_sales: z.coerce.number().nullable(),
  inb: z.array(listInboundSchema),
  base_stock_status: baseStockStatusSchema,
});

const overviewRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  sku: z.string(),
  variant_country: z.string(),
  product_name: z.string().nullable(),
  variant_name: z.string(),
  per_warehouse: z.array(perWarehouseSchema),
  visible_on_hand: z.coerce.number().int().nonnegative(),
  visible_inbound_quantity: z.coerce.number().int().nonnegative(),
  effective_inbound: z.coerce.number().int().nonnegative(),
  eta_missing_quantity: z.coerce.number().int().nonnegative(),
  visible_total_quantity: z.coerce.number().int().nonnegative(),
  base_stock_status: baseStockStatusSchema,
  earliest_stockout: z.string().nullable(),
  stockout_urgency: stockoutUrgencySchema,
  partial_data: z.boolean(),
  domestic_status: z.literal('data_unavailable'),
});

export const productOverviewRpcSchema = z.object({
  items: z.array(overviewRowSchema),
  total_count: z.coerce.number().int().nonnegative(),
  queue_counts: z.object({
    critical: z.coerce.number().int().nonnegative(),
    warning: z.coerce.number().int().nonnegative(),
    ok: z.coerce.number().int().nonnegative(),
    data_incomplete: z.coerce.number().int().nonnegative(),
  }),
});

const assignedWarehouseDetailSchema = z.object({
  warehouse_id: z.string().uuid(),
  warehouse_name: z.string(),
  country: z.string(),
  on_hand: z.coerce.number().int().nonnegative(),
  daily_sales: z.coerce.number().nullable(),
  inbound: z.array(detailInboundSchema),
  visible_inbound_quantity: z.coerce.number().int().nonnegative(),
  eta_missing_quantity: z.coerce.number().int().nonnegative(),
  est_stockout_date: z.string().nullable(),
  effective_inbound: z.coerce.number().int().nonnegative(),
  base_stock_status: baseStockStatusSchema,
  safety_stock: z.coerce.number().int().nullable(),
  target_stock: z.coerce.number().int().nullable(),
  net_demand: z.coerce.number().int().nonnegative(),
  suggest_qty: z.coerce.number().int().nonnegative(),
  latest_order_date: z.string().nullable(),
  replenishment_urgency: stockoutUrgencySchema,
});

const countryAggregateSchema = z.object({
  country: z.string(),
  on_hand: z.coerce.number().int().nonnegative(),
  daily_sales: z.coerce.number().nullable(),
  visible_inbound_quantity: z.coerce.number().int().nonnegative(),
  eta_missing_quantity: z.coerce.number().int().nonnegative(),
  earliest_stockout: z.string().nullable(),
});

export const productVariantDetailRpcSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  sku: z.string(),
  variant_country: z.string(),
  product_name: z.string().nullable(),
  variant_name: z.string(),
  visible_on_hand: z.coerce.number().int().nonnegative(),
  visible_inbound_quantity: z.coerce.number().int().nonnegative(),
  effective_inbound: z.coerce.number().int().nonnegative(),
  eta_missing_quantity: z.coerce.number().int().nonnegative(),
  visible_total_quantity: z.coerce.number().int().nonnegative(),
  earliest_stockout: z.string().nullable(),
  stockout_urgency: stockoutUrgencySchema,
  partial_data: z.boolean(),
  domestic_status: z.literal('data_unavailable'),
  assigned_warehouse_detail: z.array(assignedWarehouseDetailSchema),
  country_agg: z.array(countryAggregateSchema),
});
