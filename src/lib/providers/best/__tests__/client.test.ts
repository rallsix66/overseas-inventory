// P3-S1B: 百世 API Client — 单元测试
//
// 覆盖: 请求 URL/Headers/body、HTTP 错误、百世业务错误、
// 非法 JSON、结构异常、空结果、分页边界、凭证缺失 fail-fast。
//
// 所有测试使用假凭证和 mock fetch，不访问真实服务。

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BestClient, loadConfigFromEnv, createBestClient } from '../client';
import { BestApiError, BestNetworkError, BestValidationError } from '../types';

// ─── Mock fixtures ──────────────────────────────────────────────

function mockOrderSuccessResponse(data: Record<string, unknown>) {
  return {
    success: true,
    enMessage: 'success',
    multiMessage: '',
    errorCode: '',
    traceId: 'trace-001',
    ...data,
  };
}

function mockOrderBusinessError(errorCode: string, message: string) {
  return {
    success: false,
    errorCode,
    enMessage: message,
    multiMessage: message,
    traceId: 'trace-err',
  };
}

function mockLogisticsSuccessResponse(data: Record<string, unknown>) {
  return {
    success: true,
    enMessage: 'success',
    multiMessage: '',
    errorCode: '',
    traceId: 'trace-002',
    ...data,
  };
}

function mockLogisticsBusinessError(errorCode: string, message: string) {
  return {
    success: false,
    errorCode,
    enMessage: message,
    multiMessage: message,
    traceId: 'trace-err',
  };
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function createMockFetch(
  responseFactory: (
    call: FetchCall,
  ) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
): Mock {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };

    const response = await responseFactory(call);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      json: async () => response.body,
    };
  });
}

const FAKE_CONFIG = {
  baseUrl: 'https://best-api.example.com',
  partnerId: 'PARTNER-TEST',
  secret: 'test-secret-xyz',
};

let client: BestClient;

// ─── Tests ──────────────────────────────────────────────────────

describe('BestClient — 订单查询请求', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = createMockFetch(() => ({
      status: 200,
      body: mockOrderSuccessResponse({
        pageSize: 20,
        currentPage: 1,
        total: 1,
        list: [
          {
            orderNo: 'ORD001',
            waybillNo: 'WB001',
            goodsInfoList: [
              { goodsCode: 'SKU-A', goodsName: 'Product A', goodsQuantity: 5 },
            ],
          },
        ],
      }),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
  });

  it('请求方法为 POST', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(call[1]?.method).toBe('POST');
  });

  it('请求 Content-Type 为 application/json', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toContain('application/json');
  });

  it('请求 Header 包含 partnerId', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['partnerId']).toBe('PARTNER-TEST');
  });

  it('请求 Header 包含 sign (32 位 hex)', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(typeof headers['sign']).toBe('string');
    expect(headers['sign']).toHaveLength(32);
    expect(headers['sign']).toMatch(/^[a-f0-9]{32}$/);
  });

  it('订单查询 Header 包含 serviceType', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['serviceType']).toBe('queryOrderInfoByOrderNo');
  });

  it('订单查询端点为 /star-gate/bestApi/queryOrderInfoByOrderNo', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/star-gate/bestApi/queryOrderInfoByOrderNo');
  });

  it('Body 为 { request: { nos, currentPage, pageSize } }', async () => {
    await client.queryOrderInfoByOrderNo({
      nos: ['ORD001', 'ORD002'],
      currentPage: 2,
      pageSize: 50,
    });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    const req = body.request as Record<string, unknown>;
    expect(req.nos).toEqual(['ORD001', 'ORD002']);
    expect(req.currentPage).toBe(2);
    expect(req.pageSize).toBe(50);
  });

  it('Body 不包含 partnerID / bizData / sign 旧字段', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    expect(body.partnerID).toBeUndefined();
    expect(body.bizData).toBeUndefined();
    expect(body.sign).toBeUndefined();
  });

  it('默认分页参数: currentPage=1, pageSize=20', async () => {
    await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    const req = body.request as Record<string, unknown>;
    expect(req.currentPage).toBe(1);
    expect(req.pageSize).toBe(20);
  });

  it('成功响应返回 success=true', async () => {
    const result = await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });
    expect(result.success).toBe(true);
    expect(result.message).toBe('success');
    expect(result.data).toBeDefined();
  });

  it('nos 为空 → BestApiError (INVALID_PARAMS)', async () => {
    client = new BestClient(FAKE_CONFIG);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: [] }),
    ).rejects.toThrow(BestApiError);

    try {
      await client.queryOrderInfoByOrderNo({ nos: [] });
    } catch (err) {
      expect(err).toBeInstanceOf(BestApiError);
      expect((err as BestApiError).code).toBe('INVALID_PARAMS');
    }
  });
});

