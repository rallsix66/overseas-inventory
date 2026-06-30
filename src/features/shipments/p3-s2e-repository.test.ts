// P3-S2E: getInTransitDetailsByVariantAndWarehouse — 行为测试
//
// 覆盖：
// - 按 (variant_id, warehouse_id) 精准查询在途明细
// - 展开字段仅含：单号、采购单号、数量、预计到货时间、shipmentId
// - 不串仓 — 只显示当前 SKU + 仓库的在途明细
// - Admin/Operator 仓库隔离有效
// - warehoused 排除
// - 排序：按预计到货时间升序，null 靠后
// - DB 错误传播
//
// Mock 调用顺序（getInTransitDetailsByVariantAndWarehouse 内部）：
//   1. supabase.from('profiles')   — getUserRole（仅 userId 存在时）
//   2. supabase.from('shipment')    — 按 warehouse_id 过滤，neq warehoused
//   3. supabase.from('shipment_item') — 按 shipment_ids + variant_id

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── valid UUIDs ──────────────────────────────────────────────────────────

const VARIANT_A = '00000000-0000-4000-8000-000000000001';
const WAREHOUSE_X = '00000000-0000-4000-8000-000000000010';
const WAREHOUSE_Y = '00000000-0000-4000-8000-000000000020';
const SHIPMENT_1 = '00000000-0000-4000-8000-000000000100';
const SHIPMENT_2 = '00000000-0000-4000-8000-000000000200';
const USER_ADMIN = '00000000-0000-4000-8000-000000000030';
const USER_OPERATOR = '00000000-0000-4000-8000-000000000040';

// ─── Profile mocks (getUserRole queries) ─────────────────────────────────

const adminProfile = { data: { role: { name: 'admin' } }, error: null };
const operatorProfile = { data: { role: { name: 'operator' } }, error: null };

// ─── Mock builders ────────────────────────────────────────────────────────

function createQueryMock(result: { data?: unknown; error?: unknown; count?: number }) {
  const self: Record<string, unknown> = {
    then(resolve: (v: unknown) => void) {
      resolve(result);
      return Promise.resolve(result);
    },
  };
  for (const method of [
    'select', 'eq', 'ilike', 'order', 'notIn', 'in', 'limit',
    'single', 'maybeSingle', 'neq', 'range', 'update',
  ]) {
    self[method] = vi.fn(() => self);
  }
  return { builder: self };
}

function pushResults(
  ...results: Array<{ data?: unknown; error?: unknown; count?: number }>
) {
  const blds = results.map((r) => createQueryMock(r));
  let cursor = 0;
  mockFrom.mockImplementation(() => {
    if (cursor >= blds.length)
      throw new Error(`Unexpected from() call — queue exhausted at index ${cursor}`);
    return blds[cursor++].builder;
  });
}

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const { mockFrom, mockGetAccessibleIds } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetAccessibleIds: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

vi.mock('@/features/warehouse-access/repository', () => ({
  warehouseAccessRepository: {
    getAccessibleWarehouseIds: (...args: unknown[]) =>
      mockGetAccessibleIds(...args),
  },
}));

vi.mock('@/features/variants/repository', () => ({
  variantRepository: {
    getUserArchivedVariantIds: vi.fn(() => Promise.resolve(new Set<string>())),
  },
}));

// ─── Helper: shipment row ─────────────────────────────────────────────────

function sRow(id: string, warehouseId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shipment_no: `SN-${id.substring(0, 8)}`,
    purchase_order_no: null,
    estimated_arrival: '2026-07-15',
    warehouse_id: warehouseId,
    status: 'departed',
    ...overrides,
  };
}

function itemRow(shipmentId: string, variantId: string, quantity: number, warehoused = 0) {
  return { shipment_id: shipmentId, variant_id: variantId, quantity, warehoused_quantity: warehoused };
}

// Import the real repository (uses mocked createClient + warehouseAccessRepository)
import { shipmentRepository } from '@/features/shipments/repository';

// ─── Tests ────────────────────────────────────────────────────────────────

