// P5-SY11B: Variant Repository 软归档能力测试
//
// 覆盖:
// - database.ts 类型包含 3 个新增字段（类型级测试）
// - VariantFilters 支持 archiveStatus
// - list() / list({}) 默认 active
// - list({ archiveStatus: 'archived' }) / 'all' 过滤
// - getUnmatched() 排除 archived
// - archive() 校验与去重
// - restore() 清空审计字段
// - match/unmatch/batchMatch 阻止 archived Variant
// - batchMatch 遇到 archived 时不得调用 RPC

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Thenable chain mock ───────────────────────────────────────────────
// Supabase 查询构建器返回的链既是 thenable（可 await）又是 chainable（可继续 .eq/.in 等）。
// 所有链方法返回链本身，链本身实现了 then/catch 使其可 await。

function createChainResult(result: { data: unknown; error?: Error | null; count?: number }) {
  // 记录哪些过滤方法被调用以及参数
  const eqCalls: Array<{ col: string; val: unknown }> = [];
  const inCalls: Array<{ col: string; vals: unknown }> = [];
  const orCalls: string[] = [];

  const chain: Record<string, unknown> = {
    // thenable — 当 await 时返回 result
    then: (resolve: (v: unknown) => void) => {
      resolve(result);
    },
    catch: (reject: (e: unknown) => void) => {
      if (result.error) reject(result.error);
      else return { then: (resolve: (v: unknown) => void) => resolve(result) };
    },
  };

  function makeFn(name: string) {
    if (name === 'eq') {
      return vi.fn((col: string, val: unknown) => {
        eqCalls.push({ col, val });
        return chain;
      });
    }
    if (name === 'in') {
      return vi.fn((col: string, vals: unknown) => {
        inCalls.push({ col, vals });
        return chain;
      });
    }
    if (name === 'or') {
      return vi.fn((s: string) => {
        orCalls.push(s);
        return chain;
      });
    }
    return vi.fn(() => chain);
  }

  chain.select = makeFn('select');
  chain.eq = makeFn('eq');
  chain.in = makeFn('in');
  chain.or = makeFn('or');
  chain.order = makeFn('order');
  chain.range = makeFn('range');
  chain.maybeSingle = makeFn('maybeSingle');

  // Attach call records
  (chain as Record<string, unknown>)._eqCalls = eqCalls;
  (chain as Record<string, unknown>)._inCalls = inCalls;
  (chain as Record<string, unknown>)._orCalls = orCalls;

  return chain as Record<string, unknown> & {
    _eqCalls: typeof eqCalls;
    _inCalls: typeof inCalls;
    _orCalls: typeof orCalls;
  };
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}));

vi.mock('@/lib/supabase/helpers', () => ({
  unwrapJoin: (joined: unknown) => {
    if (Array.isArray(joined)) return joined[0];
    return joined;
  },
}));

import { variantRepository, VariantError } from './repository';
import { archiveVariantsSchema, restoreVariantsSchema } from './schema';
import type { VariantFilters } from './types';
import type { Database } from '@/types/database';

// ─── Helpers ───────────────────────────────────────────────────────────

const VALID_UUID = '00000000-0000-4000-a000-000000000001';
const VALID_UUID2 = '00000000-0000-4000-a000-000000000002';
const PRODUCT_UUID = '10000000-0000-4000-a000-000000000001';
const ADMIN_UUID = '20000000-0000-4000-a000-000000000001';

function resetMocks() {
  vi.clearAllMocks();
}

// ─── 1. 类型级测试：database.ts 包含 3 个新字段 ────────────────────────

describe('P5-SY11B — 类型定义', () => {
  it('product_variant.Row 包含 is_archived, archived_at, archived_by', () => {
    type Row = Database['public']['Tables']['product_variant']['Row'];
    const row: Row = {} as Row;
    void (row.is_archived satisfies boolean);
    void (row.archived_at satisfies string | null);
    void (row.archived_by satisfies string | null);
    expect(true).toBe(true);
  });

  it('product_variant.Insert 包含可选 is_archived, archived_at, archived_by', () => {
    type Insert = Database['public']['Tables']['product_variant']['Insert'];
    const insert: Insert = {};
    void (insert.is_archived satisfies boolean | undefined);
    void (insert.archived_at satisfies string | null | undefined);
    void (insert.archived_by satisfies string | null | undefined);
    expect(true).toBe(true);
  });

  it('product_variant.Update 包含可选 is_archived, archived_at, archived_by', () => {
    type Update = Database['public']['Tables']['product_variant']['Update'];
    const update: Update = {};
    void (update.is_archived satisfies boolean | undefined);
    void (update.archived_at satisfies string | null | undefined);
    void (update.archived_by satisfies string | null | undefined);
    expect(true).toBe(true);
  });

  it('VariantFilters 支持 archiveStatus', () => {
    const filters: VariantFilters = { archiveStatus: 'active' };
    expect(filters.archiveStatus).toBe('active');
  });
});

