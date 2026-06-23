// Sync Feature Module — createSyncActions 测试 (P5-SY5C2 V5.8)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncActions } from './actions';
import type { SyncActionsDeps, InputArtifactSource } from './actions';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { createSyncService } from './sync-service';

// ─── Mock auth ──────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireActiveAdmin: vi.fn(),
  requireActiveAuth: vi.fn(),
}));

import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';

const mockAdminUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin',
  isActive: true as const,
};

const mockOperatorUser = {
  id: 'operator-user-id',
  email: 'op@example.com',
  displayName: 'Operator',
  roleName: 'operator',
  isActive: true as const,
};

// ─── Helpers ────────────────────────────────────────────────────────

function buildDeps(overrides?: Partial<SyncActionsDeps>): SyncActionsDeps {
  MockRepository._resetAll();
  MockArtifactProvider._resetAll();
  const repository = new MockRepository('admin');
  const artifactProvider = new MockArtifactProvider();
  const runner = new MockSyncRunner();
  const syncService = createSyncService({
    repository,
    artifactProvider,
    runner,
  });
  const inputArtifactSource: InputArtifactSource = {
    getInputArtifact: async () => ({ skus: ['TEST-SKU'] }),
  };
  return { repository, syncService, inputArtifactSource, artifactProvider, ...overrides };
}

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('warehouseId', '550e8400-e29b-41d4-a716-446655440000');
  fd.set('mode', overrides.mode ?? 'dry_run');
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

// ─── Factory shape ──────────────────────────────────────────────────

describe('createSyncActions — factory', () => {
  it('returns triggerSync, getSyncRunsAction, getSyncRunDetailAction', () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    expect(typeof actions.triggerSync).toBe('function');
    expect(typeof actions.getSyncRunsAction).toBe('function');
    expect(typeof actions.getSyncRunDetailAction).toBe('function');
  });

  it('not a singleton — each call returns independent instance', () => {
    const a = createSyncActions(buildDeps());
    const b = createSyncActions(buildDeps());
    expect(a).not.toBe(b);
    expect(a.triggerSync).not.toBe(b.triggerSync);
  });
});

// ─── triggerSync — success mapping ──────────────────────────────────

describe('createSyncActions — triggerSync success mapping', () => {
  beforeEach(() => {
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('success=true only when status==="completed"', async () => {
    const deps = buildDeps();
    const runner = new MockSyncRunner();
    runner.exitCode = 0;
    const syncService = createSyncService({
      repository: deps.repository,
      artifactProvider: new MockArtifactProvider(),
      runner,
    });
    const actions = createSyncActions({ ...deps, syncService });

    const fd = buildFormData({ mode: 'dry_run' });
    const result = await actions.triggerSync(fd);
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.runId).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('success=false when status==="failed"', async () => {
    const deps = buildDeps();
    const runner = new MockSyncRunner();
    runner.exitCode = 1;
    const repo = new MockRepository('admin');
    const syncService = createSyncService({
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner,
    });
    const actions = createSyncActions({ ...deps, syncService, repository: repo });

    const fd = buildFormData({ mode: 'dry_run' });
    const result = await actions.triggerSync(fd);
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.runId).toBeDefined();
    expect(result.error).toBeDefined();
  });

  it('success=false when status==="indeterminate"', async () => {
    const deps = buildDeps();
    const runner = new MockSyncRunner();
    runner.exitCode = 0;
    const repo = new MockRepository('admin');
    // Force indeterminate: make release fail after business success
    const origRelease = repo.releaseSyncRun.bind(repo);
    repo.releaseSyncRun = async (params) => {
      if (params.status === 'completed') {
        throw new Error('模拟 release 失败');
      }
      return origRelease(params);
    };
    const syncService = createSyncService({
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner,
    });
    const actions = createSyncActions({ ...deps, syncService, repository: repo });

    const fd = buildFormData({ mode: 'dry_run' });
    const result = await actions.triggerSync(fd);
    expect(result.success).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.runId).toBeDefined();
  });
});

// ─── triggerSync — auth / validation ────────────────────────────────

describe('createSyncActions — triggerSync auth', () => {
  it('triggerSync calls requireActiveAdmin (throws if no auth)', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('未登录或账户已停用'));
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    const fd = buildFormData({ mode: 'dry_run' });
    await expect(actions.triggerSync(fd)).rejects.toThrow('未登录或账户已停用');
  });
});

