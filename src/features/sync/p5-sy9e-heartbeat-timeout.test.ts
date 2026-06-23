// P5-SY9E rework: heartbeat / timeout / abort / 子进程控制 测试
//
// 验证: 可注入 heartbeat 间隔 + 真实触发 heartbeat + terminate 统一管线 +
// prepareRunnerContext 异常清理 + SIGTERM→SIGKILL + real_write 路径。
// 不连接生产 Supabase，不执行真实写入。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncService, type SyncServiceDeps } from './sync-service';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';

// ─── vi.hoisted mock state for python-bridge terminate tests ─────
const bridgeMockState = vi.hoisted(() => ({
  mockChild: null as Record<string, unknown> | null,
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => bridgeMockState.mockChild),
}));

// ─── Helpers ──────────────────────────────────────────────────────

const WH_ID = 'adc5ec45-cd98-42a8-a1d1-26600e80d481';
const TRIGGERED_BY = 'user-0000-0000-0000-000000000001';

function makeDeps(opts?: {
  repo?: MockRepository;
  runner?: MockSyncRunner;
  heartbeatIntervalMs?: number;
}): SyncServiceDeps {
  MockRepository._resetAll();
  MockArtifactProvider._resetAll();
  return {
    repository: opts?.repo ?? new MockRepository('admin'),
    artifactProvider: new MockArtifactProvider(),
    runner: opts?.runner ?? new MockSyncRunner(),
    heartbeatIntervalMs: opts?.heartbeatIntervalMs,
  };
}

const DRY_INPUT = { skus: ['WM0001', 'WM0002'], warehouse: '测试仓' };

// ─── 1. Heartbeat 真实触发 ──────────────────────────────────────

describe('P5-SY9E — heartbeat 真实触发', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('注入 heartbeatIntervalMs=20ms + runner delay=150ms → heartbeat 至少调用一次', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.delayMs = 150; // runner 执行 150ms

    const spy = vi.spyOn(repo, 'heartbeatSyncRun');

    const deps = makeDeps({ repo, runner, heartbeatIntervalMs: 20 });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('completed');
    // 150ms / 20ms = 最多 7 次心跳，至少 1 次
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    // 验证每次调用参数正确
    for (const call of spy.mock.calls) {
      expect(call[0]).toMatchObject({ leaseDuration: 300 });
      expect(call[0].runId).toBe(result.runId);
    }
  });

  it('heartbeat 抛错时同步仍完成（真实触发 heartbeat + 注入抛错）', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.delayMs = 150;

    let callCount = 0;
    const spy = vi.spyOn(repo, 'heartbeatSyncRun');
    spy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('模拟 heartbeat 网络超时');
      }
    });

    const deps = makeDeps({ repo, runner, heartbeatIntervalMs: 20 });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    // heartbeat 失败不应导致 sync 失败
    expect(result.status).toBe('completed');
    expect(result.runnerResult).toBeDefined();
    // heartbeat 至少被调用过（第一次抛错，后续成功）
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('claim 前失败不触发 heartbeat', async () => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();

    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    const spy = vi.spyOn(repo, 'heartbeatSyncRun');

    // 预先占仓
    await repo.claimSyncRun({
      warehouseId: WH_ID,
      mode: 'dry_run',
      runId: 'existing-run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const deps: SyncServiceDeps = {
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner,
      heartbeatIntervalMs: 20,
    };
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('占用');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── 2. Timeout / Abort ─────────────────────────────────────────

describe('P5-SY9E — timeout / abort', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('signal 已 aborted → runner 检测并抛出，release failed', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.delayMs = 5_000;

    const ctrl = new AbortController();
    ctrl.abort('测试取消');

    const deps = makeDeps({ repo, runner });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
      signal: ctrl.signal,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('同步被取消');
  });

  it('runner capabilities maxTimeoutMs=50 + delayMs=5s → timeout 触发，release failed', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner._setCapabilities({ supportsTimeout: true, maxTimeoutMs: 50 });
    runner.delayMs = 5_000;

    const deps = makeDeps({ repo, runner });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Runner 执行失败');
  });

  it('capabilities maxTimeoutMs=0 → 不创建 timeout signal', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.delayMs = 10;

    const deps = makeDeps({ repo, runner });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('completed');
  });
});

