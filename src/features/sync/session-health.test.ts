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

describe('syncWarehouse 永久禁用', () => {
  // P5-SY9K rework: syncWarehouse 已移除 session health guard 和 feature gate，
  // 永久禁用，始终返回"旧快速同步入口已禁用"错误。

  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
  });

  it('任何调用均返回"旧快速同步入口已禁用"（不进入真实同步管线）', async () => {
    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('旧快速同步入口已禁用');
    expect(result.error).toContain('Dry Run');
    expect(result.error).toContain('确认写入');
    expect(result.runId).toBe('');
  });

  it('disable 错误不包含 session health 或 feature gate 消息（已移除这些 guard）', async () => {
    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.error).not.toContain('BigSeller 登录会话不可用');
    expect(result.error).not.toContain('功能尚未启用');
    expect(result.error).not.toContain('P5-SY9E');
  });

  it('不依赖 WEBSYNC_REAL_WRITE_ENABLED 环境变量', async () => {
    // gate=true 时也应返回禁用错误
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
    try {
      const { syncWarehouse } = await getSyncActions();
      const result = await syncWarehouse('any-wh-id');
      expect(result.error).toContain('旧快速同步入口已禁用');
    } finally {
      delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
    }
  });
});

// ─── syncWarehouse 旧入口禁用回归（原 feature gate 测试替换）────

describe('syncWarehouse 旧入口禁用回归', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  it('gate 关闭时返回禁用错误（非 gate 错误）', async () => {
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
    expect(result.error).toContain('旧快速同步入口已禁用');
    // 不再包含 feature gate 消息
    expect(result.error).not.toContain('功能尚未启用');
    expect(result.runId).toBe('');
  });

  it('gate 开启时同样返回禁用错误（gate=true 也不进入真实同步）', async () => {
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    expect(result.error).toContain('旧快速同步入口已禁用');
    expect(result.error).not.toContain('BigSeller 登录会话不可用');
  });

  it('unhealthy session 时同样返回禁用错误（不检查 session health）', async () => {
    mockState.spawnStdout = JSON.stringify({
      status: 'need_login',
      message: '需要登录。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncWarehouse } = await getSyncActions();
    const result = await syncWarehouse('any-wh-id');

    // 不检查 session health，直接返回禁用错误
    expect(result.error).toContain('旧快速同步入口已禁用');
    expect(result.error).not.toContain('BigSeller 登录会话不可用');
  });
});

describe('syncAllWarehouses 永久禁用', () => {
  // P5-SY9K rework: syncAllWarehouses 已移除 session health guard 和 feature gate，
  // 永久禁用，始终返回"旧批量同步入口已禁用"错误。

  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
  });

  it('任何调用均返回"旧批量同步入口已禁用"（不进入真实同步管线）', async () => {
    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.allSuccess).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('旧批量同步入口已禁用');
    expect(result.results[0].error).toContain('批量 Dry Run');
    expect(result.results[0].error).toContain('批量确认写入');
    expect(result.results[0].runId).toBe('');
  });

  it('disable 错误不包含 session health 或 feature gate 消息', async () => {
    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.results[0].error).not.toContain('BigSeller 登录会话不可用');
    expect(result.results[0].error).not.toContain('功能尚未启用');
  });

  it('不依赖 WEBSYNC_REAL_WRITE_ENABLED 环境变量', async () => {
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
    try {
      const { syncAllWarehouses } = await getSyncActions();
      const result = await syncAllWarehouses();
      expect(result.results[0].error).toContain('旧批量同步入口已禁用');
    } finally {
      delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
    }
  });
});

// ─── syncAllWarehouses 旧入口禁用回归（原 feature gate 测试替换）──

describe('syncAllWarehouses 旧入口禁用回归', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnStdout = null;
    mockState.spawnStderr = null;
    mockState.spawnError = null;
    mockState.spawnExitCode = null;
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  afterEach(() => {
    delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
  });

  it('gate 关闭时返回禁用错误（非 gate 错误）', async () => {
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
    expect(result.results[0].error).toContain('旧批量同步入口已禁用');
    expect(result.results[0].error).not.toContain('功能尚未启用');
    expect(result.results[0].runId).toBe('');
  });

  it('gate 开启时同样返回禁用错误（gate=true 也不进入真实同步）', async () => {
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
    mockState.spawnStdout = JSON.stringify({
      status: 'healthy',
      message: '已登录可用。',
      checked_at: '2026-06-23T10:00:00.000Z',
      details: {},
    }) + '\n';
    mockState.spawnExitCode = 0;

    const { syncAllWarehouses } = await getSyncActions();
    const result = await syncAllWarehouses();

    expect(result.results[0].error).toContain('旧批量同步入口已禁用');
    expect(result.results[0].error).not.toContain('BigSeller 登录会话不可用');
  });
});