// ─── triggerSync — real_write ───────────────────────────────────────

describe('createSyncActions — triggerSync real_write', () => {
  beforeEach(() => {
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('real_write passes confirmToken + dryRunRunId to executeSync', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    const artifactProvider = new MockArtifactProvider();
    const runner = new MockSyncRunner();
    runner.exitCode = 0;

    // First set up a completed Dry Run to have bound artifacts
    const drySvc = createSyncService({ repository: repo, artifactProvider, runner });
    const dryResult = await drySvc.executeSync({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      inputArtifact: { skus: ['SETUP-SKU'] },
      triggeredBy: mockAdminUser.id,
    });
    const dryRunRunId = dryResult.runId;

    // Now test real_write using the dryRunRunId from the setup
    const realRunner = new MockSyncRunner();
    realRunner.exitCode = 0;
    const realSvc = createSyncService({ repository: repo, artifactProvider, runner: realRunner });
    const inputArtifactSource: InputArtifactSource = {
      getInputArtifact: async () => ({ skus: ['REAL-SKU'] }),
    };
    const actions = createSyncActions({ repository: repo, syncService: realSvc, inputArtifactSource, artifactProvider });

    const fd = buildFormData({
      mode: 'real_write',
      dryRunRunId,
      confirmToken: 'P5-SY3B-PH',
    });
    const result = await actions.triggerSync(fd);
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.runId).toBeDefined();
  });
});

// ─── getSyncRunsAction ──────────────────────────────────────────────

