// P3-S3: 手动创建/补录在途记录 — 行为测试 + 源码非回归测试
//
// 覆盖：
// - Zod schema 校验（纯函数）
// - createShipment Server Action（mock repository + auth）
// - searchVariants Server Action（mock repository + auth）
// - 源码非回归（is_archived 数据库列引用 + ilike vs .or()）
// - max(50) items 限制
//
// Repository 行为测试已移至 repository-behavior.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShipmentSchema, searchVariantsSchema } from '@/features/shipments/schema';
import { createShipment, searchVariants } from '@/features/shipments/actions';
import { shipmentRepository } from '@/features/shipments/repository';
import fs from 'fs';
import path from 'path';

// ─── valid UUIDs ──────────────────────────────────────────────────────

const VID1 = '00000000-0000-4000-8000-000000000001';
const VID2 = '00000000-0000-4000-8000-000000000002';
const WID1 = '00000000-0000-4000-8000-000000000004';

// ─── 1. createShipmentSchema (Zod) ────────────────────────────────────

describe('P3-S3 — createShipmentSchema (Zod)', () => {
  const validData = {
    country: 'TH',
    items: [{ variantId: VID1, quantity: 100 }],
  };

  it('最小有效数据通过', () => {
    const r = createShipmentSchema.safeParse(validData);
    expect(r.success).toBe(true);
  });

  it('完整可选字段通过', () => {
    const r = createShipmentSchema.safeParse({
      vesselName: 'EVER FORTUNE',
      voyageNumber: 'V1234',
      originPort: '上海港',
      destinationPort: '曼谷港',
      country: 'TH',
      warehouseId: WID1,
      estimatedArrival: '2026-12-31',
      note: '测试备注',
      items: [
        { variantId: VID1, quantity: 50 },
        { variantId: VID2, quantity: 200 },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items).toHaveLength(2);
    }
  });

  it.each(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'])('country=%s 通过', (c) => {
    const r = createShipmentSchema.safeParse({ country: c, items: validData.items });
    expect(r.success).toBe(true);
  });

  it('非法 country 拒绝', () => {
    const r = createShipmentSchema.safeParse({ country: 'XX', items: validData.items });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('请选择目的国');
  });

  it('缺少 country 拒绝', () => {
    const r = createShipmentSchema.safeParse({ items: validData.items });
    expect(r.success).toBe(false);
  });

  it('空 items 数组拒绝', () => {
    const r = createShipmentSchema.safeParse({ country: 'TH', items: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('至少添加一个产品');
  });

  it('缺少 items 拒绝', () => {
    const r = createShipmentSchema.safeParse({ country: 'TH' });
    expect(r.success).toBe(false);
  });

  it('quantity <= 0 拒绝', () => {
    const r = createShipmentSchema.safeParse({
      country: 'TH',
      items: [{ variantId: VID1, quantity: 0 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain('数量最少为 1');
    }
  });

  it('quantity 非整数拒绝', () => {
    const r = createShipmentSchema.safeParse({
      country: 'TH',
      items: [{ variantId: VID1, quantity: 1.5 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain('数量必须为整数');
    }
  });

  it('非法 variantId UUID 拒绝', () => {
    const r = createShipmentSchema.safeParse({
      country: 'TH',
      items: [{ variantId: 'not-a-uuid', quantity: 10 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('无效的 SKU ID');
  });

  it('非法 warehouseId UUID 拒绝', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      warehouseId: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('无效的仓库 ID');
  });

  // ── strict date: YYYY-MM-DD only ──────────────────────────────

  it('合法日期 YYYY-MM-DD 通过', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      estimatedArrival: '2026-06-15',
    });
    expect(r.success).toBe(true);
  });

  it('不存在的日期拒绝 (2026-02-30)', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      estimatedArrival: '2026-02-30',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('预计到仓日期不合法');
  });

  it('ISO 时间戳拒绝', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      estimatedArrival: '2026-06-15T00:00:00.000Z',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('预计到仓日期不合法');
  });

  it('乱写的日期字符串拒绝', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      estimatedArrival: 'today',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('预计到仓日期不合法');
  });

  it('空日期通过（可选字段）', () => {
    const r = createShipmentSchema.safeParse({ ...validData, estimatedArrival: '' });
    expect(r.success).toBe(true);
  });

  it('不传 estimatedArrival 通过', () => {
    const r = createShipmentSchema.safeParse(validData);
    expect(r.success).toBe(true);
  });

  it('vesselName 超长拒绝', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      vesselName: 'x'.repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it('note 超长拒绝', () => {
    const r = createShipmentSchema.safeParse({
      ...validData,
      note: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  // ── duplicate variantId ───────────────────────────────────────

  it('重复 variantId 拒绝', () => {
    const r = createShipmentSchema.safeParse({
      country: 'TH',
      items: [
        { variantId: VID1, quantity: 10 },
        { variantId: VID1, quantity: 20 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message);
      expect(messages).toContain('产品明细中存在重复 SKU');
    }
  });

  // ── max(50) items ─────────────────────────────────────────────

  it('50 条 items 通过', () => {
    const items50 = Array.from({ length: 50 }, (_, i) => ({
      variantId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    const r = createShipmentSchema.safeParse({ country: 'TH', items: items50 });
    expect(r.success).toBe(true);
  });

  it('51 条 items 拒绝', () => {
    const items51 = Array.from({ length: 51 }, (_, i) => ({
      variantId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    const r = createShipmentSchema.safeParse({ country: 'TH', items: items51 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain('最多添加 50 个产品');
    }
  });
});

// ─── 2. searchVariantsSchema (Zod) ────────────────────────────────────

describe('P3-S3 — searchVariantsSchema (Zod)', () => {
  it('合法参数通过', () => {
    const r = searchVariantsSchema.safeParse({ country: 'TH', search: 'SKU001' });
    expect(r.success).toBe(true);
  });

  it('无 search 通过', () => {
    const r = searchVariantsSchema.safeParse({ country: 'ID' });
    expect(r.success).toBe(true);
  });

  it('search 自动 trim', () => {
    const r = searchVariantsSchema.safeParse({ country: 'TH', search: '  hello  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.search).toBe('hello');
  });

  it('非法 country 拒绝', () => {
    const r = searchVariantsSchema.safeParse({ country: 'XX' });
    expect(r.success).toBe(false);
  });

  it('search 超长拒绝 (max 100)', () => {
    const r = searchVariantsSchema.safeParse({ country: 'TH', search: 'x'.repeat(101) });
    expect(r.success).toBe(false);
  });

  it('search 刚好 100 通过', () => {
    const r = searchVariantsSchema.safeParse({ country: 'TH', search: 'x'.repeat(100) });
    expect(r.success).toBe(true);
  });

  it('search 特殊字符通过（转义在 repository 层处理）', () => {
    const r = searchVariantsSchema.safeParse({ country: 'TH', search: '%_\\' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.search).toBe('%_\\');
  });
});

// ─── 3. 源码非回归 ────────────────────────────────────────────────────

describe('P3-S3 — 源码非回归', () => {
  const shipmentsDir = path.resolve(__dirname);
  const files = fs
    .readdirSync(shipmentsDir)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== 'p3-s3-contract.test.ts' && f !== 'repository-behavior.test.ts');

  // ── is_archived ──────────────────────────────────────────────────

  for (const file of files) {
    it(`${file} 不含 is_archived 数据库列引用`, () => {
      const content = fs.readFileSync(path.join(shipmentsDir, file), 'utf-8');
      const codeLines = content.split('\n').filter(
        (line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'),
      );
      const codeOnly = codeLines.join('\n');
      expect(codeOnly).not.toMatch(/\.eq\(['"]is_archived['"]/);
      expect(codeOnly).not.toMatch(/\.neq\(['"]is_archived['"]/);
      expect(codeOnly).not.toMatch(/select\([^)]*is_archived/);
    });
  }

  it('repository.ts 中 validateVariantsForShipment select 不含 is_archived', () => {
    const repoPath = path.resolve(__dirname, 'repository.ts');
    const content = fs.readFileSync(repoPath, 'utf-8');
    const methodStart = content.indexOf('async validateVariantsForShipment');
    const nextMethod = content.indexOf('async ', methodStart + 1);
    const methodBody = content.slice(methodStart, nextMethod > 0 ? nextMethod : undefined);
    const selectMatch = methodBody.match(/\.select\(([^)]+)\)/);
    if (selectMatch) {
      expect(selectMatch[1]).not.toContain('is_archived');
    }
  });

  it('repository.ts 中 searchVariants 引用 variantRepository.getUserArchivedVariantIds', () => {
    const repoPath = path.resolve(__dirname, 'repository.ts');
    const content = fs.readFileSync(repoPath, 'utf-8');
    expect(content).toMatch(/variantRepository\.getUserArchivedVariantIds/);
  });

  // ── ilike vs .or() ───────────────────────────────────────────────

  it('searchVariants 使用 ilike 而非将用户输入拼入 .or()', () => {
    const repoPath = path.resolve(__dirname, 'repository.ts');
    const content = fs.readFileSync(repoPath, 'utf-8');
    const methodStart = content.indexOf('async searchVariants');
    const nextAsync = content.indexOf('async ', methodStart + 1);
    const methodBody = content.slice(methodStart, nextAsync > 0 ? nextAsync : undefined);
    expect(methodBody).toContain('.ilike');
    // 不应将 search 变量直接拼入 or 字符串
    const orCallMatch = methodBody.match(/\.or\([^)]*search[^)]*\)/);
    expect(orCallMatch).toBeNull();
  });
});

// ─── Shared mock state ────────────────────────────────────────────────

const {
  mockRequireActiveAuth,
  mockCreate,
  mockValidateWarehouseForShipment,
  mockValidateVariantsForShipment,
  mockCanAccessWarehouse,
  mockSearchVariants,
} = vi.hoisted(() => ({
  mockRequireActiveAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockValidateWarehouseForShipment: vi.fn(),
  mockValidateVariantsForShipment: vi.fn(),
  mockCanAccessWarehouse: vi.fn(),
  mockSearchVariants: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: mockRequireActiveAuth,
}));

vi.mock('@/features/warehouse-access/repository', () => ({
  warehouseAccessRepository: {
    canAccessWarehouse: mockCanAccessWarehouse,
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('./repository', () => ({
  shipmentRepository: {
    create: mockCreate,
    validateWarehouseForShipment: mockValidateWarehouseForShipment,
    validateVariantsForShipment: mockValidateVariantsForShipment,
    searchVariants: mockSearchVariants,
  },
  ShipmentError: class ShipmentError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'ShipmentError';
      this.code = code;
    }
  },
}));

function makeShipmentError(msg: string, code = 'VALIDATION'): Error {
  const err = new Error(msg);
  err.name = 'ShipmentError';
  (err as unknown as { code: string }).code = code;
  return err;
}

// ─── 4. createShipment Server Action (behavioral) ─────────────────────

describe('P3-S3 — createShipment action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const adminUser = { id: 'u-admin', roleName: 'admin', isActive: true as const, email: 'a@x.com', displayName: 'Admin' };
  const operatorUser = { id: 'u-op', roleName: 'operator', isActive: true as const, email: 'o@x.com', displayName: 'Op' };

  const validInput = {
    country: 'TH' as const,
    items: [{ variantId: VID1, quantity: 100 }],
  };

  // ── auth ──────────────────────────────────────────────────────

  it('未登录拒绝', async () => {
    mockRequireActiveAuth.mockImplementation(() => { throw new Error('未登录或账户已停用'); });
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('创建在途记录失败');
  });

  it('停用用户拒绝', async () => {
    mockRequireActiveAuth.mockImplementation(() => { throw new Error('未登录或账户已停用'); });
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
  });

  // ── Zod ───────────────────────────────────────────────────────

  it('非法 country Zod 拒绝（不调用 repository）', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    const result = await createShipment({ ...validInput, country: 'XX' as never });
    expect(result.success).toBe(false);
    expect(result.error).toContain('请选择目的国');
    expect(mockValidateWarehouseForShipment).not.toHaveBeenCalled();
  });

  // ── max(50) items → Zod reject, RPC not called ────────────────

  it('51 条 items Zod 拒绝且 RPC 不调用', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    const items51 = Array.from({ length: 51 }, (_, i) => ({
      variantId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    const result = await createShipment({ country: 'TH', items: items51 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('最多添加 50 个产品');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── operator ──────────────────────────────────────────────────

  it('operator 未选仓库拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(operatorUser);
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('请选择仓库');
  });

  it('operator 无仓库权限拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(operatorUser);
    mockCanAccessWarehouse.mockResolvedValue(false);
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('您没有该仓库的操作权限');
    expect(mockValidateWarehouseForShipment).not.toHaveBeenCalled();
  });

  it('operator 有权限且仓库校验通过 → 创建成功', async () => {
    mockRequireActiveAuth.mockResolvedValue(operatorUser);
    mockCanAccessWarehouse.mockResolvedValue(true);
    mockCreate.mockResolvedValue('shipment-1');
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(true);
    expect(mockValidateWarehouseForShipment).toHaveBeenCalledWith(WID1, 'TH');
    expect(mockValidateVariantsForShipment).toHaveBeenCalledWith([VID1], 'TH');
    expect(mockCreate).toHaveBeenCalled();
  });

  // ── warehouse validation ──────────────────────────────────────

  it('仓库不存在拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockValidateWarehouseForShipment.mockImplementation(() => Promise.reject(makeShipmentError('仓库不存在或已停用')));
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('仓库不存在或已停用');
  });

  it('国内仓库拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockValidateWarehouseForShipment.mockImplementation(() => Promise.reject(makeShipmentError('只能选择海外仓库')));
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('只能选择海外仓库');
  });

  it('国家与仓库不一致拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockValidateWarehouseForShipment.mockImplementation(() => Promise.reject(makeShipmentError('国家与仓库不一致')));
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('国家与仓库不一致');
  });

  // ── variant validation ────────────────────────────────────────

  it('SKU 不存在拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockValidateVariantsForShipment.mockImplementation(() => Promise.reject(makeShipmentError('SKU 不存在：' + VID1)));
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('SKU 不存在');
  });

  it('产品国家与目的国不一致拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockValidateVariantsForShipment.mockImplementation(() => Promise.reject(makeShipmentError('产品国家与目的国不一致')));
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('产品国家与目的国不一致');
  });

  // ── admin ─────────────────────────────────────────────────────

  it('admin 不指定仓库创建成功', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockCreate.mockResolvedValue('shipment-2');
    const result = await createShipment(validInput);
    expect(result.success).toBe(true);
    expect(result.data).toBe('shipment-2');
    expect(mockValidateWarehouseForShipment).not.toHaveBeenCalled();
    expect(mockCanAccessWarehouse).not.toHaveBeenCalled();
  });

  it('admin 指定仓库创建成功', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockCreate.mockResolvedValue('shipment-3');
    const result = await createShipment({ ...validInput, warehouseId: WID1 });
    expect(result.success).toBe(true);
    expect(mockValidateWarehouseForShipment).toHaveBeenCalledWith(WID1, 'TH');
  });

  // ── error handling ────────────────────────────────────────────

  it('ShipmentError (DB_ERROR) 映射为中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockCreate.mockImplementation(() => Promise.reject(makeShipmentError('创建在途记录失败，请稍后重试', 'DB_ERROR')));
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('创建在途记录失败，请稍后重试');
  });

  it('非 ShipmentError 返回通用错误', async () => {
    mockRequireActiveAuth.mockResolvedValue(adminUser);
    mockCreate.mockImplementation(() => Promise.reject(new Error('unknown')));
    const result = await createShipment(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('创建在途记录失败，请稍后重试');
  });
});

// ─── 5. searchVariants Server Action (behavioral) ─────────────────────

describe('P3-S3 — searchVariants action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const fakeVariants = [
    { id: VID1, sku: 'SKU1', name: 'n', productName: 'p', country: 'TH' },
  ];

  it('需要登录', async () => {
    mockRequireActiveAuth.mockImplementation(() => { throw new Error('未登录或账户已停用'); });
    const result = await searchVariants('TH');
    expect(result.success).toBe(false);
    expect(result.error).toContain('搜索 SKU 失败');
  });

  it('非法 country Zod 拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    const result = await searchVariants('XX' as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('请选择目的国');
  });

  it('search 超长 Zod 拒绝', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    const result = await searchVariants('TH', 'x'.repeat(101));
    expect(result.success).toBe(false);
  });

  it('调用 repository.searchVariants 并返回 ActionResult', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    mockSearchVariants.mockResolvedValue(fakeVariants);
    const result = await searchVariants('TH', 'SKU');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(fakeVariants);
    expect(mockSearchVariants).toHaveBeenCalledWith('TH', 'SKU', 'u1');
  });

  it('不传 search 时传 undefined', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    mockSearchVariants.mockResolvedValue([]);
    const result = await searchVariants('TH');
    expect(result.success).toBe(true);
    expect(mockSearchVariants).toHaveBeenCalledWith('TH', undefined, 'u1');
  });

  it('ShipmentError 返回 ActionResult 中文错误', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    mockSearchVariants.mockImplementation(() => Promise.reject(makeShipmentError('查询 SKU 列表失败', 'DB_ERROR')));
    const result = await searchVariants('TH', 'SKU');
    expect(result.success).toBe(false);
    expect(result.error).toBe('查询 SKU 列表失败');
  });

  it('非 ShipmentError 返回通用错误', async () => {
    mockRequireActiveAuth.mockResolvedValue({ id: 'u1', roleName: 'admin' });
    mockSearchVariants.mockImplementation(() => Promise.reject(new Error('unknown')));
    const result = await searchVariants('TH', 'SKU');
    expect(result.success).toBe(false);
    expect(result.error).toBe('搜索 SKU 失败，请稍后重试');
  });
});

// ─── 6. Repository 行为测试 ────────────────────────────────────────────
// 已移至 repository-behavior.test.ts（mock createClient + variantRepository，
// 直接调用真实 shipmentRepository.searchVariants()，覆盖错误传播/notIn/合并去重/LIKE 转义/ActionResult 映射）
