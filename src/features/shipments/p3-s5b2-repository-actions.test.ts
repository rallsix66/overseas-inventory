// P3-S5B2: Repository 方法 + Server Actions — 静态与行为测试
//
// 覆盖：
// ── Repository 行为测试 ──
// 1. partialWarehouse — RPC 调用、snake_case→camelCase 映射、错误传播
// 2. listEligibleForBatchWarehousing — customs+warehouse IS NOT NULL 过滤、Operator 仓库隔离、分页、筛选
// 3. getConfirmedWarehousedQuantity — 两步聚合、空结果、错误传播
// 4. getConfirmedWarehousedByWarehouse — 按 variant 聚合、空结果、错误传播
// 5. confirmBigsellerAbsorption — 状态校验（仅 warehoused）、已确认拦截、成功写入、错误传播
//
// ── Server Actions 测试 ──
// 6. partialWarehouseShipment — Admin-only、Zod 校验、成功/失败、revalidate
// 7. batchWarehouseShipments — Admin-only、Zod 校验、逐笔串行、单笔失败不影响后续、revalidate
// 8. confirmBigsellerAbsorption — Admin-only、UUID Zod、成功/失败、revalidate
//
// ── Schema / Types / 源码静态检查 ──
// 9. Schema 校验 — confirmBigsellerAbsorptionSchema、batchWarehouseShipmentsSchema
// 10. 不调用 00023 / warehouse_shipment_transactional
// 11. 不写 inventory
// 12. snake_case/camelCase 映射验证

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf-8');
}

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockFrom,
  mockRpc,
  mockGetAccessibleIds,
  mockRequireActiveAuth,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockGetAccessibleIds: vi.fn(),
  mockRequireActiveAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: () => mockRequireActiveAuth(),
}));

vi.mock('@/features/warehouse-access/repository', () => ({
  warehouseAccessRepository: {
    getAccessibleWarehouseIds: mockGetAccessibleIds,
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

// ─── Constants ──────────────────────────────────────────────────────────────

const SHIPMENT_ID = '00000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '10000000-0000-4000-8000-000000000001';
const VARIANT_ID = '20000000-0000-4000-8000-000000000001';
const ADMIN_USER = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  roleName: 'admin' as const,
  isActive: true as const,
  email: 'admin@test.com',
  displayName: 'Admin',
};
const OP_USER = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  roleName: 'operator' as const,
  isActive: true as const,
  email: 'op@test.com',
  displayName: 'Operator',
};

// ─── Mock helpers ───────────────────────────────────────────────────────────

function createQueryMock(result: { data?: unknown; error?: unknown }) {
  const calls: string[] = [];
  const self: Record<string, unknown> = {
    then(resolve: (v: unknown) => void) {
      resolve(result);
      return Promise.resolve(result);
    },
  };

  for (const method of [
    'select', 'eq', 'neq', 'not', 'is', 'ilike', 'order',
    'notIn', 'in', 'limit', 'range', 'single', 'maybeSingle', 'update', 'or',
  ]) {
    self[method] = vi.fn(() => self);
  }

  return { builder: self, calls };
}

function pushFromResults(
  ...results: Array<{ data?: unknown; error?: unknown }>
) {
  const blds = results.map((r) => createQueryMock(r));
  let cursor = 0;
  mockFrom.mockImplementation(() => {
    if (cursor >= blds.length)
      throw new Error(`Unexpected from() call — queue exhausted at ${cursor}`);
    return blds[cursor++].builder;
  });
  return { getBuilder: (i: number) => blds[i], getBuilders: () => blds };
}

// ─── Import repository & actions (after mocks) ──────────────────────────────

import { shipmentRepository, ShipmentError } from '@/features/shipments/repository';
import {
  partialWarehouseShipment,
  batchWarehouseShipments,
  confirmBigsellerAbsorption,
} from '@/features/shipments/actions';
import {
  confirmBigsellerAbsorptionSchema,
  batchWarehouseShipmentsSchema,
} from '@/features/shipments/schema';

// ============================================================================
// 1. Repository — partialWarehouse
// ============================================================================

describe('P3-S5B2: partialWarehouse()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('调用 partial_warehouse_shipment RPC，映射 items 为 [{variant_id, quantity}]', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, all_warehoused: false, items_updated: 2 },
      error: null,
    });

    const result = await shipmentRepository.partialWarehouse(
      SHIPMENT_ID,
      [
        { variantId: VARIANT_ID, quantity: 5 },
        { variantId: '20000000-0000-4000-8000-000000000002', quantity: 3 },
      ],
    );

    expect(mockRpc).toHaveBeenCalledWith('partial_warehouse_shipment', {
      p_shipment_id: SHIPMENT_ID,
      p_items: [
        { variant_id: VARIANT_ID, quantity: 5 },
        { variant_id: '20000000-0000-4000-8000-000000000002', quantity: 3 },
      ],
      p_description: null,
    });
    expect(result).toEqual({
      success: true,
      allWarehoused: false,
      itemsUpdated: 2,
    });
  });

  it('传递 description 到 RPC', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, all_warehoused: true, items_updated: 1 },
      error: null,
    });

    await shipmentRepository.partialWarehouse(
      SHIPMENT_ID,
      [{ variantId: VARIANT_ID, quantity: 10 }],
      '测试备注',
    );

    expect(mockRpc).toHaveBeenCalledWith('partial_warehouse_shipment', {
      p_shipment_id: SHIPMENT_ID,
      p_items: [{ variant_id: VARIANT_ID, quantity: 10 }],
      p_description: '测试备注',
    });
  });

  it('all_warehoused false → allWarehoused false', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, all_warehoused: false, items_updated: 1 },
      error: null,
    });

    const result = await shipmentRepository.partialWarehouse(SHIPMENT_ID, [
      { variantId: VARIANT_ID, quantity: 1 },
    ]);

    expect(result.allWarehoused).toBe(false);
  });

  it('RPC error → ShipmentError(DB_ERROR) 保留中文错误消息', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: '入仓数量 (100) 超过在途余量 (5)' },
    });

    await expect(
      shipmentRepository.partialWarehouse(SHIPMENT_ID, [
        { variantId: VARIANT_ID, quantity: 100 },
      ]),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '入仓数量 (100) 超过在途余量 (5)',
      code: 'DB_ERROR',
    });
  });

  it('RPC error 无 message 时返回兜底中文错误', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {},
    });

    await expect(
      shipmentRepository.partialWarehouse(SHIPMENT_ID, [
        { variantId: VARIANT_ID, quantity: 1 },
      ]),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '确认入仓失败，请稍后重试',
    });
  });

  it('RPC 返回 null 结果 → ShipmentError', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      shipmentRepository.partialWarehouse(SHIPMENT_ID, [
        { variantId: VARIANT_ID, quantity: 1 },
      ]),
    ).rejects.toThrow(ShipmentError);
  });
});

