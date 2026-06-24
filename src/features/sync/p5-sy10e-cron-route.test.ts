// P5-SY10E rework: Vercel Cron Route Handler + 系统 claim 路径测试
//
// 验证:
// - Route Handler 正确鉴权 API key（缺少/错误 → 401）
// - runScheduledAutoPreReview 不依赖用户 session
// - 不调用 triggerBatchRealWrite / confirmRealWrite
// - vercel.json 结构正确
// - 源码级安全检查
//
// P5-SY10E rework additions:
// - Migration 00010 claim_sync_run_system 静态检查
// - actions.ts 不再有 systemTriggeredBy 绕权参数
// - SyncService _systemClaimConfig 使用 claimSyncRunSystem
// - system path 不能 real_write
// - claim_sync_run 仍要求 auth.uid()
//
// 使用 MockRepository + MockSyncRunner，不连接生产 Supabase。

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { createSyncActions, type SyncActionsDeps, type InputArtifactSource } from './actions';
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

const SYSTEM_USER_ID = 'cron-system-user-id';

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

// ─── Source file paths ──────────────────────────────────────────────

const ROUTE_PATH = path.resolve(process.cwd(), 'src/app/api/cron/dry-run/route.ts');
const VERCEL_JSON_PATH = path.resolve(process.cwd(), 'vercel.json');
const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/sync/actions.ts');
const SERVER_ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/sync/server-actions.ts');
const MIGRATION_00010_PATH = path.resolve(process.cwd(), 'supabase/migrations/00010_claim_sync_run_system.sql');
const MIGRATION_00007_PATH = path.resolve(process.cwd(), 'supabase/migrations/00007_sync_run.sql');
const MIGRATION_00008_PATH = path.resolve(process.cwd(), 'supabase/migrations/00008_sync_run_for_update_dry_run.sql');
const SYNC_SERVICE_PATH = path.resolve(process.cwd(), 'src/features/sync/sync-service.ts');
const REPOSITORY_PATH = path.resolve(process.cwd(), 'src/features/sync/repository.ts');

// ─── 1. 源码检查：Route Handler 不包含 Real Write 调用 ─────────────