// ─── 2. list() archiveStatus 过滤 ─────────────────────────────────────

describe('P5-SY11B — list() archiveStatus 过滤', () => {
  beforeEach(resetMocks);

  it('list() 默认 archiveStatus = active，查询 is_archived = false', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list();

    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('list({}) 等价于 list()，默认 active', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({});

    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('list({ archiveStatus: "active" }) 过滤 is_archived = false', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'active' });

    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('list({ archiveStatus: "archived" }) 过滤 is_archived = true', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'archived' });

    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: true });
  });

  it('list({ archiveStatus: "all" }) 不调用 is_archived eq', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'all' });

    const isArchivedEq = chain._eqCalls.filter((c) => c.col === 'is_archived');
    expect(isArchivedEq.length).toBe(0);
  });
});

// ─── 3. getUnmatched() 排除已归档 ──────────────────────────────────────

describe('P5-SY11B — getUnmatched() 排除已归档', () => {
  beforeEach(resetMocks);

  it('getUnmatched() 查询 is_archived = false', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.getUnmatched();

    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
    expect(chain._inCalls).toContainEqual({
      col: 'match_status',
      vals: ['unmatched', 'pending'],
    });
  });
});

// ─── 4. archive() 校验 ─────────────────────────────────────────────────

describe('P5-SY11B — archive() 校验与行为', () => {
  beforeEach(resetMocks);

  it('空数组抛出 INVALID_ID', async () => {
    await expect(variantRepository.archive([], ADMIN_UUID)).rejects.toMatchObject({
      code: 'INVALID_ID',
    });
  });

  it('非法 UUID 抛出 INVALID_ID', async () => {
    await expect(variantRepository.archive(['not-a-uuid'], ADMIN_UUID)).rejects.toMatchObject({
      code: 'INVALID_ID',
    });
  });

  it('archivedBy 非法 UUID 抛出 INVALID_ID', async () => {
    await expect(variantRepository.archive([VALID_UUID], 'not-a-uuid')).rejects.toMatchObject({
      code: 'INVALID_ID',
    });
  });

  it('不存在的 ID 抛出 NOT_FOUND', async () => {
    const chain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
    });
    mockFrom.mockReturnValue(chain);

    await expect(
      variantRepository.archive([VALID_UUID, VALID_UUID2], ADMIN_UUID)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('去重后只归档未归档项', async () => {
    const selectChain = createChainResult({
      data: [
        { id: VALID_UUID, is_archived: false },
        { id: VALID_UUID2, is_archived: true },
      ],
    });

    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    const result = await variantRepository.archive(
      [VALID_UUID, VALID_UUID2, VALID_UUID], // duplicate VALID_UUID
      ADMIN_UUID
    );

    // 只归档了 VALID_UUID（未归档 + 去重），VALID_UUID2 已归档被跳过
    expect(result.archived).toBe(1);
  });

  it('全部已归档时返回 archived: 0', async () => {
    const chain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
    });
    mockFrom.mockReturnValue(chain);

    const result = await variantRepository.archive([VALID_UUID], ADMIN_UUID);
    expect(result.archived).toBe(0);
  });

  it('update payload 包含 is_archived=true, archived_at, archived_by', async () => {
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
    });
    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    await variantRepository.archive([VALID_UUID], ADMIN_UUID);

    expect(mockUpdate).toHaveBeenCalled();
    const payload = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_archived).toBe(true);
    expect(payload.archived_at).toBeTypeOf('string');
    expect(payload.archived_by).toBe(ADMIN_UUID);
  });

  it('update 链包含 .eq("is_archived", false) 防止并发覆盖', async () => {
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
    });
    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    await variantRepository.archive([VALID_UUID], ADMIN_UUID);

    expect(updateChain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('返回实际 update 行数，而不是 toArchive.length', async () => {
    // 3 个未归档，但并发下只有 2 个实际被 update（模拟另一个请求先归档了第 3 个）
    const selectChain = createChainResult({
      data: [
        { id: VALID_UUID, is_archived: false },
        { id: VALID_UUID2, is_archived: false },
        { id: '00000000-0000-4000-a000-000000000003', is_archived: false },
      ],
    });
    const updateChain = createChainResult({
      data: [{ id: VALID_UUID }, { id: VALID_UUID2 }],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    const result = await variantRepository.archive(
      [VALID_UUID, VALID_UUID2, '00000000-0000-4000-a000-000000000003'],
      ADMIN_UUID
    );

    expect(result.archived).toBe(2); // 不是 3
  });
});

describe('P5-SY11B — restore() 校验与行为', () => {
  beforeEach(resetMocks);

  it('空数组抛出 INVALID_ID', async () => {
    await expect(variantRepository.restore([])).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('非法 UUID 抛出 INVALID_ID', async () => {
    await expect(variantRepository.restore(['not-a-uuid'])).rejects.toMatchObject({
      code: 'INVALID_ID',
    });
  });

  it('不存在的 ID 抛出 NOT_FOUND', async () => {
    const chain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
    });
    mockFrom.mockReturnValue(chain);

    await expect(
      variantRepository.restore([VALID_UUID, VALID_UUID2])
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('恢复已归档项：is_archived=false, archived_at=null, archived_by=null', async () => {
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
    });

    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    const result = await variantRepository.restore([VALID_UUID]);
    expect(result.restored).toBe(1);
  });

  it('全部未归档时返回 restored: 0', async () => {
    const chain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
    });
    mockFrom.mockReturnValue(chain);

    const result = await variantRepository.restore([VALID_UUID]);
    expect(result.restored).toBe(0);
  });

  it('update payload 包含 is_archived=false, archived_at=null, archived_by=null', async () => {
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
    });
    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    await variantRepository.restore([VALID_UUID]);

    expect(mockUpdate).toHaveBeenCalled();
    const payload = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_archived).toBe(false);
    expect(payload.archived_at).toBeNull();
    expect(payload.archived_by).toBeNull();
  });

  it('update 链包含 .eq("is_archived", true) 防止并发覆盖', async () => {
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
    });
    const updateChain = createChainResult({ data: [{ id: VALID_UUID }], error: null });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    await variantRepository.restore([VALID_UUID]);

    expect(updateChain._eqCalls).toContainEqual({ col: 'is_archived', val: true });
  });

  it('返回实际 update 行数，而不是 toRestore.length', async () => {
    // 2 个已归档，但并发下只有 1 个实际被 update（模拟另一个请求先恢复了第 2 个）
    const selectChain = createChainResult({
      data: [
        { id: VALID_UUID, is_archived: true },
        { id: VALID_UUID2, is_archived: true },
      ],
    });
    const updateChain = createChainResult({
      data: [{ id: VALID_UUID }],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: mockUpdate });
    mockUpdate.mockReturnValue(updateChain);

    const result = await variantRepository.restore([VALID_UUID, VALID_UUID2]);

    expect(result.restored).toBe(1); // 不是 2
  });
});