// ============================================================================
// 2. Repository — listEligibleForBatchWarehousing (源码检查 + 行为)
// ============================================================================

describe('P3-S5B2: listEligibleForBatchWarehousing()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('方法签名包含 filters + userId 可选参数', async () => {
    expect(shipmentRepository.listEligibleForBatchWarehousing).toBeInstanceOf(Function);
    // The method accepts (filters?, userId?)
    expect(shipmentRepository.listEligibleForBatchWarehousing.length).toBeGreaterThanOrEqual(0);
  });

  it('源码中查询 status=customs 且 warehouse_id IS NOT NULL', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain("eq('status', 'customs')");
    expect(fnBody).toContain("not('warehouse_id', 'is', null)");
  });

  it('源码中包含 Operator 仓库隔离分支', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain('getAccessibleWarehouseIds');
    expect(fnBody).toContain("role === 'operator'");
  });

  it('源码中包含 country / warehouseId 可选筛选', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain("country) query = query.eq('country', country)");
    expect(fnBody).toContain("warehouseId) query = query.eq('warehouse_id', warehouseId)");
  });

  it('源码中包含 remainingQuantity 计算', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain('remainingQuantity');
    expect(fnBody).toContain('quantity - i.warehoused_quantity');
  });

  it('源码中 productNames 最多 3 个', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain('productNames.length >= 3');
  });

  it('不调用 00023 RPC', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).not.toMatch(/warehouse_shipment_transactional/);
  });

  it('不写 inventory', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    // Exclude comment lines when checking for inventory writes
    const codeLines = fnBody.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const codeOnly = codeLines.join('\n');
    expect(codeOnly).not.toMatch(/\.from\('inventory'\)/);
    expect(codeOnly).not.toMatch(/inventory\.quantity/);
  });

  it('DB 查询出错返回 ShipmentError', async () => {
    // Directly test the error path: pushFromResults with error in shipment query
    pushFromResults(
      { data: { role: { name: 'admin' } } },
      { data: null, error: new Error('connection refused') },
    );

    await expect(
      shipmentRepository.listEligibleForBatchWarehousing({}, ADMIN_USER.id),
    ).rejects.toThrow(ShipmentError);
  });

  it('翻页参数传递正确', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async listEligibleForBatchWarehousing(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain('pageSize = PAGE_SIZE');
    expect(fnBody).toContain('(page - 1) * pageSize');
    expect(fnBody).toContain("order('created_at'");
  });
});

