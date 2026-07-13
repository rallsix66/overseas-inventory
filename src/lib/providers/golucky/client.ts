// 喜运达(golucky)物流轨迹 API Client（只读）
//
// 仅查询运单物流轨迹（GET /tmsapi/tracking/list）。
// Token 管理采用租约模型：抢租约短事务 → 事务外调外部 API → 写回校验所有权。
//
// 安全约束：本模块不记录 token / appSecret 到日志或错误。

import {
  GoluckyApiError,
  GoluckyNetworkError,
  type ParsedGoluckyEvent,
} from './types';
import {
  goluckyTrackingResponseSchema,
  goluckyTokenResponseSchema,
} from './schema';
import { parseTrackingResponse } from './parse-response';

export type FetchFn = typeof fetch;

// ─── Token 缓存接口（由调用方注入，隔离数据库访问） ──────

export interface TokenCache {
  /** 阶段一：抢租约（短事务无网络）→ 返回 cachedToken 或 null（需刷新） */
  acquireLease(provider: string): Promise<{ action: 'reuse' | 'refresh' | 'first_time'; accessToken: string | null; expiresAt: string | null }>;
  /** 阶段二：写回 token（校验 lease_owner 所有权） */
  storeToken(provider: string, accessToken: string, expiresAt: string): Promise<void>;
  /** 释放租约（刷新失败时调用） */
  releaseLease(provider: string): Promise<void>;
}

/** 默认 TokenCache（供测试/无 DB 场景使用） */
export class InMemoryTokenCache implements TokenCache {
  private cache = new Map<string, { token: string; expiresAt: string }>();

  async acquireLease(_provider: string) {
    const entry = this.cache.get(_provider);
    if (entry && new Date(entry.expiresAt).getTime() - 5 * 60 * 1000 > Date.now()) {
      return { action: 'reuse' as const, accessToken: entry.token, expiresAt: entry.expiresAt };
    }
    if (entry) {
      return { action: 'refresh' as const, accessToken: entry.token, expiresAt: entry.expiresAt };
    }
    return { action: 'first_time' as const, accessToken: null, expiresAt: null };
  }

  async storeToken(provider: string, accessToken: string, expiresAt: string) {
    this.cache.set(provider, { token: accessToken, expiresAt });
  }

  async releaseLease(_provider: string) {
    // no-op — in-memory 无并发锁需求
  }
}

// ─── Client Config ──────────────────────────────────────

export interface GoluckyClientConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  timeoutMs?: number;
  /** Token 缓存实现。生产使用 SupabaseTokenCache，测试使用 InMemoryTokenCache */
  tokenCache: TokenCache;
}

// ─── Client ─────────────────────────────────────────────

export class GoluckyClient {
  private readonly config: Required<Omit<GoluckyClientConfig, 'tokenCache'>>;
  private readonly fetchFn: FetchFn;
  private readonly tokenCache: TokenCache;
  private static readonly PROVIDER = 'golucky';

