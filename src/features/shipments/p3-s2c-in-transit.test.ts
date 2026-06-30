// P3-S2C: 内部手动在途只读聚合 — 行为测试
//
// 覆盖：
// - getInTransitByVariant() 聚合逻辑
// - warehoused 排除
// - Admin / Operator 仓库隔离
// - DB 错误传播
//
// Mock 调用顺序（getInTransitByVariant 内部）：
//   1. supabase.from('profiles')  — getUserRole（仅 userId 存在时）
//   2. supabase.from('shipment')   — 获取非 warehoused 的 shipment_id 列表
//   3. supabase.from('shipment_item') — 获取在途明细

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── valid UUIDs ──────────────────────────────────────────────────────────

const VARIANT_A = '00000000-0000-4000-8000-000000000001';
const VARIANT_B = '00000000-0000-4000-8000-000000000002';
const WAREHOUSE_X = '00000000-0000-4000-8000-000000000010';
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

function shipmentRow(id: string) {
  return { id };
}

function shipmentItems(
  items: Array<{ variant_id: string; quantity: number; warehoused_quantity: number }>,
) {
  return items.map((item, i) => ({
    id: sid(100 + i),
    ...item,
  }));
}

const emptyShipments = { data: [] as Array<{ id: string }>, error: null };

// ─── Tests ────────────────────────────────────────────────────────────────

describe('shipmentRepository.getInTransitByVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Admin paths ───────────────────────────────────────────────────────

  describe('Admin（无仓库过滤）', () => {
    it('单 shipment 单 variant — 在途 = quantity - warehoused_quantity', async () => {
      pushResults(
        adminProfile,  // 1. getUserRole → 'admin'
        { data: [shipmentRow(sid(1)), shipmentRow(sid(2))] },  // 2. shipment query
        { data: shipmentItems([                                   // 3. shipment_item query
          { variant_id: VARIANT_A, quantity: 100, warehoused_quantity: 0 },
          { variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 20 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      // (100 - 0) + (50 - 20) = 130
      expect(map.get(VARIANT_A)).toBe(130);
      expect(map.size).toBe(1);
    });

    it('多 variant 各自聚合', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1))] },
        { data: shipmentItems([
          { variant_id: VARIANT_A, quantity: 10, warehoused_quantity: 0 },
          { variant_id: VARIANT_B, quantity: 20, warehoused_quantity: 5 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      expect(map.get(VARIANT_A)).toBe(10);
      expect(map.get(VARIANT_B)).toBe(15);
    });

    it('无 shipment 数据 → 返回空 Map', async () => {
      pushResults(
        adminProfile,
        emptyShipments,
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      expect(map.size).toBe(0);
    });

    it('null shipment data → 返回空 Map', async () => {
      pushResults(
        adminProfile,
        { data: null },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      expect(map.size).toBe(0);
    });
  });

  // ── Operator paths ────────────────────────────────────────────────────

  describe('Operator（仓库隔离）', () => {
    it('已分配仓库的 shipment 在途正常统计', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      pushResults(
        operatorProfile,                                                  // 1. getUserRole → 'operator'
        { data: [shipmentRow(sid(1))] },                                 // 2. shipment query (filtered by WAREHOUSE_X)
        { data: shipmentItems([                                          // 3. shipment_item query
          { variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 10 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_OPERATOR);

      expect(map.get(VARIANT_A)).toBe(40);
      expect(mockGetAccessibleIds).toHaveBeenCalledWith(USER_OPERATOR);
    });

    it('空分配 → 返回空 Map（不查询 shipment）', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set());

      pushResults(
        operatorProfile,   // 1. getUserRole → 'operator'
        // No more from() calls expected — returns early
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_OPERATOR);

      expect(map.size).toBe(0);
    });

    it('已分配仓库但 shipment 查询结果为空 → 空 Map', async () => {
      mockGetAccessibleIds.mockResolvedValueOnce(new Set([WAREHOUSE_X]));

      pushResults(
        operatorProfile,
        emptyShipments,
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_OPERATOR);

      expect(map.size).toBe(0);
    });
  });

  // ── warehoused 排除 ───────────────────────────────────────────────────

  describe('warehoused 状态排除', () => {
    it('neq 过滤确保 warehoused 的 shipment 不计入聚合', async () => {
      // The .neq('status','warehoused') is applied by the real code;
      // we mock what the DB returns — only non-warehoused shipments.
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1))] },
        { data: shipmentItems([
          { variant_id: VARIANT_A, quantity: 100, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      // Only the non-warehoused shipment's items are counted
      expect(map.get(VARIANT_A)).toBe(100);
    });
  });

  // ── 边界 ──────────────────────────────────────────────────────────────

  describe('边界', () => {
    it('warehoused_quantity 等于 quantity → 在途为 0', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1))] },
        { data: shipmentItems([
          { variant_id: VARIANT_A, quantity: 50, warehoused_quantity: 50 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      expect(map.get(VARIANT_A)).toBe(0);
    });

    it('跨 shipment 同 variant 聚合正确', async () => {
      pushResults(
        adminProfile,
        { data: [
          shipmentRow(sid(1)),
          shipmentRow(sid(2)),
          shipmentRow(sid(3)),
        ] },
        { data: shipmentItems([
          { variant_id: VARIANT_A, quantity: 30, warehoused_quantity: 0 },
          { variant_id: VARIANT_A, quantity: 20, warehoused_quantity: 5 },
          { variant_id: VARIANT_B, quantity: 10, warehoused_quantity: 0 },
          { variant_id: VARIANT_B, quantity: 40, warehoused_quantity: 10 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant(USER_ADMIN);

      // variant A: (30-0) + (20-5) = 45
      expect(map.get(VARIANT_A)).toBe(45);
      // variant B: (10-0) + (40-10) = 40
      expect(map.get(VARIANT_B)).toBe(40);
    });

    it('no userId → 不查询 profile，不应用仓库过滤', async () => {
      pushResults(
        { data: [shipmentRow(sid(1))] },
        { data: shipmentItems([
          { variant_id: VARIANT_A, quantity: 10, warehoused_quantity: 0 },
        ]) },
      );

      const map = await shipmentRepository.getInTransitByVariant();

      expect(map.get(VARIANT_A)).toBe(10);
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
        shipmentRepository.getInTransitByVariant(USER_ADMIN),
      ).rejects.toThrow('查询在途数据失败');
    });

    it('shipment_item 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        adminProfile,
        { data: [shipmentRow(sid(1))] },
        { data: null, error: { message: 'connection refused' } },
      );

      await expect(
        shipmentRepository.getInTransitByVariant(USER_ADMIN),
      ).rejects.toThrow('查询在途数据失败');
    });

    it('getUserRole 查询 DB 错误 → ShipmentError', async () => {
      pushResults(
        { data: null, error: { code: 'CONNECTION_ERROR', message: 'timeout' } },
      );

      await expect(
        shipmentRepository.getInTransitByVariant(USER_ADMIN),
      ).rejects.toThrow('查询用户角色失败');
    });
  });
});