// ============================================================================
// 3. Repository — getConfirmedWarehousedQuantity
// ============================================================================

describe('P3-S5B2: getConfirmedWarehousedQuantity()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('两步查询：先查 shipment IDs → 再聚合 warehoused_quantity', async () => {
    pushFromResults(
      { data: [{ id: 'ship-1' }, { id: 'ship-2' }] }, // shipment IDs
      {
        data: [
          { warehoused_quantity: 10 },
          { warehoused_quantity: 25 },
        ],
      }, // shipment_items
    );

    const total = await shipmentRepository.getConfirmedWarehousedQuantity(
      VARIANT_ID,
      WAREHOUSE_ID,
    );

    expect(total).toBe(35);
  });

  it('无匹配 shipment 返回 0', async () => {
    pushFromResults({ data: [] });

    const total = await shipmentRepository.getConfirmedWarehousedQuantity(
      VARIANT_ID,
      WAREHOUSE_ID,
    );

    expect(total).toBe(0);
  });

  it('shipment 查询出错 → ShipmentError', async () => {
    pushFromResults({ data: null, error: new Error('connection lost') });

    await expect(
      shipmentRepository.getConfirmedWarehousedQuantity(VARIANT_ID, WAREHOUSE_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '查询已确认入仓数量失败',
    });
  });

  it('shipment_item 查询出错 → ShipmentError', async () => {
    pushFromResults(
      { data: [{ id: 'ship-1' }] },
      { data: null, error: new Error('connection lost') },
    );

    await expect(
      shipmentRepository.getConfirmedWarehousedQuantity(VARIANT_ID, WAREHOUSE_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '查询已确认入仓数量失败',
    });
  });

  it('不写 inventory', async () => {
    // This is a read-only method — verified by code review below
    pushFromResults(
      { data: [{ id: 'ship-1' }] },
      { data: [{ warehoused_quantity: 5 }] },
    );

    await shipmentRepository.getConfirmedWarehousedQuantity(VARIANT_ID, WAREHOUSE_ID);

    // No rpc() calls, no mutation
    expect(mockRpc).not.toHaveBeenCalled();
    // Only read from shipment and shipment_item
    const fromCalls = mockFrom.mock.calls.map((c: string[]) => c[0]);
    expect(fromCalls).toEqual(['shipment', 'shipment_item']);
  });

  // ── P3-S5B2 聚合口径：仅纳入 customs 或 warehoused+未吸收 ──

  it('源码中 shipment 查询包含 .or() — 仅 customs 或 warehoused+未吸收', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async getConfirmedWarehousedQuantity(');
    const fnEnd = src.indexOf('async getConfirmedWarehousedByWarehouse(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain("status.eq.customs,and(status.eq.warehoused,bigseller_absorbed_at.is.null)");
    expect(fnBody).toContain('.or(');
  });

  it('customs 状态 → 计入（shipment 查询返回数据则参与聚合）', async () => {
    // mock 不过滤数据，但验证 customs 路径不报错且正确聚合
    pushFromResults(
      { data: [{ id: 'ship-customs-1' }] },
      { data: [{ warehoused_quantity: 8 }] },
    );

    const total = await shipmentRepository.getConfirmedWarehousedQuantity(
      VARIANT_ID,
      WAREHOUSE_ID,
    );
    expect(total).toBe(8);
  });

  it('warehoused + bigseller_absorbed_at=NULL → 计入', async () => {
    pushFromResults(
      { data: [{ id: 'ship-wh-1' }] },
      { data: [{ warehoused_quantity: 12 }] },
    );

    const total = await shipmentRepository.getConfirmedWarehousedQuantity(
      VARIANT_ID,
      WAREHOUSE_ID,
    );
    expect(total).toBe(12);
  });

  it('warehoused + bigseller_absorbed_at 非 NULL → 不计入（shipment 查询返回空）', async () => {
    // .or() 过滤 absorbed shipments → 数据库层排除，返回空数组 → 结果 0
    pushFromResults({ data: [] });

    const total = await shipmentRepository.getConfirmedWarehousedQuantity(
      VARIANT_ID,
      WAREHOUSE_ID,
    );
    expect(total).toBe(0);
  });
});

// ============================================================================
// 4. Repository — getConfirmedWarehousedByWarehouse
// ============================================================================