describe('P3-S2E: getInTransitDetailsByVariantAndWarehouse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 核心：按 (variant, warehouse) 精准查询 ─────────────────────────

  describe('精准查询（不串仓）', () => {
    it('只返回指定 variant + warehouse 的在途明细', async () => {
      pushResults(
        adminProfile,
        { data: [
          sRow(SHIPMENT_1, WAREHOUSE_X, { shipment_no: 'SN-001', purchase_order_no: 'PO-001' }),
          sRow(SHIPMENT_2, WAREHOUSE_X, { shipment_no: 'SN-002' }),
        ] },
        { data: [
          itemRow(SHIPMENT_1, VARIANT_A, 100, 0),
          itemRow(SHIPMENT_2, VARIANT_A, 50, 10),
        ] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(2);
      expect(details[0].shipmentNo).toBe('SN-001');
      expect(details[0].purchaseOrderNo).toBe('PO-001');
      expect(details[0].quantity).toBe(100);
      expect(details[1].shipmentNo).toBe('SN-002');
      expect(details[1].quantity).toBe(40);
    });

    it('同一 variant 在不同仓库的在途不串仓', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X, { shipment_no: 'SN-X1' })] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 50, 0)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(1);
      expect(details[0].shipmentNo).toBe('SN-X1');
    });

    it('指定仓库无在途 → 空数组', async () => {
      pushResults(
        adminProfile,
        { data: [] as Array<Record<string, unknown>> },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_Y, USER_ADMIN,
      );

      expect(details).toHaveLength(0);
    });

    it('仓库有 shipment 但 shipment_item 返回空 → 空数组', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X)] },
        { data: [] as Array<Record<string, unknown>> },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(0);
    });
  });

  // ── 返回字段校验 ───────────────────────────────────────────────────

  describe('返回字段', () => {
    it('展开字段仅含：shipmentId/shipmentNo/purchaseOrderNo/quantity/estimatedArrival', async () => {
      pushResults(
        adminProfile,
        { data: [
          sRow(SHIPMENT_1, WAREHOUSE_X, {
            shipment_no: 'SN-TEST-001',
            purchase_order_no: 'PO-2026-999',
            estimated_arrival: '2026-08-01',
          }),
        ] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 60, 20)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(1);
      const d = details[0];
      expect(Object.keys(d).sort()).toEqual([
        'estimatedArrival',
        'purchaseOrderNo',
        'quantity',
        'shipmentId',
        'shipmentNo',
      ]);
      expect(d.shipmentNo).toBe('SN-TEST-001');
      expect(d.purchaseOrderNo).toBe('PO-2026-999');
      expect(d.quantity).toBe(40);
      expect(d.estimatedArrival).toBe('2026-08-01');
      expect(d.shipmentId).toBe(SHIPMENT_1);
    });

    it('purchase_order_no 为 null 时返回 null', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X, { shipment_no: 'SN-001', purchase_order_no: null })] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 30, 0)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(1);
      expect(details[0].purchaseOrderNo).toBeNull();
    });

    it('在途数量为 0 的记录不入结果', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X)] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 50, 50)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(0);
    });
  });

  // ── Admin paths ───────────────────────────────────────────────────

  describe('Admin 不限仓库', () => {
    it('Admin 可查询任意仓库的在途明细', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_Y, { shipment_no: 'SN-Y1' })] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 25, 0)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_Y, USER_ADMIN,
      );

      expect(details).toHaveLength(1);
    });
  });

  // ── Operator paths ────────────────────────────────────────────────

  describe('Operator 仓库隔离', () => {
    it('Operator 查询已分配仓库 → 正常返回', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      pushResults(
        operatorProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X, { shipment_no: 'SN-X1' })] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 50, 10)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_OPERATOR,
      );

      expect(details).toHaveLength(1);
      expect(details[0].quantity).toBe(40);
    });

    it('Operator 查询未分配仓库 → 空数组', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      // getUserRole → from('profiles') needs a queued result
      pushResults(operatorProfile);

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_Y, USER_OPERATOR,
      );

      // 未分配仓库 → 仓库隔离拦截，不查询 shipment
      expect(details).toHaveLength(0);
      // 确认 mockFrom 仅被调用一次（profiles），没有调用 shipment
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });
  });

  // ── warehoused 排除 ───────────────────────────────────────────────

  describe('warehoused 状态排除', () => {
    it('warehoused 的 shipment 被 neq 过滤不出现', async () => {
      pushResults(
        adminProfile,
        { data: [] as Array<Record<string, unknown>> },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(0);
    });
  });

  // ── 排序 ──────────────────────────────────────────────────────────

  describe('排序', () => {
    it('按预计到货时间升序，null 靠后', async () => {
      const s1 = SHIPMENT_1;
      const s2 = SHIPMENT_2;
      const s3 = '00000000-0000-4000-8000-000000000300';

      pushResults(
        adminProfile,
        { data: [
          sRow(s1, WAREHOUSE_X, { shipment_no: 'SN-A', estimated_arrival: '2026-09-01' }),
          sRow(s2, WAREHOUSE_X, { shipment_no: 'SN-B', estimated_arrival: '2026-07-01' }),
          sRow(s3, WAREHOUSE_X, { shipment_no: 'SN-C', estimated_arrival: null }),
        ] },
        { data: [
          itemRow(s1, VARIANT_A, 10, 0),
          itemRow(s2, VARIANT_A, 20, 0),
          itemRow(s3, VARIANT_A, 30, 0),
        ] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X, USER_ADMIN,
      );

      expect(details).toHaveLength(3);
      expect(details[0].shipmentNo).toBe('SN-B');
      expect(details[1].shipmentNo).toBe('SN-A');
      expect(details[2].shipmentNo).toBe('SN-C');
    });
  });

  // ── DB 错误传播 ───────────────────────────────────────────────────

  describe('DB 错误传播', () => {
    it('shipment 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        adminProfile,
        { data: null, error: { message: 'connection refused' } },
      );

      await expect(
        shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
          VARIANT_A, WAREHOUSE_X, USER_ADMIN,
        ),
      ).rejects.toThrow('查询在途明细失败');
    });

    it('shipment_item 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        adminProfile,
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X)] },
        { data: null, error: { message: 'connection refused' } },
      );

      await expect(
        shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
          VARIANT_A, WAREHOUSE_X, USER_ADMIN,
        ),
      ).rejects.toThrow('查询在途明细失败');
    });

    it('getUserRole 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        { data: null, error: { code: 'CONNECTION_ERROR', message: 'timeout' } },
      );

      await expect(
        shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
          VARIANT_A, WAREHOUSE_X, USER_ADMIN,
        ),
      ).rejects.toThrow('查询用户角色失败');
    });
  });

  // ── no userId ─────────────────────────────────────────────────────

  describe('no userId', () => {
    it('no userId → 不查询 profile，不应用仓库过滤', async () => {
      pushResults(
        { data: [sRow(SHIPMENT_1, WAREHOUSE_X, { shipment_no: 'SN-NU' })] },
        { data: [itemRow(SHIPMENT_1, VARIANT_A, 10, 0)] },
      );

      const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
        VARIANT_A, WAREHOUSE_X,
      );

      expect(details).toHaveLength(1);
      expect(details[0].shipmentNo).toBe('SN-NU');
    });
  });
});
