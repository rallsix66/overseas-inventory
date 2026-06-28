// P3-S3: shipmentRepository.searchVariants() 独立行为测试
//
// Mock createClient() + variantRepository，不 mock shipmentRepository 本身。
// 直接调用真实 shipmentRepository.searchVariants() 验证查询行为。
//
// 覆盖：
// - 无关键词查询错误传播
// - SKU / variant name / product name / product_id 回查各查询错误传播
// - 归档过滤 notIn 在 limit 前进入查询
// - SKU / variant name / product name 三路结果合并去重
// - \、%、_ 的 LIKE 转义
// - Repository 错误经 Server Action 返回中文 ActionResult

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shipmentRepository, ShipmentError } from '@/features/shipments/repository';
import { searchVariants } from '@/features/shipments/actions';

// ── Mock builders ──────────────────────────────────────────────────────

/** 创建可链式调用的 mock query builder，await 时返回 { data, error }
 *  Supabase 查询总是 resolve（不 reject），错误通过 { error } 字段返回 */
function createQueryMock(result: { data?: unknown; error?: unknown }) {
  const calls: string[] = [];
  const callLog: Array<{ method: string; args: unknown[] }> = [];
  const notInCalls: Array<{ column: string; ids: unknown[] }> = [];

  const self: Record<string, unknown> = {
    then(resolve: (v: unknown) => void) {
      resolve(result);
      return Promise.resolve(result);
    },
  };

  for (const method of ['select', 'eq', 'ilike', 'order', 'notIn', 'in', 'limit', 'single', 'maybeSingle', 'neq']) {
    self[method] = vi.fn((...args: unknown[]) => {
      calls.push(method);
      callLog.push({ method, args: [...args] });
      if (method === 'notIn') {
        notInCalls.push({ column: args[0] as string, ids: args[1] as unknown[] });
      }
      return self;
    });
  }

  return { builder: self, calls, callLog, notInCalls };
}

// ── Mock setup ─────────────────────────────────────────────────────────

const {
  mockFrom,
  mockGetArchivedIds,
  mockRequireActiveAuth,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetArchivedIds: vi.fn(),
  mockRequireActiveAuth: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    from: mockFrom,
  })),
}));

