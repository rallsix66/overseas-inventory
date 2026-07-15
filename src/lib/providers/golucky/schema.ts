// 喜运达(golucky) API Zod 校验
//
// 校验 API 响应 envelope 结构，不校验专有业务字段。
//
// 顶层 code 字段兼容 string 和 number（Golucky 实际返回 number，
// 但文档示例为 string），解析后统一转换为 string 保持内部契约稳定。

import { z } from 'zod';

/** 响应顶层 code：同时接受 string 和 number，归一化为 string */
const envelopeCode = z.union([z.string(), z.number()]).transform(String).optional();

/** tracking/list 轨迹节点 */
export const goluckyTrackingNodeSchema = z.object({
  code: z.string().optional(),
  title: z.string().optional(),
  enTitle: z.string().optional(),
  desc: z.string().optional(),
  enDesc: z.string().optional(),
  time: z.number().optional(),
});

/** tracking/list 响应 */
export const goluckyTrackingResponseSchema = z.object({
  data: z.array(goluckyTrackingNodeSchema).optional(),
  code: envelopeCode,
  message: z.string().optional(),
});

/** gettoken 响应 */
export const goluckyTokenResponseSchema = z.object({
  data: z
    .object({
      accessToken: z.string().optional(),
      expiresIn: z.number().optional(),
    })
    .optional(),
  code: envelopeCode,
  message: z.string().optional(),
});
