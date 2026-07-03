// P3-S5B0: 封存旧版 00023 入仓入口 — 测试
//
// 覆盖：
// 1. warehouseShipment action — 阻断桩行为
// 2. 详情页 — 不渲染 WarehouseShipmentButton
// 3. 详情页 — 不导入 WarehouseShipmentButton
// 4. warehouseShipment action — 不调用 repository / RPC

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRpc, mockRequireActiveAuth } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockRequireActiveAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: () => mockRequireActiveAuth(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ rpc: mockRpc })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/features/warehouse-access/repository', () => ({
  warehouseAccessRepository: {
    getAccessibleWarehouseIds: vi.fn().mockResolvedValue(new Set<string>()),
    canAccessWarehouse: vi.fn().mockResolvedValue(true),
  },
}));

const SHIPMENT_ID = '00000000-0000-4000-8000-000000000010';

// ─── 1. warehouseShipment action — 阻断桩行为 ─────────────────────────────

describe('P3-S5B0: warehouseShipment 阻断桩', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRequireActiveAuth.mockReset();
  });

  it('返回 success:false', async () => {
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(r.success).toBe(false);
  });

  it('返回中文错误"旧版入仓入口已停用"', async () => {
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(r.error).toContain('旧版入仓入口已停用');
  });

  it('不调用 requireActiveAuth', async () => {
    const { warehouseShipment } = await import('./actions');
    await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(mockRequireActiveAuth).not.toHaveBeenCalled();
  });

  it('不调用 RPC（不产生任何数据库调用）', async () => {
    const { warehouseShipment } = await import('./actions');
    await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('无效 UUID 仍返回阻断错误（不经过 Zod 校验）', async () => {
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: 'not-a-uuid' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('已停用');
  });

  it('空对象参数仍返回阻断错误', async () => {
    const { warehouseShipment } = await import('./actions');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing edge case with invalid input
    const r = await warehouseShipment({} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('已停用');
  });

  it('无论输入如何均返回相同错误', async () => {
    const { warehouseShipment } = await import('./actions');
    const inputs = [
      { shipmentId: SHIPMENT_ID },
      { shipmentId: SHIPMENT_ID, description: '测试' },
      { shipmentId: 'bad-uuid' },
    ];
    for (const input of inputs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing with varied input shapes
      const r = await warehouseShipment(input as any);
      expect(r.success).toBe(false);
      expect(r.error).toContain('已停用');
    }
  });

  it('多次调用均返回相同阻断错误（幂等）', async () => {
    const { warehouseShipment } = await import('./actions');
    const r1 = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    const r2 = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(r1).toEqual(r2);
    expect(r1.error).toContain('已停用');
  });
});

// ─── 2. 详情页 — 不渲染 WarehouseShipmentButton ────────────────────────────

const DETAIL_PAGE = readFileSync(
  resolve(process.cwd(), 'src/app/dashboard/shipments/[id]/page.tsx'),
  'utf-8',
);

// PERF-S1D: PartialWarehouseEntry / BigsellerAbsorptionButton / warehouseBlockReason
// 已从 page.tsx 移至 ShipmentDetailClient
const DETAIL_CLIENT = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/components/shipment-detail-client.tsx'),
  'utf-8',
);

describe('P3-S5B0: 详情页不渲染旧版 WarehouseShipmentButton', () => {
  it('不导入 WarehouseShipmentButton', () => {
    expect(DETAIL_PAGE).not.toMatch(
      /import\s+\{\s*WarehouseShipmentButton\s*\}/,
    );
  });

  it('不含 <WarehouseShipmentButton 渲染', () => {
    expect(DETAIL_PAGE).not.toMatch(/<WarehouseShipmentButton/);
  });

  it('含 P3-S5B0 注释标记（旧入口封存说明）', () => {
    expect(DETAIL_CLIENT).toMatch(/P3-S5B0/);
  });

  it('P3-S5B3: 导入 PartialWarehouseEntry 和 BigsellerAbsorptionButton', () => {
    expect(DETAIL_CLIENT).toMatch(/PartialWarehouseEntry/);
    expect(DETAIL_CLIENT).toMatch(/BigsellerAbsorptionButton/);
  });

  it('warehouseBlockReason 信息区块保留', () => {
    expect(DETAIL_CLIENT).toMatch(/warehouseBlockReason/);
  });
});

// ─── 3. Actions 源码 — warehouseShipment 不调用旧路径 ──────────────────────

const ACTIONS_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/actions.ts'),
  'utf-8',
);

const whFnBody = (() => {
  const m = ACTIONS_SRC.match(
    /export async function warehouseShipment[\s\S]*?\n\}/,
  );
  return m?.[0] ?? '';
})();

describe('P3-S5B0: warehouseShipment 函数体不含旧路径调用', () => {
  it('不含 requireActiveAuth 调用（注释提及除外）', () => {
    // match requireActiveAuth() call, not comment mention
    expect(whFnBody).not.toMatch(/requireActiveAuth\(/);
  });

  it('不含 warehouseShipmentSchema 引用', () => {
    expect(whFnBody).not.toMatch(/warehouseShipmentSchema/);
  });

  it('不含 shipmentRepository.warehouseShipment 调用', () => {
    expect(whFnBody).not.toMatch(/shipmentRepository\.warehouseShipment/);
  });

  it('不含 revalidatePath 调用（注释提及除外）', () => {
    expect(whFnBody).not.toMatch(/revalidatePath\(/);
  });

  it('不含 try/catch 异常处理（无数据库操作）', () => {
    expect(whFnBody).not.toMatch(/try\s*\{/);
  });

  it('不含 rpc 调用', () => {
    expect(whFnBody).not.toMatch(/\.rpc\(/);
  });

  it('不含 from() 调用', () => {
    expect(whFnBody).not.toMatch(/\.from\(/);
  });
});
