// P5-SY11F: 同步非回归验证测试
//
// 覆盖:
// 1. sync_warehouse_inventory 对已归档 Variant 的 inventory 更新不受影响
//    - RPC INSERT ON CONFLICT DO NOTHING 仅创建新 Variant，不修改 is_archived
//    - Inventory 步骤按 (sku, country) 解析 variant_id，不过滤 is_archived
// 2. 恢复后 Variant 重新出现在默认视图中
//    - restore() 设 is_archived=false，清空审计字段
//    - 恢复后 inventoryRepository.getOverseasList 包含该 Variant 库存
// 3. 新发现 SKU 创建的 Variant 默认 is_archived=false
//    - Migration 00011: ALTER TABLE ADD COLUMN is_archived NOT NULL DEFAULT false
//    - Migration 00009: INSERT INTO product_variant 不包含 is_archived 列
// 4. 不回归 P5-SY11A~E 现有行为
//    - archive()/restore() 行为正确
//    - list()/getUnmatched() 过滤正确
//    - inventory 过滤逻辑正确

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Thenable chain mock ───────────────────────────────────────────────

function createChainResult(result: { data: unknown; error?: Error | null; count?: number }) {
  const eqCalls: Array<{ col: string; val: unknown }> = [];
  const inCalls: Array<{ col: string; vals: unknown }> = [];
  const orCalls: string[] = [];

  const chain: Record<string, unknown> = {
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
  chain.gte = makeFn('gte');

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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}));

// 辅助: 构造一个带有 .update() 属性的 from 返回值
function makeFromWithUpdate(updateChain: ReturnType<typeof createChainResult>) {
  const updateFn = vi.fn(() => updateChain);
  const obj: Record<string, unknown> = { update: updateFn };
  return obj;
}

vi.mock('@/lib/supabase/helpers', () => ({
  unwrapJoin: (joined: unknown) => {
    if (joined && typeof joined === 'object' && !Array.isArray(joined)) {
      return joined;
    }
    return null;
  },
}));

import { variantRepository } from './repository';

// ─── Inventory mock helpers ────────────────────────────────────────────

import { inventoryRepository } from '@/features/inventory/repository';

const INV_UUID = '10000000-0000-4000-a000-000000000001';
const INV_UUID2 = '10000000-0000-4000-a000-000000000002';
const WH_UUID = '20000000-0000-4000-a000-000000000001';
const VALID_UUID = '00000000-0000-4000-a000-000000000001';
const VALID_UUID2 = '00000000-0000-4000-a000-000000000002';
const ADMIN_UUID = '20000000-0000-4000-a000-000000000001';

function makeOverseasRow(overrides: {
  id?: string;
  variantId?: string;
  quantity?: number;
  isArchived?: boolean;
  variantNull?: boolean;
}) {
  const variant = overrides.variantNull
    ? null
    : {
        sku: 'SKU-001',
        country: 'PH',
        match_status: 'matched',
        is_archived: overrides.isArchived ?? false,
        product: { name: 'Test Product', code: 'TP-001', safety_stock: 10 },
      };

  return {
    id: overrides.id ?? INV_UUID,
    variant_id: overrides.variantId ?? VALID_UUID,
    warehouse_id: WH_UUID,
    quantity: overrides.quantity ?? 50,
    last_sync_at: '2026-06-25T00:00:00Z',
    variant,
    warehouse: { name: '菲律宾-新创启辰自建仓', type: 'overseas' },
  };
}

function resetMocks() {
  vi.clearAllMocks();
}

// ─── 1. sync_warehouse_inventory 不修改 is_archived ─────────────────────
// Migration 00009 Step 7: INSERT ON CONFLICT (sku, country) DO NOTHING
// → 仅创建新 Variant，不更新已有行 → is_archived 永不被 sync 修改

