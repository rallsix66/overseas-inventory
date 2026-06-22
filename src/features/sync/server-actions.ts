'use server';

// Sync Feature Module — 顶层 Server Actions (P5-SY5D)
//
// 通过 createSyncActions 工厂组合 mock 依赖，导出页面可调用的 Server Actions。
// 页面通过此边界调用同步能力，不直接实例化 Repository / Provider / Runner。
// 真实 Provider / Runner / Repository 就绪后替换 mock 依赖即可。

import { createSyncActions } from './actions';
import type { InputArtifactSource } from './actions';
import { createSyncService } from './sync-service';
import { SupabaseSyncRepository } from './supabase-repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { RealSyncRunner, type WarehouseBridgeInfo } from './real-sync-runner';
import { revalidatePath } from 'next/cache';
import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { JsonValue, SyncRunsResponse, SyncRunDetailResponse } from './types';

// ─── Mock InputArtifactSource ─────────────────────────────────────

const mockInputArtifactSource: InputArtifactSource = {
  async getInputArtifact(
    warehouseId: string,
    _mode: 'dry_run' | 'real_write',
  ): Promise<JsonValue> {
    void warehouseId; // consumed by real InputArtifactSource in production
    void _mode;
    return {
      warehouse: '菲律宾-新创启辰自建仓',
      country: 'PH',
      timestamp: new Date().toISOString(),
      rows: [],
    };
  },
};

// ─── Per-request dependency wiring ───────────────────────────────

async function createSupabaseRepo() {
  return new SupabaseSyncRepository(
    await createClient(),
    createServiceClient(),
  );
}

async function wireActions() {
  const repository = await createSupabaseRepo();
  const artifactProvider = new MockArtifactProvider();
  const runner = new MockSyncRunner();
  const syncService = createSyncService({
    repository,
    artifactProvider,
    runner,
  });

  return createSyncActions({
    repository,
    syncService,
    inputArtifactSource: mockInputArtifactSource,
  });
}

/** 真实同步管线：RealSyncRunner 调用 Python 桥接执行 BigSeller 抓取 + Supabase RPC */
async function wireRealActions(warehouses: WarehouseBridgeInfo[]) {
  const repository = await createSupabaseRepo();
  const artifactProvider = new MockArtifactProvider();
  const runner = new RealSyncRunner(warehouses);
  const syncService = createSyncService({
    repository,
    artifactProvider,
    runner,
  });

  return createSyncActions({
    repository,
    syncService,
    inputArtifactSource: mockInputArtifactSource,
  });
}

// ─── Exported Server Actions ─────────────────────────────────────

export async function getSyncRuns(
  warehouseId?: string,
  limit?: number,
): Promise<SyncRunsResponse> {
  await requireActiveAuth();
  const actions = await wireActions();
  return actions.getSyncRunsAction(warehouseId, limit);
}

export async function getSyncRunDetail(
  runId: string,
): Promise<SyncRunDetailResponse> {
  await requireActiveAuth();
  const actions = await wireActions();
  return actions.getSyncRunDetailAction(runId);
}

export async function triggerSync(
  formData: FormData,
): Promise<{ success: boolean; runId: string; status: string; error?: string }> {
  await requireActiveAdmin();
  const actions = await wireActions();
  return actions.triggerSync(formData);
}

const COUNTRY_TOKEN_MAP: Record<string, string> = {
  PH: 'P5-SY3B-PH',
  VN: 'P5-SY8B-VN',
  TH: 'P5-SY8D-TH',
  MY: 'P5-SY8F-MY',
  ID: 'P5-SY8H-ID',
};

const COUNTRY_OLDNAME_MAP: Record<string, string> = {
  PH: '菲律宾仓',
  VN: '越南仓',
  TH: '泰国仓',
  MY: '马来西亚仓',
  ID: '印尼仓',
};

