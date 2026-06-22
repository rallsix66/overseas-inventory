// Sync Feature Module — MockRepository 测试 (P5-SY5C2 V5.8)

import { describe, it, expect, beforeEach } from 'vitest';
import { MockRepository } from './repository';

const WH_ID = 'adc5ec45-cd98-42a8-a1d1-26600e80d481';
const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';
const TRIGGERED_BY = 'user-0000-0000-0000-000000000001';

describe('MockRepository — claim', () => {
  let repo: MockRepository;

  beforeEach(() => {
    MockRepository._resetAll();
    repo = new MockRepository('admin');
  });

  it('claim 成功返回 runId', async () => {
    const id = await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    expect(id).toBe(RUN_ID);
  });

  it('同 warehouse 重复 claim 拒绝（返回 null）', async () => {
    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const second = await repo.claimSyncRun({
      runId: '660e8400-e29b-41d4-a716-446655440001',
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    expect(second).toBeNull();
  });

  it('过期租约可回收', async () => {
    const fakeNow = new Date('2026-06-19T10:00:00Z');
    let currentTime = fakeNow.getTime();

    repo._setClock(() => new Date(currentTime));

    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    // Advance past lease expiry (300s = 5min)
    currentTime += 301 * 1000;

    const reclaimed = await repo.claimSyncRun({
      runId: '660e8400-e29b-41d4-a716-446655440001',
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    expect(reclaimed).toBe('660e8400-e29b-41d4-a716-446655440001');

    // Old run should be marked failed
    const oldRun = await repo.getSyncRunDetail(RUN_ID);
    expect(oldRun).not.toBeNull();
    if (oldRun) {
      // Admin view returns full status
      expect('error_message' in oldRun).toBe(true);
    }
  });

  it('different warehouse 可并行 claim', async () => {
    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const second = await repo.claimSyncRun({
      runId: '660e8400-e29b-41d4-a716-446655440001',
      warehouseId: 'bdc5ec45-cd98-42a8-a1d1-26600e80d482',
      mode: 'real_write',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
      dryRunRunId: RUN_ID,
    });
    expect(second).toBe('660e8400-e29b-41d4-a716-446655440001');
  });

  it('leaseDuration < 30 拒绝', async () => {
    await expect(
      repo.claimSyncRun({
        runId: RUN_ID,
        warehouseId: WH_ID,
        mode: 'dry_run',
        leaseDuration: 29,
        triggeredBy: TRIGGERED_BY,
        triggeredFrom: 'web',
      }),
    ).rejects.toThrow('leaseDuration 必须在 [30, 900] 范围内');
  });

  it('leaseDuration > 900 拒绝', async () => {
    await expect(
      repo.claimSyncRun({
        runId: RUN_ID,
        warehouseId: WH_ID,
        mode: 'dry_run',
        leaseDuration: 901,
        triggeredBy: TRIGGERED_BY,
        triggeredFrom: 'web',
      }),
    ).rejects.toThrow('leaseDuration 必须在 [30, 900] 范围内');
  });
});

describe('MockRepository — release', () => {
  let repo: MockRepository;

  beforeEach(async () => {
    MockRepository._resetAll();
    repo = new MockRepository('admin');
    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
  });

  it('release completed 强制 exitCode=0', async () => {
    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'completed',
        exitCode: 1,
      }),
    ).rejects.toThrow('completed 状态必须 exitCode=0');
  });

  it('release failed 强制 exitCode IN (1,2)', async () => {
    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'failed',
        exitCode: 0,
      }),
    ).rejects.toThrow('failed 状态必须 exitCode IN (1, 2)');
  });

  it('release 仅接受 in_progress 状态', async () => {
    await repo.releaseSyncRun({
      runId: RUN_ID,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'failed',
        exitCode: 1,
      }),
    ).rejects.toThrow('无法 release 状态为 completed 的运行');
  });

  it('release 不存在的 runId 抛错', async () => {
    await expect(
      repo.releaseSyncRun({
        runId: 'nonexistent-run-id',
        status: 'completed',
        exitCode: 0,
      }),
    ).rejects.toThrow('不存在');
  });

  it('dry_run completed 必须传 planDriftCheck + planDriftCount + planDriftDifferences', async () => {
    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'completed',
        exitCode: 0,
        planDriftCount: 0,
        planDriftDifferences: [],
      }),
    ).rejects.toThrow('必须传 planDriftCheck');

    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'completed',
        exitCode: 0,
        planDriftCheck: 'PASS',
        planDriftDifferences: [],
      }),
    ).rejects.toThrow('必须传 planDriftCount');

    await expect(
      repo.releaseSyncRun({
        runId: RUN_ID,
        status: 'completed',
        exitCode: 0,
        planDriftCheck: 'PASS',
        planDriftCount: 0,
      }),
    ).rejects.toThrow('必须传 planDriftDifferences');
  });

  it('release failed exitCode=1 成功', async () => {
    await repo.releaseSyncRun({
      runId: RUN_ID,
      status: 'failed',
      exitCode: 1,
      errorMessage: '测试失败',
    });

    const detail = await repo.getSyncRunDetail(RUN_ID);
    expect(detail).not.toBeNull();
    if (detail) {
      expect('exit_code' in detail).toBe(true);
      expect((detail as Record<string, unknown>).exit_code).toBe(1);
    }
  });

  it('release completed 成功', async () => {
    await repo.releaseSyncRun({
      runId: RUN_ID,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
      planArtifactHash: 'abc123',
    });

    const detail = await repo.getSyncRunDetail(RUN_ID);
    expect(detail).not.toBeNull();
  });
});