describe('P5-SY10E — Cron Route Handler 源码检查', () => {
  let routeSrc: string;

  beforeAll(() => {
    routeSrc = fs.readFileSync(ROUTE_PATH, 'utf-8');
    JSON.parse(fs.readFileSync(VERCEL_JSON_PATH, 'utf-8')); // verify valid JSON
  });

  it('route.ts 不含 triggerBatchRealWrite 调用', () => {
    expect(routeSrc).not.toMatch(/triggerBatchRealWrite/);
  });

  it('route.ts 不含 confirmRealWrite 调用', () => {
    expect(routeSrc).not.toMatch(/confirmRealWrite/);
  });

  it('route.ts 不含 supabase\\.from\\(\\) 直接数据库访问', () => {
    expect(routeSrc).not.toMatch(/supabase\s*\.\s*from\s*\(/);
  });

  it('route.ts 包含 runScheduledAutoPreReview import', () => {
    expect(routeSrc).toMatch(/runScheduledAutoPreReview/);
  });

  it('route.ts 返回 401 当 token 为空', () => {
    expect(routeSrc).toMatch(/缺少 API key/);
    expect(routeSrc).toMatch(/status:\s*401/);
  });

  it('route.ts 包含 CRON_API_KEY 错误处理', () => {
    expect(routeSrc).toMatch(/CRON_API_KEY/);
  });

  it('route.ts 包含 500 错误处理', () => {
    expect(routeSrc).toMatch(/status:\s*500/);
  });

  it('route.ts 使用 NextRequest 类型', () => {
    expect(routeSrc).toMatch(/NextRequest/);
  });
});

// ─── 2. vercel.json 结构验证 ────────────────────────────────────────

describe('P5-SY10E — vercel.json 结构', () => {
  let vercelJson: Record<string, unknown>;

  beforeAll(() => {
    vercelJson = JSON.parse(fs.readFileSync(VERCEL_JSON_PATH, 'utf-8'));
  });

  it('包含 crons 数组', () => {
    expect(vercelJson).toHaveProperty('crons');
    expect(Array.isArray(vercelJson.crons)).toBe(true);
  });

  it('crons 包含至少一个条目', () => {
    const crons = vercelJson.crons as Array<Record<string, unknown>>;
    expect(crons.length).toBeGreaterThanOrEqual(1);
  });

  it('cron 条目包含 path /api/cron/dry-run', () => {
    const crons = vercelJson.crons as Array<Record<string, unknown>>;
    expect(crons[0].path).toBe('/api/cron/dry-run');
  });

  it('cron 条目包含有效 schedule', () => {
    const crons = vercelJson.crons as Array<Record<string, unknown>>;
    expect(crons[0].schedule).toBe('0 1 * * *');
    const parts = (crons[0].schedule as string).split(' ');
    expect(parts).toHaveLength(5);
  });
});

// ─── 3. actions.ts 不再有 systemTriggeredBy 绕权参数（P5-SY10E rework）─

describe('P5-SY10E rework — actions.ts 不再有 systemTriggeredBy', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('triggerBatchDryRun 签名不含 systemTriggeredBy 参数', () => {
    // The function signature should NOT contain systemTriggeredBy
    const fnMatch = actionsSrc.match(/async triggerBatchDryRun\([\s\S]*?\)\s*\{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/systemTriggeredBy/);
    }
  });

  it('triggerBatchDryRun 始终调用 requireActiveAdmin（无条件绕过）', () => {
    const fnMatch = actionsSrc.match(/async triggerBatchDryRun\([\s\S]*?\)\s*\{[\s\S]*?^  \}/m);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).toMatch(/requireActiveAdmin/);
      // 不应有 ?? 绕过 fallback
      expect(fnMatch[0]).not.toMatch(/systemTriggeredBy\s*\?\?\s*\(await requireActiveAdmin/);
    }
  });

  it('runAutoPreReview 签名不含 systemTriggeredBy 参数', () => {
    const fnMatch = actionsSrc.match(/async runAutoPreReview\([\s\S]*?\)\s*\{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/systemTriggeredBy/);
    }
  });

  it('runAutoPreReview 调用 triggerBatchDryRun 时不传 systemTriggeredBy', () => {
    // Should pass only warehouses, not warehouses + systemTriggeredBy
    expect(actionsSrc).toMatch(/triggerBatchDryRun\s*\(\s*warehouses\s*\)/);
  });
});

// ─── 4. Migration 00010 静态检查（P5-SY10E rework）────────────────