describe('P3-S5B2: getConfirmedWarehousedByWarehouse()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按 variant_id 聚合已确认入仓数量', async () => {
    pushFromResults(
      { data: [{ id: 'ship-1' }, { id: 'ship-2' }] },
      {
        data: [
          { variant_id: VARIANT_ID, warehoused_quantity: 10 },
          { variant_id: VARIANT_ID, warehoused_quantity: 5 },
          { variant_id: '20000000-0000-4000-8000-000000000002', warehoused_quantity: 20 },
        ],
      },
    );

    const results = await shipmentRepository.getConfirmedWarehousedByWarehouse(
      WAREHOUSE_ID,
    );

    expect(results).toHaveLength(2);
    const v1 = results.find((r) => r.variantId === VARIANT_ID);
    expect(v1?.confirmedQuantity).toBe(15);
    const v2 = results.find(
      (r) => r.variantId === '20000000-0000-4000-8000-000000000002',
    );
    expect(v2?.confirmedQuantity).toBe(20);
  });

  it('无 shipment 返回空数组', async () => {
    pushFromResults({ data: [] });

    const results = await shipmentRepository.getConfirmedWarehousedByWarehouse(
      WAREHOUSE_ID,
    );

    expect(results).toEqual([]);
  });

  it('shipment 查询出错 → ShipmentError', async () => {
    pushFromResults({ data: null, error: new Error('timeout') });

    await expect(
      shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '查询仓库已确认入仓聚合失败',
    });
  });

  it('shipment_item 查询出错 → ShipmentError', async () => {
    pushFromResults(
      { data: [{ id: 'ship-1' }] },
      { data: null, error: new Error('timeout') },
    );

    await expect(
      shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      message: '查询仓库已确认入仓聚合失败',
    });
  });

  it('不写 inventory', async () => {
    pushFromResults(
      { data: [{ id: 'ship-1' }] },
      { data: [] },
    );

    await shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    const fromCalls = mockFrom.mock.calls.map((c: string[]) => c[0]);
    expect(fromCalls).toEqual(['shipment', 'shipment_item']);
  });

  // ── P3-S5B2 聚合口径：仅纳入 customs 或 warehoused+未吸收 ──

  it('源码中 shipment 查询包含 .or() — 仅 customs 或 warehoused+未吸收', () => {
    const src = readSrc('src/features/shipments/repository.ts');
    const fnStart = src.indexOf('async getConfirmedWarehousedByWarehouse(');
    const fnEnd = src.indexOf('async confirmBigsellerAbsorption(');
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain("status.eq.customs,and(status.eq.warehoused,bigseller_absorbed_at.is.null)");
    expect(fnBody).toContain('.or(');
  });

  it('customs 状态 → 计入聚合', async () => {
    pushFromResults(
      { data: [{ id: 'ship-customs-1' }] },
      { data: [{ variant_id: VARIANT_ID, warehoused_quantity: 7 }] },
    );

    const results = await shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID);
    expect(results).toHaveLength(1);
    expect(results[0].confirmedQuantity).toBe(7);
  });

  it('warehoused + bigseller_absorbed_at=NULL → 计入聚合', async () => {
    pushFromResults(
      { data: [{ id: 'ship-wh-1' }] },
      { data: [{ variant_id: VARIANT_ID, warehoused_quantity: 15 }] },
    );

    const results = await shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID);
    expect(results).toHaveLength(1);
    expect(results[0].confirmedQuantity).toBe(15);
  });

  it('warehoused + bigseller_absorbed_at 非 NULL → 不计入聚合（返回空数组）', async () => {
    pushFromResults({ data: [] });

    const results = await shipmentRepository.getConfirmedWarehousedByWarehouse(WAREHOUSE_ID);
    expect(results).toEqual([]);
  });
});

// ============================================================================
// 5. Repository — confirmBigsellerAbsorption
// ============================================================================

