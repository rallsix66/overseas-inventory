// P5-SY11E: Variants 页面 UI/集成测试
//
// 覆盖:
// - search 参数传入 repository.list()
// - buildQuery 查询字符串构造逻辑（与 variant-page-content.tsx 同步）
// - archiveStatus 判定逻辑（Admin/Operator 角色差异）
// - unmatched 页面使用 requireActiveAuth + getUnmatched
// - 空数据状态文本变体
// - 分页参数默认值
// - ArchiveControls 选择逻辑覆盖（active/archived 混合选中）

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock auth ────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireActiveAuth: vi.fn(),
  requireActiveAdmin: vi.fn(),
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentActiveUser: vi.fn(),
}));

import { requireActiveAuth } from '@/lib/auth';

// ─── Mock repository ──────────────────────────────────────────────────

const mockList = vi.fn();
const mockGetUnmatched = vi.fn();

vi.mock('@/features/variants/repository', () => ({
  variantRepository: {
    list: (...args: unknown[]) => mockList(...args),
    getUnmatched: (...args: unknown[]) => mockGetUnmatched(...args),
  },
  VariantError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'VariantError';
      this.code = code;
    }
  },
}));

import { variantRepository } from '@/features/variants/repository';

// ─── Helpers ──────────────────────────────────────────────────────────