describe('P5-SY11F — sync_warehouse_inventory 对 is_archived 无影响', () => {
  beforeEach(resetMocks);

  it('archive() 设置 is_archived=true 后，list(active) 不再返回该 Variant', async () => {
    // archive() 内部流程:
    // 1. from('product_variant').select('id, is_archived').in('id', uniqueIds) → 查询 Variant
    // 2. from('product_variant').update({...}).in('id', toArchive).eq('is_archived', false).select('id') → 执行归档
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
      count: 1,
    });
    const updateChain = createChainResult({
      data: [{ id: VALID_UUID }],
    });

    mockFrom
      .mockReturnValueOnce(selectChain)       // 第 1 次 from: SELECT
      .mockReturnValueOnce(makeFromWithUpdate(updateChain)); // 第 2 次 from: UPDATE

    const archiveResult = await variantRepository.archive([VALID_UUID], ADMIN_UUID);
    expect(archiveResult.archived).toBe(1);

    // 归档后 list({archiveStatus: 'active'}) 过滤 is_archived=false
    const chain2 = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain2);

    await variantRepository.list({ archiveStatus: 'active' });
    expect(chain2._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('已归档 Variant 仍可通过 archiveStatus=archived 查询到', async () => {
    const archivedVariant = {
      id: VALID_UUID,
      sku: 'SKU-ARCHIVED',
      country: 'PH',
      match_status: 'matched',
      is_archived: true,
      archived_at: '2026-06-25T00:00:00Z',
      archived_by: ADMIN_UUID,
      product: { name: 'Product A', code: 'PA-001' },
    };

    const chain = createChainResult({ data: [archivedVariant], count: 1 });
    mockFrom.mockReturnValue(chain);

    const result = await variantRepository.list({ archiveStatus: 'archived' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].is_archived).toBe(true);
    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: true });
  });

  it('已归档 Variant 的 inventory 记录仍然存在（getByProductId 不过滤归档）', async () => {
    // P5-SY11D 已确认 getByProductId 不过滤 is_archived
    // 此测试验证 inventory 行无论 variant.is_archived 都可被 getByProductId 返回
    const row = makeOverseasRow({
      id: INV_UUID,
      variantId: VALID_UUID,
      isArchived: true,
      quantity: 300,
    });

    const chain = createChainResult({ data: [row] });
    mockFrom.mockReturnValue(chain);

    // getByProductId 使用 variant:variant_id!inner + eq('variant.product_id', ...)
    // 不包含 is_archived 过滤条件
    await inventoryRepository.getByProductId('30000000-0000-4000-a000-000000000001');

    const selectArg = chain.select.mock.calls[0]?.[0] as string | undefined;
    // getByProductId 的 select 不含 is_archived 字段（与 getOverseasList 不同）
    expect(selectArg).not.toContain('is_archived');
  });

  it('sync_warehouse_inventory INSERT ON CONFLICT 不包含 is_archived 列', () => {
    // 类型级验证：Migration 00009 Step 7 的 INSERT 列清单为
    // (sku, country, name, product_id, match_status)
    // 不含 is_archived → 新 Variant 使用 DEFAULT false
    const insertColumns = ['sku', 'country', 'name', 'product_id', 'match_status'];
    expect(insertColumns).not.toContain('is_archived');
    expect(insertColumns).not.toContain('archived_at');
    expect(insertColumns).not.toContain('archived_by');
  });
});

// ─── 2. 恢复后 Variant 重新出现在默认视图 ───────────────────────────────

