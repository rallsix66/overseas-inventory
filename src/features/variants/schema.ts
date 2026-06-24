// SKU 模块 Zod 校验 schema
import { z } from 'zod';

/** SKU 匹配到标准产品 */
export const variantMatchSchema = z.object({
  variantId: z.string().uuid('无效的 SKU ID'),
  productId: z.string().uuid('无效的产品 ID'),
});

export type VariantMatchValues = z.infer<typeof variantMatchSchema>;

/** SKU 筛选参数校验 */
export const variantSearchSchema = z.object({
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']).optional(),
  matchStatus: z.enum(['matched', 'unmatched', 'pending']).optional(),
  productId: z.string().uuid().optional(),
  search: z.string().optional(),
  archiveStatus: z.enum(['active', 'archived', 'all']).optional().default('active'),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});
