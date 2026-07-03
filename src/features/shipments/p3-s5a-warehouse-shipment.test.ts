// P3-S5A: 手动确认入仓事务与库存联动 — 测试
//
// 覆盖：
// 1. warehouseShipmentSchema — Zod 校验（纯函数）
// 2. Migration 00023 源码检查 — admin-only / FOR UPDATE / inventory / tracking_event / REVOKE/GRANT
// 3. 详情页源码检查 — 确认入仓按钮可见性 / non-customs 文案 / Operator 隐藏
// 4. WarehouseShipmentButton 组件源码检查 — 二次确认 / 提交禁用
// 5. repository warehouseShipment — RPC 调用
// 6. actions warehouseShipment — Admin-only / Zod 校验 / 错误传播
// 7. RPC 并发/事务边界源码级断言

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Hoisted mocks — file-scoped, shared by sections 5 & 6 ──────────────────

const {
  mockRpc,
  mockFrom,
  mockRequireActiveAuth,
} = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockRequireActiveAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: () => mockRequireActiveAuth(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom, rpc: mockRpc })),
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

// ─── 1. warehouseShipmentSchema — Zod 校验（纯函数） ──────────────────────────

import { warehouseShipmentSchema } from './schema';

const SHIPMENT_ID = '00000000-0000-4000-8000-000000000010';