describe('BestClient — 物流轨迹查询请求', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = createMockFetch(() => ({
      status: 200,
      body: mockLogisticsSuccessResponse({
        Items: [
          {
            Groups: [
              {
                Traces: [
                  {
                    status: 'DEPARTED',
                    description: '已发车',
                    occurredAt: '2026-06-01 10:00:00',
                    location: '深圳',
                  },
                ],
              },
            ],
          },
        ],
      }),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
  });

  it('物流查询端点为 /star-gate/bestApi/trackingQuery', async () => {
    await client.queryLogisticsTrace({ nos: ['WB001'] });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/star-gate/bestApi/trackingQuery');
  });

  it('物流查询 Header 不包含 serviceType', async () => {
    await client.queryLogisticsTrace({ nos: ['WB001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['serviceType']).toBeUndefined();
  });

  it('物流查询 Header 包含 partnerId 和 sign', async () => {
    await client.queryLogisticsTrace({ nos: ['WB001'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['partnerId']).toBe('PARTNER-TEST');
    expect(typeof headers['sign']).toBe('string');
    expect(headers['sign']).toHaveLength(32);
  });

  it('物流查询 Body 为 { nos: [...] }', async () => {
    await client.queryLogisticsTrace({ nos: ['WB001', 'WB002'] });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    expect(body.nos).toEqual(['WB001', 'WB002']);
  });

  it('物流查询成功响应返回 success=true', async () => {
    const result = await client.queryLogisticsTrace({ nos: ['WB001'] });
    expect(result.success).toBe(true);
  });

  it('nos 为空 → BestApiError (logistics)', async () => {
    client = new BestClient(FAKE_CONFIG);
    await expect(
      client.queryLogisticsTrace({ nos: [] }),
    ).rejects.toThrow(BestApiError);
  });
});

describe('BestClient — 错误处理', () => {
  it('HTTP 4xx → BestNetworkError', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 400,
      body: {},
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestNetworkError);
  });

  it('HTTP 5xx → BestNetworkError', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 500,
      body: {},
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestNetworkError);
  });

  it('订单业务错误（success=false）→ BestApiError', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 200,
      body: mockOrderBusinessError('E1001', 'order not found'),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['NONEXIST'] }),
    ).rejects.toThrow(BestApiError);

    try {
      await client.queryOrderInfoByOrderNo({ nos: ['NONEXIST'] });
    } catch (err) {
      expect(err).toBeInstanceOf(BestApiError);
      const apiErr = err as BestApiError;
      expect(apiErr.code).toBe('E1001');
      expect(apiErr.message).toContain('order not found');
    }
  });

  it('物流业务错误（Success=false）→ BestApiError', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 200,
      body: mockLogisticsBusinessError('E1001', '无轨迹数据'),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryLogisticsTrace({ nos: ['NONEXIST'] }),
    ).rejects.toThrow(BestApiError);

    try {
      await client.queryLogisticsTrace({ nos: ['NONEXIST'] });
    } catch (err) {
      expect(err).toBeInstanceOf(BestApiError);
      expect((err as BestApiError).code).toBe('E1001');
    }
  });

  it('响应不是合法 JSON → BestApiError (INVALID_JSON)', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('JSON parse error');
      },
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestApiError);

    try {
      await client.queryOrderInfoByOrderNo({ nos: ['X'] });
    } catch (err) {
      expect(err).toBeInstanceOf(BestApiError);
      expect((err as BestApiError).code).toBe('INVALID_JSON');
    }
  });

  it('订单响应结构不符 → BestValidationError', async () => {
    // 缺少 response 根节点
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ code: '0', message: 'ok' }),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestValidationError);
  });

  it('物流响应结构不符 → BestValidationError', async () => {
    // 缺少 ResponseData 根节点
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ Success: true }),
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryLogisticsTrace({ nos: ['X'] }),
    ).rejects.toThrow(BestValidationError);
  });

  it('rawData 保留完整原始响应', async () => {
    const rawResponse = {
      success: true,
      enMessage: 'success',
      multiMessage: '',
      errorCode: '',
      traceId: 'trace-raw',
      pageSize: 20,
      currentPage: 1,
      total: 1,
      list: [
        {
          orderNo: 'ORD001',
          waybillNo: 'WB001',
          best_internal_id: 'BEST-99999',
          goodsInfoList: [
            {
              goodsCode: 'SKU-A',
              goodsName: 'Product A',
              goodsQuantity: 5,
              provider_meta: 'extra',
            },
          ],
        },
      ],
    };
    const mockFetch = createMockFetch(() => ({
      status: 200,
      body: rawResponse,
    }));
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await client.queryOrderInfoByOrderNo({ nos: ['ORD001'] });

    // rawData 保留完整原始响应
    expect(result.rawData).toEqual(rawResponse);
    // data 通过 Zod 校验
    expect(result.data.list).toBeDefined();
    expect(result.data.list).toHaveLength(1);
  });
});