// ─── 3. prepareRunnerContext 异常清理 ───────────────────────────

describe('P5-SY9E — prepareRunnerContext 异常清理', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('dry_run: capabilities() 抛错 → heartbeat 清理 + release failed', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.shouldThrowCapabilities = true;

    const hbSpy = vi.spyOn(repo, 'heartbeatSyncRun');
    const releaseSpy = vi.spyOn(repo, 'releaseSyncRun');

    const deps = makeDeps({ repo, runner, heartbeatIntervalMs: 20 });
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: DRY_INPUT,
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Runner 能力查询失败');
    // heartbeat 不应被触发（capabilities 在 heartbeat 启动后立即调用，但抛错时已 clearInterval）
    expect(hbSpy).not.toHaveBeenCalled();
    // release failed 被调用
    expect(releaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', exitCode: 1 }),
    );
  });

  it('real_write: capabilities() 抛错 → heartbeat 清理 + release failed', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    runner.shouldThrowCapabilities = true;

    // 准备 Dry Run artifact（real_write 需要先加载绑定 plan）
    const artifactProvider = new MockArtifactProvider();
    const planPrep = artifactProvider.prepare({
      country: 'VN', new_variants: [], inventory_inserts: [],
      inventory_updates: [], inventory_unchanged: [], warehouse_rename_required: {},
    });
    await artifactProvider.store('dr-bound', 'input', artifactProvider.prepare({ skus: ['X'] }));
    await artifactProvider.store('dr-bound', 'plan', planPrep);

    const hbSpy = vi.spyOn(repo, 'heartbeatSyncRun');
    const releaseSpy = vi.spyOn(repo, 'releaseSyncRun');

    MockArtifactProvider._resetAll(); // reset after store
    // Re-store since we reset
    await artifactProvider.store('dr-bound', 'input', artifactProvider.prepare({ skus: ['X'] }));
    await artifactProvider.store('dr-bound', 'plan', planPrep);

    // Use a fresh artifactProvider that has the stored artifacts
    const deps: SyncServiceDeps = {
      repository: repo,
      artifactProvider, // same instance — has artifacts
      runner,
      heartbeatIntervalMs: 20,
    };
    const svc = createSyncService(deps);

    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'real_write',
      inputArtifact: DRY_INPUT,
      dryRunRunId: 'dr-bound',
      confirmToken: 'P5-SY3B-PH',
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Runner 能力查询失败');
    expect(hbSpy).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', exitCode: 1 }),
    );
  });
});

// ─── 4. python-bridge terminate 统一管线 ────────────────────────