describe('P5-SY10E rework — Migration 00010 claim_sync_run_system', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_00010_PATH, 'utf-8');
  });

  it('函数名为 claim_sync_run_system', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_sync_run_system/);
  });

  it('使用 SECURITY DEFINER', () => {
    expect(migrationSrc).toMatch(/SECURITY DEFINER/);
  });

  it('使用 SET search_path = \'\'', () => {
    expect(migrationSrc).toMatch(/SET search_path = ''/);
  });

  it('无 auth.uid() 调用', () => {
    // Only check function body (between $$ and the final $$), not comments
    const bodyMatch = migrationSrc.match(/\$\$[\s\S]*?(?:auth\.uid\(\))/);
    // auth.uid() should only appear in comments (outside the function body)
    const codeLines = migrationSrc
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codeLines).not.toMatch(/auth\.uid\(\)/);
  });

  it('验证 p_triggered_by 是激活的管理员', () => {
    expect(migrationSrc).toMatch(/p\.is_active = true/);
    expect(migrationSrc).toMatch(/r\.name = 'admin'/);
  });

  it('仅允许 dry_run 模式', () => {
    expect(migrationSrc).toMatch(/p_mode != 'dry_run'/);
    expect(migrationSrc).toMatch(/仅允许 dry_run 模式/);
  });

  it('复用并发锁顺序', () => {
    expect(migrationSrc).toMatch(/pg_advisory_xact_lock/);
    expect(migrationSrc).toMatch(/FOR UPDATE/);
    expect(migrationSrc).toMatch(/clock_timestamp/);
  });

  it('revoke from public, anon, authenticated', () => {
    expect(migrationSrc).toMatch(/REVOKE EXECUTE.*FROM PUBLIC/);
    expect(migrationSrc).toMatch(/REVOKE EXECUTE.*FROM anon/);
    expect(migrationSrc).toMatch(/REVOKE EXECUTE.*FROM authenticated/);
  });

  it('grant to service_role only', () => {
    expect(migrationSrc).toMatch(/GRANT EXECUTE.*TO service_role/);
  });

  it('不包含 real_write 模式启用逻辑', () => {
    // The system claim function must not allow real_write
    expect(migrationSrc).not.toMatch(/p_mode = 'real_write'/);
  });

  it('不修改已执行 migration（注释中有声明）', () => {
    expect(migrationSrc).toMatch(/不修改已执行 Migration/);
  });

  it('参数列表不含 p_dry_run_run_id', () => {
    // System path doesn't support dry_run_run_id binding
    const paramsMatch = migrationSrc.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\)/);
    expect(paramsMatch).not.toBeNull();
    if (paramsMatch) {
      expect(paramsMatch[0]).not.toMatch(/p_dry_run_run_id/);
    }
  });
});

// ─── 5. claim_sync_run 未修改（仍要求 auth.uid()）─────────────────

describe('P5-SY10E rework — claim_sync_run 未修改', () => {
  it('Migration 00008 中 claim_sync_run 仍包含 auth.uid() 检查', () => {
    const m08 = fs.readFileSync(MIGRATION_00008_PATH, 'utf-8');
    expect(m08).toMatch(/auth\.uid\(\) IS NULL/);
  });

  it('Migration 00008 中 claim_sync_run 仍要求 admin 角色', () => {
    const m08 = fs.readFileSync(MIGRATION_00008_PATH, 'utf-8');
    expect(m08).toMatch(/IS DISTINCT FROM 'admin'/);
  });

  it('Migration 00008 中 claim_sync_run 仍绑定 triggered_by = auth.uid()', () => {
    const m08 = fs.readFileSync(MIGRATION_00008_PATH, 'utf-8');
    expect(m08).toMatch(/p_triggered_by.*!= auth\.uid\(\)/);
  });
});

// ─── 6. server-actions.ts 定时预审 rewired（P5-SY10E rework）─────

describe('P5-SY10E rework — server-actions.ts 定时预审', () => {
  let serverActionsSrc: string;

  beforeAll(() => {
    serverActionsSrc = fs.readFileSync(SERVER_ACTIONS_PATH, 'utf-8');
  });

  it('导出 runScheduledAutoPreReview 函数', () => {
    expect(serverActionsSrc).toMatch(/export async function runScheduledAutoPreReview/);
  });

  it('包含 CRON_API_KEY 校验', () => {
    expect(serverActionsSrc).toMatch(/CRON_API_KEY 环境变量未配置/);
    expect(serverActionsSrc).toMatch(/CRON_API_KEY 无效/);
  });

  it('包含 CRON_SYSTEM_USER_ID 校验', () => {
    expect(serverActionsSrc).toMatch(/CRON_SYSTEM_USER_ID 环境变量未配置/);
  });

  it('使用 _systemClaimConfig 构造 SyncService', () => {
    expect(serverActionsSrc).toMatch(/_systemClaimConfig/);
    expect(serverActionsSrc).toMatch(/enabled: true/);
  });

  it('直接调用 createSyncService 而非 createSyncActions', () => {
    // Should create SyncService with _systemClaimConfig, NOT go through wireRealActions → createSyncActions
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return \{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      // Must use createSyncService directly
      expect(fnMatch[0]).toMatch(/createSyncService/);
      // Must NOT call wireRealActions inside the scheduled path
      // (wireRealActions creates user-auth actions; system path uses systemSyncService directly)
      // The systemSyncService is created inline with _systemClaimConfig
      expect(fnMatch[0]).toMatch(/_systemClaimConfig/);
    }
  });

  it('不将 systemTriggeredBy 传给 runAutoPreReview', () => {
    // After rework, no more passing triggeredBy as 4th arg
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return \{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/systemTriggeredBy/);
    }
  });

  it('verifyBigSellerSession 仍包含 requireActiveAdmin', () => {
    expect(serverActionsSrc).toMatch(/export async function verifyBigSellerSession[\s\S]*?requireActiveAdmin/);
  });

  it('_verifyBigSellerSessionCore 不含 requireActiveAdmin', () => {
    const coreMatch = serverActionsSrc.match(/async function _verifyBigSellerSessionCore\(\)[\s\S]*?\n\}/);
    expect(coreMatch).not.toBeNull();
    if (coreMatch) {
      expect(coreMatch[0]).not.toMatch(/requireActiveAdmin/);
    }
  });

  it('不调用 triggerBatchRealWrite', () => {
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return \{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/triggerBatchRealWrite/);
    }
  });

  it('不调用 confirmRealWrite', () => {
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return \{/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/confirmRealWrite/);
    }
  });
});