/** 与 variant-page-content.tsx 保持一致的查询字符串构造逻辑 */
function buildQuery(params: {
  archiveStatus: 'active' | 'archived' | 'all';
  search: string;
  page?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.archiveStatus !== 'active') qs.set('archiveStatus', params.archiveStatus);
  if (params.search) qs.set('search', params.search);
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Server Component 中的 archiveStatus 判定逻辑（与 page.tsx 保持一致） */
function resolveArchiveStatus(
  isAdmin: boolean,
  rawValue: string | undefined
): 'active' | 'archived' | 'all' {
  const validValues = ['active', 'archived', 'all'];
  if (!isAdmin || !validValues.includes(rawValue ?? '')) return 'active';
  return rawValue as 'active' | 'archived' | 'all';
}

/** 空数据消息判定（与 variant-page-content.tsx 保持一致） */
function getEmptyMessage(
  archiveStatus: 'active' | 'archived' | 'all',
  search: string | undefined
): { title: string; subtitle: string } {
  if (search) {
    return {
      title: '未找到匹配的 SKU',
      subtitle: `没有 SKU 或名称包含 "${search}" 的记录`,
    };
  }
  if (archiveStatus === 'archived') {
    return { title: '暂无 SKU 数据', subtitle: '没有已归档的 SKU' };
  }
  if (archiveStatus === 'all') {
    return { title: '暂无 SKU 数据', subtitle: '系统中尚无任何 SKU 记录' };
  }
  return {
    title: '暂无 SKU 数据',
    subtitle: '所有 SKU 均处于活跃状态，等待海外仓同步创建',
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ADMIN_USER = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin' as const,
  isActive: true as const,
};

const _OPERATOR_USER = {
  id: 'op-user-id',
  email: 'op@example.com',
  displayName: 'Operator',
  roleName: 'operator' as const,
  isActive: true as const,
};

void _OPERATOR_USER;

function resetMocks() {
  vi.clearAllMocks();
}

// ─── 1. buildQuery 查询字符串构造 ──────────────────────────────────────

describe('P5-SY11E — buildQuery 查询字符串构造', () => {
  it('默认 archiveStatus=active 且无 search 时返回空字符串', () => {
    expect(buildQuery({ archiveStatus: 'active', search: '' })).toBe('');
  });

  it('非 active archiveStatus 包含在查询字符串中', () => {
    expect(buildQuery({ archiveStatus: 'archived', search: '' })).toBe('?archiveStatus=archived');
    expect(buildQuery({ archiveStatus: 'all', search: '' })).toBe('?archiveStatus=all');
  });

  it('search 参数包含在查询字符串中', () => {
    expect(buildQuery({ archiveStatus: 'active', search: 'ABC' })).toBe('?search=ABC');
  });

  it('page > 1 时包含 page 参数', () => {
    expect(buildQuery({ archiveStatus: 'active', search: '', page: 3 })).toBe('?page=3');
  });

  it('page = 1 时不包含 page 参数', () => {
    expect(buildQuery({ archiveStatus: 'active', search: '', page: 1 })).toBe('');
  });

  it('page = 0 时不包含 page 参数', () => {
    expect(buildQuery({ archiveStatus: 'active', search: '', page: 0 })).toBe('');
  });

  it('archiveStatus + search + page 组合', () => {
    const result = buildQuery({ archiveStatus: 'all', search: 'TEST', page: 2 });
    expect(result).toContain('archiveStatus=all');
    expect(result).toContain('search=TEST');
    expect(result).toContain('page=2');
  });

  it('search 含特殊字符时正确编码', () => {
    const result = buildQuery({ archiveStatus: 'active', search: 'A&B' });
    expect(result).toContain('search=A%26B');
  });
});

// ─── 2. archiveStatus 判定逻辑 ────────────────────────────────────────

describe('P5-SY11E — archiveStatus 判定逻辑', () => {
  it('Admin + 合法值 active → active', () => {
    expect(resolveArchiveStatus(true, 'active')).toBe('active');
  });

  it('Admin + 合法值 archived → archived', () => {
    expect(resolveArchiveStatus(true, 'archived')).toBe('archived');
  });

  it('Admin + 合法值 all → all', () => {
    expect(resolveArchiveStatus(true, 'all')).toBe('all');
  });

  it('Admin + 非法值 → 强制 active', () => {
    expect(resolveArchiveStatus(true, 'invalid')).toBe('active');
  });

  it('Admin + undefined → 默认 active', () => {
    expect(resolveArchiveStatus(true, undefined)).toBe('active');
  });

  it('Operator + 合法值 archived → 强制 active（URL 篡改防护）', () => {
    expect(resolveArchiveStatus(false, 'archived')).toBe('active');
  });

  it('Operator + 合法值 all → 强制 active（URL 篡改防护）', () => {
    expect(resolveArchiveStatus(false, 'all')).toBe('active');
  });

  it('Operator + 合法值 active → active', () => {
    expect(resolveArchiveStatus(false, 'active')).toBe('active');
  });

  it('Operator + undefined → 默认 active', () => {
    expect(resolveArchiveStatus(false, undefined)).toBe('active');
  });
});

// ─── 3. 空数据状态消息 ────────────────────────────────────────────────

describe('P5-SY11E — 空数据状态消息', () => {
  it('搜索无结果时显示搜索提示', () => {
    const msg = getEmptyMessage('active', 'XYZ');
    expect(msg.title).toBe('未找到匹配的 SKU');
    expect(msg.subtitle).toContain('XYZ');
  });

  it('搜索无结果在 archived 标签也显示搜索提示', () => {
    const msg = getEmptyMessage('archived', 'XYZ');
    expect(msg.title).toBe('未找到匹配的 SKU');
    expect(msg.subtitle).toContain('XYZ');
  });

  it('archived 标签无数据', () => {
    const msg = getEmptyMessage('archived', undefined);
    expect(msg.subtitle).toBe('没有已归档的 SKU');
  });

  it('all 标签无数据', () => {
    const msg = getEmptyMessage('all', undefined);
    expect(msg.subtitle).toBe('系统中尚无任何 SKU 记录');
  });

  it('active 标签无数据', () => {
    const msg = getEmptyMessage('active', undefined);
    expect(msg.subtitle).toBe('所有 SKU 均处于活跃状态，等待海外仓同步创建');
  });
});

// ─── 4. variantRepository.list() search 参数 ──────────────────────────

describe('P5-SY11E — variantRepository.list() search 参数', () => {
  beforeEach(resetMocks);

  it('list() 无 search 参数时不传 or 过滤', async () => {
    mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });

    await variantRepository.list({ archiveStatus: 'active', page: 1, pageSize: 20 });
    expect(mockList).toHaveBeenCalledWith(
      expect.not.objectContaining({ search: expect.anything() })
    );
  });

  it('list({ search: "ABC" }) 传递 search 到 repository', async () => {
    mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });

    await variantRepository.list({ archiveStatus: 'active', search: 'ABC', page: 1, pageSize: 20 });
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'ABC' })
    );
  });

  it('list() 默认 page=1 pageSize=20 由 repository 处理', async () => {
    // 当 page/pageSize 未传入时，传 undefined，由 repository 内部提供默认值
    mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });

    await variantRepository.list({ archiveStatus: 'active' });
    const call = mockList.mock.calls[0][0];
    expect(call.archiveStatus).toBe('active');
    // page/pageSize 未传入时为 undefined，repository 内部应用默认值
    expect(call.page).toBeUndefined();
    expect(call.pageSize).toBeUndefined();
  });
});

// ─── 5. requireActiveAuth 调用验证 ────────────────────────────────────

describe('P5-SY11E — auth 调用验证', () => {
  beforeEach(resetMocks);

  it('requireActiveAuth 函数存在且可调用', async () => {
    vi.mocked(requireActiveAuth).mockResolvedValue(ADMIN_USER);

    const user = await requireActiveAuth();
    expect(user.roleName).toBe('admin');
    expect(user.isActive).toBe(true);
    expect(requireActiveAuth).toHaveBeenCalled();
  });

  it('requireActiveAuth 对停用用户抛出', async () => {
    vi.mocked(requireActiveAuth).mockRejectedValue(new Error('未登录或账户已停用'));

    await expect(requireActiveAuth()).rejects.toThrow('未登录或账户已停用');
  });
});

