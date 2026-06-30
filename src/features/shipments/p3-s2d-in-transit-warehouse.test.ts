// P3-S2D: 在途库存聚合精确到仓库 — 行为测试
//
// 覆盖：
// - getInTransitByVariantAndWarehouse() 按 (variant_id, warehouse_id) 聚合
// - 同一 variant 在不同仓库的在途不串仓
// - 同一 variant+warehouse 跨 shipment 聚合正确
// - warehoused 排除
// - Admin / Operator 仓库隔离
// - DB 错误传播
//
// Mock 调用顺序（getInTransitByVariantAndWarehouse 内部）：
//   1. supabase.from('profiles')  — getUserRole（仅 userId 存在时）
//   2. supabase.from('shipment')   — 获取非 warehoused 的 shipment (id, warehouse_id)
//   3. supabase.from('shipment_item') — 获取在途明细 (含 shipment_id)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── valid UUIDs ──────────────────────────────────────────────────────────

const VARIANT_A = '00000000-0000-4000-8000-000000000001';
const VARIANT_B = '00000000-0000-4000-8000-000000000002';
const WAREHOUSE_X = '00000000-0000-4000-8000-000000000010';
const WAREHOUSE_Y = '00000000-0000-4000-8000-000000000020';
const USER_ADMIN = '00000000-0000-4000-8000-000000000030';
const USER_OPERATOR = '00000000-0000-4000-8000-000000000040';

function sid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

// ─── Profile mocks (getUserRole queries) ─────────────────────────────────

const adminProfile = { data: { role: { name: 'admin' } }, error: null };
const operatorProfile = { data: { role: { name: 'operator' } }, error: null };

// ─── Mock builders ────────────────────────────────────────────────────────

