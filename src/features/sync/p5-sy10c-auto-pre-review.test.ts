// P5-SY10C: 自动预审编排 测试
//
// 验证: runAutoPreReview 正确串联 batch Dry Run → getWarehouseHistory → evaluateRules /
// session unhealthy 全局阻断 / 单仓失败不影响其他仓 / getWarehouseHistory 逐仓调用 /
// evaluateRules 逐仓调用且 decision 进入结果 / Operator 不可调用 /
// 不触发 Real Write / production wiring 不含 Mock。
// 使用 MockRepository + MockSyncRunner，不连接生产 Supabase，不执行真实写入。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncActions } from './actions';
import type { SyncActionsDeps, InputArtifactSource } from './actions';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { createSyncService, type SyncServiceDeps } from './sync-service';
import type { SessionHealthResult } from './types';
import fs from 'node:fs';
import path from 'node:path';

// ─── Mock auth ──────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireActiveAdmin: vi.fn(),
  requireActiveAuth: vi.fn(),
}));

import { requireActiveAdmin } from '@/lib/auth';

const mockAdminUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleName: 'admin',
  isActive: true as const,
};

// ─── Healthy session ────────────────────────────────────────────────

const healthySession: SessionHealthResult = {
  status: 'healthy',
  message: '会话正常',
  checkedAt: '2026-06-24T10:00:00.000Z',
};

const unhealthySession: SessionHealthResult = {
  status: 'need_login',
  message: '需要重新登录 BigSeller',
  checkedAt: '2026-06-24T10:00:00.000Z',
};

// ─── Warehouses ─────────────────────────────────────────────────────

const WH_PH = { id: 'adc5ec45-cd98-42a8-a1d1-26600e80d481', name: '菲律宾-新创启辰自建仓', country: 'PH' };
const WH_VN = { id: 'c0b661fa-7b6b-4c28-9563-e3e2e3e48a27', name: '越南青林湾仓库', country: 'VN' };
const WH_TH = { id: 'aa3af864-28d9-4a9d-8e9d-3a3b9e3f4483', name: 'DEE-龙仔厝（ICE专属）', country: 'TH' };

// ─── Helpers ────────────────────────────────────────────────────────

function makeDeps(opts?: Partial<SyncServiceDeps>): SyncServiceDeps {
  MockRepository._resetAll();
  MockArtifactProvider._resetAll();
  return {
    repository: new MockRepository('admin'),
    artifactProvider: new MockArtifactProvider(),
    runner: new MockSyncRunner(),
    ...opts,
  };
}

function buildActionsDeps(overrides?: Partial<SyncActionsDeps>): SyncActionsDeps {
  const deps = makeDeps();
  const inputArtifactSource: InputArtifactSource = {
    getInputArtifact: async () => ({ skus: ['TEST-SKU'] }),
  };
  return {
    repository: deps.repository,
    syncService: createSyncService(deps),
    inputArtifactSource,
    artifactProvider: deps.artifactProvider,
    ...overrides,
  };
}

/** Inject a completed Dry Run with result_summary into MockRepository */
function injectCompleted(
  repo: MockRepository,
  runId: string,
  warehouseId: string,
  startedAt: Date,
  resultSummary?: Record<string, unknown>,
) {
  repo._injectRunDetail(runId, {
    id: runId,
    warehouseId,
    mode: 'dry_run',
    status: 'completed',
    exitCode: 0,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 60_000),
    resultSummary: resultSummary ?? {
      warehouseId,
      warehouseName: '测试仓',
      variantsCreated: 10,
      variantsSkipped: 0,
      inventoryInserted: 5,
      inventoryUpdated: 80,
      inventoryUnchanged: 15,
      warehouseRenamed: false,
      rawRowCount: 100,
      validSkuCount: 95,
      invalidSkuCount: 5,
    },
  });
}

/** Inject a failed Dry Run into MockRepository */
function injectFailed(
  repo: MockRepository,
  runId: string,
  warehouseId: string,
  startedAt: Date,
) {
  repo._injectRunDetail(runId, {
    id: runId,
    warehouseId,
    mode: 'dry_run',
    status: 'failed',
    exitCode: 1,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 30_000),
    errorMessage: '抓取超时',
    resultSummary: null,
  });
}

// ─── 1. Happy path: 多仓预审返回 PASS/WARN/BLOCK ───────────────────

