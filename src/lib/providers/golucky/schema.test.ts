// Golucky API Schema 回归测试
//
// 验证 Zod schema 对 Golucky API 响应 code 字段的 string/number 兼容性。
// 根因：Golucky 实际返回 code: 0 (number)，但旧 schema 只接受 string，
// 导致生产 Cron 报"Token 响应结构校验失败"。
//
// 安全约束：测试不含真实 accessToken/appKey/appSecret。

import { describe, it, expect } from 'vitest';
import {
  goluckyTokenResponseSchema,
  goluckyTrackingResponseSchema,
  goluckyTrackingNodeSchema,
} from './schema';

// ─── Token 响应 schema ─────────────────────────────────────

describe('goluckyTokenResponseSchema — code string/number 兼容', () => {
  // ── 成功场景：number code ──

  it('code: 0 (number) → 解析成功，code 归一化为 "0"', () => {
    const raw = {
      code: 0,
      success: true,
      message: '成功',
      data: { accessToken: 'test-token-abc', expiresIn: 7200 },
    };

    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.code).toBe('0');
      expect(result.data.message).toBe('成功');
      expect(result.data.data?.accessToken).toBe('test-token-abc');
      expect(result.data.data?.expiresIn).toBe(7200);
    }
  });

  it('code: "0" (string) → 解析成功，code 保持 "0"', () => {
    const raw = {
      code: '0',
      success: true,
      message: '成功',
      data: { accessToken: 'test-token-def', expiresIn: 7200 },
    };

    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.code).toBe('0');
      expect(result.data.data?.accessToken).toBe('test-token-def');
    }
  });

  // ── 失败场景：number code ──

  it('code: 400001 (number) → 解析成功，code 归一化为 "400001"，不报结构校验失败', () => {
    const raw = {
      code: 400001,
      success: false,
      message: '颁发凭证失败，appKey不存在对应应用',
    };

    const result = goluckyTokenResponseSchema.safeParse(raw);
    // 关键断言：不能因为 code 是 number 就 safeParse 失败
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.code).toBe('400001');
      expect(result.data.message).toBe('颁发凭证失败，appKey不存在对应应用');
      expect(result.data.data).toBeUndefined();
    }
  });

  it('code: "400001" (string) → 解析成功，向下兼容', () => {
    const raw = {
      code: '400001',
      success: false,
      message: '颁发凭证失败，appKey不存在对应应用',
    };

    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.code).toBe('400001');
    }
  });

  it('code 缺失 → 解析成功，code undefined', () => {
    const raw = {
      success: true,
      message: '成功',
      data: { accessToken: 'test-token-ghi', expiresIn: 7200 },
    };

    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.code).toBeUndefined();
    }
  });

  // ── 其他数字 code 值 ──

  it('code: 200 (number) → 归一化为 "200"', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: 200 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('200');
    }
  });

  it('code: 500 (number) → 归一化为 "500"', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: 500 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('500');
    }
  });

  // ── 拒绝非 string/number code ──

  it('code: true (boolean) → 拒绝', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: true });
    expect(result.success).toBe(false);
  });

  it('code: null → 拒绝', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: null });
    expect(result.success).toBe(false);
  });

  it('code: {} (object) → 拒绝', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: {} });
    expect(result.success).toBe(false);
  });

  it('code: [] (array) → 拒绝', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: [] });
    expect(result.success).toBe(false);
  });

  // ── Token 空判断兼容 ──

  it('code: 0 且 accessToken 存在 → code 转 "0"（truthy string），不触发 TOKEN_EMPTY', () => {
    const raw = {
      code: 0,
      success: true,
      data: { accessToken: 'tok', expiresIn: 7200 },
    };
    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.code).toBe('string');
      expect(result.data.code).toBe('0');
    }
  });

  it('code: undefined 且 accessToken 缺失 → code undefined → 走 TOKEN_EMPTY 分支', () => {
    const raw = { success: true, data: {} };
    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBeUndefined();
    }
  });

  // ── message 字段不变 ──

  it('message 保持 string 类型不变', () => {
    const raw = { code: 0, message: '成功' };
    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.message).toBe('string');
    }
  });

  it('message 为 number → 拒绝（仅接受 string）', () => {
    const result = goluckyTokenResponseSchema.safeParse({ code: 0, message: 123 });
    expect(result.success).toBe(false);
  });

  // ── success 字段剥离 ──

  it('success 字段由 Zod 默认剥离（不在 parsed data 中）', () => {
    const raw = { code: 0, success: true, message: 'ok' };
    const result = goluckyTokenResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('success' in result.data).toBe(false);
    }
  });
});

// ─── Tracking 响应 schema ──────────────────────────────────

describe('goluckyTrackingResponseSchema — code string/number 兼容', () => {
  it('code: 0 (number) → 解析成功，code 归一化为 "0"', () => {
    const raw = {
      code: 0,
      message: '成功',
      data: [
        {
          code: 'CREATED',
          title: '订单已创建',
          desc: '订单已创建',
          time: 1719500000000,
        },
      ],
    };

    const result = goluckyTrackingResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('0');
      expect(result.data.data?.length).toBe(1);
    }
  });

  it('code: "0" (string) → 解析成功，向下兼容', () => {
    const raw = {
      code: '0',
      message: '成功',
      data: [],
    };

    const result = goluckyTrackingResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('0');
    }
  });

  it('code: 400001 (number) → 归一化为 "400001"', () => {
    const raw = {
      code: 400001,
      message: '运单不存在',
    };

    const result = goluckyTrackingResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('400001');
      expect(result.data.message).toBe('运单不存在');
    }
  });

  it('code 缺失 → undefined', () => {
    const result = goluckyTrackingResponseSchema.safeParse({ data: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBeUndefined();
    }
  });

  it('code: true (boolean) → 拒绝', () => {
    const result = goluckyTrackingResponseSchema.safeParse({ code: true });
    expect(result.success).toBe(false);
  });
});