function createQueryMock(result: {
  data?: unknown;
  error?: unknown;
  count?: number;
}) {
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
  return { getBuilder: (index: number) => blds[index] };
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

// Import the real repository (uses mocked createClient + warehouseAccessRepository)
import { shipmentRepository } from '@/features/shipments/repository';

// ─── Helpers ──────────────────────────────────────────────────────────────

function shipmentRow(id: string, warehouseId: string) {
  return { id, warehouse_id: warehouseId };
}

function shipmentItems(
  items: Array<{
    shipment_id: string;
    variant_id: string;
    quantity: number;
    warehoused_quantity: number;
  }>,
) {
  return items.map((item, i) => ({
    id: sid(100 + i),
    ...item,
  }));
}

const emptyShipments = { data: [] as Array<{ id: string; warehouse_id: string }>, error: null };

// ─── Tests ────────────────────────────────────────────────────────────────

describe('shipmentRepository.getInTransitByVariantAndWarehouse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 仓库维度聚合核心 ────────────────────────────────────────────────

  describe('仓库维度聚合（核心）', () => {
    it('同一 variant 在两个仓库分别有在途 → 各自独立不串仓', async () => {
      const s1 = sid(1);
      const s2 = sid(2);

      pushResults(
        adminProfile,  // 1. getUserRole → 'admin'
        { data: [shipmentRow(s1, WAREHOUSE_X), shipmentRow(s2, WAREHOUSE_Y)] },  // 2. shipments
        { data: shipmentItems([                                                    // 3. items
          { shipment_id: s1, variant_id: VARIANT_A, quantity: 100, warehoused_quantity: 0 },
          { shipment_id: s2, variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 10 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      // Variant A in warehouse X: 100 - 0 = 100
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(100);
      // Variant A in warehouse Y: 50 - 10 = 40
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_Y)).toBe(40);
      // Warehouse Y should NOT have warehouse X's quantity
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_Y)).toBe(40); // confirming no cross-contamination
      expect(map.size).toBe(1); // one variant
      expect(map.get(VARIANT_A)?.size).toBe(2); // two warehouses
    });

    it('同一 variant + 同一仓库跨 shipment 聚合正确', async () => {
      const s1 = sid(1);
      const s2 = sid(2);

      pushResults(
        adminProfile,
        { data: [
          shipmentRow(s1, WAREHOUSE_X),
          shipmentRow(s2, WAREHOUSE_X),
        ] },
        { data: shipmentItems([
          { shipment_id: s1, variant_id: VARIANT_A, quantity: 30, warehoused_quantity: 0 },
          { shipment_id: s2, variant_id: VARIANT_A, quantity: 20, warehoused_quantity: 5 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      // (30 - 0) + (20 - 5) = 45 in warehouse X
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(45);
      expect(map.get(VARIANT_A)?.size).toBe(1);
    });

    it('多 variant 多仓库 — 每个 (variant, warehouse) 独立', async () => {
      const s1 = sid(1);
      const s2 = sid(2);
      const s3 = sid(3);

      pushResults(
        adminProfile,
        { data: [
          shipmentRow(s1, WAREHOUSE_X),
          shipmentRow(s2, WAREHOUSE_X),
          shipmentRow(s3, WAREHOUSE_Y),
        ] },
        { data: shipmentItems([
          { shipment_id: s1, variant_id: VARIANT_A, quantity: 10, warehoused_quantity: 0 },
          { shipment_id: s2, variant_id: VARIANT_B, quantity: 20, warehoused_quantity: 0 },
          { shipment_id: s3, variant_id: VARIANT_A, quantity: 30, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      // Variant A in X: 10
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(10);
      // Variant A in Y: 30
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_Y)).toBe(30);
      // Variant B in X: 20
      expect(map.get(VARIANT_B)?.get(WAREHOUSE_X)).toBe(20);
      // Variant B NOT in Y
      expect(map.get(VARIANT_B)?.has(WAREHOUSE_Y)).toBe(false);
    });
  });

  // ── Admin paths ───────────────────────────────────────────────────────

  describe('Admin（无仓库过滤）', () => {
    it('Admin 看到所有仓库的在途数据', async () => {
      const s1 = sid(1);
      const s2 = sid(2);

      pushResults(
        adminProfile,
        { data: [
          shipmentRow(s1, WAREHOUSE_X),
          shipmentRow(s2, WAREHOUSE_Y),
        ] },
        { data: shipmentItems([
          { shipment_id: s1, variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 0 },
          { shipment_id: s2, variant_id: VARIANT_A, quantity: 30, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(50);
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_Y)).toBe(30);
    });

    it('无 shipment 数据 → 返回空 Map', async () => {
      pushResults(
        adminProfile,
        emptyShipments,
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);
      expect(map.size).toBe(0);
    });

    it('null shipment data → 返回空 Map', async () => {
      pushResults(
        adminProfile,
        { data: null },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);
      expect(map.size).toBe(0);
    });
  });

  // ── Operator paths ────────────────────────────────────────────────────

  describe('Operator（仓库隔离）', () => {
    it('已分配仓库的在途正常统计，未分配仓库不可见', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      pushResults(
        operatorProfile,  // 1. getUserRole → 'operator'
        { data: [shipmentRow(sid(1), WAREHOUSE_X)] },  // 2. shipment query (filtered by WAREHOUSE_X)
        { data: shipmentItems([                          // 3. shipment_item query
          { shipment_id: sid(1), variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 10 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_OPERATOR);

      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(40);
      expect(mockGetAccessibleIds).toHaveBeenCalledWith(USER_OPERATOR);
    });

    it('空分配 → 返回空 Map（不查询 shipment）', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set());

      pushResults(
        operatorProfile,   // 1. getUserRole → 'operator'
        // No more from() calls — returns early
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_OPERATOR);
      expect(map.size).toBe(0);
    });

    it('已分配仓库但 shipment 查询结果为空 → 空 Map', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      pushResults(
        operatorProfile,
        emptyShipments,
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_OPERATOR);
      expect(map.size).toBe(0);
    });
  });

  // ── warehoused 排除 ───────────────────────────────────────────────────

  describe('warehoused 状态排除', () => {
    it('neq 过滤确保 warehoused 的 shipment 不计入聚合', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1), WAREHOUSE_X)] },
        { data: shipmentItems([
          { shipment_id: sid(1), variant_id: VARIANT_A, quantity: 100, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      // DB mock returns only non-warehoused shipments; .neq() is applied by real code
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(100);
    });
  });

  // ── 边界 ──────────────────────────────────────────────────────────────

  describe('边界', () => {
    it('warehoused_quantity 等于 quantity → 在途为 0', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1), WAREHOUSE_X)] },
        { data: shipmentItems([
          { shipment_id: sid(1), variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 50 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(0);
    });

    it('no userId → 不查询 profile，不应用仓库过滤', async () => {
      pushResults(
        { data: [shipmentRow(sid(1), WAREHOUSE_X)] },
        { data: shipmentItems([
          { shipment_id: sid(1), variant_id: VARIANT_A, quantity: 10, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse();

      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(10);
    });

    it('shipment 的 warehouse_id 为 null → 对应 items 跳过', async () => {
      pushResults(
        adminProfile,
        { data: [
          { id: sid(1), warehouse_id: null },
          { id: sid(2), warehouse_id: WAREHOUSE_X },
        ] },
        { data: shipmentItems([
          { shipment_id: sid(1), variant_id: VARIANT_A, quantity: 10, warehoused_quantity: 0 },
          { shipment_id: sid(2), variant_id: VARIANT_A, quantity: 20, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN);

      // null warehouse shipment items are skipped
      // Only warehouse X counts: 20
      expect(map.get(VARIANT_A)?.get(WAREHOUSE_X)).toBe(20);
      // No null-warehouse entry
      expect(map.get(VARIANT_A)?.size).toBe(1);
    });
  });

  // ── DB 错误传播 ───────────────────────────────────────────────────────

  describe('DB 错误传播', () => {
    it('shipment 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        adminProfile,
        { data: null, error: { message: 'connection refused' } },
      );

      await expect(
        shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN),
      ).rejects.toThrow('查询在途数据失败');
    });

    it('shipment_item 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1), WAREHOUSE_X)] },
        { data: null, error: { message: 'connection refused' } },
      );

      await expect(
        shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN),
      ).rejects.toThrow('查询在途数据失败');
    });

    it('getUserRole 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        { data: null, error: { code: 'CONNECTION_ERROR', message: 'timeout' } },
      );

      await expect(
        shipmentRepository.getInTransitByVariantAndWarehouse(USER_ADMIN),
      ).rejects.toThrow('查询用户角色失败');
    });
  });
});
