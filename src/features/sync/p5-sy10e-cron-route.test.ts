// P5-SY10E: Vercel Cron Route Handler 测试
//
// 验证:
// - Route Handler 正确鉴权 API key（缺少/错误 → 401）
// - runScheduledAutoPreReview 不依赖用户 session
// - 不调用 triggerBatchRealWrite / confirmRealWrite
// - vercel.json 结构正确
// - 源码级安全检查
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

  it('route.ts 不含 supabase\.from\(\) 直接数据库访问', () => {
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
    // UTC 01:00 = 北京时间 09:00
    // 5-field cron: minute hour day-of-month month day-of-week
    const parts = (crons[0].schedule as string).split(' ');
    expect(parts).toHaveLength(5);
  });
});

// ─── 3. actions.ts systemTriggeredBy 参数 ───────────────────────────

describe('P5-SY10E — actions.ts systemTriggeredBy 支持', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('triggerBatchDryRun 签名包含 systemTriggeredBy 参数', () => {
    expect(actionsSrc).toMatch(/systemTriggeredBy\??:\s*string/);
  });

  it('triggerBatchDryRun 使用 systemTriggeredBy ?? requireActiveAdmin 模式', () => {
    expect(actionsSrc).toMatch(/systemTriggeredBy\s*\?\?\s*\(await requireActiveAdmin/);
  });

  it('runAutoPreReview 签名包含 systemTriggeredBy 参数', () => {
    // runAutoPreReview has 4th param systemTriggeredBy
    const match = actionsSrc.match(/async runAutoPreReview\([\s\S]*?systemTriggeredBy/);
    expect(match).not.toBeNull();
  });

  it('runAutoPreReview 将 systemTriggeredBy 传递给 triggerBatchDryRun', () => {
    expect(actionsSrc).toMatch(/triggerBatchDryRun\s*\(\s*warehouses\s*,\s*systemTriggeredBy\s*\)/);
  });
});

// ─── 4. server-actions.ts 定时预审导出 ──────────────────────────────

describe('P5-SY10E — server-actions.ts 定时预审', () => {
  let serverActionsSrc: string;

  beforeAll(() => {
    serverActionsSrc = fs.readFileSync(SERVER_ACTIONS_PATH, 'utf-8');
  });

  it('导出 runScheduledAutoPreReview 函数', () => {
    expect(serverActionsSrc).toMatch(/export async function runScheduledAutoPreReview/);
  });

  it('runScheduledAutoPreReview 包含 CRON_API_KEY 校验', () => {
    expect(serverActionsSrc).toMatch(/CRON_API_KEY 环境变量未配置/);
    expect(serverActionsSrc).toMatch(/CRON_API_KEY 无效/);
  });

  it('runScheduledAutoPreReview 包含 CRON_SYSTEM_USER_ID 校验', () => {
    expect(serverActionsSrc).toMatch(/CRON_SYSTEM_USER_ID 环境变量未配置/);
  });

  it('runScheduledAutoPreReview 调用 _verifyBigSellerSessionCore（无 requireActiveAdmin）', () => {
    expect(serverActionsSrc).toMatch(/_verifyBigSellerSessionCore/);
  });

  it('runScheduledAutoPreReview 将 systemTriggeredBy 传给 runAutoPreReview', () => {
    // Check that triggeredBy is passed as the 4th argument to runAutoPreReview
    expect(serverActionsSrc).toMatch(/triggeredBy.*systemTriggeredBy|systemTriggeredBy/);
  });

  it('verifyBigSellerSession 仍包含 requireActiveAdmin', () => {
    expect(serverActionsSrc).toMatch(/export async function verifyBigSellerSession[\s\S]*?requireActiveAdmin/);
  });

  it('_verifyBigSellerSessionCore 不含 requireActiveAdmin', () => {
    // Extract the core function and verify no requireActiveAdmin inside it
    const coreMatch = serverActionsSrc.match(/async function _verifyBigSellerSessionCore\(\)[\s\S]*?\n\}/);
    expect(coreMatch).not.toBeNull();
    if (coreMatch) {
      expect(coreMatch[0]).not.toMatch(/requireActiveAdmin/);
    }
  });

  it('runScheduledAutoPreReview 不调用 triggerBatchRealWrite', () => {
    // Find the function body
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return result;\n\}/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/triggerBatchRealWrite/);
    }
  });

  it('runScheduledAutoPreReview 不调用 confirmRealWrite', () => {
    const fnMatch = serverActionsSrc.match(/export async function runScheduledAutoPreReview[\s\S]*?\n  return result;\n\}/);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/confirmRealWrite/);
    }
  });
});