vi.mock('@/features/variants/repository', () => ({
  variantRepository: {
    getUserArchivedVariantIds: mockGetArchivedIds,
  },
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: mockRequireActiveAuth,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────

const VID1 = '00000000-0000-4000-8000-000000000001';
const VID2 = '00000000-0000-4000-8000-000000000002';
const VID3 = '00000000-0000-4000-8000-000000000003';
const USER_ID = 'a'.repeat(36);

function mockVariantRow(id: string, sku: string, name: string, country: string, productName: string) {
  return {
    id,
    sku,
    name,
    country,
    product: { name: productName } as unknown,
  };
}

/** Push mock results onto the from() queue in order.
 *  Builders are preserved in the array (accessed by index, not shifted)
 *  so they can be inspected after the query resolves. */
function pushResults(...results: Array<{ data?: unknown; error?: unknown }>) {
  const blds = results.map((r) => createQueryMock(r));
  let cursor = 0;
  mockFrom.mockImplementation((_: string) => {
    if (cursor >= blds.length) throw new Error('Unexpected from() call — queue exhausted');
    return blds[cursor++].builder;
  });
  return {
    getBuilder: (index: number) => {
      if (index >= blds.length) throw new Error(`No builder at index ${index}`);
      return blds[index];
    },
    getBuilders: () => blds,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('shipmentRepository.searchVariants() 行为测试', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetArchivedIds.mockResolvedValue(new Set<string>());
  });

  // ── Error propagation ────────────────────────────────────────────

  describe('错误传播', () => {
    it('无关键词 product_variant 查询出错 → ShipmentError(DB_ERROR)', async () => {
      pushResults({ data: null, error: new Error('connection refused') });

      await expect(
        shipmentRepository.searchVariants('TH', undefined, USER_ID),
      ).rejects.toMatchObject({
        name: 'ShipmentError',
        message: '查询 SKU 列表失败',
      });
    });

    it('SKU ilike 查询出错 → ShipmentError(DB_ERROR)', async () => {
      // With search='SKU001': SKU query → error, rest never reached
      pushResults(
        { data: null, error: new Error('connection refused') },  // SKU query (error)
        { data: [] },   // name query
        { data: [] },   // product query
        { data: [] },   // product→variant query
      );

      let thrown: unknown;
      try {
        await shipmentRepository.searchVariants('TH', 'SKU001', USER_ID);
        expect.fail('should have thrown');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ShipmentError);
      expect((thrown as Error).message).toBe('查询 SKU 列表失败');
    });

    it('variant name ilike 查询出错 → ShipmentError(DB_ERROR)', async () => {
      pushResults(
        { data: [] },   // SKU query (pass)
        { data: null, error: new Error('connection refused') },  // name query (error)
        { data: [] },   // product query
        { data: [] },   // product→variant query
      );

      await expect(
        shipmentRepository.searchVariants('TH', 'test', USER_ID),
      ).rejects.toThrow(ShipmentError);
    });

    it('product name ilike 查询出错 → ShipmentError(DB_ERROR)', async () => {
      pushResults(
        { data: [] },   // SKU query (pass)
        { data: [] },   // name query (pass)
        { data: null, error: new Error('connection refused') },  // product query (error)
        { data: [] },   // product→variant query
      );

      await expect(
        shipmentRepository.searchVariants('TH', 'test', USER_ID),
      ).rejects.toThrow(ShipmentError);
    });

    it('product_id 回查 variant 查询出错 → ShipmentError(DB_ERROR)', async () => {
      pushResults(
        { data: [] },   // SKU query (pass)
        { data: [] },   // name query (pass)
        { data: [{ id: 'product-1' }] },  // product query (pass — finds a product)
        { data: null, error: new Error('connection refused') },  // product→variant query (error)
      );

      await expect(
        shipmentRepository.searchVariants('TH', 'test', USER_ID),
      ).rejects.toThrow(ShipmentError);
    });

    it('getUserArchivedVariantIds 出错 → VariantError 穿透', async () => {
      mockGetArchivedIds.mockRejectedValue(new Error('DB error'));
      pushResults({ data: [] });

      await expect(
        shipmentRepository.searchVariants('TH', undefined, USER_ID),
      ).rejects.toThrow('DB error');
    });
  });

  // ── Archived filtering ───────────────────────────────────────────

  describe('归档过滤 (notIn before limit)', () => {
    it('无关键词查询：有归档 ID 时 notIn 在 limit 之前被调用', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set([VID1]));
      const { getBuilder } = pushResults(
        { data: [] },  // product_variant (no keyword)
      );

      await shipmentRepository.searchVariants('TH', undefined, USER_ID);

      const b = getBuilder(0);
      const notInIdx = b.calls.indexOf('notIn');
      const limitIdx = b.calls.indexOf('limit');
      expect(notInIdx).toBeGreaterThan(-1);
      expect(limitIdx).toBeGreaterThan(-1);
      expect(notInIdx).toBeLessThan(limitIdx);
      expect(b.notInCalls[0]).toMatchObject({ column: 'id', ids: [VID1] });
    });

    it('有搜索词时每个 product_variant 查询都有 notIn 且在 limit 前', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set([VID1, VID2]));
      const { getBuilders } = pushResults(
        { data: [] },   // SKU query
        { data: [] },   // name query
        { data: [{ id: 'product-1' }] },  // product query (finds product → triggers variant query)
        { data: [] },   // product→variant query
      );

      await shipmentRepository.searchVariants('TH', 'sku', USER_ID);

      // Check SKU query (index 0) and name query (index 1)
      for (const idx of [0, 1]) {
        const b = getBuilders()[idx];
        const notInIdx = b.calls.indexOf('notIn');
        const limitIdx = b.calls.indexOf('limit');
        expect(notInIdx).toBeGreaterThan(-1);
        expect(limitIdx).toBeGreaterThan(-1);
        expect(notInIdx).toBeLessThan(limitIdx);
      }

      // Check product→variant query (index 3)
      const vB = getBuilders()[3];
      const vNotInIdx = vB.calls.indexOf('notIn');
      const vLimitIdx = vB.calls.indexOf('limit');
      expect(vNotInIdx).toBeGreaterThan(-1);
      expect(vLimitIdx).toBeGreaterThan(-1);
      expect(vNotInIdx).toBeLessThan(vLimitIdx);
    });

    it('无归档 ID 时不调用 notIn', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },
      );

      await shipmentRepository.searchVariants('TH', undefined, USER_ID);

      expect(getBuilder(0).calls).not.toContain('notIn');
    });

    it('无搜索词时归档 ID 通过 notIn 在 DB 层过滤（不在 JS 层 filter）', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set([VID1]));
      const { getBuilder } = pushResults({
        data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Product A')],
      });

      await shipmentRepository.searchVariants('TH', undefined, USER_ID);

      // notIn 被调用，在 DB 层完成过滤，不依赖 JS 层 archivedIds.has()
      const b = getBuilder(0);
      expect(b.notInCalls).toHaveLength(1);
      expect(b.notInCalls[0]).toMatchObject({ column: 'id', ids: [VID1] });
    });
  });

  // ── Merge & dedup ────────────────────────────────────────────────

  describe('三路合并去重', () => {
    it('SKU 和 variant name 查询结果按 variant id 去重', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        {
          data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Prod A')],
        },
        {
          data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Prod A')],
        },  // same variant
        { data: [] },   // product query
        { data: [] },   // product→variant query
      );

      const results = await shipmentRepository.searchVariants('TH', 'sku', USER_ID);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(VID1);
    });

    it('三路不同 variant 合并且按 SKU/name/product 顺序排列', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        {
          data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Prod A')],
        },
        {
          data: [mockVariantRow(VID2, 'SKU-B', 'Name B', 'TH', 'Prod B')],
        },
        { data: [] },   // product query
        { data: [] },   // product→variant query
      );

      const results = await shipmentRepository.searchVariants('TH', 'sku', USER_ID);
      expect(results).toHaveLength(2);
    });

    it('product name 匹配的 variant 被合并进来', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [] },   // SKU query
        { data: [] },   // name query
        { data: [{ id: 'product-1' }] },  // product query
        {
          data: [mockVariantRow(VID3, 'SKU-C', 'Name C', 'TH', 'Target Product')],
        },  // product→variant
      );

      const results = await shipmentRepository.searchVariants('TH', 'target', USER_ID);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(VID3);
      expect(results[0].productName).toBe('Target Product');
    });

    it('product name 匹配结果与 SKU/name 结果去重', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Prod')] },  // SKU
        { data: [] },   // name
        { data: [{ id: 'product-1' }] },  // product
        { data: [mockVariantRow(VID1, 'SKU-A', 'Name A', 'TH', 'Prod')] },  // same via product
      );

      const results = await shipmentRepository.searchVariants('TH', 'sku', USER_ID);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(VID1);
    });

    it('结果不超过 LIMIT (100)', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const manyRows = Array.from({ length: 150 }, (_, i) =>
        mockVariantRow(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `SKU-${i}`, `Name-${i}`, 'TH', `Product-${i}`),
      );
      pushResults(
        { data: manyRows.slice(0, 80) },
        { data: manyRows.slice(20, 70) },  // overlapping + more
        { data: [] },
        { data: [] },
      );

      const results = await shipmentRepository.searchVariants('TH', 'sku', USER_ID);
      expect(results.length).toBeLessThanOrEqual(100);
    });
  });

  // ── LIKE escaping ────────────────────────────────────────────────

  describe('LIKE 通配符转义（ilike 参数断言）', () => {
    /** 从 builder 的 callLog 中取出所有 ilike 调用的第二个参数（pattern） */
    function ilikePatterns(builder: ReturnType<typeof createQueryMock>) {
      return builder.callLog
        .filter((c) => c.method === 'ilike')
        .map((c) => c.args[1] as string);
    }

    it('反斜杠 \\ 被转义，不匹配任意字符', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },   // SKU
        { data: [] },   // name
        { data: [] },   // product
        { data: [] },   // product→variant
      );

      await shipmentRepository.searchVariants('TH', '\\test', USER_ID);

      const patterns = ilikePatterns(getBuilder(0));
      expect(patterns).toContain('%\\\\test%');
    });

    it('% 被转义，不作为 LIKE 通配符', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      );

      await shipmentRepository.searchVariants('TH', '100%', USER_ID);

      const patterns = ilikePatterns(getBuilder(0));
      expect(patterns).toContain('%100\\%%');
    });

    it('_ 被转义，不作为 LIKE 单字符通配符', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      );

      await shipmentRepository.searchVariants('TH', 'SKU_001', USER_ID);

      const patterns = ilikePatterns(getBuilder(0));
      expect(patterns).toContain('%SKU\\_001%');
    });

    it('\\ + % + _ 组合全部被转义', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      );

      await shipmentRepository.searchVariants('TH', '\\%_', USER_ID);

      const patterns = ilikePatterns(getBuilder(0));
      // search='\%_' → escape \ first → '\\%_' → then escape % and _ → '\\\%\_'
      // pattern = '%' + '\\\%\_' + '%'
      expect(patterns).toContain('%\\\\\\%\\_%');
    });

    it('无特殊字符时不添加多余反斜杠', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilder } = pushResults(
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      );

      await shipmentRepository.searchVariants('TH', 'normal', USER_ID);

      const patterns = ilikePatterns(getBuilder(0));
      expect(patterns).toContain('%normal%');
    });

    it('variant name 和 product name 查询也使用相同转义 pattern', async () => {
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      const { getBuilders } = pushResults(
        { data: [] },   // SKU
        { data: [] },   // name
        { data: [{ id: 'product-1' }] },  // product
        { data: [] },   // product→variant
      );

      await shipmentRepository.searchVariants('TH', 'a_b', USER_ID);

      // SKU query (index 0) and name query (index 1) both use ilike with escaped pattern
      const skuPatterns = ilikePatterns(getBuilders()[0]);
      const namePatterns = ilikePatterns(getBuilders()[1]);
      expect(skuPatterns).toContain('%a\\_b%');
      expect(namePatterns).toContain('%a\\_b%');
    });
  });

  // ── Error → ActionResult (real Server Action chain) ─────────────

  describe('searchVariants() Server Action 真实链路', () => {
    const USER = { id: 'u-action', roleName: 'admin' as const, isActive: true as const, email: 'a@x.com', displayName: 'Admin' };

    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('无关键词查询 DB 错误 → ShipmentError → ActionResult { success: false, error }', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults({ data: null, error: new Error('connection lost') });

      const result = await searchVariants('TH');
      expect(result.success).toBe(false);
      expect(result.error).toBe('查询 SKU 列表失败');
    });

    it('SKU 查询 DB 错误 → ShipmentError → ActionResult { success: false, error }', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [], error: new Error('timeout') }, // SKU query error
        { data: [] },
        { data: [] },
        { data: [] },
      );

      const result = await searchVariants('TH', 'sku');
      expect(result.success).toBe(false);
      expect(result.error).toBe('查询 SKU 列表失败');
    });

    it('variant name 查询 DB 错误 → ShipmentError → ActionResult', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [] },   // SKU (pass)
        { data: null, error: new Error('timeout') },  // name (error)
        { data: [] },
        { data: [] },
      );

      const result = await searchVariants('TH', 'test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('查询 SKU 列表失败');
    });

    it('product name 查询 DB 错误 → ShipmentError → ActionResult', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [] },   // SKU (pass)
        { data: [] },   // name (pass)
        { data: null, error: new Error('timeout') },  // product (error)
        { data: [] },
      );

      const result = await searchVariants('TH', 'test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('查询 SKU 列表失败');
    });

    it('product→variant 回查 DB 错误 → ShipmentError → ActionResult', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults(
        { data: [] },   // SKU (pass)
        { data: [] },   // name (pass)
        { data: [{ id: 'product-1' }] },  // product (pass)
        { data: null, error: new Error('timeout') },  // product→variant (error)
      );

      const result = await searchVariants('TH', 'test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('查询 SKU 列表失败');
    });

    it('getUserArchivedVariantIds 异常 → ActionResult 中文错误', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockRejectedValue(new Error('DB error'));

      const result = await searchVariants('TH');
      expect(result.success).toBe(false);
      expect(result.error).toBe('搜索 SKU 失败，请稍后重试');
    });

    it('未登录 → requireActiveAuth 抛错 → ActionResult', async () => {
      mockRequireActiveAuth.mockImplementation(() => { throw new Error('未登录或账户已停用'); });

      const result = await searchVariants('TH');
      expect(result.success).toBe(false);
      expect(result.error).toContain('搜索 SKU 失败');
    });

    it('正常结果 → ActionResult { success: true, data }', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);
      mockGetArchivedIds.mockResolvedValue(new Set<string>());
      pushResults({
        data: [mockVariantRow(VID1, 'SKU1', 'Name', 'TH', 'Product')],
      });

      const result = await searchVariants('TH');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].sku).toBe('SKU1');
      }
    });

    it('Zod 校验拒绝非法 country → 不调用 repository', async () => {
      mockRequireActiveAuth.mockResolvedValue(USER);

      const result = await searchVariants('XX' as never);
      expect(result.success).toBe(false);
      expect(result.error).toContain('请选择目的国');
    });
  });
});
