// 百世开放平台 API Client（只读）
//
// 仅封装 queryOrderInfoByOrderNo 和 trackingQuery。
// 不做下单、不做送货预报、不调用任何百世写接口。
//
// 请求/响应结构经测试环境真实 API 验证。
// 生产环境 URL 尚未验证。
//
// 安全约束：本模块不记录 secret 或签名原文到日志/错误。

import {
  BestApiError,
  BestNetworkError,
  BestValidationError,
  type BestClientConfig,
  type BestLogisticsData,
  type BestOrderData,
  type BestQueryResult,
  type QueryLogisticsParams,
  type QueryOrderInfoParams,
} from './types';
import { sign } from './signature';
import { bestOrderResponseSchema, bestLogisticsResponseSchema } from './schema';

export type FetchFn = typeof fetch;

/** 从环境变量读取百世 API 配置，缺失时 fail-fast。 */
export function loadConfigFromEnv(env: typeof process.env): BestClientConfig {
  const baseUrl = env.BEST_OPEN_BASE_URL;
  const partnerId = env.BEST_OPEN_PARTNER_ID;
  const secret = env.BEST_OPEN_SECRET;

  const missing: string[] = [];
  if (!baseUrl) missing.push('BEST_OPEN_BASE_URL');
  if (!partnerId) missing.push('BEST_OPEN_PARTNER_ID');
  if (!secret) missing.push('BEST_OPEN_SECRET');

  if (missing.length > 0) {
    throw new Error(`百世 API 凭证缺失: ${missing.join(', ')}`);
  }

  return { baseUrl: baseUrl!, partnerId: partnerId!, secret: secret! };
}

/**
 * 百世只读 API Client。
 *
 * 仅暴露只读查询方法。fetch 实现可注入（测试用 mock）。
 */
export class BestClient {
  private readonly config: Required<BestClientConfig>;
  private readonly fetchFn: FetchFn;

  constructor(config: BestClientConfig, fetchImpl?: FetchFn) {
    this.config = {
      baseUrl: config.baseUrl,
      partnerId: config.partnerId,
      secret: config.secret,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
    this.fetchFn = fetchImpl ?? globalThis.fetch;
  }

  /** 暴露 baseUrl 供测试断言 */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  // ─── 公共只读接口 ──────────────────────────────────────────────

  /**
   * 按单号查询运单信息（只读）。
   *
   * @param params - nos（订单号或运单号列表）、分页参数
   * @returns 校验后的查询结果
   */
  async queryOrderInfoByOrderNo(
    params: QueryOrderInfoParams,
  ): Promise<BestQueryResult<BestOrderData>> {
    if (!params.nos || params.nos.length === 0) {
      throw new BestApiError('nos 不能为空', 'INVALID_PARAMS');
    }

    const body = {
      request: {
        nos: params.nos,
        currentPage: params.currentPage ?? 1,
        pageSize: params.pageSize ?? 20,
      },
    };

    const raw = await this.post(
      '/star-gate/bestApi/queryOrderInfoByOrderNo',
      body,
      { serviceType: 'queryOrderInfoByOrderNo' },
    );

    const parsed = bestOrderResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BestValidationError('订单响应结构校验失败', parsed.error);
    }

    const resp = parsed.data;
    if (!resp.success) {
      throw new BestApiError(
        `百世业务错误 [${resp.errorCode ?? 'UNKNOWN'}]: ${resp.enMessage || resp.multiMessage || '未知错误'}`,
        resp.errorCode ?? 'BUSINESS_ERROR',
      );
    }

    return {
      success: resp.success,
      message: resp.enMessage || resp.multiMessage || '',
      data: {
        pageSize: resp.pageSize,
        currentPage: resp.currentPage,
        total: resp.total,
        list: resp.list,
      } as BestOrderData,
      rawData: raw,
    };
  }

  /**
   * 按运单号查询物流轨迹（只读）。
   *
   * @param params - nos（运单号列表）
   * @returns 校验后的查询结果
   */
  async queryLogisticsTrace(
    params: QueryLogisticsParams,
  ): Promise<BestQueryResult<BestLogisticsData>> {
    if (!params.nos || params.nos.length === 0) {
      throw new BestApiError('nos 不能为空', 'INVALID_PARAMS');
    }

    const body = { nos: params.nos };

    const raw = await this.post(
      '/star-gate/bestApi/trackingQuery',
      body,
    );

    const parsed = bestLogisticsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BestValidationError('轨迹响应结构校验失败', parsed.error);
    }

    const rd = parsed.data;
    if (!rd.success) {
      throw new BestApiError(
        `百世业务错误 [${rd.errorCode ?? 'UNKNOWN'}]: ${rd.enMessage || rd.multiMessage || '未知错误'}`,
        rd.errorCode ?? 'BUSINESS_ERROR',
      );
    }

    // 数据可能在顶层 Items 或嵌套 Data.Items
    const items = rd.Items ?? rd.Data?.Items;

    return {
      success: rd.success,
      message: rd.enMessage || rd.multiMessage || '',
      data: { Items: items } as BestLogisticsData,
      rawData: raw,
    };
  }

  // ─── 内部请求方法 ──────────────────────────────────────────────

  private async post(
    endpoint: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    // 使用 JSON.stringify（自然 key 顺序），不排序
    // stableStringify 会改变签名导致 API 鉴权失败
    const bodyStr = JSON.stringify(body);
    const sig = sign(bodyStr, this.config.secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      partnerId: this.config.partnerId,
      sign: sig,
      ...extraHeaders,
    };

    const url = `${this.config.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new BestNetworkError(`请求超时 (${this.config.timeoutMs}ms)`);
      }
      throw new BestNetworkError('网络请求失败', err);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new BestNetworkError(
        `HTTP ${response.status}: ${response.statusText}`,
        { status: response.status },
      );
    }

    try {
      return await response.json();
    } catch {
      throw new BestApiError('响应不是合法 JSON', 'INVALID_JSON');
    }
  }
}

/**
 * 从环境变量创建 BestClient。
 * 凭证缺失时抛出。
 */
export function createBestClient(
  env: typeof process.env,
  fetchImpl?: FetchFn,
): BestClient {
  return new BestClient(loadConfigFromEnv(env), fetchImpl);
}