describe('P5-SY9E — python-bridge terminate（SIGTERM → SIGKILL）', () => {
  let mockListeners: Record<string, Array<(...args: unknown[]) => void>>;

  function makeMockChild() {
    mockListeners = {};
    const child = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        (mockListeners[event] ??= []).push(handler);
      }),
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      exitCode: null as number | null, // 模拟 Node ChildProcess — null 表示仍在运行
      killed: false,
    };
    bridgeMockState.mockChild = child;
    return child;
  }

  function emit(event: string, ...args: unknown[]) {
    for (const h of mockListeners[event] ?? []) h(...args);
  }

  beforeEach(() => {
    bridgeMockState.mockChild = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('timeout 触发 SIGTERM → exitCode 仍为 null → SIGKILL', async () => {
    // re-import to get fresh module with mock applied
    const { callPythonBridge } = await import('@/lib/python-bridge');
    const child = makeMockChild();

    // 不 await — Promise 一直 pending
    const prom = callPythonBridge(
      { warehouseId: WH_ID, warehouseName: '测试', oldName: '旧名', country: 'VN', token: 'tok', mode: 'dry_run' },
      undefined,
      5, // 5ms timeout
    );

    // timeout 触发 SIGTERM
    await new Promise((r) => setTimeout(r, 30));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // grace 期后 → SIGKILL（exitCode 仍为 null）
    await new Promise((r) => setTimeout(r, 5100));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    emit('close', null);
    await expect(prom).rejects.toThrow('Python bridge 被终止');
    await expect(prom).rejects.toThrow('超时');
  }, 10_000);

  it('abort signal 触发 terminate → SIGTERM → SIGKILL', async () => {
    const { callPythonBridge } = await import('@/lib/python-bridge');
    const child = makeMockChild();
    const ctrl = new AbortController();

    const prom = callPythonBridge(
      { warehouseId: WH_ID, warehouseName: '测试', oldName: '旧名', country: 'VN', token: 'tok', mode: 'dry_run' },
      ctrl.signal,
    );

    ctrl.abort();
    await new Promise((r) => setTimeout(r, 30));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await new Promise((r) => setTimeout(r, 5100));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    emit('close', null);
    await expect(prom).rejects.toThrow('Python bridge 被终止');
    await expect(prom).rejects.toThrow('外部取消');
  }, 10_000);

  it('terminate 幂等 — timeout + abort 同时触发，SIGTERM 仅一次', async () => {
    const { callPythonBridge } = await import('@/lib/python-bridge');
    const child = makeMockChild();
    const ctrl = new AbortController();

    const prom = callPythonBridge(
      { warehouseId: WH_ID, warehouseName: '测试', oldName: '旧名', country: 'VN', token: 'tok', mode: 'dry_run' },
      ctrl.signal,
      5,
    );

    // timeout fires
    await new Promise((r) => setTimeout(r, 30));
    // abort also fires
    ctrl.abort();

    const sigtermCalls = (child.kill as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: string[]) => c[0] === 'SIGTERM').length;
    expect(sigtermCalls).toBe(1);

    await new Promise((r) => setTimeout(r, 5100));
    emit('close', null);
    await expect(prom).rejects.toThrow('Python bridge 被终止');
  }, 10_000);
});

// ─── 5. Lease 过期与并发保护 ────────────────────────────────────

describe('P5-SY9E — lease 过期与并发保护', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('lease 过期后同仓可被后续 claim 回收', async () => {
    const repo = new MockRepository('admin');
    const now = Date.now();

    repo._injectRunDetail('old-run', {
      warehouseId: WH_ID, mode: 'dry_run', status: 'in_progress',
      leaseExpiresAt: new Date(now - 60_000),
      heartbeatAt: new Date(now - 120_000),
      startedAt: new Date(now - 120_000),
      finishedAt: null,
    } as Parameters<typeof repo._injectRunDetail>[1]);

    const result = await repo.claimSyncRun({
      warehouseId: WH_ID, mode: 'dry_run', runId: 'new-run',
      leaseDuration: 300, triggeredBy: TRIGGERED_BY, triggeredFrom: 'web',
    });

    expect(result).toBe('new-run');
    const oldRun = await repo.getDryRunBindingMetadata('old-run');
    expect(oldRun?.status).toBe('failed');
  });

  it('heartbeat 续租后 lease 未过期，同仓无法 claim', async () => {
    const repo = new MockRepository('admin');
    const now = Date.now();

    repo._injectRunDetail('active-run', {
      warehouseId: WH_ID, mode: 'dry_run', status: 'in_progress',
      leaseExpiresAt: new Date(now + 240_000),
      heartbeatAt: new Date(now), startedAt: new Date(now), finishedAt: null,
    } as Parameters<typeof repo._injectRunDetail>[1]);

    const result = await repo.claimSyncRun({
      warehouseId: WH_ID, mode: 'dry_run', runId: 'new-run',
      leaseDuration: 300, triggeredBy: TRIGGERED_BY, triggeredFrom: 'web',
    });
    expect(result).toBeNull();

    await repo.heartbeatSyncRun({ runId: 'active-run', leaseDuration: 300 });
    const updated = await repo.getDryRunBindingMetadata('active-run');
    expect(updated?.status).toBe('in_progress');
  });

  it('heartbeat 对不存在的 run 抛错', async () => {
    const repo = new MockRepository('admin');
    await expect(
      repo.heartbeatSyncRun({ runId: 'nonexistent', leaseDuration: 300 }),
    ).rejects.toThrow('不存在');
  });

  it('heartbeat 对非 in_progress run 抛错', async () => {
    const repo = new MockRepository('admin');
    repo._injectRunDetail('completed-run', {
      warehouseId: WH_ID, mode: 'dry_run', status: 'completed',
    } as Parameters<typeof repo._injectRunDetail>[1]);

    await expect(
      repo.heartbeatSyncRun({ runId: 'completed-run', leaseDuration: 300 }),
    ).rejects.toThrow('只能对 in_progress 运行发送心跳');
  });
});

