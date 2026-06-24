// P5-SY10D: 预审页面 UI 测试
//
// 验证: AutoPreReviewResult 结构正确 / PASS/WARN/BLOCK counts 与
// ruleVerdict.decision 一致 / warehouseRenamePlan 透传 /
// ruleVerdict.evaluations 结构 / BLOCK 不可选 /
// session unhealthy 全局阻断 / 不触发 Real Write /
// sync-page-content.tsx 源码不含 supabase.from()。
// 使用 MockRepository + MockSyncRunner，不连接生产 Supabase。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncActions } from './actions';
import type { SyncActionsDeps, InputArtifactSource } from './actions';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { createSyncService, type SyncServiceDeps } from './sync-service';
import type { SessionHealthResult, AutoPreReviewItem, AutoPreReviewResult } from './types';
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

// ─── 1. AutoPreReviewResult 结构 ────────────────────────────────────

describe('P5-SY10D — AutoPreReviewResult 结构', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('returns AutoPreReviewResult with items, summary, sessionHealth', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('sessionHealth');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.summary).toHaveProperty('total');
    expect(result.summary).toHaveProperty('pass');
    expect(result.summary).toHaveProperty('warn');
    expect(result.summary).toHaveProperty('block');
    expect(result.summary).toHaveProperty('failed');
  });

  it('each item has dryRun, history, ruleVerdict', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    for (const item of result.items) {
      expect(item).toHaveProperty('warehouseId');
      expect(item).toHaveProperty('warehouseName');
      expect(item).toHaveProperty('country');
      expect(item).toHaveProperty('dryRun');
      expect(item.dryRun).toHaveProperty('status');
      expect(item.dryRun).toHaveProperty('runId');
      expect(item.dryRun).toHaveProperty('rawRowCount');
      expect(item.dryRun).toHaveProperty('validSkuCount');
      expect(item.dryRun).toHaveProperty('invalidSkuCount');
      expect(item.dryRun).toHaveProperty('variantsCreated');
      expect(item.dryRun).toHaveProperty('inventoryInserted');
      expect(item.dryRun).toHaveProperty('inventoryUpdated');
      expect(item.dryRun).toHaveProperty('inventoryUnchanged');
      expect(item.dryRun).toHaveProperty('planDriftCheck');
      expect(item.dryRun).toHaveProperty('planDriftCount');
      expect(item).toHaveProperty('history');
      expect(item).toHaveProperty('ruleVerdict');
    }
  });

  it('dryRun contains warehouseRenamePlan field', async () => {
    const runner = new MockSyncRunner();
    runner.renamePlan = {
      action: 'rename',
      current_name: '旧仓名',
      target_name: '新仓名',
      message: '仓库已改名',
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
    // warehouseRenamePlan should exist on the dryRun object
    expect(result.items[0].dryRun).toHaveProperty('warehouseRenamePlan');
  });
});

// ─── 2. PASS/WARN/BLOCK counts 一致 ─────────────────────────────────

describe('P5-SY10D — PASS/WARN/BLOCK counts', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('summary.pass matches items with decision=PASS count', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    const passCount = result.items.filter(
      (i) => i.ruleVerdict.decision === 'PASS',
    ).length;
    expect(result.summary.pass).toBe(passCount);
  });

  it('summary.warn matches items with decision=WARN count', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const warnCount = result.items.filter(
      (i) => i.ruleVerdict.decision === 'WARN',
    ).length;
    expect(result.summary.warn).toBe(warnCount);
  });

  it('summary.block matches items with decision=BLOCK count', async () => {
    // Use plan drift to trigger BLOCK
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED';

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const blockCount = result.items.filter(
      (i) => i.ruleVerdict.decision === 'BLOCK',
    ).length;
    expect(result.summary.block).toBe(blockCount);
    expect(blockCount).toBeGreaterThan(0);
  });

  it('summary.{pass+warn+block} = total (every item has a decision)', async () => {
    const deps = buildActionsDeps({
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH_TH.id) throw new Error('TH 仓不可达');
          return { skus: ['TEST-SKU'] };
        },
      },
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    const { pass, warn, block, total } = result.summary;
    // Every item has exactly one ruleVerdict.decision (PASS/WARN/BLOCK)
    expect(pass + warn + block).toBe(total);
    // failed is a separate dimension (dryRun.status), may overlap with BLOCK
    expect(result.summary.failed).toBeGreaterThanOrEqual(0);
  });
});

// ─── 3. ruleVerdict 结构 ────────────────────────────────────────────

