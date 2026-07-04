import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to make mock refs available to the hoisted vi.mock factory
const { mockGetUser, mockSingle } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSingle: vi.fn(),
}));

const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    }),
  ),
}));

vi.mock('@/lib/supabase/helpers', () => ({
  unwrapJoin: (joined: unknown) => {
    if (Array.isArray(joined)) return joined[0];
    return joined;
  },
}));

import {
  getCurrentUser,
  getCurrentActiveUser,
  requireAuth,
  requireAdmin,
  requireActiveAuth,
  requireActiveAdmin,
} from '@/lib/auth';

function resetMocks() {
  vi.clearAllMocks();
}

function mockAuthSuccess(email = 'admin@test.com') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1', email } },
    error: null,
  });
}

function mockAuthUnauthenticated() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function mockAuthError() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('auth error') });
}

function mockProfile(overrides: Record<string, unknown> = {}) {
  mockSingle.mockResolvedValue({
    data: {
      display_name: 'Test User',
      is_active: true,
      role: [{ name: 'admin' }],
      ...overrides,
    },
    error: null,
  });
}

function mockProfileError() {
  mockSingle.mockResolvedValue({ data: null, error: new Error('db error') });
}

function mockProfileNotFound() {
  mockSingle.mockResolvedValue({ data: null, error: null });
}

// ─── Existing function regression tests ───────────────────────────

describe('getCurrentUser (existing, unchanged)', () => {
  beforeEach(resetMocks);

  it('returns user when authenticated and profile exists', async () => {
    mockAuthSuccess();
    mockProfile();

    const user = await getCurrentUser();

    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.email).toBe('admin@test.com');
    expect(user!.displayName).toBe('Test User');
    expect(user!.roleName).toBe('admin');

    // Verify query chain — select now includes is_active for shared cache
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('display_name, is_active, role:role_id (name)');
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockSingle).toHaveBeenCalled();
  });

  it('returns null when not authenticated', async () => {
    mockAuthUnauthenticated();

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });

  it('returns null on auth error', async () => {
    mockAuthError();

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });

  it('falls back to email prefix when display_name is null', async () => {
    mockAuthSuccess('test@example.com');
    mockProfile({ display_name: null });

    const user = await getCurrentUser();

    expect(user!.displayName).toBe('test');
  });

  it('defaults roleName to operator when role is missing', async () => {
    mockAuthSuccess();
    mockProfile({ role: null });

    const user = await getCurrentUser();

    expect(user!.roleName).toBe('operator');
  });
});

describe('requireAuth (existing, unchanged)', () => {
  beforeEach(resetMocks);

  it('returns user when authenticated', async () => {
    mockAuthSuccess();
    mockProfile();

    const user = await requireAuth();

    expect(user.id).toBe('user-1');
  });

  it('throws when not authenticated', async () => {
    mockAuthUnauthenticated();

    await expect(requireAuth()).rejects.toThrow('未登录');
  });
});

describe('requireAdmin (existing, unchanged)', () => {
  beforeEach(resetMocks);

  it('returns user when admin', async () => {
    mockAuthSuccess();
    mockProfile();

    const user = await requireAdmin();

    expect(user.roleName).toBe('admin');
  });

  it('throws when not authenticated', async () => {
    mockAuthUnauthenticated();

    await expect(requireAdmin()).rejects.toThrow('未登录');
  });

  it('throws when operator', async () => {
    mockAuthSuccess();
    mockProfile({ role: [{ name: 'operator' }] });

    await expect(requireAdmin()).rejects.toThrow('无权限');
  });
});

// ─── P5-SY5B: New active-user functions ──────────────────────────

describe('getCurrentActiveUser', () => {
  beforeEach(resetMocks);

  it('returns user with isActive when authenticated and active', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: true });

    const user = await getCurrentActiveUser();

    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.email).toBe('admin@test.com');
    expect(user!.displayName).toBe('Test User');
    expect(user!.roleName).toBe('admin');
    expect(user!.isActive).toBe(true);

    // Verify query chain includes is_active
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('display_name, is_active, role:role_id (name)');
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockSingle).toHaveBeenCalled();
  });

  it('returns null when user is not authenticated', async () => {
    mockAuthUnauthenticated();

    const user = await getCurrentActiveUser();

    expect(user).toBeNull();
  });

  it('returns null on auth error (same as unauthenticated)', async () => {
    mockAuthError();

    const user = await getCurrentActiveUser();

    expect(user).toBeNull();
  });

  it('returns null when is_active is false (inactive user)', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: false });

    const user = await getCurrentActiveUser();

    expect(user).toBeNull();
  });

  it('returns null when is_active is null/undefined', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: null });

    const user = await getCurrentActiveUser();

    expect(user).toBeNull();
  });

  it('throws on profile database error', async () => {
    mockAuthSuccess();
    mockProfileError();

    await expect(getCurrentActiveUser()).rejects.toThrow('数据库错误');
  });

  it('returns null when profile not found', async () => {
    mockAuthSuccess();
    mockProfileNotFound();

    const user = await getCurrentActiveUser();

    expect(user).toBeNull();
  });

  it('returns operator role for active operator user', async () => {
    mockAuthSuccess('operator@test.com');
    mockProfile({ is_active: true, role: [{ name: 'operator' }] });

    const user = await getCurrentActiveUser();

    expect(user).not.toBeNull();
    expect(user!.roleName).toBe('operator');
    expect(user!.isActive).toBe(true);
  });
});

describe('requireActiveAuth', () => {
  beforeEach(resetMocks);

  it('returns user when authenticated and active', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: true });

    const user = await requireActiveAuth();

    expect(user.id).toBe('user-1');
    expect(user.isActive).toBe(true);
  });

  it('throws when not authenticated', async () => {
    mockAuthUnauthenticated();

    await expect(requireActiveAuth()).rejects.toThrow('未登录或账户已停用');
  });

  it('throws when inactive', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: false });

    await expect(requireActiveAuth()).rejects.toThrow('未登录或账户已停用');
  });
});

describe('requireActiveAdmin', () => {
  beforeEach(resetMocks);

  it('returns user when active admin', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: true, role: [{ name: 'admin' }] });

    const user = await requireActiveAdmin();

    expect(user.roleName).toBe('admin');
    expect(user.isActive).toBe(true);
  });

  it('throws when not authenticated', async () => {
    mockAuthUnauthenticated();

    await expect(requireActiveAdmin()).rejects.toThrow('未登录或账户已停用');
  });

  it('throws when inactive', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: false });

    await expect(requireActiveAdmin()).rejects.toThrow('未登录或账户已停用');
  });

  it('throws when active operator (not admin)', async () => {
    mockAuthSuccess();
    mockProfile({ is_active: true, role: [{ name: 'operator' }] });

    await expect(requireActiveAdmin()).rejects.toThrow('无权限');
  });
});
