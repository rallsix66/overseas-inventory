// 喜运达(golucky) API Zod 校验
//
// 校验 API 响应 envelope 结构，不校验专有业务字段。

import { z } from 'zod';

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
  code: z.string().optional(),
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
  code: z.string().optional(),
  message: z.string().optional(),
});