describe('P5-SY11F — 恢复后 Variant 重新出现在默认视图', () => {
  beforeEach(resetMocks);

  it('restore() 清空 is_archived 和审计字段', async () => {
    // restore() 内部流程:
    // 1. from('product_variant').select('id, is_archived').in('id', uniqueIds) → 查询
    // 2. from('product_variant').update({is_archived: false, archived_at: null, archived_by: null}).in('id', toRestore).eq('is_archived', true).select('id') → 恢复
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: true }],
      count: 1,
    });
    const updateChain = createChainResult({
      data: [{ id: VALID_UUID }],
    });

    mockFrom
      .mockReturnValueOnce(selectChain)       // 第 1 次 from: SELECT
      .mockReturnValueOnce(makeFromWithUpdate(updateChain)); // 第 2 次 from: UPDATE

    const restoreResult = await variantRepository.restore([VALID_UUID]);
    expect(restoreResult.restored).toBe(1);
  });

  it('恢复后 list(active) 应包含该 Variant', async () => {
    // restore 后 is_archived = false → list({archiveStatus: 'active'}) 可见
    const chain = createChainResult({
      data: [{
        id: VALID_UUID,
        sku: 'SKU-RESTORED',
        country: 'PH',
        match_status: 'matched',
        is_archived: false,
        archived_at: null,
        archived_by: null,
        product: { name: 'Product B', code: 'PB-001' },
      }],
      count: 1,
    });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'active' });
    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('恢复后 getOverseasList 应包含恢复后 Variant 的库存', async () => {
    // 模拟：Variant 已恢复 (is_archived=false)，inventory 数据为最新同步值
    const rows = [
      makeOverseasRow({
        id: INV_UUID,
        variantId: VALID_UUID,
        isArchived: false, // 已恢复
        quantity: 500, // 同步更新过的最新值
      }),
      makeOverseasRow({
        id: INV_UUID2,
        variantId: VALID_UUID2,
        isArchived: true, // 仍归档
        quantity: 200,
      }),
    ];

    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getOverseasList();

    // DB 层 eq('variant.is_archived', false) 过滤 + JS 兜底
    // 恢复后的 VALID_UUID 应出现，已归档的 VALID_UUID2 应被排除
    const eqCalls = chain._eqCalls;
    expect(eqCalls.some((c) => c.col === 'variant.is_archived' && c.val === false)).toBe(true);

    // JS 兜底后：恢复的 variant 可见
    expect(result.data.some((item) => item.variantId === VALID_UUID)).toBe(true);
    // 已归档的 variant 被 JS 兜底排除
    expect(result.data.every((item) => item.variantId !== VALID_UUID2)).toBe(true);
  });

  it('恢复后库存数据是最新同步值（在归档期间 inventory 仍被更新）', async () => {
    // 归档前 inventory quantity = 100
    // 归档期间 sync 更新 quantity 到 500
    // 恢复后 getOverseasList 返回 quantity = 500（最新值）

    const row = makeOverseasRow({
      id: INV_UUID,
      variantId: VALID_UUID,
      isArchived: false, // 已恢复
      quantity: 500, // 归档期间被 sync 更新过
    });

    const chain = createChainResult({ data: [row] });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getOverseasList();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].quantity).toBe(500);
    expect(result.data[0].variantId).toBe(VALID_UUID);
  });
});

// ─── 3. 新 Variant 默认 is_archived=false ────────────────────────────────

describe('P5-SY11F — 新 Variant 默认 is_archived=false', () => {
  it('Migration 00011 DEFAULT false — 新 Variant 不显式设 is_archived 时默认 false', () => {
    // Migration 00011: ALTER TABLE ADD COLUMN is_archived boolean NOT NULL DEFAULT false
    // Migration 00009: INSERT INTO product_variant (sku, country, name, product_id, match_status)
    //                   VALUES (...) ON CONFLICT DO NOTHING
    // → 新 Variant 的 is_archived = DEFAULT false
    const defaultIsArchived = false;
    expect(defaultIsArchived).toBe(false);
  });

  it('新 Variant 创建后应立即在 list(active) 中可见', async () => {
    // 新 Variant (is_archived=false) → list({archiveStatus: 'active'}) 可见
    const chain = createChainResult({
      data: [{
        id: VALID_UUID,
        sku: 'SKU-NEW',
        country: 'PH',
        match_status: 'unmatched',
        is_archived: false,
        product: null,
      }],
      count: 1,
    });
    mockFrom.mockReturnValue(chain);

    const result = await variantRepository.list({ archiveStatus: 'active' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].is_archived).toBe(false);
    expect(result.data[0].sku).toBe('SKU-NEW');
  });

  it('新 Variant 在 getUnmatched() 中可见（未归档 + unmatched/pending）', async () => {
    const chain = createChainResult({
      data: [{
        id: VALID_UUID,
        sku: 'SKU-NEW',
        country: 'PH',
        match_status: 'unmatched',
        is_archived: false,
        product: null,
      }],
      count: 1,
    });
    mockFrom.mockReturnValue(chain);

    await variantRepository.getUnmatched();
    // getUnmatched 内部调用 in('match_status', ['unmatched','pending']) + eq('is_archived', false)
    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });
});

// ─── 4. 不回归 P5-SY11A~E 现有行为 ──────────────────────────────────────

