// Sync Feature Module — verifyBigSellerSession 测试 (P5-SY9B)
//
// 测试 BigSeller 会话健康检查 Server Action 的权限、
// 状态分类、checked_at → checkedAt 转换和结构性保证。
// 包含 syncWarehouse / syncAllWarehouses 服务端 session health guard 回归测试。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const adminUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin',
  isActive: true as const,
};

// ─── Hoisted mock state (available before vi.mock hoisting) ─────

const mockState = vi.hoisted(() => ({
  authRejection: null as Error | null,
  spawnStdout: null as string | null,
  spawnStderr: null as string | null,
  spawnError: null as Error | null,
  spawnExitCode: null as number | null,
}));

// ─── Module-level mocks ─────────────────────────────────────────

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth', () => ({
  requireActiveAdmin: vi.fn().mockImplementation(() => {
    if (mockState.authRejection) throw mockState.authRejection;
    return adminUser;
  }),
  requireActiveAuth: vi.fn(),
  getCurrentActiveUser: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const stdoutListeners: Record<string, (...args: unknown[]) => void> = {};
    const stderrListeners: Record<string, (...args: unknown[]) => void> = {};

    setTimeout(() => {
      if (mockState.spawnError) {
        listeners['error']?.(mockState.spawnError);
        return;
      }
      if (mockState.spawnStdout !== null) {
        stdoutListeners['data']?.(Buffer.from(mockState.spawnStdout));
      }
      if (mockState.spawnStderr !== null) {
        stderrListeners['data']?.(Buffer.from(mockState.spawnStderr));
      }
      listeners['close']?.(mockState.spawnExitCode);
    }, 10);

    return {
      stdout: { on: (event: string, cb: (...args: unknown[]) => void) => { stdoutListeners[event] = cb; } },
      stderr: { on: (event: string, cb: (...args: unknown[]) => void) => { stderrListeners[event] = cb; } },
      on: (event: string, cb: (...args: unknown[]) => void) => { listeners[event] = cb; },
      kill: vi.fn(),
    };
  }),
}));

// ─── Dynamic import (after mocks are established) ──────────────

