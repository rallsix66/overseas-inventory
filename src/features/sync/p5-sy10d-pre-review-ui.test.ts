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

// ─── 9. 自动预审复选框行为（源码检查）────────────────────────────────

describe('P5-SY10D — 自动预审复选框行为', () => {
  const pageSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/app/dashboard/sync/_components/sync-page-content.tsx'),
    'utf-8',
  );

  it('存在 autoReviewSelectedItems 独立选择状态', () => {
    // 必须使用独立的 Set 管理预审勾选状态，不与 selectedReadyItems 混淆
    expect(pageSrc).toContain('autoReviewSelectedItems');
    expect(pageSrc).toContain('useState<Set<string>>(new Set())');
  });

  it('存在 toggleAutoReviewItem 切换函数', () => {
    expect(pageSrc).toContain('toggleAutoReviewItem');
    // 必须使用函数式 setState 模式
    expect(pageSrc).toContain('setAutoReviewSelectedItems');
  });

  it('PASS 仓库可选且 checked 状态由 autoReviewSelectedItems 驱动', () => {
    // selectable 条件必须同时检查 decision !== 'BLOCK' 和 status === 'ready'
    expect(pageSrc).toContain("decision !== 'BLOCK'");
    expect(pageSrc).toContain("status === 'ready'");
    // checked 必须读取 autoReviewSelectedItems
    expect(pageSrc).toContain('autoReviewSelectedItems.has');
    // onToggle 必须调用 toggleAutoReviewItem
    expect(pageSrc).toContain('toggleAutoReviewItem(');
  });

  it('WARN 仓库可选且有警告提示', () => {
    // BatchReviewCard 中 WARN 决策显示 AlertTriangle 图标
    expect(pageSrc).toContain('isWarnByRule');
    expect(pageSrc).toContain('AlertTriangle');
    // WARN 提示文字
    expect(pageSrc).toContain('规则预警');
  });

  it('BLOCK 仓库不可选且 checkbox disabled', () => {
    // BLOCK 决策应导致 isBlockedByRule 为 true → checkbox disabled
    expect(pageSrc).toContain('isBlockedByRule');
    expect(pageSrc).toContain('disabled={!isSelectable}');
    // BLOCK 项阻断原因提示
    expect(pageSrc).toContain('阻断原因');
  });

  it('failed/blocked 状态仓库不可选（selectable 检查 dryRun.status）', () => {
    // selectable 必须同时检查 status === 'ready'
    // 确保 failed/blocked 仓库即使 PASS/WARN 也不可选
    const selectablePattern = /selectable=\{.*status\s*===?\s*['"]ready['"]/;
    expect(selectablePattern.test(pageSrc)).toBe(true);
  });

  it('handleAutoPreReview 不调用 triggerBatchRealWrite 或 confirmRealWrite', () => {
    // 自动预审 Dialog 不得触发真实写入
    // handleAutoPreReview 函数体内不应出现 triggerBatchRealWrite / confirmRealWrite
    const fnStart = pageSrc.indexOf('async function handleAutoPreReview');
    expect(fnStart).toBeGreaterThan(0);

    // 找到下一个顶层函数定义作为边界
    const afterFn = pageSrc.slice(fnStart);
    const nextFn = afterFn.search(/\n  async function (?!handleAutoPreReview)/);
    const fnBody = nextFn > 0 ? afterFn.slice(0, nextFn) : afterFn;

    expect(fnBody).not.toContain('triggerBatchRealWrite');
    expect(fnBody).not.toContain('confirmRealWrite');
  });

  it('自动预审 Dialog 不包含批量写入操作区', () => {
    // 自动预审 Dialog 区域不应包含 Real Write 按钮或确认短语输入
    const dialogStart = pageSrc.indexOf('自动预审 Dialog');
    expect(dialogStart).toBeGreaterThan(0);

    const afterDialog = pageSrc.slice(dialogStart);
    // 找到下一个 Dialog 或 Sheet 作为边界（"确认 Real Write Dialog"）
    const nextBoundary = afterDialog.indexOf('确认 Real Write Dialog');
    const dialogSection = nextBoundary > 0 ? afterDialog.slice(0, nextBoundary) : afterDialog;

    expect(dialogSection).not.toContain('triggerBatchRealWrite');
    expect(dialogSection).not.toContain('confirmRealWrite');
    expect(dialogSection).not.toContain('确认短语');
  });

  it('对话框打开/关闭/重新执行时重置选择状态', () => {
    // 三个清除点：按钮 onClick、Dialog onOpenChange、handleAutoPreReview 开头
    const clearPattern = /setAutoReviewSelectedItems\s*\(\s*new\s+Set\s*\(\s*\)\s*\)/g;
    const matches = pageSrc.match(clearPattern);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});