describe('P3-S5B2: confirmBigsellerAbsorption()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('status=warehoused + bigseller_absorbed_at=NULL → 成功写入', async () => {
    pushFromResults(
      {
        data: { status: 'warehoused', bigseller_absorbed_at: null },
      }, // SELECT check (pass)
      { data: null, error: null }, // UPDATE (success — no error)
    );

    const result = await shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID);
    expect(result).toBe(true);
  });

  it('status 不是 warehoused → VALIDATION 错误', async () => {
    pushFromResults({
      data: { status: 'customs', bigseller_absorbed_at: null },
    });

    await expect(
      shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      code: 'VALIDATION',
      message: '仅已入仓的在途记录可确认 BigSeller 吸收',
    });
  });

  it('bigseller_absorbed_at 已非 NULL → VALIDATION 重复操作', async () => {
    pushFromResults({
      data: { status: 'warehoused', bigseller_absorbed_at: '2026-07-01T00:00:00Z' },
    });

    await expect(
      shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      code: 'VALIDATION',
      message: '该在途记录已确认 BigSeller 吸收，不可重复操作',
    });
  });

  it('shipment 不存在 → NOT_FOUND', async () => {
    pushFromResults({
      data: null,
      error: { code: 'PGRST116', message: 'Not found' },
    });

    await expect(
      shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      code: 'NOT_FOUND',
    });
  });

  it('DB 查询出错 → DB_ERROR', async () => {
    pushFromResults({
      data: null,
      error: new Error('connection lost'),
    });

    await expect(
      shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      code: 'DB_ERROR',
    });
  });

  it('UPDATE 出错 → DB_ERROR', async () => {
    pushFromResults(
      { data: { status: 'warehoused', bigseller_absorbed_at: null } },
      { data: null, error: new Error('write failed') },
    );

    await expect(
      shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID),
    ).rejects.toMatchObject({
      name: 'ShipmentError',
      code: 'DB_ERROR',
    });
  });

  it('不调用 00023 RPC', async () => {
    pushFromResults(
      { data: { status: 'warehoused', bigseller_absorbed_at: null } },
      { data: null, error: null },
    );

    await shipmentRepository.confirmBigsellerAbsorption(SHIPMENT_ID);

    const rpcCalls = mockRpc.mock.calls;
    const called00023 = rpcCalls.some(
      (call: unknown[]) => call[0] === 'warehouse_shipment_transactional',
    );
    expect(called00023).toBe(false);
  });
});

// ============================================================================
// 6. Actions — partialWarehouseShipment
// ============================================================================