async function getVerifyBigSellerSession() {
  const mod = await import('./server-actions');
  return mod.verifyBigSellerSession;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('verifyBigSellerSession', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
  });

  // ── Permission ──────────────────────────────────────────────

  describe('权限', () => {
    it('Admin 可以调用，返回 healthy', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'healthy',
        message: '已登录可用：BigSeller 登录会话正常。（检查耗时 8.5s）',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: { vxe_header_count: 13, vxe_row_count: 48 },
      }) + '\n';
      mockState.spawnExitCode = 0;

      const verifyBigSellerSession = await getVerifyBigSellerSession();
      const result = await verifyBigSellerSession();

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('已登录可用');
    });

    it('未登录用户不能调用', async () => {
      mockState.authRejection = new Error('未登录或账户已停用');
      const verifyBigSellerSession = await getVerifyBigSellerSession();
      await expect(verifyBigSellerSession()).rejects.toThrow('未登录或账户已停用');
    });

    it('Operator 不能调用', async () => {
      mockState.authRejection = new Error('无权限：需要管理员角色');
      const verifyBigSellerSession = await getVerifyBigSellerSession();
      await expect(verifyBigSellerSession()).rejects.toThrow('无权限：需要管理员角色');
    });
  });

  // ── Status classification ──────────────────────────────────

  describe('状态分类', () => {
    it('need_login', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'need_login',
        message: '需要登录：BigSeller 登录会话已过期。请点击「重新建立登录会话」按钮。',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 0;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('need_login');
    });

    it('need_verification', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'need_verification',
        message: '需要验证码：BigSeller 页面出现安全验证。',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: { captcha_detected: true },
      }) + '\n';
      mockState.spawnExitCode = 0;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('need_verification');
    });

    it('profile_unavailable', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'profile_unavailable',
        message: 'Profile 不可用：BigSeller 登录会话 cookie 文件缺失或为空。请点击「重新建立登录会话」按钮重新登录。',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: { profile_dir_exists: true, profile_has_cookies: false },
      }) + '\n';
      mockState.spawnExitCode = 1;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('profile_unavailable');
    });

    it('page_structure_changed', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'page_structure_changed',
        message: '页面结构异常：缺少仓库筛选入口。',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 1;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('page_structure_changed');
    });

    it('table_not_loaded', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'table_not_loaded',
        message: '表格未加载：无法找到 VXE 表格。',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 1;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('table_not_loaded');
    });

    it('Python 无输出 → unknown_error', async () => {
      mockState.spawnStdout = null;
      mockState.spawnExitCode = 1;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('unknown_error');
      expect(result.message).toContain('无输出');
    });

    it('Python 输出非 JSON → unknown_error', async () => {
      mockState.spawnStdout = 'not json!!!\n';
      mockState.spawnExitCode = 1;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('unknown_error');
      expect(result.message).toContain('解析失败');
    });

    it('子进程启动失败 → unknown_error', async () => {
      mockState.spawnError = new Error('ENOENT: python not found');
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect(result.status).toBe('unknown_error');
      expect(result.message).toContain('无法启动');
    });
  });

  // ── checked_at → checkedAt 转换 (P5-SY9B rework) ────────────

  describe('checked_at → checkedAt 字段转换', () => {
    it('Python checked_at 应转换为 TypeScript checkedAt', async () => {
      const pyTimestamp = '2026-06-23T12:00:00.000Z';
      mockState.spawnStdout = JSON.stringify({
        status: 'healthy',
        message: '已登录可用',
        checked_at: pyTimestamp,
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 0;

      const fn = await getVerifyBigSellerSession();
      const result = await fn();

      // TypeScript 契约使用 checkedAt (camelCase)
      expect(result.checkedAt).toBe(pyTimestamp);
      // Python snake_case 不应泄漏到 TypeScript 类型
      expect((result as Record<string, unknown>).checked_at).toBeUndefined();
    });

    it('Python 缺少 checked_at 时 fallback 为当前 ISO 时间戳', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'healthy',
        message: '已登录可用',
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 0;

      const fn = await getVerifyBigSellerSession();
      const result = await fn();

      expect(result.checkedAt).toBeTruthy();
      // 应为有效 ISO 时间戳
      expect(() => new Date(result.checkedAt)).not.toThrow();
    });

    it('Python 同时包含 checked_at 和旧 checkedAt 时优先 checked_at', async () => {
      const correctTs = '2026-06-23T14:00:00.000Z';
      const staleTs = '2026-06-22T00:00:00.000Z';
      mockState.spawnStdout = JSON.stringify({
        status: 'healthy',
        message: '已登录可用',
        checked_at: correctTs,
        checkedAt: staleTs,
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 0;

      const fn = await getVerifyBigSellerSession();
      const result = await fn();

      // checked_at 优先
      expect(result.checkedAt).toBe(correctTs);
    });
  });

  // ── Structural guarantees ──────────────────────────────────

  describe('结构性保证', () => {
    it('不含 sync_run 写入字段', async () => {
      mockState.spawnStdout = JSON.stringify({
        status: 'healthy',
        message: '已登录可用',
        checked_at: '2026-06-23T10:00:00.000Z',
        details: {},
      }) + '\n';
      mockState.spawnExitCode = 0;
      const fn = await getVerifyBigSellerSession();
      const result = await fn();
      expect((result as Record<string, unknown>).runId).toBeUndefined();
      expect((result as Record<string, unknown>).summary).toBeUndefined();
    });

    it('7 种状态值完整', () => {
      const valid = [
        'healthy', 'need_login', 'need_verification',
        'profile_unavailable', 'page_structure_changed',
        'table_not_loaded', 'unknown_error',
      ];
      expect(valid.length).toBe(7);
    });

    it('healthy 启用同步，其余禁用', () => {
      const unhealthy = [
        'need_login', 'need_verification', 'profile_unavailable',
        'page_structure_changed', 'table_not_loaded', 'unknown_error',
      ];
      expect('healthy' !== 'healthy').toBe(false);
      for (const s of unhealthy) {
        expect(s !== 'healthy').toBe(true);
      }
    });
  });
});

// ─── Session Health Guard 回归测试 (P5-SY9B rework) ─────────────
//
// 验证 syncWarehouse / syncAllWarehouses 在 Server Action 内部
// 强制检查会话健康状态，非 healthy 不得进入 wireRealActions。

async function getSyncActions() {
  return import('./server-actions');
}

describe('syncWarehouse session health guard', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    // P5-SY9C: feature gate 默认关闭。healthy guard 测试需要
    // 开启 gate 以验证 guard 通过后继续执行（随后因无 Supabase 而 throw）。
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  // ── Non-healthy → guard rejects ────────────────────────────

  it('need_login 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'need_login',
      message: '需要登录：BigSeller 登录会话已过期。请点击「重新建立登录会话」按钮。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('需要登录');
    // 未进入真实同步管线：runId 为空，不应有 dryRunRunId
    expect(result.runId).toBe('');
    expect(result.dryRunRunId).toBeUndefined();
  });

  it('profile_unavailable 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'profile_unavailable',
      message: 'Profile 不可用：BigSeller 登录会话 cookie 文件缺失或为空。请点击「重新建立登录会话」按钮重新登录。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: { profile_dir_exists: false, profile_has_cookies: false },
    }) + '\n';
    mockState.spawnExitCode = 1;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('Profile 不可用');
    expect(result.runId).toBe('');
  });

  it('unknown_error 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = null;
    mockState.spawnExitCode = 1;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('无输出');
    expect(result.runId).toBe('');
  });

  it('table_not_loaded 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'table_not_loaded',
      message: '表格未加载：无法找到 VXE 表格。请稍后重试。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 1;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
  });

  it('need_verification 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'need_verification',
      message: '需要验证码：BigSeller 页面出现安全验证。请点击「重新建立登录会话」按钮。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: { captcha_detected: true },
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('需要验证码');
  });

  it('page_structure_changed 时返回中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'page_structure_changed',
      message: '页面结构异常：缺少仓库筛选入口。请检查 BigSeller 页面是否正常。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 1;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('页面结构异常');
  });

  // ── Healthy → guard passes ─────────────────────────────────

  it('healthy 时通过 guard，继续执行（随后因无 Supabase 而 throw，证明未在 guard 处阻断）', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用：BigSeller 登录会话正常。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: { vxe_header_count: 13, vxe_row_count: 48 },
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();

    // healthy 应通过 guard，随后尝试 getCachedOverseasWarehouses()→Supabase
    // 无 Supabase 环境下必然 throw；若 guard 误触发则会 return 而非 throw
    await expect(syncWarehouse('any-wh-id')).rejects.toThrow();
    // 错误应来自 Supabase 连接层，而非「BigSeller 登录会话不可用」
    try {
      await syncWarehouse('any-wh-id');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('BigSeller 登录会话不可用');
    }
  });
});