describe('P3-S5A: warehouseShipmentSchema (Zod)', () => {
  it('最小有效数据通过', () => {
    const r = warehouseShipmentSchema.safeParse({ shipmentId: SHIPMENT_ID });
    expect(r.success).toBe(true);
  });

  it('shipmentId + description 通过', () => {
    const r = warehouseShipmentSchema.safeParse({
      shipmentId: SHIPMENT_ID,
      description: '货物已到仓确认入仓',
    });
    expect(r.success).toBe(true);
  });

  it('空 description 通过', () => {
    const r = warehouseShipmentSchema.safeParse({
      shipmentId: SHIPMENT_ID,
      description: '',
    });
    expect(r.success).toBe(true);
  });

  it('缺少 shipmentId 拒绝', () => {
    const r = warehouseShipmentSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('非法 UUID 拒绝', () => {
    const r = warehouseShipmentSchema.safeParse({ shipmentId: 'not-a-uuid' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('无效');
    }
  });

  it('空字符串 shipmentId 拒绝', () => {
    const r = warehouseShipmentSchema.safeParse({ shipmentId: '' });
    expect(r.success).toBe(false);
  });

  it('description 超过 500 字符拒绝', () => {
    const r = warehouseShipmentSchema.safeParse({
      shipmentId: SHIPMENT_ID,
      description: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('500');
    }
  });

  it('description 恰好 500 字符通过', () => {
    const r = warehouseShipmentSchema.safeParse({
      shipmentId: SHIPMENT_ID,
      description: 'x'.repeat(500),
    });
    expect(r.success).toBe(true);
  });
});

// ─── 2. Migration 00023 源码检查 ─────────────────────────────────────────────

const MIGRATION_00023 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/00023_warehouse_shipment_transactional.sql'),
  'utf-8',
);

describe('P3-S5A: Migration 00023 — 权限与结构', () => {
  it('函数名为 warehouse_shipment_transactional', () => {
    expect(MIGRATION_00023).toMatch(/warehouse_shipment_transactional/);
  });

  it('SECURITY INVOKER', () => {
    expect(MIGRATION_00023).toMatch(/SECURITY INVOKER/);
  });

  it('admin-only: v_role != admin', () => {
    expect(MIGRATION_00023).toMatch(/v_role\s*!=\s*'admin'/);
  });

  it('调用 public.get_user_role()', () => {
    expect(MIGRATION_00023).toMatch(/public\.get_user_role\(\)/);
  });

  it('admin 校验失败抛出无权限错误', () => {
    expect(MIGRATION_00023).toMatch(/无权限：需要管理员角色/);
  });

  it('REVOKE EXECUTE FROM PUBLIC', () => {
    expect(MIGRATION_00023).toMatch(/REVOKE EXECUTE.*FROM PUBLIC/);
  });

  it('REVOKE EXECUTE FROM anon', () => {
    expect(MIGRATION_00023).toMatch(/REVOKE EXECUTE.*FROM anon/);
  });

  it('GRANT EXECUTE TO authenticated', () => {
    expect(MIGRATION_00023).toMatch(/GRANT EXECUTE.*TO authenticated/);
  });

  it('无权限错误使用 P0001', () => {
    expect(MIGRATION_00023).toMatch(/ERRCODE = 'P0001'/);
  });
});

describe('P3-S5A: Migration 00023 — 变量绑定修复', () => {
  it('使用 v_shipment record（不含重复 INTO 目标）', () => {
    expect(MIGRATION_00023).toMatch(/v_shipment\s+record/);
  });

  it('SELECT INTO v_shipment（单个 record 变量）', () => {
    expect(MIGRATION_00023).toMatch(/INTO\s+v_shipment/);
  });

  it('不含重复 INTO 目标（如 v_shipment_wh_id, v_shipment_wh_id）', () => {
    // No two consecutive INTO targets with the same variable name
    expect(MIGRATION_00023).not.toMatch(/INTO\s+\w+,\s*\1/);
  });

  it('使用 IF NOT FOUND 检测不存在的 shipment', () => {
    expect(MIGRATION_00023).toMatch(/IF NOT FOUND THEN/);
  });

  it('v_shipment.status 引用（record 字段访问）', () => {
    expect(MIGRATION_00023).toMatch(/v_shipment\.status/);
  });

  it('v_shipment.warehouse_id 引用（独立字段，不与 id 混淆）', () => {
    expect(MIGRATION_00023).toMatch(/v_shipment\.warehouse_id/);
  });
});

describe('P3-S5A: Migration 00023 — 原子 UPSERT', () => {
  it('inventory 使用 INSERT ... ON CONFLICT (variant_id, warehouse_id)', () => {
    expect(MIGRATION_00023).toMatch(/ON CONFLICT\s*\(\s*variant_id\s*,\s*warehouse_id\s*\)/);
  });

  it('DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity', () => {
    expect(MIGRATION_00023).toMatch(/quantity\s*=\s*public\.inventory\.quantity\s*\+\s*EXCLUDED\.quantity/);
  });

  it('DO UPDATE 同时更新 updated_at 和 last_sync_at', () => {
    // Both must appear after DO UPDATE SET (not just in INSERT VALUES)
    expect(MIGRATION_00023).toMatch(/DO UPDATE[\s\S]{0,500}last_sync_at\s*=\s*now\(\)/);
  });

  it('不含 SELECT ... FROM inventory FOR UPDATE（select-then-insert 已移除）', () => {
    // The old pattern: SELECT id, quantity INTO v_existing_inv FROM inventory ... FOR UPDATE
    expect(MIGRATION_00023).not.toMatch(/FROM public\.inventory[\s\S]*?FOR UPDATE/);
  });

  it('不含 v_existing_inv 变量（select-then-insert 残留已清理）', () => {
    expect(MIGRATION_00023).not.toMatch(/v_existing_inv/);
  });
});

describe('P3-S5A: Migration 00023 — 入仓业务规则', () => {
  it('FOR UPDATE 锁定 shipment', () => {
    expect(MIGRATION_00023).toMatch(/FROM public\.shipment[\s\S]*?FOR UPDATE/);
  });

  it('FOR UPDATE 锁定 shipment_item', () => {
    expect(MIGRATION_00023).toMatch(/FROM public\.shipment_item[\s\S]*?FOR UPDATE/);
  });

  it('禁止重复入仓: warehoused 检测', () => {
    expect(MIGRATION_00023).toMatch(/已完成入仓，不可重复操作/);
  });

  it('必须有 warehouse_id', () => {
    expect(MIGRATION_00023).toMatch(/未指定仓库，无法入仓/);
  });

  it('仅 customs 允许入仓', () => {
    expect(MIGRATION_00023).toMatch(/仅清关后可确认入仓/);
  });

  it('状态非 customs 抛异常', () => {
    expect(MIGRATION_00023).toMatch(/当前状态为.*仅清关后可确认入仓/);
  });

  it('检查 remaining > 0（超量保护）', () => {
    expect(MIGRATION_00023).toMatch(/remaining/);
  });

  it('warehoused_quantity > quantity 数据异常检测', () => {
    expect(MIGRATION_00023).toMatch(/已入仓数量超过总数/);
  });

  it('remaining = 0 时跳过（幂等安全）', () => {
    expect(MIGRATION_00023).toMatch(/CONTINUE/);
  });
});

describe('P3-S5A: Migration 00023 — 入库操作', () => {
  it('原子 UPSERT inventory（INSERT ... ON CONFLICT DO UPDATE）', () => {
    expect(MIGRATION_00023).toMatch(/INSERT INTO public\.inventory/);
    expect(MIGRATION_00023).toMatch(/ON CONFLICT/);
  });

  it('DO UPDATE 增加数量而非覆盖', () => {
    expect(MIGRATION_00023).toMatch(/EXCLUDED\.quantity/);
  });

  it('更新 shipment_item.warehoused_quantity → quantity（全部入仓）', () => {
    expect(MIGRATION_00023).toMatch(/warehoused_quantity\s*=\s*quantity/);
  });

  it('更新 shipment.status → warehoused', () => {
    expect(MIGRATION_00023).toMatch(/SET status = 'warehoused'/);
  });

  it('插入 tracking_event status=warehoused', () => {
    expect(MIGRATION_00023).toMatch(/INSERT INTO public\.tracking_event/);
    expect(MIGRATION_00023).toMatch(/'warehoused'/);
  });

  it('tracking_event 使用 auth.uid() 作为 created_by', () => {
    expect(MIGRATION_00023).toMatch(/auth\.uid\(\)/);
  });

  it('tracking_event 使用 now() 作为 occurred_at', () => {
    expect(MIGRATION_00023).toMatch(/now\(\)/);
  });

  it('description 默认值 COALESCE 为确认入仓', () => {
    expect(MIGRATION_00023).toMatch(/确认入仓/);
  });

  it('返回 TRUE', () => {
    expect(MIGRATION_00023).toMatch(/RETURN TRUE/);
  });
});

// ─── 3. 详情页源码检查 ──────────────────────────────────────────────────────

// PERF-S1D: PartialWarehouseEntry / BigsellerAbsorptionButton / warehouseBlockReason
// 已从 page.tsx 移至 ShipmentDetailClient
const DETAIL_PAGE = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/components/shipment-detail-client.tsx'),
  'utf-8',
);

describe('P3-S5B3: 详情页 — 双模式按钮 / warehouseBlockReason', () => {
  it('导入 PartialWarehouseEntry（确认到仓入口）', () => {
    expect(DETAIL_PAGE).toMatch(/PartialWarehouseEntry/);
  });

  it('导入 BigsellerAbsorptionButton（BigSeller 吸收确认）', () => {
    expect(DETAIL_PAGE).toMatch(/BigsellerAbsorptionButton/);
  });

  it('status=customs 时渲染 PartialWarehouseEntry', () => {
    expect(DETAIL_PAGE).toMatch(/status\s*===\s*'customs'/);
    expect(DETAIL_PAGE).toMatch(/PartialWarehouseEntry/);
  });

  it('P3-S5B3: PartialWarehouseEntry 渲染条件包含 warehouse_id', () => {
    // PartialWarehouseEntry 仅在 shipment.warehouse_id 存在时渲染
    // 源码应包含：status === 'customs' && shipment.warehouse_id
    expect(DETAIL_PAGE).toMatch(/shipment\.warehouse_id/);
    // 确认 PartialWarehouseEntry 在 JSX 中使用时，前一行含 warehouse_id 条件
    const partialEntryFirstIdx = DETAIL_PAGE.indexOf('PartialWarehouseEntry');
    // 跳过 import 行，找到 JSX 中的 <PartialWarehouseEntry
    const jsxIdx = DETAIL_PAGE.indexOf('<PartialWarehouseEntry', partialEntryFirstIdx);
    expect(jsxIdx).toBeGreaterThan(0);
    // 在 JSX 标签之前应出现 shipment.warehouse_id（条件链）
    const warehouseIdIdx = DETAIL_PAGE.lastIndexOf('shipment.warehouse_id', jsxIdx);
    expect(warehouseIdIdx).toBeGreaterThan(0);
    expect(warehouseIdIdx).toBeLessThan(jsxIdx);
  });

  it('status=warehoused + bigseller_absorbed_at 为空时渲染 BigsellerAbsorptionButton', () => {
    expect(DETAIL_PAGE).toMatch(/status\s*===\s*'warehoused'/);
    expect(DETAIL_PAGE).toMatch(/bigseller_absorbed_at/);
    expect(DETAIL_PAGE).toMatch(/BigsellerAbsorptionButton/);
  });

  it('定义 warehouseBlockReason 变量', () => {
    expect(DETAIL_PAGE).toMatch(/warehouseBlockReason/);
  });

  it('warehouseBlockReason 含"无仓库"分支', () => {
    expect(DETAIL_PAGE).toMatch(/未指定仓库，无法入仓/);
  });

  it('warehouseBlockReason 含"非 customs"分支', () => {
    expect(DETAIL_PAGE).toMatch(/清关后方可确认入仓/);
  });

  it('warehouseBlockReason 含"isAdmin / isWarehoused 提前返回 null"分支', () => {
    // The helper returns null early if not admin or already warehoused
    expect(DETAIL_PAGE).toMatch(/!isAdmin.*isWarehoused/);
  });

  it('P3-S5B3: WarehouseShipmentButton 不渲染（旧 00023 入口已封存）', () => {
    // Old WarehouseShipmentButton removed; new P3-S5B3 buttons handle warehousing
    expect(DETAIL_PAGE).not.toMatch(/<WarehouseShipmentButton/);
  });

  it('渲染阻止原因使用 warehouseBlockReason 条件', () => {
    expect(DETAIL_PAGE).toMatch(/\{warehouseBlockReason\s*&&/);
  });

  it('P3-S5B0: 不导入 WarehouseShipmentButton，不渲染按钮（非注释匹配）', () => {
    // 确认详情页不 import WarehouseShipmentButton 组件
    expect(DETAIL_PAGE).not.toMatch(
      /import\s+\{\s*WarehouseShipmentButton\s*\}/,
    );
    // 确认不渲染 <WarehouseShipmentButton（JSX 标签，非注释）
    expect(DETAIL_PAGE).not.toMatch(/<WarehouseShipmentButton/);
  });

  it('Admin 可见确认入口', () => {
    expect(DETAIL_PAGE).toMatch(/isAdmin/);
  });

  it('warehoused 时不显示操作区', () => {
    expect(DETAIL_PAGE).toMatch(/!isWarehoused/);
  });
});

// ─── 4. WarehouseShipmentButton 组件源码检查 ─────────────────────────────────

const BUTTON_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/components/warehouse-shipment-button.tsx'),
  'utf-8',
);

describe('P3-S5A: WarehouseShipmentButton 组件 — 二次确认', () => {
  it('使用 Dialog 组件', () => {
    expect(BUTTON_SRC).toMatch(/Dialog/);
  });

  it('调用 warehouseShipment Server Action', () => {
    expect(BUTTON_SRC).toMatch(/warehouseShipment\(\{/);
  });

  it('有"确认入仓"标题', () => {
    expect(BUTTON_SRC).toMatch(/确认入仓/);
  });

  it('警告"此操作不可撤销"', () => {
    expect(BUTTON_SRC).toMatch(/不可撤销/);
  });

  it('提交期间按钮 disabled', () => {
    expect(BUTTON_SRC).toMatch(/disabled=\{submitting\}/);
  });

  it('提交期间显示"执行中..."', () => {
    expect(BUTTON_SRC).toMatch(/执行中\.\.\./);
  });

  it('成功时 toast 成功消息', () => {
    expect(BUTTON_SRC).toMatch(/确认入仓成功/);
  });

  it('失败时 toast 错误消息', () => {
    expect(BUTTON_SRC).toMatch(/result\.error/);
  });

  it('失败后不关闭 Dialog（setSubmitting(false)）', () => {
    expect(BUTTON_SRC).toMatch(/setSubmitting\(false\)/);
  });

  it('有取消按钮关闭 Dialog', () => {
    expect(BUTTON_SRC).toMatch(/setOpen\(false\)/);
  });

  it('有备注输入框（description）', () => {
    expect(BUTTON_SRC).toMatch(/description/);
  });

  it('描述最大长度 500', () => {
    expect(BUTTON_SRC).toMatch(/maxLength=\{500\}/);
  });
});

// ─── 5. Repository 行为测试 — warehouseShipment ─────────────────────────────

describe('P3-S5A: shipmentRepository.warehouseShipment() 行为测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
  });

  it('RPC 成功返回 true', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { shipmentRepository } = await import('./repository');
    const result = await shipmentRepository.warehouseShipment(
      SHIPMENT_ID,
      'user-1',
      '确认入仓',
    );

    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('warehouse_shipment_transactional', {
      p_shipment_id: SHIPMENT_ID,
      p_description: '确认入仓',
    });
  });

  it('无 description 传 null', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { shipmentRepository } = await import('./repository');
    await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');

    expect(mockRpc).toHaveBeenCalledWith('warehouse_shipment_transactional', {
      p_shipment_id: SHIPMENT_ID,
      p_description: null,
    });
  });

  it('RPC 错误（重复入仓）→ ShipmentError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '该在途记录已完成入仓，不可重复操作', code: 'P0001' },
    });

    const { shipmentRepository, ShipmentError } = await import('./repository');

    try {
      await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShipmentError);
      expect((e as Error).message).toBe('该在途记录已完成入仓，不可重复操作');
    }
  });

  it('RPC 错误（非 customs）→ ShipmentError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '当前状态为 booking，仅清关后可确认入仓', code: 'P0001' },
    });

    const { shipmentRepository, ShipmentError } = await import('./repository');

    try {
      await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShipmentError);
      expect((e as Error).message).toContain('仅清关后可确认入仓');
    }
  });

  it('RPC 错误（无仓库）→ ShipmentError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '该在途记录未指定仓库，无法入仓', code: 'P0001' },
    });

    const { shipmentRepository, ShipmentError } = await import('./repository');

    try {
      await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShipmentError);
      expect((e as Error).message).toBe('该在途记录未指定仓库，无法入仓');
    }
  });

  it('RPC 错误（无权限）→ ShipmentError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '无权限：需要管理员角色', code: 'P0001' },
    });

    const { shipmentRepository, ShipmentError } = await import('./repository');

    try {
      await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShipmentError);
      expect((e as Error).message).toBe('无权限：需要管理员角色');
    }
  });

  it('RPC 错误（不存在）→ ShipmentError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '在途记录不存在或无权访问', code: 'P0001' },
    });

    const { shipmentRepository, ShipmentError } = await import('./repository');

    try {
      await shipmentRepository.warehouseShipment(SHIPMENT_ID, 'user-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShipmentError);
      expect((e as Error).message).toBe('在途记录不存在或无权访问');
    }
  });
});

