// 百世 API 响应 Zod 校验 Schema
//
// 使用 Zod 显式校验官方协议响应结构。
// 仅校验已确认的最小字段集合，未知字段通过 rawData 保留。
// 禁止使用 as 代替校验。
//
// 响应结构经测试环境真实 API 验证。

import { z } from 'zod';

// ─── Order Query Response ──────────────────────────────────────────

/** 商品明细（goodsInfoList 元素，字段待成功响应确认） */
export const bestOrderItemSchema = z.object({
  goodsCode: z.string().optional(),
  goodsName: z.string().optional(),
  goodsQuantity: z.number().int().finite().positive(),
});

/** queryOrderInfoByOrderNo 响应 — 扁平结构 */
export const bestOrderResponseSchema = z.object({
  success: z.boolean(),
  errorCode: z.string().optional(),
  multiMessage: z.string().optional(),
  enMessage: z.string().optional(),
  traceId: z.string().optional(),
  // 成功时可能存在的 data 字段（待成功响应确认）
  pageSize: z.number().optional(),
  currentPage: z.number().optional(),
  total: z.number().optional(),
  list: z.array(z.unknown()).optional(),
});

// ─── Logistics Trace Response ──────────────────────────────────────

/** queryLogisticsTrace 响应 — 扁平结构（字段待真实响应确认） */
export const bestLogisticsResponseSchema = z.object({
  success: z.boolean(),
  errorCode: z.string().optional(),
  multiMessage: z.string().optional(),
  enMessage: z.string().optional(),
  traceId: z.string().optional(),
  // 成功时可能存在的 data 字段（待成功响应确认）
  Items: z.array(z.unknown()).optional(),
  Data: z
    .object({
      Items: z.array(z.unknown()).optional(),
    })
    .optional(),
});