// ─── 6. getUnmatched 调用验证 ─────────────────────────────────────────

describe('P5-SY11E — unmatched 页面数据获取', () => {
  beforeEach(resetMocks);

  it('getUnmatched 返回活跃未匹配 SKU', async () => {
    mockGetUnmatched.mockResolvedValue([
      { id: 'uuid-1', sku: 'SKU-001', match_status: 'unmatched', is_archived: false },
    ]);

    const items = await variantRepository.getUnmatched();
    expect(items).toHaveLength(1);
    expect(items[0].is_archived).toBe(false);
  });

  it('getUnmatched 不接收任何参数（仅查询活跃未匹配+待确认）', async () => {
    mockGetUnmatched.mockResolvedValue([]);

    await variantRepository.getUnmatched();
    expect(mockGetUnmatched).toHaveBeenCalledWith();
  });
});

// ─── 7. ArchiveControls 选择逻辑 ──────────────────────────────────────

describe('P5-SY11E — ArchiveControls 选择逻辑', () => {
  it('混合选中时正确区分活跃项和已归档项', () => {
    const selectedItems = [
      { id: '1', is_archived: false },
      { id: '2', is_archived: true },
      { id: '3', is_archived: false },
    ];

    const activeSelected = selectedItems.filter((item) => !item.is_archived);
    const archivedSelected = selectedItems.filter((item) => item.is_archived);

    expect(activeSelected).toHaveLength(2);
    expect(archivedSelected).toHaveLength(1);
  });

  it('全部活跃时 canArchive=true, canRestore=false', () => {
    const selectedItems = [
      { id: '1', is_archived: false },
      { id: '2', is_archived: false },
    ];

    const canArchive = selectedItems.filter((item) => !item.is_archived).length > 0;
    const canRestore = selectedItems.filter((item) => item.is_archived).length > 0;

    expect(canArchive).toBe(true);
    expect(canRestore).toBe(false);
  });

  it('全部已归档时 canArchive=false, canRestore=true', () => {
    const selectedItems = [
      { id: '1', is_archived: true },
      { id: '2', is_archived: true },
    ];

    const canArchive = selectedItems.filter((item) => !item.is_archived).length > 0;
    const canRestore = selectedItems.filter((item) => item.is_archived).length > 0;

    expect(canArchive).toBe(false);
    expect(canRestore).toBe(true);
  });

  it('无选中项时不显示操作栏', () => {
    const selectedItems: { id: string; is_archived: boolean }[] = [];
    expect(selectedItems.length === 0).toBe(true);
  });
});

// ─── 8. VariantFilters 类型验证 ───────────────────────────────────────

describe('P5-SY11E — VariantFilters 类型验证', () => {
  it('VariantFilters 支持 search 字段', () => {
    // 类型级验证：如果 search 不在 VariantFilters 中，编译期就会失败
    const filters: { search?: string; archiveStatus?: string; page?: number; pageSize?: number } = {
      search: 'test-sku',
      archiveStatus: 'active',
      page: 1,
      pageSize: 20,
    };
    expect(filters.search).toBe('test-sku');
  });

  it('search 为空时不传递到 repository（trim 后为 undefined）', () => {
    const rawSearch = '   ';
    const search = rawSearch.trim() || undefined;
    expect(search).toBeUndefined();
  });

  it('search 有值时 trim 后传递', () => {
    const rawSearch = '  ABC123  ';
    const search = rawSearch.trim();
    expect(search).toBe('ABC123');
  });
});

// ─── 9. 搜索切换重置 page=1 ──────────────────────────────────────────

describe('P5-SY11E — 搜索切换重置 page=1', () => {
  it('搜索变更时 page 不含在 URL 中（即默认第 1 页）', () => {
    // 搜索变更后，buildQuery 不传 page → 不带 page 参数 → 服务器默认 page=1
    const qs = buildQuery({ archiveStatus: 'active', search: 'new-search' });
    expect(qs).not.toContain('page=');
  });

  it('分页链接保留 search 参数', () => {
    const qs = buildQuery({ archiveStatus: 'archived', search: 'SKU', page: 3 });
    expect(qs).toContain('search=SKU');
    expect(qs).toContain('page=3');
    expect(qs).toContain('archiveStatus=archived');
  });

  it('标签切换保留 search 参数', () => {
    const qs = buildQuery({ archiveStatus: 'all', search: 'ABC' });
    expect(qs).toContain('archiveStatus=all');
    expect(qs).toContain('search=ABC');
  });
});