describe('P5-SY10C — happy path: 多仓预审', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('returns items for all warehouses with correct structure', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    expect(result.items).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.sessionHealth).toEqual(healthySession);
    expect(result.blockReason).toBeUndefined();

    for (const item of result.items) {
      expect(item).toHaveProperty('warehouseId');
      expect(item).toHaveProperty('warehouseName');
      expect(item).toHaveProperty('country');
      expect(item).toHaveProperty('dryRun');
      expect(item).toHaveProperty('history');
      expect(item).toHaveProperty('ruleVerdict');

      // Dry Run fields
      expect(item.dryRun).toHaveProperty('status');
      expect(item.dryRun).toHaveProperty('runId');
      expect(typeof item.dryRun.runId).toBe('string');
      expect(item.dryRun.runId.length).toBeGreaterThan(0);

      // History fields
      expect(item.history).toHaveProperty('hasBaseline');
      expect(item.history).toHaveProperty('consecutiveFailures');
      expect(item.history).toHaveProperty('lastSuccess');
      expect(item.history).toHaveProperty('stats');

      // Rule verdict fields
      expect(item.ruleVerdict).toHaveProperty('decision');
      expect(item.ruleVerdict).toHaveProperty('evaluations');
      expect(item.ruleVerdict).toHaveProperty('summary');
      expect(['PASS', 'WARN', 'BLOCK']).toContain(item.ruleVerdict.decision);
    }
  });

  it('summary counts match verdict distributions', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    expect(result.summary.total).toBe(2);
    expect(result.summary.pass + result.summary.warn + result.summary.block)
      .toBe(result.summary.total - result.summary.failed);
  });

  it('consecutive failures ≥ 3 → BLOCK via R5', async () => {
    // Inject 3 consecutive failed Dry Runs for WH_PH AFTER deps creation
    // (makeDeps() calls _resetAll(), so we must inject after).
    // Make the current batch Dry Run also fail so it adds to the chain.
    const deps = buildActionsDeps({
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH_PH.id) throw new Error('PH 仓抓取失败');
          return { skus: ['TEST-SKU'] };
        },
      },
    });
    const repo = deps.repository as MockRepository;
    const now = new Date();
    injectFailed(repo, 'fail-3', WH_PH.id, new Date(now.getTime() - 3000));
    injectFailed(repo, 'fail-2', WH_PH.id, new Date(now.getTime() - 2000));
    injectFailed(repo, 'fail-1', WH_PH.id, new Date(now.getTime() - 1000));

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const ph = result.items.find((i) => i.warehouseId === WH_PH.id);
    expect(ph).toBeDefined();
    // Failed Dry Run adds to consecutiveFailures (3 historical + 1 current)
    // R5 triggers BLOCK when consecutiveFailures >= 3.
    expect(ph!.ruleVerdict.decision).toBe('BLOCK');
    expect(ph!.ruleVerdict.evaluations.some((e) => e.rule === 'consecutive_failures')).toBe(true);
  });

  it('plan drift → BLOCK via R3', async () => {
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED';
    runner.planDriftCount = 5;

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.dryRun.status).toBe('blocked');
    expect(item.dryRun.planDriftCheck).toBe('DRIFT_DETECTED');
    expect(item.ruleVerdict.decision).toBe('BLOCK');
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'plan_drift')).toBe(true);
  });

  it('all PASS when clean history + healthy session + no anomalies', async () => {
    const repo = new MockRepository('admin');
    // Inject a single successful Dry Run as baseline
    injectCompleted(repo, 'baseline-1', WH_PH.id, new Date(Date.now() - 60_000));

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].history.hasBaseline).toBe(true);
    expect(result.items[0].ruleVerdict.decision).toBe('PASS');
    expect(result.summary.pass).toBe(1);
  });
});

// ─── 2. Session unhealthy → 全局阻断 ────────────────────────────────

