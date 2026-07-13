// 喜运达(golucky) Dry Run — 只拉轨迹+解析+校验，不写库

import { GoluckyClient, type TokenCache } from './client';
import type { GoluckyDryRunResult } from './types';
import { GoluckyApiError } from './types';

/**
 * 对单运单号执行只读 Dry Run。
 *
 * 拉取轨迹 → 解析 → 校验 → 返回结果摘要。
 * 不访问数据库，不写入任何记录。
 */
export async function dryRunWaybill(
  client: GoluckyClient,
  waybillNo: string,
): Promise<GoluckyDryRunResult> {
  try {
    const { events, rawResponse } = await client.getTracking(waybillNo);

    return {
      waybillNo,
      events,
      rawResponse,
      success: true,
      message: `成功获取 ${events.length} 条轨迹`,
    };
  } catch (err) {
    const message = err instanceof GoluckyApiError
      ? `API 错误: ${err.message}`
      : err instanceof Error
        ? `请求失败: ${err.message}`
        : '未知错误';

    return {
      waybillNo,
      events: [],
      rawResponse: null,
      success: false,
      message,
    };
  }
}

/** 创建 Dry Run 用 Client（使用 InMemoryTokenCache） */
export function createDryRunClient(
  baseUrl: string,
  appKey: string,
  appSecret: string,
  tokenCache: TokenCache,
): GoluckyClient {
  return new GoluckyClient({ baseUrl, appKey, appSecret, timeoutMs: 30_000, tokenCache });
}