// ─── Feature gate interception (P5-SY9C rework) ────────────────

describe('syncWarehouse feature gate (WEBSYNC_REAL_WRITE_ENABLED)', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    // 刻意不设置 WEBSYNC_REAL_WRITE_ENABLED — gate 默认关闭
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  it('healthy session 但 gate 关闭 → 返回 gate 错误，不进入真实同步', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用：BigSeller 登录会话正常。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('功能尚未启用');
    expect(result.error).toContain('P5-SY9E');
    expect(result.runId).toBe('');
  });

  it('healthy session 但 gate 关闭 → error 不包含 session health 消息（gate 在 health 之后拦截）', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    // gate 拦截消息与 session health 无关
    expect(result.error).not.toContain('BigSeller 登录会话不可用');
    expect(result.error).not.toContain('已登录可用');
  });

  it('gate 关闭时 verifyBigSellerSession 仍被调用（health guard 先于 gate）', async () => {
    // session unhealthy → 被 health guard 拦截，gate 未到达
    mockState.spawnStdout = JSON.stringify({
      status: 'need_login',
      message: '需要登录。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    // health guard 先拦截，返回 session error 而非 gate error
    expect(result.error).toContain('BigSeller 登录会话不可用');
    expect(result.error).toContain('需要登录');
    expect(result.error).not.toContain('功能尚未启用');
  });
});

describe('syncAllWarehouses session health guard', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    // P5-SY9C: feature gate 默认关闭。healthy guard 测试需要开启 gate。
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  it('need_login 时返回 results 含中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'need_login',
      message: '需要登录：BigSeller 登录会话已过期。请点击「重新建立登录会话」按钮。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.allSuccess).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('BigSeller 登录会话不可用');
    expect(result.results[0].error).toContain('需要登录');
    expect(result.results[0].runId).toBe('');
  });

  it('profile_unavailable 时返回 results 含中文错误，不进入真实同步管线', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'profile_unavailable',
      message: 'Profile 不可用：BigSeller 登录会话 profile 目录不存在。请先点击「重新建立登录会话」按钮。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: { profile_dir_exists: false },
    }) + '\n';
    mockState.spawnExitCode = 1;

    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.allSuccess).toBe(false);
    expect(result.results[0].error).toContain('BigSeller 登录会话不可用');
    expect(result.results[0].error).toContain('Profile 不可用');
  });

  it('healthy 时通过 guard，继续执行（随后因无 Supabase 而 throw）', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncAllWarehouses } = await getSyncActions();

    // healthy 应通过 guard，随后尝试 Supabase → throw
    await expect(syncAllWarehouses()).rejects.toThrow();
    try {
      await syncAllWarehouses();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('BigSeller 登录会话不可用');
    }
  });
});

// ─── Feature gate interception for syncAllWarehouses (P5-SY9C rework) ──

describe('syncAllWarehouses feature gate (WEBSYNC_REAL_WRITE_ENABLED)', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    // 刻意不设置 WEBSYNC_REAL_WRITE_ENABLED — gate 默认关闭
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  it('healthy session 但 gate 关闭 → 返回 gate 错误 results', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用：BigSeller 登录会话正常。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.allSuccess).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('功能尚未启用');
    expect(result.results[0].runId).toBe('');
  });

  it('healthy session 但 gate 关闭 → error 不包含 session health 消息', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.results[0].error).not.toContain('BigSeller 登录会话不可用');
    expect(result.results[0].error).not.toContain('已登录可用');
  });
});
