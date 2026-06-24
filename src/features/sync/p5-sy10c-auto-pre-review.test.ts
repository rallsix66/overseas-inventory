// P5-SY10C: 自动预审编排 测试
//
// 验证: runAutoPreReview 正确串联 逐仓预取历史 → batch Dry Run → evaluateRules /
// 预取历史不包含当前 Dry Run / session unhealthy 全局阻断 / 单仓失败不影响其他仓 /
// getWarehouseHistory 逐仓调用（在 Dry Run 之前） /
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
    // Inject 3 consecutive failed Dry Runs for WH_PH AFTER deps creation.
    // Pre-run history will see 3 consecutive failures (fetched BEFORE Dry Run).
    // The current batch Dry Run also fails for WH_PH, which adds R4 (dry_run_failed).
    // R5 triggers when consecutiveFailures >= 3 from pre-run history.
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
    // R5 triggers BLOCK when consecutiveFailures >= 3 (from pre-run history)
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
    const deps = buildActionsDeps();
    // Inject a single successful Dry Run as baseline AFTER buildActionsDeps
    // (buildActionsDeps → makeDeps → _resetAll clears static runs)
    const repo = deps.repository as MockRepository;
    injectCompleted(repo, 'baseline-1', WH_PH.id, new Date(Date.now() - 60_000));

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

  it('history data flows into AutoPreReviewItem — uses pre-run history', async () => {
    const deps = buildActionsDeps();
    // Give WH_PH a pre-existing successful baseline AFTER buildActionsDeps
    const repo = deps.repository as MockRepository;
    injectCompleted(repo, 'ph-1', WH_PH.id, new Date(Date.now() - 120_000));
    // WH_VN has no pre-existing history (cold start)

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const ph = result.items.find((i) => i.warehouseId === WH_PH.id);
    // PH has pre-existing baseline from pre-run history
    expect(ph!.history.hasBaseline).toBe(true);
    expect(ph!.history.lastSuccess).not.toBeNull();

    const vn = result.items.find((i) => i.warehouseId === WH_VN.id);
    // VN is cold start — pre-run history has no baseline (fetched BEFORE Dry Run)
    expect(vn!.history.hasBaseline).toBe(false);
    expect(vn!.history.lastSuccess).toBeNull();
    expect(vn!.history.stats).toBeNull();
  });

  it('getWarehouseHistory failure → BLOCK with history_unavailable rule', async () => {
    const repo = new MockRepository('admin');
    repo.getWarehouseHistory = async () => {
      throw new Error('DB 查询失败');
    };

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    // Both warehouses had history fetch failure → both BLOCK
    expect(result.items).toHaveLength(2);

    for (const item of result.items) {
      // Must BLOCK, not cold-start defaults
      expect(item.ruleVerdict.decision).toBe('BLOCK');
      expect(item.ruleVerdict.evaluations).toHaveLength(1);
      expect(item.ruleVerdict.evaluations[0].rule).toBe('history_unavailable');
      expect(item.ruleVerdict.evaluations[0].level).toBe('BLOCK');
      expect(item.ruleVerdict.evaluations[0].message).toContain('历史上下文读取失败');
      // History placeholder values
      expect(item.history.hasBaseline).toBe(false);
    }

    // Both BLOCK, none pass/warn
    expect(result.summary.block).toBe(2);
    expect(result.summary.pass).toBe(0);
    expect(result.summary.warn).toBe(0);
  });

  it('single getWarehouseHistory failure → only that warehouse BLOCKed, others continue', async () => {
    const repo = new MockRepository('admin');
    const origGetWh = repo.getWarehouseHistory.bind(repo);
    repo.getWarehouseHistory = async (whId) => {
      if (whId === WH_TH.id) throw new Error('TH 仓历史查询异常');
      return origGetWh(whId);
    };

    const deps = buildActionsDeps({ repository: repo });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    expect(result.items).toHaveLength(3);

    // TH should be BLOCKed due to history_unavailable
    const th = result.items.find((i) => i.warehouseId === WH_TH.id);
    expect(th!.ruleVerdict.decision).toBe('BLOCK');
    expect(th!.ruleVerdict.evaluations[0].rule).toBe('history_unavailable');
    expect(th!.ruleVerdict.evaluations[0].message).toContain('TH 仓历史查询异常');

    // PH and VN should proceed normally
    const others = result.items.filter((i) => i.warehouseId !== WH_TH.id);
    for (const item of others) {
      expect(item.ruleVerdict.evaluations.every((e) => e.rule !== 'history_unavailable')).toBe(true);
    }

    // Summary: 1 BLOCK (TH), others pass/warn as normal
    expect(result.summary.block).toBeGreaterThanOrEqual(1);
    expect(result.summary.total).toBe(3);
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

  it('cold start (no baseline) → hasBaseline=false, rules evaluate correctly', async () => {
    // Use a repo with NO pre-existing history to simulate true cold start.
    // History is fetched BEFORE the batch Dry Run, so hasBaseline stays false
    // even after a successful Dry Run.
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    const item = result.items[0];
    // Pre-run history: no baseline (fetched BEFORE Dry Run executes)
    expect(item.history.hasBaseline).toBe(false);
    expect(item.history.consecutiveFailures).toBe(0);
    expect(item.history.lastSuccess).toBeNull();
    expect(item.history.stats).toBeNull();
    // Rule verdict exists and is one of PASS/WARN/BLOCK
    // (with default MockSyncRunner values: validSkuCount=91, variantsCreated=1,
    //  invalidSkuCount=0 — no rule thresholds exceeded → PASS)
    expect(['PASS', 'WARN', 'BLOCK']).toContain(item.ruleVerdict.decision);
  });

  it('cold start with high new variant ratio → R7 WARN', async () => {
    // R7: !hasBaseline && validSkuCount > 0 && variantsCreated/validSkuCount > 0.5 → WARN
    const runner = new MockSyncRunner();
    const origExecute = runner.execute.bind(runner);
    runner.execute = async (params) => {
      const result = await origExecute(params);
      if (params.mode === 'dry_run' && result.success) {
        result.summary.variantsCreated = 60;
        if (result.scraperMeta) {
          result.scraperMeta.validSkuCount = 100;
        }
      }
      return result;
    };

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
    expect(item.history.hasBaseline).toBe(false);
    // R7: cold_start_high_new (60/100 = 0.6 > 0.5)
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'cold_start_high_new')).toBe(true);
    // Cold start R7 is WARN only, not BLOCK
    expect(item.ruleVerdict.decision).toBe('WARN');
  });

  it('cold start with high invalid SKU ratio → R11 WARN', async () => {
    // R11: !hasBaseline && rawRowCount > 0 && invalidSkuCount/rawRowCount > 0.3 → WARN
    const runner = new MockSyncRunner();
    const origExecute = runner.execute.bind(runner);
    runner.execute = async (params) => {
      const result = await origExecute(params);
      if (params.mode === 'dry_run' && result.success) {
        result.summary.variantsCreated = 1; // keep low to avoid R7
        if (result.scraperMeta) {
          result.scraperMeta.rawRowCount = 100;
          result.scraperMeta.validSkuCount = 100;
          result.scraperMeta.invalidSkuCount = 40; // 40/100 = 0.4 > 0.3
        }
      }
      return result;
    };

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
    expect(item.history.hasBaseline).toBe(false);
    // R11: high_invalid_sku_cold (40/100 = 0.4 > 0.3)
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'high_invalid_sku_cold')).toBe(true);
    // R11 is WARN only
    expect(item.ruleVerdict.decision).toBe('WARN');
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
    // 3 consecutive failed dry runs from pre-run history
    expect(item.history.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(item.ruleVerdict.decision).toBe('BLOCK');
    expect(item.ruleVerdict.evaluations.some((e) => e.rule === 'consecutive_failures')).toBe(true);
  });

  it('pre-run history excludes current Dry Run record', async () => {
    // Inject a pre-existing completed run with known variantsCreated=5.
    // The batch Dry Run will create a new completed run with variantsCreated=1 (default).
    // Pre-run history stats should reflect ONLY the pre-existing run (avg=5),
    // NOT the current run (which would make avg=3).
    const deps = buildActionsDeps();
    const repo = deps.repository as MockRepository;
    injectCompleted(repo, 'baseline-1', WH_PH.id, new Date('2026-06-23T10:00:00Z'), {
      warehouseId: WH_PH.id,
      warehouseName: WH_PH.name,
      variantsCreated: 5,
      variantsSkipped: 0,
      inventoryInserted: 3,
      inventoryUpdated: 50,
      inventoryUnchanged: 10,
      warehouseRenamed: false,
      rawRowCount: 80,
      validSkuCount: 75,
      invalidSkuCount: 5,
    });

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    // Pre-run history: has baseline from pre-existing run
    expect(item.history.hasBaseline).toBe(true);
    expect(item.history.lastSuccess).not.toBeNull();
    // stats should reflect ONLY the pre-existing run (variantsCreated=5),
    // NOT the current run (variantsCreated=1 default from MockSyncRunner)
    expect(item.history.stats).not.toBeNull();
    expect(item.history.stats!.avgVariantsCreated).toBe(5);
    // rawRowCount from pre-existing run only
    expect(item.history.stats!.avgRawRowCount).toBe(80);
    expect(item.history.stats!.avgValidSkuCount).toBe(75);
    expect(item.history.stats!.avgInvalidSkuCount).toBe(5);
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