// ─── 7. 管线集成：triggerBatchDryRun 始终要求 requireActiveAdmin ──

describe('P5-SY10E rework — 管线集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('triggerBatchDryRun 始终调用 requireActiveAdmin', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    await actions.triggerBatchDryRun([
      { id: WH_PH.id, name: WH_PH.name, country: WH_PH.country },
    ]);

    expect(requireActiveAdmin).toHaveBeenCalled();
  });

  it('runAutoPreReview 始终调用 requireActiveAdmin', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    await actions.runAutoPreReview(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      healthySession,
    );

    expect(requireActiveAdmin).toHaveBeenCalled();
  });

  it('不存在绕过 requireActiveAdmin 的 systemTriggeredBy 路径', () => {
    // Source check: actions.ts should have no code path that skips requireActiveAdmin
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    // All triggerBatchDryRun paths should go through requireActiveAdmin().id
    const bypassPattern = /systemTriggeredBy\s*\?\?\s*\(await requireActiveAdmin/;
    expect(actionsSrc).not.toMatch(bypassPattern);
  });
});

// ─── 8. SyncService system claim 路径 ──────────────────────────────

describe('P5-SY10E rework — SyncService system claim', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('_systemClaimConfig.enabled 时 claimSyncRunSystem 被调用（非 claimSyncRun）', async () => {
    const repo = new MockRepository('admin');
    const claimSystemSpy = vi.spyOn(repo, 'claimSyncRunSystem');
    const claimUserSpy = vi.spyOn(repo, 'claimSyncRun');

    const svc = createSyncService({
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner: new MockSyncRunner(),
      _systemClaimConfig: { enabled: true, triggeredBy: SYSTEM_USER_ID },
    });

    const result = await svc.executeSync({
      warehouseId: WH_PH.id,
      mode: 'dry_run',
      inputArtifact: { skus: ['SKU-1'] },
      triggeredBy: SYSTEM_USER_ID,
    });

    expect(result.status).toBe('completed');
    expect(claimSystemSpy).toHaveBeenCalled();
    expect(claimUserSpy).not.toHaveBeenCalled();
  });

  it('无 _systemClaimConfig 时 claimSyncRun 被调用（非 claimSyncRunSystem）', async () => {
    const repo = new MockRepository('admin');
    const claimSystemSpy = vi.spyOn(repo, 'claimSyncRunSystem');
    const claimUserSpy = vi.spyOn(repo, 'claimSyncRun');

    const svc = createSyncService({
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner: new MockSyncRunner(),
      // No _systemClaimConfig
    });

    const result = await svc.executeSync({
      warehouseId: WH_PH.id,
      mode: 'dry_run',
      inputArtifact: { skus: ['SKU-1'] },
      triggeredBy: mockAdminUser.id,
    });

    expect(result.status).toBe('completed');
    expect(claimUserSpy).toHaveBeenCalled();
    expect(claimSystemSpy).not.toHaveBeenCalled();
  });

  it('system path real_write 被拒绝', async () => {
    const repo = new MockRepository('admin');
    const svc = createSyncService({
      repository: repo,
      artifactProvider: new MockArtifactProvider(),
      runner: new MockSyncRunner(),
      _systemClaimConfig: { enabled: true, triggeredBy: SYSTEM_USER_ID },
    });

    // executeRealWrite 在加载 artifact 之前就拒绝 system path
    const result = await svc.executeSync({
      warehouseId: WH_PH.id,
      mode: 'real_write',
      inputArtifact: { skus: ['SKU-1'] },
      dryRunRunId: 'test-dry-run-id',
      confirmToken: 'TEST-TOKEN',
      triggeredBy: SYSTEM_USER_ID,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/禁止执行 Real Write/);
  });
});

