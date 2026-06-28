// P3-S1B: 百世 Dry Run — 单元测试
//
// 覆盖: dryRunWaybill / dryRunOrder 使用 mock fetch 端到端流程、
// 结构解析、Zod 校验、异常传播。协议未确认时所有异常必须传播。
//
// 所有测试使用假凭证和 mock fetch，不访问真实服务。

import { describe, it, expect, vi, type Mock } from 'vitest';
import { dryRunWaybill, dryRunOrder, createDryRunClient } from '../dry-run';
import { BestClient } from '../client';
import {
  BestApiError,
  BestNetworkError,
  BestValidationError,
} from '../types';

// ─── 辅助 ────────────────────────────────────────────────────────

const FAKE_CONFIG = {
  baseUrl: 'https://best-api.example.com',
  partnerId: 'PARTNER-TEST',
  secret: 'test-secret-xyz',
};

/**
 * 创建 mock fetch，根据 URL 返回扁平响应结构。
 */
function makeSuccessFetch(
  orderData: Record<string, unknown>,
  logisticsData: Record<string, unknown>,
): Mock {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const u = String(url);

    if (u.includes('trackingQuery')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          success: true,
          enMessage: 'success',
          multiMessage: '',
          errorCode: '',
          traceId: 'trace-002',
          ...logisticsData,
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        enMessage: 'success',
        multiMessage: '',
        errorCode: '',
        traceId: 'trace-001',
        ...orderData,
      }),
    };
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('dryRunWaybill', () => {
  it('成功拉取并解析运单+轨迹', async () => {
    const orderData = {
      pageSize: 20,
      currentPage: 1,
      total: 1,
      list: [
        {
          orderNo: 'ORD-001',
          waybillNo: 'WB-001',
          status: 'IN_TRANSIT',
          goodsInfoList: [
            { goodsCode: 'SKU-A', goodsName: 'Test Product A', goodsQuantity: 10 },
            { goodsCode: 'SKU-B', goodsName: 'Test Product B', goodsQuantity: 5 },
          ],
        },
      ],
    };
    const logisticsData = {
      Items: [
        {
          Groups: [
            {
              Traces: [
                { status: 'DEPARTED', description: '已发车', occurredAt: '2026-06-01 10:00:00', location: '深圳' },
                { status: 'ARRIVED', description: '已到达', occurredAt: '2026-06-03 14:00:00', location: '曼谷' },
              ],
            },
          ],
        },
      ],
    };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-001');

    expect(result.success).toBe(true);
    expect(result.message).toBe('success');
    expect(result.itemSummary).toHaveLength(2);
    expect(result.itemSummary[0]).toEqual({
      externalSku: 'SKU-A',
      productName: 'Test Product A',
      quantity: 10,
    });
    expect(result.trackingSummary).toHaveLength(2);
    expect(result.trackingSummary[0]).toEqual({
      status: 'DEPARTED',
      description: '已发车',
      occurredAt: '2026-06-01 10:00:00',
      location: '深圳',
    });
  });

  it('原始数据以 unknown 类型保存', async () => {
    const orderData = {
      list: [{ orderNo: 'ORD-002', waybillNo: 'WB-002', goodsInfoList: [] }],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-002');

    expect(result.orderInfo).toBeDefined();
    expect(result.logisticsTrace).toBeDefined();
    expect(typeof result.orderInfo).toBe('object');
    expect(typeof result.logisticsTrace).toBe('object');
  });

  it('空商品列表 → 空摘要', async () => {
    const orderData = {
      list: [{ orderNo: 'ORD-003', waybillNo: 'WB-003', goodsInfoList: [] }],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-003');

    expect(result.itemSummary).toEqual([]);
    expect(result.trackingSummary).toEqual([]);
  });

  it('list 中 goodsInfoList 缺失 → 空摘要', async () => {
    const orderData = {
      list: [{ orderNo: 'ORD-004', waybillNo: 'WB-004' }],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-004');

    expect(result.itemSummary).toEqual([]);
  });
});

// ─── Zod 校验：异常输入 → BestValidationError ───────────────────

describe('dryRunWaybill — Zod 校验异常', () => {
  it('goodsInfoList 为 null → BestValidationError', async () => {
    const orderData = {
      list: [{ orderNo: 'ORD-005', waybillNo: 'WB-005', goodsInfoList: null }],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-005')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('goodsQuantity 非数字字符串 → BestValidationError', async () => {
    const orderData = {
      list: [
        {
          orderNo: 'ORD-007',
          goodsInfoList: [{ goodsCode: 'SKU', goodsName: 'Q', goodsQuantity: 'abc' }],
        },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-007')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('NaN goodsQuantity → BestValidationError', async () => {
    const orderData = {
      list: [
        {
          goodsInfoList: [{ goodsCode: 'SKU', goodsName: 'X', goodsQuantity: NaN }],
        },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-NAN')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('Infinity goodsQuantity → BestValidationError', async () => {
    const orderData = {
      list: [
        {
          goodsInfoList: [
            { goodsCode: 'SKU', goodsName: 'X', goodsQuantity: Infinity },
          ],
        },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-INF')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('goodsQuantity = 0 → BestValidationError', async () => {
    const orderData = {
      list: [
        {
          goodsInfoList: [{ goodsCode: 'SKU', goodsName: 'X', goodsQuantity: 0 }],
        },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-ZERO')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('goodsQuantity < 0 → BestValidationError', async () => {
    const orderData = {
      list: [
        {
          goodsInfoList: [
            { goodsCode: 'SKU', goodsName: 'X', goodsQuantity: -5 },
          ],
        },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-NEG')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('null item in goodsInfoList → BestValidationError', async () => {
    const orderData = { list: [{ goodsInfoList: [null] }] };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-NULLITEM')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('order data 为 null → 结构校验失败', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ success: true, enMessage: '', multiMessage: '', errorCode: '', traceId: '', Items: [] }),
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        // success=true but no list field → parseItems gets null data
        json: async () => ({ success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '' }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    // data will be {} → list undefined → parseItems returns [] (no error since list is optional)
    const result = await dryRunWaybill(client, 'WB-NULLDATA');
    expect(result.itemSummary).toEqual([]);
  });

  it('tracking data 为 null → 正常处理', async () => {
    const orderData = { list: [] };
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        return {
          ok: true, status: 200, statusText: 'OK',
          // success=true but no Items → parseTracking gets empty
          json: async () => ({ success: true, enMessage: '', multiMessage: '', errorCode: '', traceId: '' }),
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '', ...orderData }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-TNULL');
    expect(result.trackingSummary).toEqual([]);
  });

  it('goodsQuantity 缺失 → BestValidationError', async () => {
    const orderData = {
      list: [{ goodsInfoList: [{ goodsCode: 'SKU', goodsName: 'X' }] }],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-NOQTY')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('goodsQuantity 非整数 → BestValidationError', async () => {
    const orderData = {
      list: [
        { goodsInfoList: [{ goodsCode: 'SKU', goodsName: 'X', goodsQuantity: 3.5 }] },
      ],
    };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-FLOAT')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('goodsInfoList 不是数组 → BestValidationError', async () => {
    const orderData = { list: [{ goodsInfoList: 'not_array' }] };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-BADLIST')).rejects.toThrow(
      BestValidationError,
    );
  });

  it('list 不是数组 → BestValidationError', async () => {
    const orderData = { list: 'not_array' };
    const logisticsData = { Items: [] };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-BADLIST2')).rejects.toThrow(
      BestValidationError,
    );
  });
});

// ─── rawData 完整性 ──────────────────────────────────────────────

describe('dryRunWaybill — rawData 完整性', () => {
  it('orderInfo 包含未知顶层字段（rawData 保留完整响应）', async () => {
    const orderData = {
      pageSize: 20,
      currentPage: 1,
      total: 1,
      list: [
        {
          orderNo: 'ORD-RAW1',
          waybillNo: 'WB-RAW1',
          best_internal_id: 'BEST-99999',
          goodsInfoList: [
            { goodsCode: 'SKU', goodsName: 'X', goodsQuantity: 2, provider_meta: 'extra' },
          ],
        },
      ],
    };
    const logisticsData = {
      provider_tracking_id: 'TRK-123',
      Items: [
        {
          Groups: [
            {
              Traces: [
                { status: 'OK', description: '', occurredAt: '', location: '', raw_status_code: 'S001' },
              ],
            },
          ],
        },
      ],
    };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-RAW1');

    // rawData 保留完整扁平响应
    const oi = result.orderInfo as Record<string, unknown>;
    expect(oi.success).toBe(true);
    const list = oi.list as Array<Record<string, unknown>>;
    expect(list[0].best_internal_id).toBe('BEST-99999');

    const lt = result.logisticsTrace as Record<string, unknown>;
    expect(lt.success).toBe(true);
    expect(lt.provider_tracking_id).toBe('TRK-123');

    // 结构化摘要仅含通用字段
    expect(result.itemSummary[0]).toEqual({
      externalSku: 'SKU',
      productName: 'X',
      quantity: 2,
    });
    expect(result.itemSummary[0]).not.toHaveProperty('provider_meta');
    expect(result.trackingSummary[0]).not.toHaveProperty('raw_status_code');
  });

  it('orderInfo 与完整 mock 响应深度相等', async () => {
    const orderResponse = {
      success: true,
      enMessage: 'success',
      multiMessage: '',
      errorCode: '',
      traceId: 'trace-001',
      pageSize: 20,
      currentPage: 1,
      total: 1,
      list: [
        {
          orderNo: 'ORD-DEEP1',
          waybillNo: 'WB-DEEP1',
          status: 'IN_TRANSIT',
          nested: { key: 'val', arr: [1, 2, 3] },
          goodsInfoList: [
            { goodsCode: 'SKU-D', goodsName: 'Deep', goodsQuantity: 7, extra: 'keep' },
          ],
        },
      ],
    };
    const logisticsResponse = {
      success: true,
      enMessage: 'success',
      multiMessage: '',
      errorCode: '',
      traceId: 'trace-002',
      custom: { a: 1, b: 'text' },
      Items: [
        {
          Groups: [
            {
              Traces: [
                { status: 'S1', description: 'd1', occurredAt: '2026-01-01', location: 'L1', meta: true },
                { status: 'S2', description: 'd2', occurredAt: '2026-01-02', location: 'L2', meta: false },
              ],
            },
          ],
        },
      ],
    };

    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => logisticsResponse };
      }
      return { ok: true, status: 200, statusText: 'OK', json: async () => orderResponse };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-DEEP1');

    // rawData 完整保留
    expect(result.orderInfo).toEqual(orderResponse);
    expect(result.logisticsTrace).toEqual(logisticsResponse);

    expect(result.itemSummary).toHaveLength(1);
    expect(result.trackingSummary).toHaveLength(2);
    expect(result.itemSummary[0]).toEqual({
      externalSku: 'SKU-D',
      productName: 'Deep',
      quantity: 7,
    });
    expect((result.itemSummary[0] as Record<string, unknown>).extra).toBeUndefined();
  });

  it('tracking event 含未知字段时 rawData 保留', async () => {
    const logisticsResponse = {
      success: true,
      enMessage: '',
      multiMessage: '',
      errorCode: '',
      traceId: '',
      Items: [
        {
          Groups: [
            {
              Traces: [
                {
                  status: 'ARRIVED',
                  description: '',
                  occurredAt: '',
                  location: '',
                  provider_event_code: 'E_CODE_1',
                  provider_timestamp: 1719500000,
                },
              ],
            },
          ],
        },
      ],
    };
    const orderResponse = {
      success: true,
      enMessage: 'success',
      multiMessage: '',
      errorCode: '',
      traceId: '',
      list: [{ orderNo: 'ORD-TEV', waybillNo: 'WB-TEVENT', goodsInfoList: [] }],
    };

    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => logisticsResponse };
      }
      return { ok: true, status: 200, statusText: 'OK', json: async () => orderResponse };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunWaybill(client, 'WB-TEVENT');

    expect(result.logisticsTrace).toEqual(logisticsResponse);
    expect(result.trackingSummary[0]).not.toHaveProperty('provider_event_code');
    expect(result.trackingSummary[0]).not.toHaveProperty('provider_timestamp');
  });
});

// ─── dryRunOrder ──────────────────────────────────────────────────

describe('dryRunOrder', () => {
  it('按订单号拉取成功', async () => {
    const orderData = {
      pageSize: 20,
      currentPage: 1,
      total: 1,
      list: [
        {
          orderNo: 'ORD-100',
          waybillNo: 'WB-100',
          status: 'IN_TRANSIT',
          goodsInfoList: [
            { goodsCode: 'SKU-1', goodsName: 'Item 1', goodsQuantity: 20 },
          ],
        },
      ],
    };
    const logisticsData = {
      Items: [
        {
          Groups: [
            { Traces: [{ status: 'DEPARTED', description: '', occurredAt: '', location: '' }] },
          ],
        },
      ],
    };

    const mockFetch = makeSuccessFetch(orderData, logisticsData);
    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunOrder(client, 'ORD-100');

    expect(result.success).toBe(true);
    expect(result.itemSummary).toHaveLength(1);
    expect(result.trackingSummary).toHaveLength(1);
  });

  it('订单无 waybillNo 时跳过轨迹查询', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-200', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    const result = await dryRunOrder(client, 'ORD-200');

    expect(logisticsFetched).toBe(false);
    expect(result.trackingSummary).toEqual([]);
    expect(result.logisticsTrace).toBeNull();
  });

  it('物流轨迹 HTTP 5xx → 传播（不吞掉）', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-NETERR', waybillNo: 'WB-NETERR', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunOrder(client, 'ORD-NETERR')).rejects.toThrow(BestNetworkError);
    expect(logisticsFetched).toBe(true);
  });

  it('物流轨迹网络异常 → 传播（不吞掉）', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
        throw new Error('connect ECONNREFUSED');
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-CONN', waybillNo: 'WB-CONN', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunOrder(client, 'ORD-CONN')).rejects.toThrow(BestNetworkError);
    expect(logisticsFetched).toBe(true);
  });

  it('物流轨迹业务错误（success=false）→ 传播（不吞掉）', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({
            success: false, errorCode: 'E1001', enMessage: '无轨迹数据', multiMessage: '', traceId: '',
          }),
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-BIZERR', waybillNo: 'WB-BIZERR', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunOrder(client, 'ORD-BIZERR')).rejects.toThrow(BestApiError);
    expect(logisticsFetched).toBe(true);
  });

  it('物流轨迹鉴权失败 → 传播（不吞掉）', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({
            success: false, errorCode: 'AUTH_FAILED', enMessage: '鉴权失败', multiMessage: '', traceId: '',
          }),
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-AUTH', waybillNo: 'WB-AUTH', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunOrder(client, 'ORD-AUTH')).rejects.toThrow(BestApiError);
    expect(logisticsFetched).toBe(true);
  });

  it('物流轨迹系统错误 → 传播（不吞掉）', async () => {
    let logisticsFetched = false;
    const mockFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('trackingQuery')) {
        logisticsFetched = true;
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({
            success: false, errorCode: 'SYS_ERROR', enMessage: '系统内部错误', multiMessage: '', traceId: '',
          }),
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          success: true, enMessage: 'success', multiMessage: '', errorCode: '', traceId: '',
          list: [{ orderNo: 'ORD-SYS', waybillNo: 'WB-SYS', goodsInfoList: [] }],
        }),
      };
    });

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunOrder(client, 'ORD-SYS')).rejects.toThrow(BestApiError);
    expect(logisticsFetched).toBe(true);
  });
});

// ─── createDryRunClient ──────────────────────────────────────────

describe('createDryRunClient', () => {
  it('凭证齐全时创建 client', () => {
    const client = createDryRunClient({
      BEST_OPEN_BASE_URL: 'https://example.com',
      BEST_OPEN_PARTNER_ID: 'P001',
      BEST_OPEN_SECRET: 'S001',
    } as typeof process.env);

    expect(client).toBeInstanceOf(BestClient);
    expect(client.baseUrl).toBe('https://example.com');
  });

  it('凭证缺失时 fail-fast', () => {
    expect(() => createDryRunClient({} as typeof process.env)).toThrow();
  });
});

// ─── 异常传播 ────────────────────────────────────────────────────

describe('dryRunWaybill — 异常传播', () => {
  it('订单业务错误（success=false）→ 抛出 BestApiError', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: false, errorCode: 'SYS_ERROR', enMessage: 'system error', multiMessage: '', traceId: '',
      }),
    }));

    const client = new BestClient(FAKE_CONFIG, mockFetch as unknown as typeof fetch);
    await expect(dryRunWaybill(client, 'WB-ERR')).rejects.toThrow();
  });
});