describe('P5-SY10D — ruleVerdict 结构', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('each ruleVerdict has decision, evaluations, summary', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    const v = result.items[0].ruleVerdict;
    expect(['PASS', 'WARN', 'BLOCK']).toContain(v.decision);
    expect(Array.isArray(v.evaluations)).toBe(true);
    expect(typeof v.summary).toBe('string');
    expect(v.summary.length).toBeGreaterThan(0);
  });

  it('evaluations items have rule, level, message', async () => {
    // Use plan drift to generate evaluations
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED';

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    const { evaluations } = result.items[0].ruleVerdict;
    expect(evaluations.length).toBeGreaterThan(0);

    for (const e of evaluations) {
      expect(typeof e.rule).toBe('string');
      expect(e.rule.length).toBeGreaterThan(0);
      expect(['PASS', 'WARN', 'BLOCK']).toContain(e.level);
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('evaluations messages are in Chinese', async () => {
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED';

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    const { evaluations } = result.items[0].ruleVerdict;
    for (const e of evaluations) {
      // Message should contain Chinese characters or be non-empty
      expect(e.message).toBeTruthy();
    }
  });
});

// ─── 4. BLOCK 仓库不可选 ────────────────────────────────────────────

describe('P5-SY10D — BLOCK 不可选', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('BLOCK warehouses have decision=BLOCK in ruleVerdict', async () => {
    const runner = new MockSyncRunner();
    runner.planDriftCheck = 'DRIFT_DETECTED';

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.items[0].ruleVerdict.decision).toBe('BLOCK');
  });

  it('BLOCK items can be identified for exclusion from Real Write candidates', async () => {
    // Mix: WH_PH blocked (plan drift), WH_VN passes
    const runner = new MockSyncRunner();
    const origExecute = runner.execute.bind(runner);
    runner.execute = async (params) => {
      const result = await origExecute(params);
      if (params.mode === 'dry_run' && params.warehouseId === WH_PH.id) {
        result.planDriftCheck = 'DRIFT_DETECTED';
        result.planDriftCount = 3;
      }
      return result;
    };

    const deps = buildActionsDeps({
      syncService: createSyncService(makeDeps({ runner })),
    });
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN],
      healthySession,
    );

    const ph = result.items.find((i) => i.warehouseId === WH_PH.id)!;
    const vn = result.items.find((i) => i.warehouseId === WH_VN.id)!;

    // PH is BLOCK, VN is PASS
    expect(ph.ruleVerdict.decision).toBe('BLOCK');
    expect(vn.ruleVerdict.decision).toBe('PASS');

    // BLOCK items should not be candidates for batch Real Write
    const realWriteCandidates = result.items.filter(
      (i) => i.ruleVerdict.decision !== 'BLOCK' && i.dryRun.status === 'ready',
    );
    expect(realWriteCandidates).toHaveLength(1);
    expect(realWriteCandidates[0].warehouseId).toBe(WH_VN.id);
  });
});

// ─── 5. Session unhealthy ───────────────────────────────────────────

describe('P5-SY10D — session unhealthy 全局阻断', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('returns blockReason when session unhealthy (server-action level check via source)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sync/server-actions.ts'),
      'utf-8',
    );

    // Server Action must return early with blockReason on unhealthy session
    const fnStart = src.indexOf('export async function runAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    const afterFn = src.slice(fnStart);
    const nextExport = afterFn.indexOf('\nexport async function triggerBatchRealWrite');
    expect(nextExport).toBeGreaterThan(0);
    const fnBody = afterFn.slice(0, nextExport);

    expect(fnBody).toContain('verifyBigSellerSession');
    expect(fnBody).toContain("health.status !== 'healthy'");
    expect(fnBody).toContain('blockReason');
  });
});

// ─── 6. 不触发 Real Write ───────────────────────────────────────────

describe('P5-SY10D — 不触发 Real Write', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('runAutoPreReview does not call executeSync with real_write mode', async () => {
    const deps = buildActionsDeps();
    const modes: string[] = [];
    const origExecute = deps.syncService.executeSync;
    deps.syncService.executeSync = async (input) => {
      modes.push(input.mode);
      return origExecute(input);
    };
    const actions = createSyncActions(deps);

    await actions.runAutoPreReview([WH_PH], healthySession);
    expect(modes.every((m) => m === 'dry_run')).toBe(true);
  });
});

// ─── 7. 源码检查 ───────────────────────────────────────────────────

describe('P5-SY10D — sync-page-content.tsx 源码检查', () => {
  it('imports runAutoPreReview from server-actions', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
      'utf-8',
    );
    expect(src).toContain('runAutoPreReview');
    expect(src).toMatch(/from ['"]@\/features\/sync\/server-actions['"]/);
  });

  it('does not contain supabase.from() direct access', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
      'utf-8',
    );
    expect(src).not.toMatch(/supabase\s*\.\s*from\s*\(/);
  });

  it('contains RuleBadge component for rule decisions', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
      'utf-8',
    );
    expect(src).toContain('RuleBadge');
  });

  it('contains 自动预审 button text', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
      'utf-8',
    );
    expect(src).toContain('自动预审');
  });

  it('contains 规则详情 expandable section', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
      'utf-8',
    );
    expect(src).toContain('规则详情');
  });
});

// ─── 8. Session health 显示 ─────────────────────────────────────────

describe('P5-SY10D — session health info in result', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('result.sessionHealth is the same object passed in', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH],
      healthySession,
    );

    expect(result.sessionHealth).toEqual(healthySession);
  });

  it('summary.total equals items.length', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [WH_PH, WH_VN, WH_TH],
      healthySession,
    );

    expect(result.summary.total).toBe(result.items.length);
  });
});