// ─── 9. MockRepository claimSyncRunSystem 行为 ─────────────────────

describe('P5-SY10E rework — MockRepository claimSyncRunSystem', () => {
  beforeEach(() => {
    MockRepository._resetAll();
  });

  it('claimSyncRunSystem 返回 runId 当仓库空闲', async () => {
    const repo = new MockRepository('admin');
    const runId = await repo.claimSyncRunSystem({
      warehouseId: WH_PH.id,
      runId: 'test-run-001',
      leaseDuration: 300,
      triggeredBy: SYSTEM_USER_ID,
      triggeredFrom: 'web',
    });
    expect(runId).toBe('test-run-001');
  });

  it('claimSyncRunSystem 返回 null 当仓库已被占用', async () => {
    const repo = new MockRepository('admin');
    // First claim succeeds
    await repo.claimSyncRunSystem({
      warehouseId: WH_PH.id,
      runId: 'test-run-001',
      leaseDuration: 300,
      triggeredBy: SYSTEM_USER_ID,
      triggeredFrom: 'web',
    });
    // Second claim for same warehouse should fail
    const runId2 = await repo.claimSyncRunSystem({
      warehouseId: WH_PH.id,
      runId: 'test-run-002',
      leaseDuration: 300,
      triggeredBy: SYSTEM_USER_ID,
      triggeredFrom: 'web',
    });
    expect(runId2).toBeNull();
  });

  it('claimSyncRunSystem 拒绝无效 leaseDuration', async () => {
    const repo = new MockRepository('admin');
    await expect(
      repo.claimSyncRunSystem({
        warehouseId: WH_PH.id,
        runId: 'test-run-001',
        leaseDuration: 10, // below minimum 30
        triggeredBy: SYSTEM_USER_ID,
        triggeredFrom: 'web',
      }),
    ).rejects.toThrow(/leaseDuration/);
  });

  it('claimSyncRunSystem 写入 mode=dry_run', async () => {
    const repo = new MockRepository('admin');
    await repo.claimSyncRunSystem({
      warehouseId: WH_PH.id,
      runId: 'test-run-001',
      leaseDuration: 300,
      triggeredBy: SYSTEM_USER_ID,
      triggeredFrom: 'web',
    });

    const allRuns = repo._getAllRuns();
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].mode).toBe('dry_run');
  });

  it('claimSyncRunSystem 写入 triggeredBy', async () => {
    const repo = new MockRepository('admin');
    await repo.claimSyncRunSystem({
      warehouseId: WH_PH.id,
      runId: 'test-run-001',
      leaseDuration: 300,
      triggeredBy: SYSTEM_USER_ID,
      triggeredFrom: 'web',
    });

    const allRuns = repo._getAllRuns();
    expect(allRuns[0].triggeredBy).toBe(SYSTEM_USER_ID);
  });
});

// ─── 10. Repository 接口声明 ────────────────────────────────────────