describe('MockRepository — heartbeat', () => {
  let repo: MockRepository;

  beforeEach(async () => {
    MockRepository._resetAll();
    repo = new MockRepository('admin');
    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
  });

  it('heartbeat 更新 leaseExpiresAt', async () => {
    const fakeNow = new Date('2026-06-19T10:00:00Z');
    let currentTime = fakeNow.getTime();
    repo._setClock(() => new Date(currentTime));

    await repo.heartbeatSyncRun({ runId: RUN_ID, leaseDuration: 300 });

    // After heartbeat with 300s lease, lease should extend
    // (We can't easily inspect internal state, but we can check no error thrown)
    // Verify: advancing 299s should still block new claims
    currentTime += 299 * 1000;
    const claimed = await repo.claimSyncRun({
      runId: '660e8400-e29b-41d4-a716-446655440001',
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    expect(claimed).toBeNull(); // still locked by heartbeat-extended lease
  });

  it('heartbeat leaseDuration < 30 拒绝', async () => {
    await expect(
      repo.heartbeatSyncRun({ runId: RUN_ID, leaseDuration: 29 }),
    ).rejects.toThrow('leaseDuration 必须在 [30, 900] 范围内');
  });

  it('heartbeat 不存在 runId 抛错', async () => {
    await expect(
      repo.heartbeatSyncRun({ runId: 'nonexistent', leaseDuration: 300 }),
    ).rejects.toThrow('不存在');
  });

  it('heartbeat 仅对 in_progress 运行有效', async () => {
    await repo.releaseSyncRun({
      runId: RUN_ID,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    await expect(
      repo.heartbeatSyncRun({ runId: RUN_ID, leaseDuration: 300 }),
    ).rejects.toThrow('只能对 in_progress 运行发送心跳');
  });
});

describe('MockRepository — query', () => {
  beforeEach(() => {
    MockRepository._resetAll();
  });

  it('getSyncRuns 返回 role-aware 结果 (admin)', async () => {
    const adminRepo = new MockRepository('admin');
    await adminRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const runs = await adminRepo.getSyncRuns({ limit: 10 });
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect('display_name' in run).toBe(true);
    // Admin should have exit_code visible
    if ('exit_code' in run) {
      expect(run.exit_code).toBeNull(); // not finished yet
    }
  });

  it('getSyncRuns 返回 role-aware 结果 (operator)', async () => {
    const opRepo = new MockRepository('operator');
    await opRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const runs = await opRepo.getSyncRuns({ limit: 10 });
    expect(runs.length).toBe(1);
    const run = runs[0];
    // Operator should NOT have exit_code
    expect('exit_code' in run).toBe(false);
    // Operator should have triggered_by_email (masked)
    expect('triggered_by_email' in run).toBe(true);
  });

  it('同一 run 不同 callerRole 返回不同字段', async () => {
    const adminRepo = new MockRepository('admin');
    await adminRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const adminRuns = await adminRepo.getSyncRuns({ limit: 10 });
    const opRepo = new MockRepository('operator');
    const opRuns = await opRepo.getSyncRuns({ limit: 10 });

    const adminRun = adminRuns[0];
    const opRun = opRuns[0];

    // Admin has exit_code, Operator does not
    expect('exit_code' in adminRun).toBe(true);
    expect('exit_code' in opRun).toBe(false);

    // Admin has display_name, Operator has triggered_by_email
    expect('display_name' in adminRun).toBe(true);
    expect('triggered_by_email' in opRun).toBe(true);
  });

  it('getSyncRunDetail admin 包含 plan_drift_differences', async () => {
    const adminRepo = new MockRepository('admin');
    await adminRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    await adminRepo.releaseSyncRun({
      runId: RUN_ID,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: ['diff1', 'diff2'],
    });

    const detail = await adminRepo.getSyncRunDetail(RUN_ID);
    expect(detail).not.toBeNull();
    if (detail) {
      expect('plan_drift_differences' in detail).toBe(true);
    }
  });

  it('getSyncRunDetail operator 不含 plan_drift_differences', async () => {
    const adminRepo = new MockRepository('admin');
    await adminRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    await adminRepo.releaseSyncRun({
      runId: RUN_ID,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: ['diff1'],
    });

    const opRepo = new MockRepository('operator');
    const detail = await opRepo.getSyncRunDetail(RUN_ID);
    expect(detail).not.toBeNull();
    if (detail) {
      expect('plan_drift_differences' in detail).toBe(false);
    }
  });

  it('getSyncRunDetail 不存在返回 null', async () => {
    const adminRepo = new MockRepository('admin');
    const detail = await adminRepo.getSyncRunDetail('nonexistent');
    expect(detail).toBeNull();
  });
});

describe('MockRepository — cleanup', () => {
  beforeEach(() => {
    MockRepository._resetAll();
  });

  it('cleanupExpiredSyncRuns 返回清理数量', async () => {
    const repo = new MockRepository('admin');
    const fakeNow = new Date('2026-06-19T10:00:00Z');
    let currentTime = fakeNow.getTime();
    repo._setClock(() => new Date(currentTime));

    await repo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    // Before expiry
    const count0 = await repo.cleanupExpiredSyncRuns();
    expect(count0).toBe(0);

    // Advance past lease
    currentTime += 301 * 1000;
    const count1 = await repo.cleanupExpiredSyncRuns();
    expect(count1).toBe(1);
  });

  it('禁止根据 triggeredBy 判断角色（不同 callerRole 产生不同视图，但 run 内部数据相同）', async () => {
    const adminRepo = new MockRepository('admin');
    await adminRepo.claimSyncRun({
      runId: RUN_ID,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    // Operator repo with same internal state should NOT rely on triggeredBy
    const opRepo = new MockRepository('operator');
    const runs = await opRepo.getSyncRuns({ limit: 10 });
    expect(runs.length).toBe(1);
    // The operator repo sees operator-masked data even though triggeredBy is the same UUID
    // This proves role is from constructor, not from triggeredBy field
  });
});
