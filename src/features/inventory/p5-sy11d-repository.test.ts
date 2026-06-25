// P5-SY11D: Inventory Repository 归档过滤测试
//
// 覆盖:
// - getOverseasList 排除 is_archived=true
// - getOverseasList 排除 variant=null（JS 兜底）
// - getLowStock 排除 is_archived=true
// - getLowStock 排除 variant=null（JS 兜底）
// - getOverseasStats 不统计已归档 Variant
// - getOverseasStats 不统计 variant=null 行（JS 兜底）
// - getByProductId 保留已归档 Variant
// - 查询链包含 is_archived=false eq 过滤
// - DB 层 inner join 验证

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

// unwrapJoin: 测试中使用真实行为 — 非数组对象直接返回，否则 null
vi.mock('@/lib/supabase/helpers', () => ({
  unwrapJoin: (joined: unknown) => {
    if (joined && typeof joined === 'object' && !Array.isArray(joined)) {
      return joined;
    }
    return null;
  },
}));

import { inventoryRepository } from './repository';

// ─── Constants ─────────────────────────────────────────────────────────

const VARIANT_UUID = '00000000-0000-4000-a000-000000000001';
const VARIANT_UUID2 = '00000000-0000-4000-a000-000000000002';
const VARIANT_UUID3 = '00000000-0000-4000-a000-000000000003';
const INV_UUID = '10000000-0000-4000-a000-000000000001';
const INV_UUID2 = '10000000-0000-4000-a000-000000000002';
const INV_UUID3 = '10000000-0000-4000-a000-000000000003';
const WH_UUID = '20000000-0000-4000-a000-000000000001';
const PRODUCT_UUID = '30000000-0000-4000-a000-000000000001';

function makeOverseasRow(overrides: {
  id?: string;
  variantId?: string;
  quantity?: number;
  isArchived?: boolean;
  variantNull?: boolean;
  matchStatus?: string;
  safetyStock?: number;
}) {
  const variant = overrides.variantNull
    ? null
    : {
        sku: 'SKU-001',
        country: 'PH',
        match_status: overrides.matchStatus ?? 'matched',
        is_archived: overrides.isArchived ?? false,
        product: overrides.matchStatus === 'unmatched'
          ? null
          : { name: 'Test Product', code: 'TP-001', safety_stock: overrides.safetyStock ?? 10 },
      };

  return {
    id: overrides.id ?? INV_UUID,
    variant_id: overrides.variantId ?? VARIANT_UUID,
    warehouse_id: WH_UUID,
    quantity: overrides.quantity ?? 50,
    last_sync_at: '2026-06-25T00:00:00Z',
    variant,
    warehouse: { name: '菲律宾-新创启辰自建仓', type: 'overseas' },
  };
}

function makeStatsRow(overrides: {
  id?: string;
  variantId?: string;
  quantity?: number;
  isArchived?: boolean;
  variantNull?: boolean;
  product?: { safety_stock: number } | null;
  lastSyncAt?: string | null;
}) {
  const variant = overrides.variantNull
    ? null
    : {
        product_id: PRODUCT_UUID,
        is_archived: overrides.isArchived ?? false,
        product: overrides.product ?? { safety_stock: 10 },
      };

  return {
    id: overrides.id ?? INV_UUID,
    variant_id: overrides.variantId ?? VARIANT_UUID,
    quantity: overrides.quantity ?? 50,
    last_sync_at: overrides.lastSyncAt ?? '2026-06-25T00:00:00Z',
    variant,
    warehouse: { type: 'overseas' },
  };
}

function resetMocks() {
  vi.clearAllMocks();
}

// ─── 1. getOverseasList 归档过滤 ───────────────────────────────────────