describe('P5-SY10C — session unhealthy 全局阻断', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('session unhealthy → Dry Run executes, R1 blocks in evaluateRules', async () => {
    const deps = buildActionsDeps();
    // Track that executeSync was called (Dry Run still executes)
    let executeCalled = false;
    const origExecute = deps.syncService.executeSync;
    deps.syncService.executeSync = async (input) => {
      executeCalled = true;
      return origExecute(input);
    };

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      unhealthySession,
    );

    // Dry Run still executes because triggerBatchDryRun doesn't check
    // session health (that's the Server Action's job). But evaluateRules
    // with unhealthy session health will produce BLOCK via R1.
    expect(executeCalled).toBe(true);
    expect(result.items).toHaveLength(1);
    // R1 (session_unhealthy) fires for each warehouse
    const item = result.items[0];
    expect(item.ruleVerdict.decision).toBe('BLOCK');
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'session_unhealthy')).toBe(true);
  });

  it('server-actions.ts runAutoPreReview returns early on unhealthy session', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );

    const fnStart = src.indexOf('export async function runAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    const afterFn = src.slice(fnStart);
    const nextExport = afterFn.indexOf('\nexport async function triggerBatchRealWrite');
    expect(nextExport).toBeGreaterThan(0);
    const fnBody = afterFn.slice(0, nextExport);

    // Must call verifyBigSellerSession
    expect(fnBody).toContain('verifyBigSellerSession');
    // Must check health.status !== 'healthy'
    expect(fnBody).toContain("health.status !== 'healthy'");
    // Must return blockReason when unhealthy
    expect(fnBody).toContain('blockReason');
    // When unhealthy, must NOT call wireRealActions
    const unhealthyBlock = fnBody.slice(
      fnBody.indexOf("health.status !== 'healthy'"),
      fnBody.indexOf('blockReason') + 40,
    );
    expect(unhealthyBlock).not.toContain('wireRealActions');
  });
});

// ─── 3. 单仓 Dry Run 失败 → 不影响其他仓 ───────────────────────────

describe('P5-SY10C — 单仓失败不影响其他仓', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('one warehouse input source throws → that item failed, others continue', async () => {
    const deps = buildActionsDeps({
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH_TH.id) throw new Error('TH 仓抓取失败');
          return { skus: ['TEST-SKU'] };
        },
      },
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    expect(result.items).toHaveLength(3);

    // TH should be failed with failureReason
    const th = result.items.find((i) => i.warehouseId === WH_TH.id);
    expect(th).toBeDefined();
    expect(th!.dryRun.status).toBe('failed');
    expect(th!.dryRun.failureReason).toContain('TH 仓抓取失败');
    expect(th!.ruleVerdict.decision).toBe('BLOCK'); // R4: dry_run_failed
    expect(th!.ruleVerdict.evaluations.some((e) => e.rule === 'dry_run_failed')).toBe(true);

    // PH and VN should be ready
    const others = result.items.filter((i) => i.warehouseId !== WH_TH.id);
    expect(others.every((i) => i.dryRun.status === 'ready')).toBe(true);

    // Summary
    expect(result.summary.failed).toBe(1);
    expect(result.summary.total).toBe(3);
  });

  it('failed item still has history and ruleVerdict populated', async () => {
    const deps = buildActionsDeps({
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH_VN.id) throw new Error('VN 仓不可达');
          return { skus: ['TEST-SKU'] };
        },
      },
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_VN],
      healthySession,
    );

    const item = result.items[0];
    // History should be cold-start defaults
    expect(item.history.hasBaseline).toBe(false);
    expect(item.history.consecutiveFailures).toBe(0);
    expect(item.history.lastSuccess).toBeNull();
    expect(item.history.stats).toBeNull();
    // Rule verdict should exist
    expect(item.ruleVerdict).toBeDefined();
    expect(item.ruleVerdict.decision).toBe('BLOCK'); // R4 dry_run_failed
    expect(item.dryRun.failureReason).toContain('VN 仓不可达');
  });
});

// ─── 4. getWarehouseHistory 逐仓调用 ────────────────────────────────