describe('BestClient — 超时与网络错误', () => {
  it('请求超时 → BestNetworkError (AbortSignal 监听)', async () => {
    const mockFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    client = new BestClient(
      { ...FAKE_CONFIG, timeoutMs: 10 },
      mockFetch as unknown as typeof fetch,
    );

    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestNetworkError);

    try {
      await client.queryOrderInfoByOrderNo({ nos: ['X'] });
    } catch (err) {
      expect(err).toBeInstanceOf(BestNetworkError);
      expect((err as BestNetworkError).message).toContain('超时');
    }
  });

  it('网络连接失败 → BestNetworkError', async () => {
    const mockFetch = vi.fn(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(
      client.queryOrderInfoByOrderNo({ nos: ['X'] }),
    ).rejects.toThrow(BestNetworkError);
  });
});

describe('BestClient — 凭证校验', () => {
  it('BEST_OPEN_BASE_URL 缺失 → fail-fast', () => {
    expect(() => loadConfigFromEnv({} as typeof process.env)).toThrow(
      /BEST_OPEN_BASE_URL/,
    );
  });

  it('BEST_OPEN_PARTNER_ID 缺失 → fail-fast', () => {
    expect(() =>
      loadConfigFromEnv({
        BEST_OPEN_BASE_URL: 'https://example.com',
      } as typeof process.env),
    ).toThrow(/BEST_OPEN_PARTNER_ID/);
  });

  it('BEST_OPEN_SECRET 缺失 → fail-fast', () => {
    expect(() =>
      loadConfigFromEnv({
        BEST_OPEN_BASE_URL: 'https://example.com',
        BEST_OPEN_PARTNER_ID: 'P001',
      } as typeof process.env),
    ).toThrow(/BEST_OPEN_SECRET/);
  });

  it('所有凭证齐全 → 返回配置', () => {
    const config = loadConfigFromEnv({
      BEST_OPEN_BASE_URL: 'https://example.com',
      BEST_OPEN_PARTNER_ID: 'P001',
      BEST_OPEN_SECRET: 'S001',
    } as typeof process.env);

    expect(config.baseUrl).toBe('https://example.com');
    expect(config.partnerId).toBe('P001');
    expect(config.secret).toBe('S001');
  });

  it('createBestClient 凭证缺失时抛出', () => {
    expect(() => createBestClient({} as typeof process.env)).toThrow();
  });
});

describe('BestClient — baseUrl 暴露', () => {
  it('baseUrl 可访问', () => {
    client = new BestClient(FAKE_CONFIG);
    expect(client.baseUrl).toBe('https://best-api.example.com');
  });
});
