// P3-S2E: 入口收口 + 采购单号 + 权限 — 行为/源码测试
//
// 覆盖：
// 1. purchase_order_no — Zod schema 覆盖
// 2. purchase_order_no — types 覆盖
// 3. Operator 调用 create/update/changeStatus 被 Server Action 拒绝
// 4. Admin 正常创建/编辑/变更
// 5. 菜单入口收口 — 不再出现"在途库存"
// 6. 表单/详情页包含采购单号字段
// 7. 海外库存展开组件字段检查

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── valid UUIDs ──────────────────────────────────────────────────────────

const VARIANT_A = '00000000-0000-4000-8000-000000000001';
const SHIPMENT_1 = '00000000-0000-4000-8000-000000000100';
const USER_ADMIN = '00000000-0000-4000-8000-000000000030';
const USER_OPERATOR = '00000000-0000-4000-8000-000000000040';

const operatorUser = { id: USER_OPERATOR, roleName: 'operator' as const, name: 'Operator', email: '' };
const adminUser = { id: USER_ADMIN, roleName: 'admin' as const, name: 'Admin', email: '' };

// ─── purchase_order_no — Zod 覆盖 ─────────────────────────────────────────

import { createShipmentSchema, updateShipmentSchema } from './schema';

describe('P3-S2E: purchase_order_no — Zod schema 覆盖', () => {
  it('createShipmentSchema 接受 purchaseOrderNo 可选字符串', () => {
    const result = createShipmentSchema.safeParse({
      shipmentNo: 'SN-001',
      country: 'TH',
      purchaseOrderNo: 'PO-2026-001',
      items: [{ variantId: VARIANT_A, quantity: 10 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchaseOrderNo).toBe('PO-2026-001');
    }
  });

  it('createShipmentSchema purchaseOrderNo 省略时正常（可选）', () => {
    const result = createShipmentSchema.safeParse({
      shipmentNo: 'SN-002',
      country: 'TH',
      items: [{ variantId: VARIANT_A, quantity: 10 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchaseOrderNo).toBeUndefined();
    }
  });

  it('createShipmentSchema purchaseOrderNo 超过 100 字符拒绝', () => {
    const result = createShipmentSchema.safeParse({
      shipmentNo: 'SN-003',
      country: 'TH',
      purchaseOrderNo: 'x'.repeat(101),
      items: [{ variantId: VARIANT_A, quantity: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it('updateShipmentSchema 接受 purchaseOrderNo', () => {
    const result = updateShipmentSchema.safeParse({
      id: SHIPMENT_1,
      shipmentNo: 'SN-004',
      country: 'TH',
      purchaseOrderNo: 'PO-UPDATE-001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchaseOrderNo).toBe('PO-UPDATE-001');
    }
  });
});

// ─── purchase_order_no — types 覆盖 ───────────────────────────────────────

import type {
  InTransitDetailItem,
  ShipmentListItem,
  CreateShipmentData,
  UpdateShipmentData,
} from './types';

describe('P3-S2E: purchase_order_no — types 覆盖', () => {
  it('InTransitDetailItem 包含 purchaseOrderNo', () => {
    const item: InTransitDetailItem = {
      shipmentId: SHIPMENT_1,
      shipmentNo: 'SN-001',
      purchaseOrderNo: 'PO-001',
      quantity: 100,
      status: 'departed',
      estimatedArrival: '2026-07-01',
      latestTrackingAt: null,
    };
    expect(item.purchaseOrderNo).toBe('PO-001');
  });

  it('ShipmentListItem 包含 purchaseOrderNo', () => {
    const item: ShipmentListItem = {
      id: SHIPMENT_1,
      shipmentNo: 'SN-001',
      purchaseOrderNo: 'PO-001',
      vesselName: null,
      voyageNumber: null,
      country: 'TH',
      warehouseName: null,
      status: 'departed',
      estimatedArrival: null,
      productCount: 1,
      totalQuantity: 100,
      inTransitQuantity: 100,
      productNames: null,
      createdBy: USER_ADMIN,
      createdAt: '2026-01-01',
    };
    expect(item.purchaseOrderNo).toBe('PO-001');
  });

  it('CreateShipmentData 包含 purchaseOrderNo', () => {
    const data: CreateShipmentData = {
      shipmentNo: 'SN-001',
      purchaseOrderNo: 'PO-001',
      country: 'TH',
      items: [{ variantId: VARIANT_A, quantity: 10 }],
    };
    expect(data.purchaseOrderNo).toBe('PO-001');
  });

  it('UpdateShipmentData 包含 purchaseOrderNo', () => {
    const data: UpdateShipmentData = {
      id: SHIPMENT_1,
      shipmentNo: 'SN-001',
      purchaseOrderNo: 'PO-UPDATE',
      country: 'TH',
    };
    expect(data.purchaseOrderNo).toBe('PO-UPDATE');
  });
});

// ─── Operator write rejection ─────────────────────────────────────────────

const { mockRequireActiveAuth } = vi.hoisted(() => ({
  mockRequireActiveAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: (...args: unknown[]) => mockRequireActiveAuth(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('./repository', () => ({
  shipmentRepository: {
    create: vi.fn(),
    update: vi.fn(),
    changeStatus: vi.fn(),
    getInTransitDetailsByVariantAndWarehouse: vi.fn(),
    validateWarehouseForShipment: vi.fn(),
    validateVariantsForShipment: vi.fn(),
  },
}));

import { createShipment, updateShipment, changeShipmentStatus } from './actions';
import { shipmentRepository as mockRepo } from './repository';

const validCreateInput = {
  shipmentNo: 'SN-TEST-001',
  country: 'TH' as const,
  items: [{ variantId: VARIANT_A, quantity: 10 }],
};

const validUpdateInput = {
  id: SHIPMENT_1,
  shipmentNo: 'SN-TEST-UPD',
  country: 'TH' as const,
};

describe('P3-S2E: Operator write rejection（Server Actions）', () => {
  // ── createShipment ────────────────────────────────────────────────

  describe('createShipment', () => {
    it('Operator 被拒绝（中文错误）', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(operatorUser);
      const result = await createShipment(validCreateInput);
      expect(result.success).toBe(false);
      expect(result.error).toBe('仅管理员可创建在途记录');
    });

    it('Admin 正常创建', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(adminUser);
      // Mock the repository functions directly
      const repo = mockRepo;
      (repo.create as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue('new-id');
      (repo.validateWarehouseForShipment as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
      (repo.validateVariantsForShipment as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
      const result = await createShipment(validCreateInput);
      if (!result.success) {
        expect(result.error).toBe(undefined);
      }
      expect(result.success).toBe(true);
    });
  });

  // ── updateShipment ────────────────────────────────────────────────

  describe('updateShipment', () => {
    it('Operator 被拒绝', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(operatorUser);
      const result = await updateShipment(validUpdateInput);
      expect(result.success).toBe(false);
      expect(result.error).toBe('仅管理员可编辑在途记录');
    });

    it('Admin 正常编辑', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(adminUser);
      const repo = mockRepo;
      (repo.update as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(true);
      (repo.validateWarehouseForShipment as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
      const result = await updateShipment(validUpdateInput);
      expect(result.success).toBe(true);
    });
  });

  // ── changeShipmentStatus ──────────────────────────────────────────

  describe('changeShipmentStatus', () => {
    it('Operator 被拒绝', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(operatorUser);
      const result = await changeShipmentStatus(SHIPMENT_1, 'loading');
      expect(result.success).toBe(false);
      expect(result.error).toBe('仅管理员可变更物流状态');
    });

    it('Admin 正常变更', async () => {
      mockRequireActiveAuth.mockReset();
      mockRequireActiveAuth.mockResolvedValue(adminUser);
      (mockRepo.changeStatus as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(true);
      const result = await changeShipmentStatus(SHIPMENT_1, 'loading');
      expect(result.success).toBe(true);
    });
  });
});

// ─── 菜单入口收口 — 源码检查 ──────────────────────────────────────────────

describe('P3-S2E: 入口收口 — 菜单与重定向', () => {
  const root = resolve(import.meta.dirname ?? __dirname, '../..');

  it('侧边栏不再包含"在途库存"入口', () => {
    const sidebarPath = resolve(root, 'app/dashboard/_components/sidebar-nav.tsx');
    const content = readFileSync(sidebarPath, 'utf-8');
    expect(content).not.toContain('/dashboard/inventory/in-transit');
    expect(content).not.toContain("label: '在途库存'");
  });

  it('侧边栏物流分组保留"在途管理"入口', () => {
    const sidebarPath = resolve(root, 'app/dashboard/_components/sidebar-nav.tsx');
    const content = readFileSync(sidebarPath, 'utf-8');
    expect(content).toContain('/dashboard/shipments');
    expect(content).toContain("label: '在途管理'");
  });

  it('/dashboard/inventory/in-transit 重定向到 /dashboard/shipments', () => {
    const pagePath = resolve(root, 'app/dashboard/inventory/in-transit/page.tsx');
    const content = readFileSync(pagePath, 'utf-8');
    expect(content).toContain("redirect('/dashboard/shipments')");
  });
});

// ─── purchase_order_no — 表单源码检查 ─────────────────────────────────

describe('P3-S2E: purchase_order_no — 表单源码检查', () => {
  const root = resolve(import.meta.dirname ?? __dirname, '../..');

  it('创建表单包含采购单号输入', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/shipment-create-form.tsx'), 'utf-8');
    expect(content).toContain('purchaseOrderNo');
    expect(content).toContain('采购单号');
  });

  it('编辑表单包含采购单号输入', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/shipment-edit-form.tsx'), 'utf-8');
    expect(content).toContain('purchaseOrderNo');
    expect(content).toContain('采购单号');
  });

  it('详情页显示采购单号', () => {
    const content = readFileSync(
      resolve(root, 'app/dashboard/shipments/[id]/page.tsx'), 'utf-8');
    expect(content).toContain('purchase_order_no');
  });

  it('列表列定义显示采购单号', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/columns.tsx'), 'utf-8');
    expect(content).toContain('purchaseOrderNo');
    expect(content).toContain('采购:');
  });
});

// ─── 海外库存展开组件 — 源码检查 ──────────────────────────────────────────

describe('P3-S2E: 海外库存展开组件 — 源码检查', () => {
  const root = resolve(import.meta.dirname ?? __dirname, '../..');

  it('InTransitDetailRow 组件存在并调用 getInTransitDetails', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    expect(content).toContain('InTransitDetailRow');
    expect(content).toContain('getInTransitDetails');
    expect(content).toContain('shipmentNo');
    expect(content).toContain('purchaseOrderNo');
    expect(content).toContain('estimatedArrival');
    expect(content).toContain('/dashboard/shipments');
  });

  it('InTransitDetailRow 展开明细显示运营需要的五个字段表头', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    expect(content).toContain('单号');
    expect(content).toContain('采购单号');
    expect(content).toContain('数量');
    expect(content).toContain('物流状态');
    expect(content).toContain('预计到货时间');
    // 物流情况已改名为物流状态（主行状态标签 + 下方最近物流更新时间）
    expect(content).not.toContain('>物流情况<');
  });

  it('InTransitDetailRow 使用 mini-table 结构（细边框 / 圆角 / 横向滚动 / 最小宽度）', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    expect(content).toContain('overflow-x-auto');
    expect(content).toContain('min-w-[');
    expect(content).toMatch(/\bborder\b/);
    expect(content).toContain('rounded');
    // 列宽使用 minmax 而非纯硬编码固定值
    expect(content).toContain('minmax(');
  });

  it('InTransitDetailRow 物流状态列使用 status 映射中文标签', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    expect(content).toContain('STATUS_MAP');
    expect(content).toContain('d.status');
    // 中文状态标签（镜像主表）
    expect(content).toContain('离港');
    expect(content).toContain('清关');
  });

  it('InTransitDetailRow 物流情况使用 latestTrackingAt 展示最近物流更新', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    expect(content).toContain('latestTrackingAt');
    expect(content).toContain('最近物流更新');
    expect(content).toContain('formatDateTime(d.latestTrackingAt)');
  });

  it('展开组件不包含详细物流字段（vessel_name/voyage_number）', () => {
    const content = readFileSync(
      resolve(root, 'features/shipments/components/in-transit-detail-row.tsx'), 'utf-8');
    // Rendered fields must not include vessel/voyage info
    expect(content).not.toContain('vessel_name');
    expect(content).not.toContain('voyage_number');
    expect(content).not.toContain('vesselName');
    expect(content).not.toContain('voyageNumber');
  });

  it('海外库存页集成展开组件', () => {
    const content = readFileSync(
      resolve(root, 'app/dashboard/inventory/overseas/_components/overseas-page-content.tsx'), 'utf-8');
    expect(content).toContain('InTransitDetailRow');
    expect(content).toContain('toggleExpand');
    expect(content).toContain('expandedKey');
  });

  it('在途管理页隐藏 Operator 新建按钮', () => {
    const content = readFileSync(
      resolve(root, 'app/dashboard/shipments/_components/shipments-page-content.tsx'), 'utf-8');
    expect(content).toContain('isAdmin');
  });
});

// ─── Migration 静态检查 — RETURNING id + admin-only ─────────────────────

describe('P3-S2E: Migration 静态检查', () => {
  const repoRoot = resolve(import.meta.dirname ?? __dirname, '../../..');

  it('Migration 00020 INSERT 包含 RETURNING id INTO v_shipment_id', () => {
    const content = readFileSync(
      resolve(repoRoot, 'supabase/migrations/00020_add_purchase_order_no_to_shipment.sql'), 'utf-8');
    expect(content).toContain('RETURNING id INTO v_shipment_id');
  });

  it('Migration 00020 RPC 权限校验为 admin-only', () => {
    const content = readFileSync(
      resolve(repoRoot, 'supabase/migrations/00020_add_purchase_order_no_to_shipment.sql'), 'utf-8');
    expect(content).toContain("v_role != 'admin'");
    expect(content).not.toContain("v_role NOT IN ('admin', 'operator')");
  });

  it('Migration 00021 覆盖 change_shipment_status_transactional 为 admin-only', () => {
    const content = readFileSync(
      resolve(repoRoot, 'supabase/migrations/00021_change_shipment_status_admin_only.sql'), 'utf-8');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.change_shipment_status_transactional');
    expect(content).toContain("v_role != 'admin'");
    expect(content).not.toContain("NOT IN ('admin', 'operator')");
  });
});