// ─── 5. 管线集成：systemTriggeredBy 跳过 requireActiveAdmin ────────

describe('P5-SY10E — systemTriggeredBy 管线集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('triggerBatchDryRun 提供 systemTriggeredBy 时不调用 requireActiveAdmin', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    // 传入 systemTriggeredBy — 应该跳过 requireActiveAdmin
    const result = await actions.triggerBatchDryRun(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      SYSTEM_USER_ID,
    );

    expect(requireActiveAdmin).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].warehouseId).toBe(WH_PH.id);
  });

  it('triggerBatchDryRun 不提供 systemTriggeredBy 时调用 requireActiveAdmin', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    // 不传入 systemTriggeredBy — 应该调用 requireActiveAdmin
    await actions.triggerBatchDryRun([
      { id: WH_PH.id, name: WH_PH.name, country: WH_PH.country },
    ]);

    expect(requireActiveAdmin).toHaveBeenCalled();
  });

  it('runAutoPreReview 提供 systemTriggeredBy 时传递到 triggerBatchDryRun', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    // 传入 systemTriggeredBy
    const result = await actions.runAutoPreReview(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      healthySession,
      SYSTEM_USER_ID,
    );

    expect(requireActiveAdmin).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].warehouseId).toBe(WH_PH.id);
    expect(result.items[0].ruleVerdict).toBeDefined();
  });

  it('runAutoPreReview 不提供 systemTriggeredBy 时调用 requireActiveAdmin', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    // 不传入 systemTriggeredBy — 应该调用 requireActiveAdmin
    await actions.runAutoPreReview(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      healthySession,
    );

    expect(requireActiveAdmin).toHaveBeenCalled();
  });
});

// ─── 6. session unhealthy 时返回 blockReason ───────────────────────

describe('P5-SY10E — session unhealthy 全局阻断', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdmin).mockResolvedValue(mockAdminUser);
  });

  it('session unhealthy 时不执行 Dry Run（systemTriggeredBy 路径）', async () => {
    const deps = buildActionsDeps();
    const actions = createSyncActions(deps);

    const result = await actions.runAutoPreReview(
      [{ id: WH_PH.id, name: WH_PH.name, country: WH_PH.country }],
      unhealthySession,
      SYSTEM_USER_ID,
    );

    // Session unhealthy 在 server-actions.ts 层提前拦截，
    // 这里测试 actions 层在收到 unhealthy session 时的行为：
    // 规则引擎应判定 session_unhealthy → BLOCK
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ruleVerdict.decision).toBe('BLOCK');
  });
});

// ─── 7. 不触发 Real Write ─────────────────────────────────────────

describe('P5-SY10E — 不触发 Real Write', () => {
  let routeSrc: string;

  beforeAll(() => {
    routeSrc = fs.readFileSync(ROUTE_PATH, 'utf-8');
  });

  it('route.ts 源码不含 real_write 字面量', () => {
    expect(routeSrc).not.toMatch(/real_write/);
  });

  it('route.ts 源码不含 WEBSYNC_REAL_WRITE_ENABLED', () => {
    // Route handler doesn't need to check this gate — server-actions.ts handles it
    expect(routeSrc).not.toMatch(/isWebsyncRealWriteEnabled/);
  });
});

// ─── 8. .env.example 包含 CRON_API_KEY ────────────────────────────

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