// ─── 6. heartbeatSyncRun schema 校验 ────────────────────────────

describe('P5-SY9E — heartbeatSyncRun schema', () => {
  it('leaseDuration 必须在 [30, 900] 范围内', async () => {
    const repo = new MockRepository('admin');
    repo._injectRunDetail('test-run', {
      warehouseId: WH_ID, mode: 'dry_run', status: 'in_progress',
    } as Parameters<typeof repo._injectRunDetail>[1]);

    await expect(
      repo.heartbeatSyncRun({ runId: 'test-run', leaseDuration: 10 }),
    ).rejects.toThrow('leaseDuration 必须在 [30, 900] 范围内');

    await expect(
      repo.heartbeatSyncRun({ runId: 'test-run', leaseDuration: 1000 }),
    ).rejects.toThrow('leaseDuration 必须在 [30, 900] 范围内');

    await repo.heartbeatSyncRun({ runId: 'test-run', leaseDuration: 30 });
    await repo.heartbeatSyncRun({ runId: 'test-run', leaseDuration: 900 });
  });
});

// ─── 7. python-bridge 类型检查 ──────────────────────────────────

describe('P5-SY9E — python-bridge 接口', () => {
  it('callPythonBridge 接受 timeoutMs 参数', async () => {
    const { callPythonBridge } = await import('@/lib/python-bridge');
    expect(callPythonBridge).toBeInstanceOf(Function);
    expect(callPythonBridge.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 8. SyncRunner capabilities ─────────────────────────────────

describe('P5-SY9E — SyncRunner capabilities', () => {
  it('RealSyncRunner reports supportsTimeout=true, maxTimeoutMs=600_000', async () => {
    const { RealSyncRunner } = await import('./real-sync-runner');
    const runner = new RealSyncRunner([]);
    const caps = await runner.capabilities();
    expect(caps.supportsTimeout).toBe(true);
    expect(caps.maxTimeoutMs).toBe(600_000);
  });

  it('MockSyncRunner default: supportsTimeout=false, maxTimeoutMs=0', async () => {
    const runner = new MockSyncRunner();
    const caps = await runner.capabilities();
    expect(caps.supportsTimeout).toBe(false);
    expect(caps.maxTimeoutMs).toBe(0);
  });

  it('MockSyncRunner._setCapabilities 覆盖 timeout', async () => {
    const runner = new MockSyncRunner();
    runner._setCapabilities({ supportsTimeout: true, maxTimeoutMs: 30_000 });
    const caps = await runner.capabilities();
    expect(caps.supportsTimeout).toBe(true);
    expect(caps.maxTimeoutMs).toBe(30_000);
  });
});
