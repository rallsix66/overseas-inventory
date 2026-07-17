// BigSeller 交互式登录会话建立回归测试
//
// 验证 Vercel 环境保护、Python ENOENT 返回值处理，以及本地成功启动确认。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin',
  isActive: true as const,
};

const mockState = vi.hoisted(() => ({
  authRejection: null as Error | null,
  spawnError: null as Error | null,
  spawnCalls: [] as Array<{ command: string; args: string[] }>,
  unrefCalls: 0,
  mkdirCalls: 0,
  writeCalls: [] as string[],
  unlinkCalls: [] as string[],
  closeCalls: [] as number[],
}));

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

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(() => { mockState.mkdirCalls += 1; }),
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    writeFileSync: vi.fn((file: string) => { mockState.writeCalls.push(file); }),
    unlinkSync: vi.fn((file: string) => { mockState.unlinkCalls.push(file); }),
    openSync: vi.fn(() => 42),
    closeSync: vi.fn((fd: number) => { mockState.closeCalls.push(fd); }),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockImplementation((command: string, args: string[]) => {
    mockState.spawnCalls.push({ command, args });
    const listeners: Record<string, (...eventArgs: unknown[]) => void> = {};

    setTimeout(() => {
      if (mockState.spawnError) {
        listeners.error?.(mockState.spawnError);
        return;
      }
      listeners.spawn?.();
    }, 0);

    return {
      once: (event: string, callback: (...eventArgs: unknown[]) => void) => {
        listeners[event] = callback;
      },
      unref: vi.fn(() => { mockState.unrefCalls += 1; }),
    };
  }),
}));

async function getEstablishBigSellerSession() {
  const mod = await import('./server-actions');
  return mod.establishBigSellerSession;
}

const originalVercel = process.env.VERCEL;
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;

describe('establishBigSellerSession', () => {
  beforeEach(() => {
    mockState.authRejection = null;
    mockState.spawnError = null;
    mockState.spawnCalls = [];
    mockState.unrefCalls = 0;
    mockState.mkdirCalls = 0;
    mockState.writeCalls = [];
    mockState.unlinkCalls = [];
    mockState.closeCalls = [];
    delete process.env.VERCEL;
    delete process.env.PYTHON_EXECUTABLE;
  });

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;

    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
  });

  it('仍然先校验 Admin 权限', async () => {
    mockState.authRejection = new Error('无权限：需要管理员角色');
    const establish = await getEstablishBigSellerSession();

    await expect(establish()).rejects.toThrow('无权限：需要管理员角色');
    expect(mockState.spawnCalls).toHaveLength(0);
  });

  it('Vercel 环境返回可预期错误，不创建文件或启动 Python', async () => {
    process.env.VERCEL = '1';
    const establish = await getEstablishBigSellerSession();

    const result = await establish();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Vercel 云端');
    expect(result.message).toContain('无法启动本机 Python');
    expect(mockState.mkdirCalls).toBe(0);
    expect(mockState.spawnCalls).toHaveLength(0);
  });

  it('Python ENOENT 作为失败结果返回，并清理锁与日志句柄', async () => {
    mockState.spawnError = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' });
    const establish = await getEstablishBigSellerSession();

    const result = await establish();

    expect(result.success).toBe(false);
    expect(result.message).toContain('无法启动登录会话进程');
    expect(result.message).toContain('ENOENT');
    expect(result.message).toContain('PYTHON_EXECUTABLE');
    expect(mockState.writeCalls).toHaveLength(1);
    expect(mockState.unlinkCalls.some((file) => file.endsWith('session-establish.lock'))).toBe(true);
    expect(mockState.closeCalls).toEqual([42]);
    expect(mockState.unrefCalls).toBe(0);
  });

  it('仅在收到 spawn 事件后返回成功，并支持配置 Python 路径', async () => {
    process.env.PYTHON_EXECUTABLE = ' C:\\Program Files\\Python313\\python.exe ';
    const establish = await getEstablishBigSellerSession();

    const result = await establish();

    expect(result.success).toBe(true);
    expect(mockState.spawnCalls).toEqual([{
      command: 'C:\\Program Files\\Python313\\python.exe',
      args: ['-m', 'tools.bigseller-scraper.bigseller_scraper'],
    }]);
    expect(mockState.closeCalls).toEqual([42]);
    expect(mockState.unrefCalls).toBe(1);
  });
});