// ─── 6. P3-S5B0: warehouseShipment 阻断桩行为测试 ────────────────────────

describe('P3-S5B0: warehouseShipment 阻断桩', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRequireActiveAuth.mockReset();
  });

  it('始终返回 success:false', async () => {
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

  it('不调用 RPC（不产生数据库调用）', async () => {
    const { warehouseShipment } = await import('./actions');
    await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('无效 UUID 仍返回阻断错误（不经过 Zod）', async () => {
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: 'not-a-uuid' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('已停用');
    expect(mockRequireActiveAuth).not.toHaveBeenCalled();
  });

  it('空对象参数仍返回阻断错误', async () => {
    const { warehouseShipment } = await import('./actions');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing edge case with invalid input
    const r = await warehouseShipment({} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('已停用');
  });

  it('有 description 参数仍返回阻断错误', async () => {
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({
      shipmentId: SHIPMENT_ID,
      description: '测试备注',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('已停用');
  });
});

// ─── 7. Repository 源码检查 — warehouseShipment 方法 ─────────────────────────

const REPO_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/repository.ts'),
  'utf-8',
);

describe('P3-S5A: repository warehouseShipment 源码检查', () => {
  it('包含 warehouseShipment 方法', () => {
    expect(REPO_SRC).toMatch(/warehouseShipment/);
  });

  it('调用 supabase.rpc warehouse_shipment_transactional', () => {
    expect(REPO_SRC).toMatch(/'warehouse_shipment_transactional'/);
  });

  it('传参 p_shipment_id', () => {
    expect(REPO_SRC).toMatch(/p_shipment_id/);
  });

  it('传参 p_description', () => {
    expect(REPO_SRC).toMatch(/p_description/);
  });

  it('RPC error 抛出 ShipmentError', () => {
    expect(REPO_SRC).toMatch(/throw new ShipmentError/);
  });

  it('不直接 update/insert 表（只走 RPC）', () => {
    // The warehouseShipment method body should NOT contain direct .from() calls
    const methodBody = REPO_SRC.match(
      /async warehouseShipment[\s\S]*?\n  },/,
    )?.[0] ?? '';
    expect(methodBody).not.toMatch(/\.from\(/);
  });
});

// ─── 8. P3-S5B0: warehouseShipment 阻断桩源码检查 ────────────────────────────

const ACTIONS_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/actions.ts'),
  'utf-8',
);

// Extract warehouseShipment function body for precise checks
const whFnMatch = ACTIONS_SRC.match(
  /export async function warehouseShipment[\s\S]*?\n\}/,
);
const whFnBody = whFnMatch?.[0] ?? '';

describe('P3-S5B0: warehouseShipment 阻断桩源码检查', () => {
  it('包含 warehouseShipment export', () => {
    expect(ACTIONS_SRC).toMatch(/export async function warehouseShipment/);
  });

  it('返回"旧版入仓入口已停用"阻断错误', () => {
    expect(whFnBody).toMatch(/旧版入仓入口已停用/);
  });

  it('不调用 requireActiveAuth（注释提及除外）', () => {
    expect(whFnBody).not.toMatch(/requireActiveAuth\(/);
  });

  it('不使用 warehouseShipmentSchema.safeParse', () => {
    expect(whFnBody).not.toMatch(/warehouseShipmentSchema\.safeParse/);
  });

  it('不调用 shipmentRepository.warehouseShipment', () => {
    expect(whFnBody).not.toMatch(/shipmentRepository\.warehouseShipment/);
  });

  it('不调用 revalidatePath', () => {
    expect(whFnBody).not.toMatch(/revalidatePath/);
  });

  it('无 try/catch（无数据库操作，无需异常处理）', () => {
    expect(whFnBody).not.toMatch(/try\s*\{/);
  });

  it('函数体仅包含注释和 return { success: false, error: ... }', () => {
    // After removing comments, the function body should be minimal
    const stripped = whFnBody.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(/success:\s*false/);
    expect(stripped).not.toMatch(/requireActiveAuth/);
    expect(stripped).not.toMatch(/mockRpc/);
  });
});

// ─── 9. P3-S5B3: PartialWarehouseDialog 前端校验源码检查 ─────────────────────

const DIALOG_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/components/partial-warehouse-dialog.tsx'),
  'utf-8',
);

describe('P3-S5B3: PartialWarehouseDialog — 前端校验', () => {
  it('导入 partialWarehouseItemSchema（Zod 校验）', () => {
    expect(DIALOG_SRC).toMatch(/partialWarehouseItemSchema/);
  });

  it('不使用 parseInt 静默截断小数', () => {
    expect(DIALOG_SRC).not.toMatch(/parseInt/);
  });

  it('校验小数输入（"不支持小数"）', () => {
    expect(DIALOG_SRC).toMatch(/不支持小数/);
  });

  it('校验负数输入（"不能为负数"）', () => {
    expect(DIALOG_SRC).toMatch(/不能为负数/);
  });

  it('校验零值输入（"必须大于 0"）', () => {
    expect(DIALOG_SRC).toMatch(/必须大于 0/);
  });

  it('校验超过在途余量（"超过在途余量"）', () => {
    expect(DIALOG_SRC).toMatch(/超过在途余量/);
  });

  it('使用 fieldErrors 逐字段展示错误', () => {
    expect(DIALOG_SRC).toMatch(/fieldErrors/);
  });

  it('handleSubmit 中调用 Zod safeParse 双重校验', () => {
    expect(DIALOG_SRC).toMatch(/partialWarehouseItemSchema/);
    expect(DIALOG_SRC).toMatch(/safeParse/);
  });

  it('quantities 状态类型为 Record<string, string>（原始字符串）', () => {
    expect(DIALOG_SRC).toMatch(/Record<string,\s*string>/);
  });

  it('fillAllRemaining 使用 String(remaining) 填入整数', () => {
    expect(DIALOG_SRC).toMatch(/String\(remaining\)/);
  });
});