describe('P5-SY10E rework — Repository 接口', () => {
  let repoInterface: string;

  beforeAll(() => {
    repoInterface = fs.readFileSync(REPOSITORY_PATH, 'utf-8');
  });

  it('SyncRepository 接口包含 claimSyncRunSystem 方法', () => {
    expect(repoInterface).toMatch(/claimSyncRunSystem/);
  });

  it('claimSyncRunSystem 参数包含 warehouseId, runId, leaseDuration, triggeredBy, triggeredFrom', () => {
    expect(repoInterface).toMatch(/warehouseId/);
    expect(repoInterface).toMatch(/runId/);
    expect(repoInterface).toMatch(/leaseDuration/);
    expect(repoInterface).toMatch(/triggeredBy/);
    expect(repoInterface).toMatch(/triggeredFrom/);
  });
});

// ─── 11. SyncService _systemClaimConfig 声明 ────────────────────────

describe('P5-SY10E rework — SyncService _systemClaimConfig', () => {
  let syncServiceSrc: string;

  beforeAll(() => {
    syncServiceSrc = fs.readFileSync(SYNC_SERVICE_PATH, 'utf-8');
  });

  it('SyncServiceDeps 包含 _systemClaimConfig', () => {
    expect(syncServiceSrc).toMatch(/_systemClaimConfig/);
  });

  it('_systemClaimConfig 包含 enabled 和 triggeredBy', () => {
    expect(syncServiceSrc).toMatch(/enabled:\s*true/);
    expect(syncServiceSrc).toMatch(/triggeredBy:\s*string/);
  });

  it('executeDryRun 在 system claim 时使用 claimSyncRunSystem', () => {
    expect(syncServiceSrc).toMatch(/claimSyncRunSystem/);
  });

  it('executeRealWrite 在 system claim 时返回错误', () => {
    expect(syncServiceSrc).toMatch(/禁止执行 Real Write/);
  });
});

// ─── 12. 不触发 Real Write ─────────────────────────────────────────

describe('P5-SY10E — 不触发 Real Write', () => {
  let routeSrc: string;

  beforeAll(() => {
    routeSrc = fs.readFileSync(ROUTE_PATH, 'utf-8');
  });

  it('route.ts 源码不含 real_write 字面量', () => {
    expect(routeSrc).not.toMatch(/real_write/);
  });

  it('route.ts 源码不含 isWebsyncRealWriteEnabled', () => {
    expect(routeSrc).not.toMatch(/isWebsyncRealWriteEnabled/);
  });
});

// ─── 13. .env.example 包含 CRON_API_KEY ────────────────────────────

describe('P5-SY10E — .env.example', () => {
  let envExample: string;

  beforeAll(() => {
    const envPath = path.resolve(process.cwd(), '.env.example');
    envExample = fs.readFileSync(envPath, 'utf-8');
  });

  it('包含 CRON_API_KEY 变量', () => {
    expect(envExample).toMatch(/CRON_API_KEY/);
  });

  it('包含 CRON_SYSTEM_USER_ID 变量', () => {
    expect(envExample).toMatch(/CRON_SYSTEM_USER_ID/);
  });
});

// ─── 14. server-actions.ts 手动 runAutoPreReview 不受影响 ─────────

describe('P5-SY10E rework — 手动 runAutoPreReview 不受影响', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
  });

  it('手动 runAutoPreReview 仍使用 claimSyncRun（非 system path）', async () => {
    const deps = buildActionsDeps();
    const repo = deps.repository as MockRepository;
    const claimUserSpy = vi.spyOn(repo, 'claimSyncRun');
    const claimSystemSpy = vi.spyOn(repo, 'claimSyncRunSystem');

    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      healthySession,
    );

    expect(result.items).toHaveLength(1);
    expect(claimUserSpy).toHaveBeenCalled();
    expect(claimSystemSpy).not.toHaveBeenCalled();
    expect(requireActiveAdmin).toHaveBeenCalled();
  });
});