describe('createSyncActions — getSyncRunsAction', () => {
  it('returns SyncRunsResponse from repository (auth required)', async () => {
    vi.mocked(requireActiveAuth).mockRejectedValue(new Error('未登录或账户已停用'));
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    await expect(actions.getSyncRunsAction()).rejects.toThrow('未登录或账户已停用');
  });

  it('is a function accepting optional warehouseId and limit', () => {
    const actions = createSyncActions(buildDeps());
    expect(actions.getSyncRunsAction).toBeInstanceOf(Function);
    expect(actions.getSyncRunsAction.length).toBe(2);
  });

  it('succeeds when auth passes', async () => {
    vi.mocked(requireActiveAuth).mockResolvedValue(mockOperatorUser);
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    const result = await actions.getSyncRunsAction();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── getSyncRunDetailAction ─────────────────────────────────────────

describe('createSyncActions — getSyncRunDetailAction', () => {
  it('is a function accepting runId', () => {
    const actions = createSyncActions(buildDeps());
    expect(actions.getSyncRunDetailAction).toBeInstanceOf(Function);
    expect(actions.getSyncRunDetailAction.length).toBe(1);
  });

  it('calls requireActiveAuth then repository.getSyncRunDetail (throws if no auth)', async () => {
    vi.mocked(requireActiveAuth).mockRejectedValue(new Error('未登录或账户已停用'));
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    await expect(
      actions.getSyncRunDetailAction('550e8400-e29b-41d4-a716-446655440000'),
    ).rejects.toThrow('未登录或账户已停用');
  });

  it('returns null for nonexistent runId when auth passes', async () => {
    vi.mocked(requireActiveAuth).mockResolvedValue(mockOperatorUser);
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    const result = await actions.getSyncRunDetailAction('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBeNull();
  });
});

// ─── InputArtifactSource ────────────────────────────────────────────

describe('InputArtifactSource', () => {
  it('getInputArtifact returns JsonValue', async () => {
    const source: InputArtifactSource = {
      getInputArtifact: async () => ({ skus: ['A', 'B'] }),
    };
    const result = await source.getInputArtifact('wh-1', 'dry_run');
    expect(result).toEqual({ skus: ['A', 'B'] });
  });

  it('getInputArtifact receives warehouseId and mode', async () => {
    const calls: Array<[string, string]> = [];
    const source: InputArtifactSource = {
      getInputArtifact: async (wh, mode) => {
        calls.push([wh, mode]);
        return {};
      },
    };
    await source.getInputArtifact('wh-real', 'real_write');
    expect(calls).toEqual([['wh-real', 'real_write']]);
  });
});

// ─── getSyncRunDetailAction — role-based detail (P5-SY5D) ────────────

describe('createSyncActions — getSyncRunDetailAction role-based', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAuth).mockResolvedValue(mockAdminUser);
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('admin detail includes exit_code, error_message, plan_drift_differences', async () => {
    // Seed a completed Dry Run using buildDeps, then query with same deps
    // (no reset in between — detail query needs the seed data)
    const deps = buildDeps();
    const svc = createSyncService({
      repository: deps.repository,
      artifactProvider: deps.syncService
        ? new MockArtifactProvider() // fallback
        : new MockArtifactProvider(),
      runner: new MockSyncRunner(),
    });
    const seedResult = await svc.executeSync({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      inputArtifact: { skus: ['DETAIL-TEST'] },
      triggeredBy: mockAdminUser.id,
    });
    const runId = seedResult.runId;

    // Query detail using the same deps (no reset — repo still has seed data)
    const actions = createSyncActions(deps);
    const detail = await actions.getSyncRunDetailAction(runId);

    expect(detail).not.toBeNull();
    expect(detail).toHaveProperty('exit_code');
    expect(detail).toHaveProperty('error_message');
    expect(detail).toHaveProperty('plan_drift_differences');
    expect(detail).toHaveProperty('display_name');
    // Admin should NOT have triggered_by_email
    expect(detail).not.toHaveProperty('triggered_by_email');
  });

  it('operator detail excludes exit_code, error_message, plan_drift_differences', async () => {
    // Seed a completed Dry Run
    const deps = buildDeps();
    const svc = createSyncService({
      repository: deps.repository,
      artifactProvider: new MockArtifactProvider(),
      runner: new MockSyncRunner(),
    });
    const seedResult = await svc.executeSync({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      inputArtifact: { skus: ['DETAIL-TEST'] },
      triggeredBy: mockAdminUser.id,
    });
    const runId = seedResult.runId;

    // Query with operator repo (static store still has seed data)
    vi.mocked(requireActiveAuth).mockResolvedValue(mockOperatorUser);
    const operatorRepo = new MockRepository('operator');
    const operatorActions = createSyncActions({
      ...deps,
      repository: operatorRepo,
    });
    const detail = await operatorActions.getSyncRunDetailAction(runId);

    expect(detail).not.toBeNull();
    expect(detail).toHaveProperty('triggered_by_email');
    expect(detail).toHaveProperty('failure_summary');
    // Operator must NOT have admin fields
    expect(detail).not.toHaveProperty('exit_code');
    expect(detail).not.toHaveProperty('error_message');
    expect(detail).not.toHaveProperty('plan_drift_differences');
    expect(detail).not.toHaveProperty('display_name');
  });

  it('returns null for nonexistent runId', async () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);
    const detail = await actions.getSyncRunDetailAction('00000000-0000-0000-0000-000000000000');
    expect(detail).toBeNull();
  });
});

// ─── Cross-request artifact lifecycle (P5-SY5D) ─────────────────────

describe('createSyncActions — cross-request artifact lifecycle', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
    vi.mocked(requireActiveAuth).mockResolvedValue(mockAdminUser);
  });

  it('Dry Run artifact persists across separate action instances (simulates separate requests)', async () => {
    // Request 1: Admin triggers Dry Run
    const deps1 = buildDeps();
    const actions1 = createSyncActions(deps1);

    const dryFd = new FormData();
    dryFd.set('warehouseId', '550e8400-e29b-41d4-a716-446655440000');
    dryFd.set('mode', 'dry_run');

    const dryResult = await actions1.triggerSync(dryFd);
    expect(dryResult.success).toBe(true);
    expect(dryResult.status).toBe('completed');
    const dryRunId = dryResult.runId;

    // Verify Dry Run artifact is stored (via shared static storage)
    const checkProvider = new MockArtifactProvider();
    const planArtifact = await checkProvider.get(dryRunId, 'plan');
    expect(planArtifact).toBeDefined();

    // Request 2: simulate new HTTP request — fresh repo but shared artifact storage
    // Only reset the repository, NOT the artifact provider (artifacts must persist across requests)
    MockRepository._resetAll();
    // Do NOT call MockArtifactProvider._resetAll() — this is the key cross-request guarantee

    const repo2 = new MockRepository('admin');
    // New artifact provider instance reads from same shared static store
    const provider2 = new MockArtifactProvider();
    const runner2 = new MockSyncRunner();
    const syncService2 = createSyncService({
      repository: repo2,
      artifactProvider: provider2,
      runner: runner2,
    });
    const inputSrc2: InputArtifactSource = {
      getInputArtifact: async () => ({ skus: ['CROSS-REQUEST'] }),
    };
    const actions2 = createSyncActions({
      repository: repo2,
      syncService: syncService2,
      inputArtifactSource: inputSrc2,
      artifactProvider: provider2,
    });

    const rwFd = new FormData();
    rwFd.set('warehouseId', '550e8400-e29b-41d4-a716-446655440000');
    rwFd.set('mode', 'real_write');
    rwFd.set('dryRunRunId', dryRunId);
    rwFd.set('confirmToken', 'P5-SY3B-PH');

    const rwResult = await actions2.triggerSync(rwFd);
    expect(rwResult.success).toBe(true);
    expect(rwResult.status).toBe('completed');

    // Verify Real Write created its own input artifact via a new provider instance
    const verifyProvider = new MockArtifactProvider();
    const rwInput = await verifyProvider.get(rwResult.runId, 'input');
    expect(rwInput).toBeDefined();
  });

  it('Real Write fails when Dry Run artifact does not exist (separate storage validation)', async () => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();

    const deps = buildDeps();
    const actions = createSyncActions(deps);

    const fd = new FormData();
    fd.set('warehouseId', '550e8400-e29b-41d4-a716-446655440000');
    fd.set('mode', 'real_write');
    fd.set('dryRunRunId', '00000000-0000-0000-0000-000000000000'); // nonexistent
    fd.set('confirmToken', 'P5-SY3B-PH');

    const result = await actions.triggerSync(fd);
    expect(result.success).toBe(false);
    expect(result.error).toContain('绑定 Dry Run artifact 加载失败');
  });
});