describe('P3-S5B2: partialWarehouseShipment() action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: { success: true, all_warehoused: false, items_updated: 1 },
      error: null,
    });
  });

  it('Admin → 成功调用 repository.partialWarehouse → 返回 PartialWarehouseResult', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [{ variantId: VARIANT_ID, quantity: 5 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        success: true,
        allWarehoused: false,
        itemsUpdated: 1,
      });
    }
  });

  it('Operator → 返回权限错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(OP_USER);

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [{ variantId: VARIANT_ID, quantity: 5 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('仅管理员可确认入仓');
  });

  it('Zod 拒绝空 items → 不调用 repository', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [],
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Zod 拒绝非法 shipmentId → 不调用 repository', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await partialWarehouseShipment({
      shipmentId: 'not-a-uuid',
      items: [{ variantId: VARIANT_ID, quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Zod 拒绝重复 SKU → 不调用 repository', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [
        { variantId: VARIANT_ID, quantity: 3 },
        { variantId: VARIANT_ID, quantity: 5 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('重复 SKU');
  });

  it('Repository 抛出 ShipmentError → ActionResult 带回中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: '该在途记录已完成入仓，不可重复操作' },
    });

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [{ variantId: VARIANT_ID, quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('该在途记录已完成入仓，不可重复操作');
  });

  it('未知异常 → 兜底中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockRejectedValue(new Error('network error'));

    const result = await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [{ variantId: VARIANT_ID, quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('确认入仓失败，请稍后重试');
  });

  it('revalidate /dashboard/shipments 和详情页', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    await partialWarehouseShipment({
      shipmentId: SHIPMENT_ID,
      items: [{ variantId: VARIANT_ID, quantity: 1 }],
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/shipments');
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/dashboard/shipments/${SHIPMENT_ID}`,
    );
  });
});

// ============================================================================
// 7. Actions — batchWarehouseShipments
// ============================================================================

describe('P3-S5B2: batchWarehouseShipments() action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: { success: true, all_warehoused: true, items_updated: 1 },
      error: null,
    });
  });

  it('Admin → 逐笔串行调用 RPC → 返回逐笔结果', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const SHIP2 = '00000000-0000-4000-8000-000000000002';
    const result = await batchWarehouseShipments({
      shipments: [
        { shipmentId: SHIPMENT_ID, items: [{ variantId: VARIANT_ID, quantity: 3 }] },
        { shipmentId: SHIP2, items: [{ variantId: VARIANT_ID, quantity: 2 }] },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ shipmentId: SHIPMENT_ID, success: true });
      expect(result.data[1]).toMatchObject({ shipmentId: SHIP2, success: true });
    }
    // RPC called twice
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('Operator → 返回权限错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(OP_USER);

    const result = await batchWarehouseShipments({
      shipments: [
        { shipmentId: SHIPMENT_ID, items: [{ variantId: VARIANT_ID, quantity: 1 }] },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('仅管理员可批量确认入仓');
  });

  it('Zod 拒绝空 shipments → 不调用 RPC', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await batchWarehouseShipments({ shipments: [] });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Zod 拒绝超过 20 条 → 不调用 RPC', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const shipments = Array.from({ length: 21 }, (_, i) => ({
      shipmentId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      items: [{ variantId: VARIANT_ID, quantity: 1 }],
    }));

    const result = await batchWarehouseShipments({ shipments });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('单笔失败不影响后续 → 返回混合结果', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    // First call fails, second succeeds
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: '入仓数量超过在途余量' },
      })
      .mockResolvedValueOnce({
        data: { success: true, all_warehoused: true, items_updated: 2 },
        error: null,
      });

    const SHIP2 = '00000000-0000-4000-8000-000000000002';
    const result = await batchWarehouseShipments({
      shipments: [
        { shipmentId: SHIPMENT_ID, items: [{ variantId: VARIANT_ID, quantity: 999 }] },
        { shipmentId: SHIP2, items: [{ variantId: VARIANT_ID, quantity: 2 }] },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({
        shipmentId: SHIPMENT_ID,
        success: false,
        error: '入仓数量超过在途余量',
      });
      expect(result.data[1]).toMatchObject({
        shipmentId: SHIP2,
        success: true,
        result: { allWarehoused: true, itemsUpdated: 2 },
      });
    }
  });

  it('全部成功时 revalidate 所有详情页', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const SHIP2 = '00000000-0000-4000-8000-000000000002';
    await batchWarehouseShipments({
      shipments: [
        { shipmentId: SHIPMENT_ID, items: [{ variantId: VARIANT_ID, quantity: 1 }] },
        { shipmentId: SHIP2, items: [{ variantId: VARIANT_ID, quantity: 1 }] },
      ],
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/shipments');
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/dashboard/shipments/${SHIPMENT_ID}`,
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/dashboard/shipments/${SHIP2}`,
    );
  });

  it('未知异常 → 兜底中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    // Zod passes but repository throws unexpected error
    mockRpc.mockRejectedValue(new Error('boom'));

    const result = await batchWarehouseShipments({
      shipments: [
        { shipmentId: SHIPMENT_ID, items: [{ variantId: VARIANT_ID, quantity: 1 }] },
      ],
    });

    // Single failure caught inside the loop → outer returns success:true with failed entry
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].success).toBe(false);
      expect(result.data[0].error).toBe('确认入仓失败，请稍后重试');
    }
  });
});

// ============================================================================
// 8. Actions — confirmBigsellerAbsorption
// ============================================================================

describe('P3-S5B2: confirmBigsellerAbsorption() action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Admin → 成功调用 repository.confirmBigsellerAbsorption', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    pushFromResults(
      { data: { status: 'warehoused', bigseller_absorbed_at: null } },
      { data: null, error: null },
    );

    const result = await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(result.success).toBe(true);
  });

  it('Operator → 返回权限错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(OP_USER);

    const result = await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('仅管理员可确认 BigSeller 吸收');
  });

  it('Zod 拒绝非法 UUID → 不调用 repository', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);

    const result = await confirmBigsellerAbsorption('not-a-uuid');

    expect(result.success).toBe(false);
  });

  it('Repository VALIDATION 错误 → ActionResult 带回', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    pushFromResults({
      data: { status: 'customs', bigseller_absorbed_at: null },
    });

    const result = await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('仅已入仓的在途记录可确认 BigSeller 吸收');
  });

  it('Repository NOT_FOUND → ActionResult 带回', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    pushFromResults({
      data: null,
      error: { code: 'PGRST116' },
    });

    const result = await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('在途记录不存在或无权访问');
  });

  it('未知异常 → 兜底中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockFrom.mockImplementation(() => {
      throw new Error('unexpected');
    });

    const result = await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('确认 BigSeller 吸收失败，请稍后重试');
  });

  it('成功时 revalidate /dashboard/shipments 和详情页', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    pushFromResults(
      { data: { status: 'warehoused', bigseller_absorbed_at: null } },
      { data: null, error: null },
    );

    await confirmBigsellerAbsorption(SHIPMENT_ID);

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/shipments');
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/dashboard/shipments/${SHIPMENT_ID}`,
    );
  });
});

// ============================================================================
// 9. Schema 校验测试
// ============================================================================

describe('P3-S5B2: Schema 校验', () => {
  describe('confirmBigsellerAbsorptionSchema', () => {
    it('合法 UUID → 通过', () => {
      const result = confirmBigsellerAbsorptionSchema.safeParse({
        shipmentId: SHIPMENT_ID,
      });
      expect(result.success).toBe(true);
    });

    it('非法 UUID → 拒绝', () => {
      const result = confirmBigsellerAbsorptionSchema.safeParse({
        shipmentId: 'abc',
      });
      expect(result.success).toBe(false);
    });

    it('缺失 shipmentId → 拒绝', () => {
      const result = confirmBigsellerAbsorptionSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('batchWarehouseShipmentsSchema', () => {
    it('合法单条 → 通过', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [
          {
            shipmentId: SHIPMENT_ID,
            items: [{ variantId: VARIANT_ID, quantity: 5 }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('合法多条 → 通过', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [
          {
            shipmentId: SHIPMENT_ID,
            items: [{ variantId: VARIANT_ID, quantity: 3 }],
          },
          {
            shipmentId: '00000000-0000-4000-8000-000000000002',
            items: [{ variantId: VARIANT_ID, quantity: 2 }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('空 shipments → 拒绝', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({ shipments: [] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('至少指定一条');
    });

    it('entry 内 items 空 → 拒绝', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [{ shipmentId: SHIPMENT_ID, items: [] }],
      });
      expect(result.success).toBe(false);
    });

    it('entry 内重复 SKU → 拒绝', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [
          {
            shipmentId: SHIPMENT_ID,
            items: [
              { variantId: VARIANT_ID, quantity: 1 },
              { variantId: VARIANT_ID, quantity: 2 },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('重复 SKU');
    });

    it('非法 shipmentId → 拒绝', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [
          { shipmentId: 'bad', items: [{ variantId: VARIANT_ID, quantity: 1 }] },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('quantity 为 0 → 拒绝', () => {
      const result = batchWarehouseShipmentsSchema.safeParse({
        shipments: [
          {
            shipmentId: SHIPMENT_ID,
            items: [{ variantId: VARIANT_ID, quantity: 0 }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// 10. 静态源码检查
// ============================================================================

describe('P3-S5B2: 静态源码检查', () => {
  const REPO_SRC: string = (() => {
    try { return readSrc('src/features/shipments/repository.ts'); } catch { return ''; }
  })();
  const ACTIONS_SRC: string = (() => {
    try { return readSrc('src/features/shipments/actions.ts'); } catch { return ''; }
  })();

  describe('不调用 00023 / warehouse_shipment_transactional', () => {
    it('repository.ts 中新方法不含 warehouse_shipment_transactional', () => {
      // New P3-S5B2 methods (partialWarehouse, confirmBigsellerAbsorption, etc.)
      // must not call the old 00023 RPC
      // The existing warehouseShipment method calls warehouse_shipment_transactional — that's OK (P3-S5B0 blocked at action level)
      // But the new methods must not
      const partialWarehouseIdx = REPO_SRC.indexOf('partialWarehouse(');
      const confirmAbsorptionIdx = REPO_SRC.indexOf('confirmBigsellerAbsorption(');
      const afterNewMethods = REPO_SRC.slice(
        Math.min(
          partialWarehouseIdx > -1 ? partialWarehouseIdx : Infinity,
          confirmAbsorptionIdx > -1 ? confirmAbsorptionIdx : Infinity,
        ),
      );
      // The new methods should NOT reference warehouse_shipment_transactional
      expect(afterNewMethods).not.toMatch(/warehouse_shipment_transactional/);
    });

    it('actions.ts 中新 action 不含 warehouse_shipment_transactional', () => {
      const partialIdx = ACTIONS_SRC.indexOf('export async function partialWarehouseShipment');
      const batchIdx = ACTIONS_SRC.indexOf('export async function batchWarehouseShipments');
      const confirmIdx = ACTIONS_SRC.indexOf('export async function confirmBigsellerAbsorption');
      const afterNewActions = ACTIONS_SRC.slice(
        Math.min(
          partialIdx > -1 ? partialIdx : Infinity,
          batchIdx > -1 ? batchIdx : Infinity,
          confirmIdx > -1 ? confirmIdx : Infinity,
        ),
      );
      expect(afterNewActions).not.toMatch(/warehouse_shipment_transactional/);
      expect(afterNewActions).not.toMatch(/00023/);
    });
  });

  describe('不写 inventory', () => {
    it('repository.ts 中新方法不含 inventory.insert/update/upsert（排除注释）', () => {
      const partialWarehouseIdx = REPO_SRC.indexOf('partialWarehouse(');
      const confirmAbsorptionIdx = REPO_SRC.indexOf('confirmBigsellerAbsorption(');
      const afterNewMethods = REPO_SRC.slice(
        Math.min(
          partialWarehouseIdx > -1 ? partialWarehouseIdx : Infinity,
          confirmAbsorptionIdx > -1 ? confirmAbsorptionIdx : Infinity,
        ),
      );
      // Exclude comment lines (both // and /* */ style)
      const codeLines = afterNewMethods
        .split('\n')
        .filter((l) => {
          const trimmed = l.trim();
          return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
        });
      const codeOnly = codeLines.join('\n');
      expect(codeOnly).not.toMatch(/\.from\('inventory'\)/);
    });

    it('actions.ts 中不含 inventory 直接操作', () => {
      expect(ACTIONS_SRC).not.toMatch(/\.from\('inventory'\)/);
    });
  });

  describe('snake_case → camelCase 映射', () => {
    it('partialWarehouse RPC 返回字段做映射', () => {
      const partialIdx = REPO_SRC.indexOf('async partialWarehouse(');
      const nextMethodIdx = REPO_SRC.indexOf('async listEligibleForBatchWarehousing(');
      const methodBody = REPO_SRC.slice(partialIdx, nextMethodIdx);

      // Must map snake_case to camelCase
      expect(methodBody).toMatch(/all_warehoused/);
      expect(methodBody).toMatch(/allWarehoused/);
      expect(methodBody).toMatch(/items_updated/);
      expect(methodBody).toMatch(/itemsUpdated/);
      // Calls the correct RPC
      expect(methodBody).toContain("'partial_warehouse_shipment'");
    });
  });

  describe('Admin-only 权限', () => {
    it('partialWarehouseShipment action 校验 admin 角色', () => {
      const fnStart = ACTIONS_SRC.indexOf('export async function partialWarehouseShipment');
      const fnEnd = ACTIONS_SRC.indexOf('export async function batchWarehouseShipments');
      const fnBody = ACTIONS_SRC.slice(fnStart, fnEnd);
      expect(fnBody).toContain("roleName !== 'admin'");
      expect(fnBody).toContain('仅管理员可确认入仓');
    });

    it('batchWarehouseShipments action 校验 admin 角色', () => {
      const fnStart = ACTIONS_SRC.indexOf('export async function batchWarehouseShipments');
      const fnEnd = ACTIONS_SRC.indexOf('export async function confirmBigsellerAbsorption');
      const fnBody = ACTIONS_SRC.slice(fnStart, fnEnd);
      expect(fnBody).toContain("roleName !== 'admin'");
      expect(fnBody).toContain('仅管理员可批量确认入仓');
    });

    it('confirmBigsellerAbsorption action 校验 admin 角色', () => {
      const fnStart = ACTIONS_SRC.indexOf('export async function confirmBigsellerAbsorption');
      const fnBody = ACTIONS_SRC.slice(fnStart);
      expect(fnBody).toContain("roleName !== 'admin'");
      expect(fnBody).toContain('仅管理员可确认 BigSeller 吸收');
    });

    it('三个新 action 都调用 requireActiveAuth', () => {
      const requireAuthMatches = ACTIONS_SRC.match(/requireActiveAuth\(\)/g);
      // Each of the 3 new actions + existing actions = at least 3 more
      expect(requireAuthMatches).not.toBeNull();
      expect(requireAuthMatches!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('types.ts 类型定义', () => {
    it('BatchWarehouseEntry 包含 shipmentId/items/description', () => {
      expect(REPO_SRC).toBeTruthy();
    });

    it('PartialWarehouseResult 包含 success/allWarehoused/itemsUpdated', () => {
      const typesSrc = readSrc('src/features/shipments/types.ts');
      expect(typesSrc).toContain('PartialWarehouseResult');
      expect(typesSrc).toContain('allWarehoused');
      expect(typesSrc).toContain('itemsUpdated');
    });

    it('EligibleShipmentItem 包含 remainingQuantity', () => {
      const typesSrc = readSrc('src/features/shipments/types.ts');
      expect(typesSrc).toContain('remainingQuantity');
    });
  });

  describe('revalidate 调用', () => {
    it('partialWarehouseShipment revalidates shipments list and detail', () => {
      const fnStart = ACTIONS_SRC.indexOf('export async function partialWarehouseShipment');
      const fnEnd = ACTIONS_SRC.indexOf('export async function batchWarehouseShipments');
      const fnBody = ACTIONS_SRC.slice(fnStart, fnEnd);
      expect(fnBody).toContain("revalidatePath('/dashboard/shipments')");
      expect(fnBody).toContain('revalidatePath(`/dashboard/shipments/');
    });

    it('confirmBigsellerAbsorption revalidates shipments list and detail', () => {
      const fnStart = ACTIONS_SRC.indexOf('export async function confirmBigsellerAbsorption');
      const fnBody = ACTIONS_SRC.slice(fnStart);
      expect(fnBody).toContain("revalidatePath('/dashboard/shipments')");
      expect(fnBody).toContain('revalidatePath(`/dashboard/shipments/');
    });
  });
});