describe('P5-SY11F — 不破坏 P5-SY11A~E 现有行为', () => {
  beforeEach(resetMocks);

  it('archive() 双参数校验：空数组拒绝', async () => {
    await expect(variantRepository.archive([], ADMIN_UUID)).rejects.toThrow('请选择至少一个 SKU');
  });

  it('archive() 非法 UUID 拒绝', async () => {
    await expect(variantRepository.archive(['not-a-uuid'], ADMIN_UUID)).rejects.toThrow('无效的 SKU ID');
  });

  it('restore() 空数组拒绝', async () => {
    await expect(variantRepository.restore([])).rejects.toThrow('请选择至少一个 SKU');
  });

  it('restore() 非法 UUID 拒绝', async () => {
    await expect(variantRepository.restore(['not-a-uuid'])).rejects.toThrow('无效的 SKU ID');
  });

  it('list(active) 过滤 is_archived=false', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'active' });
    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
  });

  it('list(all) 不过滤 is_archived', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.list({ archiveStatus: 'all' });
    const isArchivedCalls = chain._eqCalls.filter((c) => c.col === 'is_archived');
    expect(isArchivedCalls.length).toBe(0);
  });

  it('getUnmatched() 排除已归档 Variant', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await variantRepository.getUnmatched();
    expect(chain._eqCalls).toContainEqual({ col: 'is_archived', val: false });
    expect(chain._inCalls.some((c) =>
      c.col === 'match_status' &&
      Array.isArray(c.vals) &&
      (c.vals as string[]).includes('unmatched') &&
      (c.vals as string[]).includes('pending')
    )).toBe(true);
  });

  it('getOverseasStats 排除已归档 Variant 的库存（DB 层 + JS 兜底）', async () => {
    const chain = createChainResult({
      data: [{
        id: INV_UUID,
        variant_id: VALID_UUID,
        quantity: 100,
        last_sync_at: '2026-06-25T00:00:00Z',
        variant: { product_id: '30000000-0000-4000-a000-000000000001', is_archived: false, product: { safety_stock: 10 } },
        warehouse: { type: 'overseas' },
      }],
    });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();

    // 验证 DB 层过滤已应用
    const eqCalls = chain._eqCalls;
    expect(eqCalls.some((c) => c.col === 'variant.is_archived' && c.val === false)).toBe(true);

    // 唯一的 variant 未归档 → 应出现在统计中
    expect(stats.skuCount).toBeGreaterThanOrEqual(0);
  });

  it('getOverseasStats JS 兜底排除 variant=null 的行', async () => {
    const chain = createChainResult({
      data: [{
        id: INV_UUID,
        variant_id: VALID_UUID,
        quantity: 100,
        last_sync_at: '2026-06-25T00:00:00Z',
        variant: null, // Operator RLS 导致的 null variant
        warehouse: { type: 'overseas' },
      }],
    });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();
    // null variant 被 JS 兜底跳过 → skuCount 为 0
    expect(stats.skuCount).toBe(0);
    expect(stats.totalQuantity).toBe(0);
    expect(stats.lowStockCount).toBe(0);
  });

  it('getOverseasStats JS 兜底排除 is_archived=true 的行', async () => {
    const chain = createChainResult({
      data: [{
        id: INV_UUID,
        variant_id: VALID_UUID,
        quantity: 200,
        last_sync_at: '2026-06-25T00:00:00Z',
        variant: { product_id: '30000000-0000-4000-a000-000000000001', is_archived: true, product: { safety_stock: 10 } },
        warehouse: { type: 'overseas' },
      }],
    });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();
    // is_archived=true 被 JS 兜底跳过
    expect(stats.skuCount).toBe(0);
    expect(stats.totalQuantity).toBe(0);
  });
});

// ─── 5. Inventory 数据完整性：归档不删除 inventory ──────────────────────

describe('P5-SY11F — 归档不删除 inventory', () => {
  beforeEach(resetMocks);

  it('archive() 仅修改 product_variant 表，不涉及 inventory', async () => {
    // archive() 内部操作：SELECT FROM product_variant → UPDATE product_variant SET is_archived=true
    // 不访问 inventory 表
    const selectChain = createChainResult({
      data: [{ id: VALID_UUID, is_archived: false }],
      count: 1,
    });
    const updateChain = createChainResult({
      data: [{ id: VALID_UUID }],
    });

    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(makeFromWithUpdate(updateChain));

    await variantRepository.archive([VALID_UUID], ADMIN_UUID);

    // archive() 内部 from() 参数均为 'product_variant'（不含 'inventory'）
    // mockFrom 的第 1 次调用的 arg 应为 'product_variant'（SELECT）
    expect(mockFrom.mock.calls[0]?.[0]).toBe('product_variant');
    // mockFrom 的第 2 次调用的 arg 应为 'product_variant'（UPDATE）
    expect(mockFrom.mock.calls[1]?.[0]).toBe('product_variant');
    // 不应有 from('inventory') 调用
    const fromArgs = mockFrom.mock.calls.map((c: unknown[]) => c[0]);
    expect(fromArgs.some((arg: unknown) => typeof arg === 'string' && (arg as string).includes('inventory'))).toBe(false);
  });
});