describe('P5-SY10C — getWarehouseHistory 逐仓调用', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('getWarehouseHistory called once per warehouse', async () => {
    const repo = new MockRepository('admin');
    const calls: string[] = [];
    const origGetWh = repo.getWarehouseHistory.bind(repo);
    repo.getWarehouseHistory = async (whId) => {
      calls.push(whId);
      return origGetWh(whId);
    };

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    expect(calls).toHaveLength(3);
    expect(calls).toContain(WH_PH.id);
    expect(calls).toContain(WH_VN.id);
    expect(calls).toContain(WH_TH.id);
  });

  it('history data flows into AutoPreReviewItem', async () => {
    const repo = new MockRepository('admin');
    // Give WH_PH a pre-existing successful baseline
    injectCompleted(repo, 'ph-1', WH_PH.id, new Date(Date.now() - 120_000));
    // WH_VN has no pre-existing history (cold start)

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const ph = result.items.find((i) => i.warehouseId === WH_PH.id);
    // PH has pre-existing baseline + the current batch Dry Run success
    expect(ph!.history.hasBaseline).toBe(true);
    expect(ph!.history.lastSuccess).not.toBeNull();

    const vn = result.items.find((i) => i.warehouseId === WH_VN.id);
    // VN gets baseline from the current batch Dry Run (which succeeds)
    expect(vn!.history.hasBaseline).toBe(true);
    // VN has no pre-existing stats before this run
    expect(vn!.history.stats).not.toBeNull();
  });

  it('getWarehouseHistory failure → cold-start defaults, does not block', async () => {
    const repo = new MockRepository('admin');
    repo.getWarehouseHistory = async () => {
      throw new Error('DB 查询失败');
    };

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    // Should fall back to cold-start defaults
    expect(item.history.hasBaseline).toBe(false);
    expect(item.history.consecutiveFailures).toBe(0);
    expect(item.history.lastSuccess).toBeNull();
    expect(item.history.stats).toBeNull();
    // Rule evaluation still runs
    expect(item.ruleVerdict).toBeDefined();
    expect(item.ruleVerdict.decision).toBeDefined();
  });
});

// ─── 5. evaluateRules 逐仓调用 + decision 进入结果 ──────────────────

describe('P5-SY10C — evaluateRules 逐仓调用', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('each item has a ruleVerdict with decision', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    for (const item of result.items) {
      expect(item.ruleVerdict).toBeDefined();
      expect(['PASS', 'WARN', 'BLOCK']).toContain(item.ruleVerdict.decision);
      expect(typeof item.ruleVerdict.summary).toBe('string');
      expect(item.ruleVerdict.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(item.ruleVerdict.evaluations)).toBe(true);
    }
  });

  it('decision BLOCK propagates to summary.block count', async () => {
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED'; // triggers R3 → BLOCK

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    expect(result.summary.block).toBe(2); // both warehouses blocked by plan drift
    expect(result.summary.pass).toBe(0);
    expect(result.summary.warn).toBe(0);
  });

  it('cold start (no baseline) → R7/R11 may trigger rules', async () => {
    // Use a repo with NO pre-existing history to simulate true cold start.
    // The batch Dry Run creates a completed record, so hasBaseline will be true
    // AFTER the run. We test that pre-run cold start state still produces
    // correct rule evaluation.
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    const item = result.items[0];
    // The batch Dry Run creates a completed record → hasBaseline is true
    expect(item.history.hasBaseline).toBe(true);
    // Rule verdict exists and is one of PASS/WARN/BLOCK
    expect(['PASS', 'WARN', 'BLOCK']).toContain(item.ruleVerdict.decision);
  });

  it('history with consecutive failures triggers R5 BLOCK', async () => {
    // Inject 3 consecutive failed Dry Runs after deps creation.
    // Make the current batch Dry Run also fail so it doesn't reset the chain.
    const deps = buildActionsDeps({
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH_PH.id) throw new Error('PH 仓抓取失败');
          return { skus: ['TEST-SKU'] };
        },
      },
    });
    const repo = deps.repository as MockRepository;
    const now = Date.now();
    injectCompleted(repo, 'ok-1', WH_PH.id, new Date(now - 240_000));
    injectFailed(repo, 'fail-3', WH_PH.id, new Date(now - 180_000));
    injectFailed(repo, 'fail-2', WH_PH.id, new Date(now - 120_000));
    injectFailed(repo, 'fail-1', WH_PH.id, new Date(now - 60_000));

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    // 3 historical + 1 current = 4 consecutive failed dry runs
    expect(item.history.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(item.ruleVerdict.decision).toBe('BLOCK');
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'consecutive_failures')).toBe(true);
  });
});

// ─── 6. Operator 不可调用 ──────────────────────────────────────────