async function getOverseasWarehouses(): Promise<
  Array<{ id: string; name: string; country: string; token: string }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('warehouse')
    .select('id, name, country')
    .eq('type', 'overseas')
    .eq('is_active', true)
    .order('country');

  if (error) throw new Error(`获取海外仓列表失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error('未找到活跃海外仓');

  return data.map((w) => ({
    id: w.id,
    name: w.name,
    country: w.country,
    token: COUNTRY_TOKEN_MAP[w.country] ?? '',
  }));
}

// 启动时缓存（同一请求内复用）
let _overseasWhCache: Awaited<ReturnType<typeof getOverseasWarehouses>> | null = null;
async function getCachedOverseasWarehouses() {
  if (!_overseasWhCache) {
    _overseasWhCache = await getOverseasWarehouses();
  }
  return _overseasWhCache;
}

/** 获取海外仓选项列表（供前端筛选和触发同步使用） */
export async function getOverseasWarehouseOptions(): Promise<
  Array<{ id: string; name: string; country: string }>
> {
  await requireActiveAuth();
  const warehouses = await getCachedOverseasWarehouses();
  return warehouses.map(({ id, name, country }) => ({ id, name, country }));
}

// ─── 一键同步（自动 dry_run → real_write 链式调用）────────────────

function toWarehouseBridgeInfo(
  warehouses: Awaited<ReturnType<typeof getOverseasWarehouses>>,
): WarehouseBridgeInfo[] {
  return warehouses.map((w) => ({
    id: w.id,
    name: w.name,
    oldName: COUNTRY_OLDNAME_MAP[w.country] ?? w.name,
    country: w.country,
    token: w.token,
  }));
}

export async function syncWarehouse(warehouseId: string): Promise<{
  warehouseId: string;
  warehouseName: string;
  success: boolean;
  runId: string;
  status: string;
  error?: string;
  dryRunRunId?: string;
}> {
  await requireActiveAdmin();
  const warehouses = await getCachedOverseasWarehouses();
  const wh = warehouses.find((w) => w.id === warehouseId);
  if (!wh) {
    return { warehouseId, warehouseName: '未知仓库', success: false, runId: '', status: 'failed', error: '未知仓库 ID' };
  }
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));
  const result = await actions.syncWarehouse(warehouseId, wh.name, wh.token);
  if (result.success) {
    revalidatePath('/dashboard/inventory/overseas');
  }
  return result;
}

export async function syncAllWarehouses(): Promise<{
  results: Array<{
    warehouseId: string;
    warehouseName: string;
    success: boolean;
    runId: string;
    status: string;
    error?: string;
    dryRunRunId?: string;
  }>;
  allSuccess: boolean;
}> {
  await requireActiveAdmin();
  const warehouses = await getCachedOverseasWarehouses();
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));
  const results: Array<{
    warehouseId: string;
    warehouseName: string;
    success: boolean;
    runId: string;
    status: string;
    error?: string;
    dryRunRunId?: string;
  }> = [];

  for (const wh of warehouses) {
    const r = await actions.syncWarehouse(wh.id, wh.name, wh.token);
    results.push(r);
  }

  const allSuccess = results.every((r) => r.success);
  if (results.some((r) => r.success)) {
    revalidatePath('/dashboard/inventory/overseas');
  }

  return { results, allSuccess };
}

// ─── 重新建立 BigSeller 登录会话 ────────────────────────────────

/** 在服务器上打开 headed Chrome，让管理员手动完成 BigSeller 登录和验证码。
 *  登录成功后 session cookie 会被持久化，后续网页端 headless 同步即可正常使用。
 *  仅在服务器有桌面环境时可用。 */
export async function establishBigSellerSession(): Promise<{
  success: boolean;
  message: string;
}> {
  await requireActiveAdmin();

  const projectRoot = path.resolve(process.cwd());
  const logDir = path.join(projectRoot, 'tools', 'bigseller-scraper', 'runtime');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'session-establish.log');
  const lockFile = path.join(logDir, 'session-establish.lock');

  // 防重复：如果已有会话建立进程在运行，拒绝再次启动
  if (fs.existsSync(lockFile)) {
    const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
    // 超过 10 分钟的锁文件视为过期（进程可能已异常退出）
    if (lockAge < 10 * 60 * 1000) {
      return {
        success: false,
        message:
          '登录会话建立进程已在运行中，请在已打开的 Chrome 窗口中完成登录。' +
          '如果确认没有 Chrome 窗口打开，请等待 10 分钟后重试。',
      };
    }
    // 清理过期锁
    fs.unlinkSync(lockFile);
  }

  fs.writeFileSync(lockFile, '', 'utf-8');

  // 将之前日志截断，保留最近一次
  const logFd = fs.openSync(logFile, 'w');

  // detached spawn — 不等待 Python 进程结束，立即返回
  // stdout/stderr 写入日志文件，便于排查 session 持久化是否成功
  const proc = spawn('python', [
    '-m', 'tools.bigseller-scraper.bigseller_scraper',
  ], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      BS_HEADLESS: '0',
      BS_SESSION_ONLY: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  // Python 进程退出时清理锁文件
  proc.on('close', () => {
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  });
  proc.on('error', () => {
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  });

  proc.unref();

  return {
    success: true,
    message:
      '已在服务器上打开 Chrome 浏览器，请在浏览器中完成 BigSeller 登录和验证码。' +
      '登录完成后浏览器会自动关闭，session cookie 将被持久化，之后网页端同步即可正常使用。' +
      `（日志: ${logFile}）`,
  };
}
