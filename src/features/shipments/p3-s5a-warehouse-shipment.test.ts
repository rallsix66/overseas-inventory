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

describe('P3-S5A: Migration 00023 — 入仓业务规则', () => {
  it('FOR UPDATE 锁定 shipment', () => {
    expect(MIGRATION_00023).toMatch(/FROM public\.shipment[\s\S]*?FOR UPDATE/);
  });

  it('FOR UPDATE 锁定 shipment_item', () => {
    expect(MIGRATION_00023).toMatch(/FROM public\.shipment_item[\s\S]*?FOR UPDATE/);
  });

  it('FOR UPDATE 锁定 inventory', () => {
    expect(MIGRATION_00023).toMatch(/FROM public\.inventory[\s\S]*?FOR UPDATE/);
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
    // remaining = quantity - warehoused_quantity (uses v_item. prefix in PL/pgSQL)
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
  it('UPDATE inventory.quantity = quantity + remaining', () => {
    expect(MIGRATION_00023).toMatch(/quantity\s*=\s*quantity\s*\+\s*v_remaining/);
  });

  it('库存不存在时 INSERT（UPSERT 路径）', () => {
    expect(MIGRATION_00023).toMatch(/INSERT INTO public\.inventory/);
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

const DETAIL_PAGE = readFileSync(
  resolve(process.cwd(), 'src/app/dashboard/shipments/[id]/page.tsx'),
  'utf-8',
);

describe('P3-S5A: 详情页 — 确认入仓按钮可见性', () => {
  it('导入 WarehouseShipmentButton', () => {
    expect(DETAIL_PAGE).toMatch(/WarehouseShipmentButton/);
  });

  it('仅 customs + warehouse_id 时渲染按钮', () => {
    // shipment.status === 'customs' && shipment.warehouse_id
    expect(DETAIL_PAGE).toMatch(/status\s*===\s*'customs'/);
    expect(DETAIL_PAGE).toMatch(/warehouse_id/);
  });

  it('Admin 可见确认入口', () => {
    expect(DETAIL_PAGE).toMatch(/isAdmin/);
  });

  it('非 customs 状态显示不可入仓文案', () => {
    expect(DETAIL_PAGE).toMatch(/清关后方可确认入仓/);
  });

  it('无仓库时显示无法入仓文案', () => {
    expect(DETAIL_PAGE).toMatch(/未指定仓库，无法入仓/);
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

// ─── 6. Actions 测试 — warehouseShipment Server Action ──────────────────────

describe('P3-S5A: warehouseShipment Server Action', () => {
  const ADMIN_USER = {
    id: 'admin-id',
    roleName: 'admin' as const,
    isActive: true as const,
    email: 'admin@test.com',
    displayName: 'Admin',
  };
  const OPERATOR_USER = {
    id: 'op-id',
    roleName: 'operator' as const,
    isActive: true as const,
    email: 'op@test.com',
    displayName: 'Operator',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
    mockRequireActiveAuth.mockReset();
  });

  it('未登录用户返回失败', async () => {
    mockRequireActiveAuth.mockRejectedValue(new Error('未登录'));
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(r.success).toBe(false);
    expect(r.error).toContain('失败');
  });

  it('Operator 返回权限拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(OPERATOR_USER);
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });
    expect(r.success).toBe(false);
    expect(r.error).toContain('仅管理员');
  });

  it('无效 UUID 返回 Zod 校验失败', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: 'not-a-uuid' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('无效');
  });

  it('Admin 成功调用 RPC 并返回成功', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({
      shipmentId: SHIPMENT_ID,
      description: '入仓',
    });

    expect(r.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('warehouse_shipment_transactional', {
      p_shipment_id: SHIPMENT_ID,
      p_description: '入仓',
    });
  });

  it('RPC 错误（重复入仓）返回中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '该在途记录已完成入仓，不可重复操作', code: 'P0001' },
    });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(false);
    expect(r.error).toContain('已完成入仓，不可重复操作');
  });

  it('RPC 错误（非 customs）返回中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '当前状态为 booking，仅清关后可确认入仓', code: 'P0001' },
    });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(false);
    expect(r.error).toContain('仅清关后可确认入仓');
  });

  it('RPC 错误（无仓库）返回中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '该在途记录未指定仓库，无法入仓', code: 'P0001' },
    });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(false);
    expect(r.error).toContain('未指定仓库');
  });

  it('RPC 错误（无权限）返回中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '无权限：需要管理员角色', code: 'P0001' },
    });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(false);
    expect(r.error).toContain('需要管理员角色');
  });

  it('未知异常返回通用中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockRejectedValue(new Error('network down'));

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(false);
    expect(r.error).toContain('失败');
  });

  it('description 超过 500 字符 Zod 拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({
      shipmentId: SHIPMENT_ID,
      description: 'x'.repeat(501),
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain('500');
  });

  it('空 description 允许（传 null）', async () => {
    mockRequireActiveAuth.mockResolvedValue(ADMIN_USER);
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { warehouseShipment } = await import('./actions');
    const r = await warehouseShipment({ shipmentId: SHIPMENT_ID });

    expect(r.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('warehouse_shipment_transactional', {
      p_shipment_id: SHIPMENT_ID,
      p_description: null,
    });
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

// ─── 8. Actions 源码检查 — warehouseShipment ────────────────────────────────

const ACTIONS_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/actions.ts'),
  'utf-8',
);

describe('P3-S5A: actions warehouseShipment 源码检查', () => {
  it('包含 warehouseShipment export', () => {
    expect(ACTIONS_SRC).toMatch(/export async function warehouseShipment/);
  });

  it('调用 requireActiveAuth', () => {
    expect(ACTIONS_SRC).toMatch(/requireActiveAuth/);
  });

  it('Admin-only: roleName !== admin 返回错误', () => {
    expect(ACTIONS_SRC).toMatch(/仅管理员可确认入仓/);
  });

  it('Zod 校验通过 warehouseShipmentSchema.safeParse', () => {
    expect(ACTIONS_SRC).toMatch(/warehouseShipmentSchema\.safeParse/);
  });

  it('调用 shipmentRepository.warehouseShipment', () => {
    expect(ACTIONS_SRC).toMatch(/shipmentRepository\.warehouseShipment/);
  });

  it('使用 parsed.data.shipmentId', () => {
    expect(ACTIONS_SRC).toMatch(/parsed\.data\.shipmentId/);
  });

  it('使用 parsed.data.description', () => {
    expect(ACTIONS_SRC).toMatch(/parsed\.data\.description/);
  });

  it('revalidatePath shipments 列表', () => {
    expect(ACTIONS_SRC).toMatch(/revalidatePath\('\/dashboard\/shipments'\)/);
  });

  it('revalidatePath shipments 详情', () => {
    expect(ACTIONS_SRC).toMatch(/revalidatePath\(`\/dashboard\/shipments\/\$\{parsed\.data\.shipmentId\}`\)/);
  });

  it('捕获 ShipmentError 返回中文错误', () => {
    expect(ACTIONS_SRC).toMatch(/ShipmentError/);
  });

  it('未知异常返回通用中文错误', () => {
    expect(ACTIONS_SRC).toMatch(/确认入仓失败，请稍后重试/);
  });
});