// ─── Tracking node schema（不变） ───────────────────────────

describe('goluckyTrackingNodeSchema — 不变', () => {
  it('完整轨迹节点解析成功', () => {
    const raw = {
      code: 'CREATED',
      title: '已创建',
      enTitle: 'Created',
      desc: '订单已创建',
      enDesc: 'Order created',
      time: 1719500000000,
    };
    const result = goluckyTrackingNodeSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('仅含 title 的标题节点（无 code/time）→ 仍解析成功', () => {
    const raw = { title: '物流轨迹', enTitle: 'Logistics Tracking' };
    const result = goluckyTrackingNodeSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('节点 code 为 number → 拒绝（仅 envelope 顶层放宽，节点 business field 不变）', () => {
    const result = goluckyTrackingNodeSchema.safeParse({ code: 0 });
    expect(result.success).toBe(false);
  });
});

// ─── GoluckyClient number code 端到端（mock fetch，无网络） ──

describe('GoluckyClient — number code 端到端兼容', () => {
  it('getTracking: token 响应 code:0 (number) + tracking 响应 code:0 (number) → 成功返回事件', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (url: string): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('gettoken')) {
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            message: '成功',
            data: { accessToken: 'tok-num', expiresIn: 7200 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // tracking/list
      return new Response(
        JSON.stringify({
          code: 0,
          message: '成功',
          data: [
            { code: 'CREATED', title: '已创建', time: 1719500000000 },
            { code: 'SHIPPED', title: '已发货', time: 1719600000000 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    const result = await client.getTracking('TEST-001');
    expect(result.events.length).toBe(2);
    expect(result.events[0].status).toBe('CREATED');
    expect(result.events[1].status).toBe('SHIPPED');
  });

  it('getTracking: token 响应 code:"0" (string) → 向下兼容', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (url: string): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('gettoken')) {
        return new Response(
          JSON.stringify({
            code: '0',
            success: true,
            message: '成功',
            data: { accessToken: 'tok-str', expiresIn: 7200 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: '0',
          message: '成功',
          data: [{ code: 'DELIVERYED', title: '已送达', time: 1719700000000 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    const result = await client.getTracking('TEST-002');
    expect(result.events.length).toBe(1);
  });

  it('getTracking: token 响应 code:400001 (number) → 抛出含真实 message/code 的 GoluckyApiError', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (_url: string): Promise<Response> => {
      return new Response(
        JSON.stringify({
          code: 400001,
          success: false,
          message: '颁发凭证失败，appKey不存在对应应用',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    // getTracking → obtainToken → fetchToken → schema parse code:400001 →
    // !tokenData.data?.accessToken → throw GoluckyApiError
    await expect(client.getTracking('TEST-003')).rejects.toMatchObject({
      name: 'GoluckyApiError',
      message: expect.stringContaining('颁发凭证失败，appKey不存在对应应用') as unknown,
      code: '400001',
    });
  });

  it('getTracking: tracking 响应 code: 500 (number) → 解析成功（不报结构校验失败）', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (url: string): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('gettoken')) {
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            message: '成功',
            data: { accessToken: 'tok-500', expiresIn: 7200 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 500,
          message: '服务内部异常',
          data: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    // tracking 响应 code:500 不再触发 "轨迹响应结构校验失败"
    const result = await client.getTracking('TEST-004');
    expect(result.events).toEqual([]); // data:[] 无有效轨迹
  });

  it('getTracking: 完整 string code 路径 → 向下兼容', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (url: string): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('gettoken')) {
        return new Response(
          JSON.stringify({
            code: '0',
            success: true,
            message: '成功',
            data: { accessToken: 'tok-str-all', expiresIn: 7200 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: '0',
          message: '成功',
          data: [
            { code: 'DST_PORT', title: '到港', time: 1719800000000 },
            { code: 'DELIVERYED', title: '已签收', time: 1719900000000 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    const result = await client.getTracking('TEST-005');
    expect(result.events.length).toBe(2);
  });

  // ── 安全：测试不含凭证泄漏 ──

  it('错误消息不包含 appKey/appSecret/accessToken', async () => {
    const { GoluckyClient, InMemoryTokenCache } = await import('./client');

    const mockFetch = async (_url: string): Promise<Response> => {
      return new Response(
        JSON.stringify({
          code: 400001,
          success: false,
          message: '凭证无效',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const cache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      {
        baseUrl: 'https://api.example.com',
        appKey: 'test-key',
        appSecret: 'test-secret',
        tokenCache: cache,
      },
      mockFetch as unknown as typeof fetch,
    );

    try {
      await client.getTracking('SEC-CHECK');
      expect.unreachable('应抛出异常');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 不得泄露凭证
      expect(msg).not.toContain('test-key');
      expect(msg).not.toContain('test-secret');
    }
  });
});
