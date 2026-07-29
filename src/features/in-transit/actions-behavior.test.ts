// ARCH-IN-TRANSIT-REPOSITORY-BOUNDARY: Action 行为测试
// 验证 ExternalTrackingError 不产生重复业务前缀
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExternalTrackingError } from '@/features/in-transit/repository';

// ─── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockImportGoluckyRefs,
  mockBindExternalRefToShipment,
  mockReactivateExternalRef,
} = vi.hoisted(() => ({
  mockImportGoluckyRefs: vi.fn(),
  mockBindExternalRefToShipment: vi.fn(),
  mockReactivateExternalRef: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ rpc: vi.fn(), from: vi.fn() }),
  ),
}));

vi.mock('@/features/in-transit/repository', async () => {
  const actual =
    await vi.importActual<typeof import('@/features/in-transit/repository')>(
      '@/features/in-transit/repository',
    );
  return {
    ...actual,
    externalTrackingRepository: {
      ...actual.externalTrackingRepository,
      importGoluckyRefs: mockImportGoluckyRefs,
      bindExternalRefToShipment: mockBindExternalRefToShipment,
      reactivateExternalRef: mockReactivateExternalRef,
    },
  };
});

// Mock next/cache revalidatePath (side-effect)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Import actions after mocks are set up
import { importGoluckyRefs, bindExternalRefToShipment, reactivateExternalRef } from '@/features/in-transit/actions';

// ─── Helpers ────────────────────────────────────────────────────────────

const validImportItems = [
  {
    waybillNo: 'WB001',
    warehouseId: '550e8400-e29b-41d4-a716-446655440001',
    country: 'TH' as const,
  },
];

const validRefId = '550e8400-e29b-41d4-a716-446655440001';
const validShipmentId = '550e8400-e29b-41d4-a716-446655440002';

// ─── Tests ──────────────────────────────────────────────────────────────

describe('ARCH-IN-TRANSIT — Action ExternalTrackingError 不重复前缀', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('importGoluckyRefs', () => {
    it('Repository 抛出 ExternalTrackingError 时直接返回 err.message（不追加"导入运单失败"）', async () => {
      mockImportGoluckyRefs.mockRejectedValueOnce(
        new ExternalTrackingError('导入失败: database connection failed', 'DB_ERROR'),
      );

      const result = await importGoluckyRefs(validImportItems);

      expect(result.success).toBe(false);
      expect(result.error).toBe('导入失败: database connection failed');
    });

    it('未知异常时使用 Action 级兜底前缀', async () => {
      mockImportGoluckyRefs.mockRejectedValueOnce(new Error('network hang'));

      const result = await importGoluckyRefs(validImportItems);

      expect(result.success).toBe(false);
      expect(result.error).toBe('导入运单失败: network hang');
    });

    it('非 Error 异常时使用"未知错误"兜底', async () => {
      mockImportGoluckyRefs.mockRejectedValueOnce('raw string error');

      const result = await importGoluckyRefs(validImportItems);

      expect(result.success).toBe(false);
      expect(result.error).toBe('导入运单失败: 未知错误');
    });
  });

  describe('bindExternalRefToShipment', () => {
    it('Repository 抛出 ExternalTrackingError 时直接返回 err.message（不追加"绑定外部物流记录失败"）', async () => {
      mockBindExternalRefToShipment.mockRejectedValueOnce(
        new ExternalTrackingError('绑定失败: ALREADY_BOUND: 已绑定 Shipment', 'DB_ERROR'),
      );

      const result = await bindExternalRefToShipment(validRefId, validShipmentId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('绑定失败: ALREADY_BOUND: 已绑定 Shipment');
    });

    it('未知异常时使用 Action 级兜底前缀', async () => {
      mockBindExternalRefToShipment.mockRejectedValueOnce(new Error('timeout'));

      const result = await bindExternalRefToShipment(validRefId, validShipmentId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('绑定外部物流记录失败: timeout');
    });
  });

  describe('reactivateExternalRef', () => {
    it('Repository 抛出 ExternalTrackingError 时直接返回 err.message（不追加"重激活失败"）', async () => {
      mockReactivateExternalRef.mockRejectedValueOnce(
        new ExternalTrackingError(
          '重激活失败: INVALID_STATUS: 仅可重激活状态为 error 或 stale 的记录',
          'DB_ERROR',
        ),
      );

      const result = await reactivateExternalRef(validRefId);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        '重激活失败: INVALID_STATUS: 仅可重激活状态为 error 或 stale 的记录',
      );
    });

    it('未知异常时使用 Action 级兜底前缀', async () => {
      mockReactivateExternalRef.mockRejectedValueOnce(new Error('boom'));

      const result = await reactivateExternalRef(validRefId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('重激活失败: boom');
    });
  });
});
