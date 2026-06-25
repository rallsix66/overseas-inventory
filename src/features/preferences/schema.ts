// 用户偏好模块 Zod 校验 schema
import { z } from 'zod';

/** 切换关注状态 — variantId UUID 校验 */
export const toggleFavoriteSchema = z.object({
  variantId: z.string().uuid('无效的 SKU ID'),
});

export type ToggleFavoriteValues = z.infer<typeof toggleFavoriteSchema>;