describe('P5-SY11D — getOverseasList() 归档过滤', () => {
  beforeEach(resetMocks);

  it('DB 层：select 使用 variant:variant_id!inner（inner join）', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getOverseasList();

    const selectArg = chain.select.mock.calls[0]?.[0] as string | undefined;
    expect(selectArg).toContain('variant:variant_id!inner');
    expect(selectArg).toContain('is_archived');
  });

  it('DB 层：eq 过滤 variant.is_archived = false', async () => {
    const chain = createChainResult({ data: [], count: 0 });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getOverseasList();

    const eqCalls = chain._eqCalls;
    expect(eqCalls.some((c) => c.col === 'variant.is_archived' && c.val === false)).toBe(true);
  });

  it('排除 is_archived=true 的 Variant 对应库存', async () => {
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 200 }),
      makeOverseasRow({ id: INV_UUID3, variantId: VARIANT_UUID3, isArchived: false, quantity: 300 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getOverseasList();

    expect(result.data).toHaveLength(2);
    expect(result.data.every((item) => item.variantId !== VARIANT_UUID2)).toBe(true);
    expect(result.total).toBe(2);
  });

  it('排除 variant=null 的 inventory 行（JS 兜底）', async () => {
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, variantNull: true, quantity: 200 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getOverseasList();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].variantId).toBe(VARIANT_UUID);
  });

  it('空数据返回空结果', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getOverseasList();

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─── 2. getLowStock 归档过滤 ───────────────────────────────────────────

describe('P5-SY11D — getLowStock() 归档过滤', () => {
  beforeEach(resetMocks);

  it('DB 层：select 使用 variant:variant_id!inner（inner join）', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getLowStock();

    const selectArg = chain.select.mock.calls[0]?.[0] as string | undefined;
    expect(selectArg).toContain('variant:variant_id!inner');
    expect(selectArg).toContain('is_archived');
  });

  it('DB 层：eq 过滤 variant.is_archived = false', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getLowStock();

    const eqCalls = chain._eqCalls;
    expect(eqCalls.some((c) => c.col === 'variant.is_archived' && c.val === false)).toBe(true);
  });

  it('排除 is_archived=true 的低库存 Variant', async () => {
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 5, safetyStock: 10 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 3, safetyStock: 10 }),
      makeOverseasRow({ id: INV_UUID3, variantId: VARIANT_UUID3, isArchived: false, quantity: 2, safetyStock: 10 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getLowStock();

    // 两个活跃 Variant 都是低库存（quantity <= safety_stock）
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.variantId !== VARIANT_UUID2)).toBe(true);
  });

  it('排除 variant=null 的 inventory 行（JS 兜底）', async () => {
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 5, safetyStock: 10 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, variantNull: true, quantity: 3 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getLowStock();

    expect(result).toHaveLength(1);
    expect(result[0].variantId).toBe(VARIANT_UUID);
  });

  it('空数据返回空数组', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getLowStock();
    expect(result).toEqual([]);
  });
});

// ─── 3. getOverseasStats 归档过滤 ──────────────────────────────────────

describe('P5-SY11D — getOverseasStats() 归档过滤', () => {
  beforeEach(resetMocks);

  it('DB 层：select 使用 variant:variant_id!inner（inner join）', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getOverseasStats();

    const selectArg = chain.select.mock.calls[0]?.[0] as string | undefined;
    expect(selectArg).toContain('variant:variant_id!inner');
    expect(selectArg).toContain('is_archived');
  });

  it('DB 层：eq 过滤 variant.is_archived = false', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getOverseasStats();

    const eqCalls = chain._eqCalls;
    expect(eqCalls.some((c) => c.col === 'variant.is_archived' && c.val === false)).toBe(true);
  });

  it('不统计已归档 Variant 的库存', async () => {
    const rows = [
      makeStatsRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeStatsRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 200 }),
      makeStatsRow({ id: INV_UUID3, variantId: VARIANT_UUID3, isArchived: false, quantity: 50 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();

    // totalQuantity: 100 + 50 = 150 (exclude 200 from archived)
    expect(stats.totalQuantity).toBe(150);
    expect(stats.skuCount).toBe(2);
  });

  it('不统计 variant=null 的 inventory 行（JS 兜底）', async () => {
    const rows = [
      makeStatsRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeStatsRow({ id: INV_UUID2, variantId: VARIANT_UUID2, variantNull: true, quantity: 200 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();

    expect(stats.totalQuantity).toBe(100);
    expect(stats.skuCount).toBe(1);
  });

  it('已归档 Variant 不参与低库存统计', async () => {
    const rows = [
      makeStatsRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 5, product: { safety_stock: 10 } }),
      makeStatsRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 5, product: { safety_stock: 10 } }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();

    expect(stats.lowStockCount).toBe(1);
  });

  it('空数据返回零统计', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    const stats = await inventoryRepository.getOverseasStats();

    expect(stats.totalQuantity).toBe(0);
    expect(stats.skuCount).toBe(0);
    expect(stats.lowStockCount).toBe(0);
  });
});

// ─── 4. getByProductId 不过滤已归档 ─────────────────────────────────────

describe('P5-SY11D — getByProductId() 保留已归档 Variant', () => {
  beforeEach(resetMocks);

  it('保留已归档 Variant 的库存（产品详情页需显示全部）', async () => {
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 200 }),
    ];
    // getByProductId uses variant:variant_id!inner without is_archived filter
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getByProductId(PRODUCT_UUID);

    // Both archived and active variants should be included
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.variantId).sort()).toEqual([VARIANT_UUID, VARIANT_UUID2].sort());
  });

  it('查询不包含 is_archived 过滤条件', async () => {
    const chain = createChainResult({ data: [] });
    mockFrom.mockReturnValue(chain);

    await inventoryRepository.getByProductId(PRODUCT_UUID);

    const eqCalls = chain._eqCalls;
    const hasArchiveEq = eqCalls.some((c) => c.col === 'variant.is_archived');
    expect(hasArchiveEq).toBe(false);
  });

  it('查询不使用 JS 兜底排除已归档', async () => {
    // 如果 JS 兜底排除已归档，则已归档行不应出现
    const rows = [
      makeOverseasRow({ id: INV_UUID, variantId: VARIANT_UUID, isArchived: false, quantity: 100 }),
      makeOverseasRow({ id: INV_UUID2, variantId: VARIANT_UUID2, isArchived: true, quantity: 200 }),
    ];
    const chain = createChainResult({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await inventoryRepository.getByProductId(PRODUCT_UUID);

    expect(result).toHaveLength(2);
  });
});