// ─── 6. match() 阻止已归档 Variant ─────────────────────────────────────

describe('P5-SY11B — match() 阻止已归档', () => {
  beforeEach(resetMocks);

  it('已归档 Variant 匹配时抛出 ARCHIVED', async () => {
    const chain = createChainResult({
      data: { id: VALID_UUID, is_archived: true },
    });
    mockFrom.mockReturnValue(chain);

    await expect(
      variantRepository.match(VALID_UUID, PRODUCT_UUID)
    ).rejects.toMatchObject({ code: 'ARCHIVED' });
  });
});

// ─── 7. unmatch() 阻止已归档 Variant ───────────────────────────────────

describe('P5-SY11B — unmatch() 阻止已归档', () => {
  beforeEach(resetMocks);

  it('已归档 Variant 取消匹配时抛出 ARCHIVED', async () => {
    const chain = createChainResult({
      data: { id: VALID_UUID, is_archived: true },
    });
    mockFrom.mockReturnValue(chain);

    await expect(variantRepository.unmatch(VALID_UUID)).rejects.toMatchObject({
      code: 'ARCHIVED',
    });
  });
});

// ─── 8. batchMatch() 阻止已归档 Variant ────────────────────────────────

describe('P5-SY11B — batchMatch() 阻止已归档', () => {
  beforeEach(resetMocks);

  it('任一 Variant 已归档 → 整体拒绝，不调用 RPC', async () => {
    const chain = createChainResult({
      data: [
        { id: VALID_UUID, is_archived: false },
        { id: VALID_UUID2, is_archived: true },
      ],
    });
    mockFrom.mockReturnValue(chain);
    mockRpc.mockReset();

    await expect(
      variantRepository.batchMatch([VALID_UUID, VALID_UUID2], PRODUCT_UUID)
    ).rejects.toMatchObject({ code: 'ARCHIVED' });

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('任一 Variant 不存在 → 整体拒绝，不调用 RPC', async () => {
    const chain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
    });
    mockFrom.mockReturnValue(chain);
    mockRpc.mockReset();

    await expect(
      variantRepository.batchMatch([VALID_UUID, VALID_UUID2], PRODUCT_UUID)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('全部存在且未归档 → 调用 RPC 并返回 matched', async () => {
    const chain = createChainResult({
      data: [
        { id: VALID_UUID, is_archived: false },
        { id: VALID_UUID2, is_archived: false },
      ],
    });
    mockFrom.mockReturnValue(chain);
    mockRpc.mockResolvedValue({ data: 2, error: null });

    const result = await variantRepository.batchMatch(
      [VALID_UUID, VALID_UUID2],
      PRODUCT_UUID
    );

    expect(mockRpc).toHaveBeenCalledWith('batch_match_variants', {
      p_variant_ids: [VALID_UUID, VALID_UUID2],
      p_product_id: PRODUCT_UUID,
    });
    expect(result.matched).toBe(2);
  });

  it('batchMatch 空数组抛出 INVALID_ID', async () => {
    await expect(
      variantRepository.batchMatch([], PRODUCT_UUID)
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('batchMatch 非法 productId 抛出 INVALID_ID', async () => {
    await expect(
      variantRepository.batchMatch([VALID_UUID], 'bad-id')
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('batchMatch 非法 variantId 抛出 INVALID_ID', async () => {
    await expect(
      variantRepository.batchMatch(['bad-id'], PRODUCT_UUID)
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });
});

// ─── 9. Schema 测试 ──────────────────────────────────────────────────────

describe('P5-SY11B — archiveVariantsSchema / restoreVariantsSchema', () => {
  describe('archiveVariantsSchema', () => {
    it('合法 UUID 数组通过校验', () => {
      const result = archiveVariantsSchema.safeParse({ variantIds: [VALID_UUID, VALID_UUID2] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variantIds).toEqual([VALID_UUID, VALID_UUID2]);
      }
    });

    it('空数组拒绝', () => {
      const result = archiveVariantsSchema.safeParse({ variantIds: [] });
      expect(result.success).toBe(false);
    });

    it('非法 UUID 拒绝', () => {
      const result = archiveVariantsSchema.safeParse({ variantIds: ['not-a-uuid'] });
      expect(result.success).toBe(false);
    });

    it('混合合法与非法 UUID 拒绝', () => {
      const result = archiveVariantsSchema.safeParse({ variantIds: [VALID_UUID, 'not-a-uuid'] });
      expect(result.success).toBe(false);
    });

    it('transform 去重：重复 ID 只保留一个', () => {
      const result = archiveVariantsSchema.safeParse({ variantIds: [VALID_UUID, VALID_UUID, VALID_UUID2] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variantIds).toEqual([VALID_UUID, VALID_UUID2]);
      }
    });

    it('缺少 variantIds 字段拒绝', () => {
      const result = archiveVariantsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('restoreVariantsSchema', () => {
    it('合法 UUID 数组通过校验', () => {
      const result = restoreVariantsSchema.safeParse({ variantIds: [VALID_UUID, VALID_UUID2] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variantIds).toEqual([VALID_UUID, VALID_UUID2]);
      }
    });

    it('空数组拒绝', () => {
      const result = restoreVariantsSchema.safeParse({ variantIds: [] });
      expect(result.success).toBe(false);
    });

    it('非法 UUID 拒绝', () => {
      const result = restoreVariantsSchema.safeParse({ variantIds: ['not-a-uuid'] });
      expect(result.success).toBe(false);
    });

    it('transform 去重：重复 ID 只保留一个', () => {
      const result = restoreVariantsSchema.safeParse({ variantIds: [VALID_UUID2, VALID_UUID2, VALID_UUID] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variantIds).toEqual([VALID_UUID2, VALID_UUID]);
      }
    });

    it('缺少 variantIds 字段拒绝', () => {
      const result = restoreVariantsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// ─── 10. VariantError 支持新 code ──────────────────────────────────────

describe('P5-SY11B — VariantError 错误码', () => {
  it('ARCHIVED code 存在', () => {
    const err = new VariantError('测试', 'ARCHIVED');
    expect(err.code).toBe('ARCHIVED');
    expect(err.name).toBe('VariantError');
  });

  it('INVALID_STATE code 存在', () => {
    const err = new VariantError('测试', 'INVALID_STATE');
    expect(err.code).toBe('INVALID_STATE');
  });
});