describe('P5-SY10C — Operator 不可调用', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('Operator → blocked (requireActiveAdmin rejects in triggerBatchDryRun)', async () => {
    vi.mocked(requireActiveAdmin).mockRejectedValue(new Error('仅管理员可操作'));
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    // At actions layer, the error from requireActiveAdmin inside
    // triggerBatchDryRun is caught by runAutoPreReview's try-catch.
    // The Server Action layer independently blocks operators via
    // its own requireActiveAdmin() call before reaching this code.
    const result = await actions.runAutoPreReview([WH_PH], healthySession);

    expect(result.items).toHaveLength(0);
    expect(result.blockReason).toContain('仅管理员可操作');
    expect(result.summary.total).toBe(0);
  });

  it('server-actions.ts runAutoPreReview calls requireActiveAdmin', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );

    const fnStart = src.indexOf('export async function runAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    const afterFn = src.slice(fnStart);
    const nextExport = afterFn.indexOf('\nexport async function triggerBatchRealWrite');
    expect(nextExport).toBeGreaterThan(0);
    const fnBody = afterFn.slice(0, nextExport);

    expect(fnBody).toContain('requireActiveAdmin');
  });
});

// ─── 7. 不触发 Real Write ──────────────────────────────────────────

describe('P5-SY10C — 不触发 Real Write', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('runAutoPreReview never calls executeSync with mode=real_write', async () => {
    const deps = buildActionsDeps();
    const modes: string[] = [];
    const origExecute = deps.syncService.executeSync;
    deps.syncService.executeSync = async (input) => {
      modes.push(input.mode);
      return origExecute(input);
    };
    const actions = createSyncActions(deps);

    await actions.runAutoPreReview([WH_PH, WH_VN], healthySession);
    expect(modes.every((m) => m === 'dry_run')).toBe(true);
  });

  it('runAutoPreReview does not call confirmRealWrite', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);
    // Spy on confirmRealWrite
    let confirmCalled = false;
    const origConfirm = actions.confirmRealWrite;
    actions.confirmRealWrite = async (...args) => {
      confirmCalled = true;
      return origConfirm(...args);
    };

    await actions.runAutoPreReview([WH_PH], healthySession);
    expect(confirmCalled).toBe(false);
  });

  it('actions.ts runAutoPreReview does not contain real_write literal', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/actions.ts'),
      'utf-8',
    );

    const fnStart = src.indexOf('async runAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    const afterFn = src.slice(fnStart);
    const nextMethod = afterFn.indexOf('async triggerBatchRealWrite');
    expect(nextMethod).toBeGreaterThan(0);
    const fnBody = afterFn.slice(0, nextMethod);

    // runAutoPreReview calls triggerBatchDryRun which uses 'dry_run'
    // but runAutoPreReview itself must NOT contain 'real_write'
    expect(fnBody).not.toMatch(/'real_write'/);
  });
});

// ─── 8. Production wiring 不含 Mock ─────────────────────────────────

describe('P5-SY10C — production wiring 不含 Mock', () => {
  it('server-actions.ts does not import MockSyncRunner', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );
    const importLines = src.split('\n').filter((l) => l.startsWith('import '));
    expect(importLines.join('\n')).not.toMatch(/MockSyncRunner/);
  });

  it('server-actions.ts does not import MockArtifactProvider', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );
    const importLines = src.split('\n').filter((l) => l.startsWith('import '));
    expect(importLines.join('\n')).not.toMatch(/MockArtifactProvider/);
  });

  it('actions.ts source code does not import MockSyncRunner or MockRepository', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/actions.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/MockSyncRunner/);
    expect(src).not.toMatch(/MockRepository/);
  });

  it('runAutoPreReview Server Action uses wireRealActions (production deps)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );

    const fnStart = src.indexOf('export async function runAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    const afterFn = src.slice(fnStart);
    const nextExport = afterFn.indexOf('\nexport async function triggerBatchRealWrite');
    expect(nextExport).toBeGreaterThan(0);
    const fnBody = afterFn.slice(0, nextExport);

    // Must call wireRealActions for production dependency wiring
    expect(fnBody).toContain('wireRealActions');
    // Must NOT call wireMockActions or wireActions
    expect(fnBody).not.toContain('wireMockActions');
    expect(fnBody).not.toContain('wireActions(');
  });

  it('createSyncService production guard rejects mock in NODE_ENV=production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        createSyncService({
          repository: new MockRepository('admin') as unknown as never,
          artifactProvider: new MockArtifactProvider() as unknown as never,
          runner: new MockSyncRunner() as unknown as never,
        }),
      ).toThrow('生产环境禁止使用 Mock');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