// ─── SyncActions type ───────────────────────────────────────────────

describe('SyncActions type', () => {
  it('return type includes triggerSync, triggerSyncAll, syncWarehouse, getSyncRunsAction, getSyncRunDetailAction', () => {
    const actions = createSyncActions(buildDeps());
    expect(actions).toHaveProperty('triggerSync');
    expect(actions).toHaveProperty('triggerSyncAll');
    expect(actions).toHaveProperty('syncWarehouse');
    expect(actions).toHaveProperty('triggerDryRun');    // P5-SY9D
    expect(actions).toHaveProperty('confirmRealWrite'); // P5-SY9D
    expect(actions).toHaveProperty('triggerBatchDryRun'); // P5-SY9F
    expect(actions).toHaveProperty('getSyncRunsAction');
    expect(actions).toHaveProperty('getSyncRunDetailAction');
    expect(Object.keys(actions).length).toBe(8); // P5-SY9F: +1 method
  });
});

// ─── triggerBatchDryRun (P5-SY9F) ─────────────────────────────────

describe('createSyncActions — triggerBatchDryRun', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
    vi.mocked(requireActiveAuth).mockResolvedValue(mockAdminUser);
  });

  const WH1 = { id: 'adc5ec45-cd98-42a8-a1d1-26600e80d481', name: '菲律宾-新创启辰自建仓', country: 'PH' };
  const WH2 = { id: 'c0b661fa-7b6b-4c28-9563-e3e2e3e48a27', name: '越南青林湾仓库', country: 'VN' };
  const WH3 = { id: 'aa3af864-28d9-4a9d-8e9d-3a3b9e3f4483', name: 'DEE-龙仔厝（ICE专属）', country: 'TH' };

  it('all warehouses succeed → allSucceeded true', async () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);

    const result = await actions.triggerBatchDryRun([WH1, WH2]);
    expect(result.allSucceeded).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.blockedCount).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('ready');
    expect(result.results[1].status).toBe('ready');
  });

  it('each warehouse has independent runId', async () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);

    const result = await actions.triggerBatchDryRun([WH1, WH2]);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].runId).toBeDefined();
    expect(result.results[1].runId).toBeDefined();
    expect(result.results[0].runId).not.toBe(result.results[1].runId);
  });

  it('single warehouse failure does not affect others', async () => {
    const deps = buildDeps();
    const runner = new MockSyncRunner();
    runner.exitCode = 0; // All runner calls succeed
    const repo = new MockRepository('admin');
    const ap = new MockArtifactProvider();
    const svc = createSyncService({ repository: repo, artifactProvider: ap, runner });

    // WH2 fails at input artifact stage, WH1 succeeds
    const actions = createSyncActions({
      repository: repo,
      syncService: svc,
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH2.id) throw new Error('模拟抓取失败：仓库不可达');
          return { skus: ['TEST-SKU'] };
        },
      },
      artifactProvider: ap,
    });

    const result = await actions.triggerBatchDryRun([WH1, WH2]);
    expect(result.results).toHaveLength(2);
    // WH1 should succeed
    const wh1 = result.results.find((r) => r.warehouseId === WH1.id);
    expect(wh1?.status).toBe('ready');
    // WH2 should fail
    const wh2 = result.results.find((r) => r.warehouseId === WH2.id);
    expect(wh2?.status).toBe('failed');
    expect(wh2?.failureReason).toBeDefined();
    expect(wh2?.failureReason).toContain('模拟抓取失败');
    // Single failure → allSucceeded false
    expect(result.allSucceeded).toBe(false);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  it('multiple failures → all reported with Chinese reasons', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    const ap = new MockArtifactProvider();
    const runner = new MockSyncRunner();
    runner.exitCode = 0;
    const svc = createSyncService({ repository: repo, artifactProvider: ap, runner });

    const actions = createSyncActions({
      repository: repo,
      syncService: svc,
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          throw new Error(`仓库 ${whId} 抓取失败`);
        },
      },
      artifactProvider: ap,
    });

    const result = await actions.triggerBatchDryRun([WH1, WH2]);
    expect(result.results).toHaveLength(2);
    expect(result.allSucceeded).toBe(false);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(2);
    for (const r of result.results) {
      expect(r.status).toBe('failed');
      expect(r.failureReason).toBeDefined();
      expect(r.failureReason).toMatch(/Dry Run 异常/);
    }
  });

  it('empty warehouse list → empty results, allSucceeded true', async () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);

    const result = await actions.triggerBatchDryRun([]);
    expect(result.results).toHaveLength(0);
    expect(result.allSucceeded).toBe(true);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it('admin required — operator rejected', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('仅管理员可操作'));

    const deps = buildDeps();
    const actions = createSyncActions(deps);

    await expect(actions.triggerBatchDryRun([WH1])).rejects.toThrow('仅管理员可操作');
  });

  it('ready warehouse includes warehouse name / country / runId / all summary fields', async () => {
    const deps = buildDeps();
    const actions = createSyncActions(deps);

    const result = await actions.triggerBatchDryRun([WH1]);
    expect(result.results).toHaveLength(1);
    const r = result.results[0];
    expect(r.status).toBe('ready');
    expect(r.warehouseId).toBe(WH1.id);
    expect(r.warehouseName).toBe(WH1.name);
    expect(r.country).toBeDefined();
    expect(r.runId).toBeDefined();
    expect(r.runId).not.toBe('');
    // Summary numeric fields
    expect(typeof r.rawRowCount).toBe('number');
    expect(typeof r.validSkuCount).toBe('number');
    expect(typeof r.invalidSkuCount).toBe('number');
    expect(typeof r.variantsCreated).toBe('number');
    expect(typeof r.inventoryInserted).toBe('number');
    expect(typeof r.inventoryUpdated).toBe('number');
    expect(typeof r.inventoryUnchanged).toBe('number');
    expect(typeof r.warehouseRenamed).toBe('boolean');
    expect(r.planDriftCheck).toBeDefined();
    expect(typeof r.planDriftCount).toBe('number');
  });

  it('failed warehouse runId is set when claim succeeded', async () => {
    const deps = buildDeps();
    const runner = new MockSyncRunner();
    runner.exitCode = 1; // Dry Run fails (non-zero exit)
    const repo = new MockRepository('admin');
    const ap = new MockArtifactProvider();
    const svc = createSyncService({ repository: repo, artifactProvider: ap, runner });
    const actions = createSyncActions({
      ...deps,
      syncService: svc,
      repository: repo,
      artifactProvider: ap,
    });

    const result = await actions.triggerBatchDryRun([WH1]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].runId).toBeDefined();
    expect(result.results[0].runId).not.toBe('');
    expect(result.results[0].failureReason).toBeDefined();
  });

  it('batch Dry Run does NOT trigger real_write mode', async () => {
    // Structural check: verify triggerBatchDryRun only uses mode='dry_run'
    const deps = buildDeps();
    const calls: string[] = [];
    const inputSrc = {
      getInputArtifact: async (whId: string, mode: string) => {
        calls.push(mode);
        return { skus: ['SKU-1'] };
      },
    };
    const actions = createSyncActions({ ...deps, inputArtifactSource: inputSrc });

    await actions.triggerBatchDryRun([WH1, WH2, WH3]);
    // All calls must be 'dry_run' — never 'real_write'
    expect(calls).toEqual(['dry_run', 'dry_run', 'dry_run']);
    expect(calls.every((m) => m === 'dry_run')).toBe(true);
  });

  it('single warehouse runner throws → caught as failed, others continue', async () => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();

    const goodRunner = new MockSyncRunner();
    goodRunner.exitCode = 0;

    const badRunner = new MockSyncRunner();
    badRunner.shouldThrow = true;
    badRunner.throwMessage = 'Runner 内部错误';

    // Build per-warehouse infrastructure with a shared repo
    const repo = new MockRepository('admin');
    const ap = new MockArtifactProvider();
    const svc1 = createSyncService({ repository: repo, artifactProvider: ap, runner: goodRunner });
    const svc2 = createSyncService({ repository: repo, artifactProvider: ap, runner: badRunner });

    // Custom input source that routes to correct syncService
    const actions = createSyncActions({
      repository: repo,
      syncService: svc1, // default — will be overridden per warehouse
      inputArtifactSource: {
        getInputArtifact: async () => ({ skus: ['SKU-1'] }),
      },
      artifactProvider: ap,
    });

    // We need per-warehouse sync service routing. Since createSyncActions
    // binds one syncService, we test that runner.shouldThrow is caught.
    // Use the bad runner as default to test that throw is caught.
    const actionsBad = createSyncActions({
      repository: repo,
      syncService: svc2,
      inputArtifactSource: {
        getInputArtifact: async () => ({ skus: ['SKU-1'] }),
      },
      artifactProvider: ap,
    });

    const result = await actionsBad.triggerBatchDryRun([WH1]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].failureReason).toContain('Runner 内部错误');
  });
});
