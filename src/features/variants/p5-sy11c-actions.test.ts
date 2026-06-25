// P5-SY11C: Variant Actions — archiveVariants / restoreVariants 测试
//
// 覆盖:
// - 活跃 Admin 归档成功
// - 活跃 Admin 恢复成功
// - Operator 被拒绝
// - 未登录用户被拒绝
// - 非活跃 Admin 被拒绝
// - 空数组校验失败
// - 非法 UUID 校验失败
// - 不存在 Variant ID 返回中文错误
// - 已归档重复归档返回 archived: 0
// - 未归档重复恢复返回 restored: 0
// - 成功后 revalidate /dashboard/variants 和 /dashboard/variants/unmatched

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock auth ────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireActiveAdmin: vi.fn(),
  requireAdmin: vi.fn(),
}));

// ─── Mock revalidatePath ──────────────────────────────────────────────

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
  unstable_noStore: vi.fn(),
}));

// ─── Mock repository ──────────────────────────────────────────────────

const mockArchive = vi.fn();
const mockRestore = vi.fn();

// 定义一个可在 mock factory 外引用的 VariantError 构造器
// eslint-disable-next-line no-var
var _VariantErrorCtor: new (message: string, code: string) => Error & { code: string };

vi.mock('./repository', () => {
  class VariantError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'VariantError';
      this.code = code;
    }
  }
  _VariantErrorCtor = VariantError;
  return {
    variantRepository: {
      archive: (...args: unknown[]) => mockArchive(...args),
      restore: (...args: unknown[]) => mockRestore(...args),
    },
    VariantError,
  };
});

import { requireActiveAdmin } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { archiveVariants, restoreVariants } from './actions';

// ─── Constants ────────────────────────────────────────────────────────

const VALID_UUID = '00000000-0000-4000-a000-000000000001';
const VALID_UUID2 = '00000000-0000-4000-a000-000000000002';

const mockAdminUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin' as const,
  isActive: true as const,
};

function resetMocks() {
  vi.clearAllMocks();
}

// ─── 1. 活跃 Admin 归档成功 ───────────────────────────────────────────

describe('P5-SY11C — archiveVariants()', () => {
  beforeEach(() => {
    resetMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('活跃 Admin 归档成功：返回 success=true + archived 数量', async () => {
    mockArchive.mockResolvedValue({ archived: 2 });

    const result = await archiveVariants([VALID_UUID, VALID_UUID2]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ archived: 2 });
  });

  it('调用 variantRepository.archive 时传入 admin.id', async () => {
    mockArchive.mockResolvedValue({ archived: 1 });

    await archiveVariants([VALID_UUID]);

    expect(mockArchive).toHaveBeenCalledWith([VALID_UUID], mockAdminUser.id);
  });

  it('成功后 revalidate /dashboard/variants 和 /dashboard/variants/unmatched', async () => {
    mockArchive.mockResolvedValue({ archived: 1 });

    await archiveVariants([VALID_UUID]);

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/variants');
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/variants/unmatched');
  });

  it('Operator 被拒绝', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('无权限：需要管理员角色'));

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('无权限：需要管理员角色');
  });

  it('未登录 / 停用用户被拒绝', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('未登录或账户已停用'));

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('未登录或账户已停用');
  });

  it('空数组校验失败', async () => {
    const result = await archiveVariants([]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('非法 UUID 校验失败', async () => {
    const result = await archiveVariants(['not-a-uuid']);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('不存在的 Variant ID 返回中文错误', async () => {
    mockArchive.mockRejectedValue(new _VariantErrorCtor!('SKU 不存在', 'NOT_FOUND'));

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('SKU 不存在');
  });

  it('已归档重复归档返回 archived: 0（repository 层返回）', async () => {
    mockArchive.mockResolvedValue({ archived: 0 });

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ archived: 0 });
  });

  it('Schema transform 去重：重复 ID 传给 repository 时已去重', async () => {
    mockArchive.mockResolvedValue({ archived: 1 });

    await archiveVariants([VALID_UUID, VALID_UUID, VALID_UUID]);

    expect(mockArchive).toHaveBeenCalledWith([VALID_UUID], mockAdminUser.id);
  });

  it('VariantError 返回中文错误消息', async () => {
    mockArchive.mockRejectedValue(new _VariantErrorCtor!('归档 SKU 失败', 'DB_ERROR'));

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('归档 SKU 失败');
  });

  it('未知错误返回通用中文提示', async () => {
    mockArchive.mockRejectedValue(new Error('Unexpected internal error'));

    const result = await archiveVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('归档失败，请稍后重试');
  });
});

// ─── 2. 活跃 Admin 恢复成功 ───────────────────────────────────────────

describe('P5-SY11C — restoreVariants()', () => {
  beforeEach(() => {
    resetMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('活跃 Admin 恢复成功：返回 success=true + restored 数量', async () => {
    mockRestore.mockResolvedValue({ restored: 3 });

    const result = await restoreVariants([VALID_UUID, VALID_UUID2]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ restored: 3 });
  });

  it('调用 variantRepository.restore 时不传 admin.id（restore 无需此参数）', async () => {
    mockRestore.mockResolvedValue({ restored: 1 });

    await restoreVariants([VALID_UUID]);

    expect(mockRestore).toHaveBeenCalledWith([VALID_UUID]);
  });

  it('成功后 revalidate /dashboard/variants 和 /dashboard/variants/unmatched', async () => {
    mockRestore.mockResolvedValue({ restored: 1 });

    await restoreVariants([VALID_UUID]);

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/variants');
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/variants/unmatched');
  });

  it('Operator 被拒绝', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('无权限：需要管理员角色'));

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('无权限：需要管理员角色');
  });

  it('未登录 / 停用用户被拒绝', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('未登录或账户已停用'));

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('未登录或账户已停用');
  });

  it('空数组校验失败', async () => {
    const result = await restoreVariants([]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('非法 UUID 校验失败', async () => {
    const result = await restoreVariants(['not-a-uuid']);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('不存在的 Variant ID 返回中文错误', async () => {
    mockRestore.mockRejectedValue(new _VariantErrorCtor!('SKU 不存在', 'NOT_FOUND'));

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('SKU 不存在');
  });

  it('未归档重复恢复返回 restored: 0（repository 层返回）', async () => {
    mockRestore.mockResolvedValue({ restored: 0 });

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ restored: 0 });
  });

  it('Schema transform 去重：重复 ID 传给 repository 时已去重', async () => {
    mockRestore.mockResolvedValue({ restored: 1 });

    await restoreVariants([VALID_UUID2, VALID_UUID2, VALID_UUID2]);

    expect(mockRestore).toHaveBeenCalledWith([VALID_UUID2]);
  });

  it('VariantError 返回中文错误消息', async () => {
    mockRestore.mockRejectedValue(new _VariantErrorCtor!('恢复 SKU 失败', 'DB_ERROR'));

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('恢复 SKU 失败');
  });

  it('未知错误返回通用中文提示', async () => {
    mockRestore.mockRejectedValue(new Error('Unexpected internal error'));

    const result = await restoreVariants([VALID_UUID]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('恢复失败，请稍后重试');
  });
});