  constructor(config: GoluckyClientConfig, fetchImpl?: FetchFn) {
    this.config = {
      baseUrl: config.baseUrl,
      appKey: config.appKey,
      appSecret: config.appSecret,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
    this.fetchFn = fetchImpl ?? globalThis.fetch;
    this.tokenCache = config.tokenCache;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  // ─── 公共接口：查询单运单轨迹 ───────────────────────────

  /**
   * 查询单运单全量物流轨迹（只读）。
   *
   * @param transportNumber — 运单号
   * @returns 解析后的轨迹事件列表
   */
  async getTracking(transportNumber: string): Promise<{
    events: ParsedGoluckyEvent[];
    rawResponse: unknown;
  }> {
    const accessToken = await this.obtainToken();

    const url = `${this.config.baseUrl}/tmsapi/tracking/list?transportNumber=${encodeURIComponent(transportNumber)}`;

    const raw = await this.get(url, accessToken);

    const parsed = goluckyTrackingResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GoluckyApiError('轨迹响应结构校验失败', 'INVALID_RESPONSE');
    }

    const events = parseTrackingResponse(parsed.data.data ?? [], transportNumber);

    return { events, rawResponse: raw };
  }

  // ─── Token 管理（租约模型） ─────────────────────────────

  private async obtainToken(): Promise<string> {
    const lease = await this.tokenCache.acquireLease(GoluckyClient.PROVIDER);

    if (lease.action === 'reuse' && lease.accessToken) {
      return lease.accessToken;
    }

    // 需要刷新或首次获取
    let newToken: string | null = null;
    let newExpiresAt: string | null = null;

    try {
      const result = await this.fetchToken();
      newToken = result.token;
      newExpiresAt = result.expiresAt;
    } catch (err) {
      // 刷新失败但旧 token 仍有效 → 继续用旧 token
      if (lease.accessToken && lease.expiresAt && new Date(lease.expiresAt).getTime() > Date.now()) {
        await this.tokenCache.releaseLease(GoluckyClient.PROVIDER);
        return lease.accessToken;
      }
      // 旧 token 也已过期 → 抛出
      await this.tokenCache.releaseLease(GoluckyClient.PROVIDER);
      throw new GoluckyApiError(
        `Token 获取失败且旧 Token 已过期: ${(err as Error).message}`,
        'TOKEN_FAILED',
      );
    }

    // 写回 token（校验租约所有权）
    await this.tokenCache.storeToken(GoluckyClient.PROVIDER, newToken, newExpiresAt);
    return newToken;
  }

  private async fetchToken(): Promise<{ token: string; expiresAt: string }> {
    const url = `${this.config.baseUrl}/api/account/gettoken?appKey=${encodeURIComponent(this.config.appKey)}&appSecret=${encodeURIComponent(this.config.appSecret)}`;

    const raw = await this.get(url);

    const parsed = goluckyTokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GoluckyApiError('Token 响应结构校验失败', 'INVALID_TOKEN_RESPONSE');
    }

    const tokenData = parsed.data;
    if (!tokenData.data?.accessToken) {
      throw new GoluckyApiError(
        `Token 获取失败: ${tokenData.message ?? tokenData.code ?? 'accessToken 为空'}`,
        tokenData.code ?? 'TOKEN_EMPTY',
      );
    }

    const expiresIn = tokenData.data.expiresIn ?? 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return { token: tokenData.data.accessToken, expiresAt };
  }

  // ─── 内部 HTTP 方法 ────────────────────────────────────

  private async get(url: string, accessToken?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (accessToken) {
      headers['Access-Token'] = accessToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new GoluckyNetworkError(`请求超时 (${this.config.timeoutMs}ms)`);
      }
      throw new GoluckyNetworkError('网络请求失败', err);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new GoluckyNetworkError(
        `HTTP ${response.status}: ${response.statusText}`,
        { status: response.status },
      );
    }

    try {
      return await response.json();
    } catch {
      throw new GoluckyApiError('响应不是合法 JSON', 'INVALID_JSON');
    }
  }
}

/** 从环境变量创建 GoluckyClient */
export function createGoluckyClient(
  env: typeof process.env,
  tokenCache: TokenCache,
  fetchImpl?: FetchFn,
): GoluckyClient {
  const baseUrl = env.GOLUCKY_BASE_URL;
  const appKey = env.GOLUCKY_APP_KEY;
  const appSecret = env.GOLUCKY_APP_SECRET;

  const missing: string[] = [];
  if (!baseUrl) missing.push('GOLUCKY_BASE_URL');
  if (!appKey) missing.push('GOLUCKY_APP_KEY');
  if (!appSecret) missing.push('GOLUCKY_APP_SECRET');

  if (missing.length > 0) {
    throw new Error(`喜运达 API 凭证缺失: ${missing.join(', ')}`);
  }

  return new GoluckyClient(
    {
      baseUrl: baseUrl!,
      appKey: appKey!,
      appSecret: appSecret!,
      tokenCache,
    },
    fetchImpl,
  );
}
