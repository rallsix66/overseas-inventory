'use server';

// Sync Feature Module — 顶层 Server Actions (P5-SY5D)
//
// 通过 createSyncActions 工厂组合 mock 依赖，导出页面可调用的 Server Actions。
// 页面通过此边界调用同步能力，不直接实例化 Repository / Provider / Runner。
// 真实 Provider / Runner / Repository 就绪后替换 mock 依赖即可。

import { createSyncActions } from './actions';
import { createSyncService } from './sync-service';
import { SupabaseSyncRepository } from './supabase-repository';
import { FileSystemArtifactProvider } from './file-system-artifact-provider';
import { RealSyncRunner, type WarehouseBridgeInfo } from './real-sync-runner';
import { WebInputArtifactSource, isWebsyncRealWriteEnabled } from './web-input-artifact-source';
import { getSyncRunsSchema, getSyncRunDetailSchema } from './schema';
import { revalidatePath } from 'next/cache';
import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { SyncRunsResponse, SyncRunDetailResponse, SessionHealthResult, TriggerDryRunResult, ConfirmRealWriteResult, BatchDryRunResult, BatchRealWriteResult, BatchRealWriteItem } from './types';

// ─── Per-request dependency wiring ───────────────────────────────

async function createSupabaseRepo() {
  return new SupabaseSyncRepository(
    await createClient(),
    createServiceClient(),
  );
}

/** 真实同步管线：RealSyncRunner + FileSystemArtifactProvider + WebInputArtifactSource
 *  调用 Python 桥接执行 BigSeller 抓取 + Supabase RPC 写入。
 *
 *  P5-SY9C: 生产路径已移除 MockArtifactProvider 和 mockInputArtifactSource。
 *  通过 WEBSYNC_REAL_WRITE_ENABLED feature gate 控制真实写入入口。
 *  P5-SY9E heartbeat/timeout 完成且 P5-SY9I 独立验收通过后才允许启用。 */
async function wireRealActions(warehouses: WarehouseBridgeInfo[]) {
  const repository = await createSupabaseRepo();
  const artifactProvider = new FileSystemArtifactProvider();
  const runner = new RealSyncRunner(warehouses);
  const inputArtifactSource = new WebInputArtifactSource(warehouses);
  const syncService = createSyncService({
    repository,
    artifactProvider,
    runner,
  });

  return createSyncActions({
    repository,
    syncService,
    inputArtifactSource,
    artifactProvider, // P5-SY9D rework: confirmRealWrite 加载绑定 artifact 使用
  });
}

// ─── Exported Server Actions ─────────────────────────────────────

export async function getSyncRuns(
  warehouseId?: string,
  limit?: number,
): Promise<SyncRunsResponse> {
  await requireActiveAuth();
  const repository = await createSupabaseRepo();
  const parsed = getSyncRunsSchema.parse({ warehouseId, limit });
  return repository.getSyncRuns({
    warehouseId: parsed.warehouseId,
    limit: parsed.limit,
  });
}

export async function getSyncRunDetail(
  runId: string,
): Promise<SyncRunDetailResponse> {
  await requireActiveAuth();
  const repository = await createSupabaseRepo();
  const parsed = getSyncRunDetailSchema.parse({ runId });
  return repository.getSyncRunDetail(parsed.runId);
}

export async function triggerSync(
  _formData: FormData,
): Promise<{ success: boolean; runId: string; status: string; error?: string }> {
  await requireActiveAdmin();
  // P5-SY9C: 旧版 FormData 同步路径已禁用。
  // 在构造 SyncService 之前直接返回中文错误，
  // 不通过 MockSyncRunner 间接触发生产 guard。
  return {
    success: false,
    runId: '',
    status: 'failed',
    error: '旧版 FormData 同步路径已禁用，请使用一键同步功能。',
  };
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

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      warehouseId,
      warehouseName: '会话异常',
      success: false,
      runId: '',
      status: 'failed',
      error: `BigSeller 登录会话不可用：${health.message}`,
    };
  }

  // ── Feature gate (P5-SY9C) ──────────────────────────────────
  // Web 同步真实写入入口保持 server-side disabled，直到 P5-SY9E
  // heartbeat/timeout 完成且 P5-SY9I 独立验收通过后才允许启用。
  if (!isWebsyncRealWriteEnabled()) {
    return {
      warehouseId,
      warehouseName: '功能未开放',
      success: false,
      runId: '',
      status: 'failed',
      error: 'Web 同步真实写入功能尚未启用。请等待 P5-SY9E heartbeat/timeout 完成并通过 P5-SY9I 独立验收。',
    };
  }

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

// ─── P5-SY9D: 单仓 Dry Run（仅审核，不自动链 Real Write）──────────

export async function triggerDryRun(warehouseId: string): Promise<TriggerDryRunResult> {
  await requireActiveAdmin();

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      warehouseId,
      warehouseName: '会话异常',
      success: false,
      runId: '',
      status: 'failed',
      error: `BigSeller 登录会话不可用：${health.message}`,
    };
  }

  const warehouses = await getCachedOverseasWarehouses();
  const wh = warehouses.find((w) => w.id === warehouseId);
  if (!wh) {
    return { warehouseId, warehouseName: '未知仓库', success: false, runId: '', status: 'failed', error: '未知仓库 ID' };
  }
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));
  const result = await actions.triggerDryRun(warehouseId, wh.name);
  if (result.success) {
    revalidatePath('/dashboard/inventory/overseas');
  }
  return result;
}

// ─── P5-SY9D: 确认 Real Write（绑定已完成 Dry Run） ──────────────

export async function confirmRealWrite(
  warehouseId: string,
  dryRunRunId: string,
): Promise<ConfirmRealWriteResult> {
  await requireActiveAdmin();

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      warehouseId,
      warehouseName: '会话异常',
      success: false,
      runId: '',
      status: 'failed',
      error: `BigSeller 登录会话不可用：${health.message}`,
      dryRunRunId,
    };
  }

  // ── Feature gate (P5-SY9C) ──────────────────────────────────
  if (!isWebsyncRealWriteEnabled()) {
    return {
      warehouseId,
      warehouseName: '功能未开放',
      success: false,
      runId: '',
      status: 'failed',
      error: 'Web 同步真实写入功能尚未启用。请等待 P5-SY9E heartbeat/timeout 完成并通过 P5-SY9I 独立验收。',
      dryRunRunId,
    };
  }

  const warehouses = await getCachedOverseasWarehouses();
  const wh = warehouses.find((w) => w.id === warehouseId);
  if (!wh) {
    return { warehouseId, warehouseName: '未知仓库', success: false, runId: '', status: 'failed', error: '未知仓库 ID', dryRunRunId };
  }
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));
  const result = await actions.confirmRealWrite(warehouseId, wh.name, wh.country, dryRunRunId, wh.token);
  if (result.success) {
    revalidatePath('/dashboard/inventory/overseas');
  }
  return result;
}

// ─── P5-SY9F: 批量全部海外仓 Dry Run ────────────────────────────

export async function triggerBatchDryRun(): Promise<BatchDryRunResult> {
  await requireActiveAdmin();

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      results: [],
      allSucceeded: false,
      successCount: 0,
      failedCount: 0,
      blockedCount: 0,
      blockReason: `BigSeller 登录会话不可用：${health.message}`,
    };
  }

  const warehouses = await getCachedOverseasWarehouses();
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));
  const result = await actions.triggerBatchDryRun(
    warehouses.map((w) => ({ id: w.id, name: w.name, country: w.country })),
  );

  if (result.results.some((r) => r.status === 'ready')) {
    revalidatePath('/dashboard/inventory/overseas');
  }

  return result;
}

// ─── P5-SY9G: 批量审核后真实写入 ────────────────────────────

export async function triggerBatchRealWrite(
  items: BatchRealWriteItem[],
  confirmationPhrase: string,
): Promise<BatchRealWriteResult> {
  await requireActiveAdmin();

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      results: [],
      allSucceeded: false,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      blockReason: `BigSeller 登录会话不可用：${health.message}`,
    };
  }

  // ── Feature gate (P5-SY9C) ──────────────────────────────────
  // Web 真实写入入口保持 server-side disabled，直到 P5-SY9E
  // heartbeat/timeout 完成且 P5-SY9I 独立验收通过后才允许启用。
  if (!isWebsyncRealWriteEnabled()) {
    return {
      results: [],
      allSucceeded: false,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      blockReason: 'Web 同步真实写入功能尚未启用。请等待 P5-SY9E heartbeat/timeout 完成并通过 P5-SY9I 独立验收。',
    };
  }

  const warehouses = await getCachedOverseasWarehouses();
  const actions = await wireRealActions(toWarehouseBridgeInfo(warehouses));

  // Populate confirmToken server-side from COUNTRY_TOKEN_MAP.
  // Client must not send tokens — they are derived from warehouse country.
  const populatedItems = items.map((item) => ({
    ...item,
    confirmToken: COUNTRY_TOKEN_MAP[item.country] ?? '',
  }));

  const result = await actions.triggerBatchRealWrite(populatedItems, confirmationPhrase);

  if (result.results.some((r) => r.status === 'success')) {
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

  // ── Session health guard (P5-SY9B) ──────────────────────────
  const health = await verifyBigSellerSession();
  if (health.status !== 'healthy') {
    return {
      results: [{
        warehouseId: 'all',
        warehouseName: '全部海外仓',
        success: false,
        runId: '',
        status: 'failed',
        error: `BigSeller 登录会话不可用：${health.message}`,
      }],
      allSuccess: false,
    };
  }

  // ── Feature gate (P5-SY9C) ──────────────────────────────────
  if (!isWebsyncRealWriteEnabled()) {
    return {
      results: [{
        warehouseId: 'all',
        warehouseName: '全部海外仓',
        success: false,
        runId: '',
        status: 'failed',
        error: 'Web 同步真实写入功能尚未启用。请等待 P5-SY9E heartbeat/timeout 完成并通过 P5-SY9I 独立验收。',
      }],
      allSuccess: false,
    };
  }

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

// ─── BigSeller 会话健康检查 (P5-SY9B) ──────────────────────────

const HEALTH_CHECK_TIMEOUT_MS = 60_000;

/** 验证 BigSeller 登录会话是否可用于 Web headless 同步。
 *  使用与 Web 同步相同的 profile 和 headless 模式，只读检查库存页是否可访问。
 *  仅 Admin 可调用；不执行任何写入、抓取或同步操作。 */
export async function verifyBigSellerSession(): Promise<SessionHealthResult> {
  await requireActiveAdmin();

  const projectRoot = path.resolve(process.cwd());

  return new Promise<SessionHealthResult>((resolve) => {
    const proc = spawn('python', [
      '-m', 'tools.bigseller-scraper.sync.health_check',
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
    }, HEALTH_CHECK_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeoutId);

      const lines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const lastJsonLine = lines.at(-1);
      if (!lastJsonLine) {
        if (stderr) {
          console.error('[verifyBigSellerSession] stderr:', stderr);
        }
        resolve({
          status: 'unknown_error',
          message: '会话健康检查无输出，Python 子进程可能启动失败。请检查服务器环境和 Playwright/Chrome 安装。',
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      try {
        const raw = JSON.parse(lastJsonLine) as Record<string, unknown>;
        // Python 输出 checked_at (snake_case)，统一转换为 TypeScript 契约的 checkedAt (camelCase)
        const result: SessionHealthResult = {
          status: (raw.status as SessionHealthResult['status']) ?? 'unknown_error',
          message: (raw.message as string) ?? '',
          checkedAt: (raw.checked_at as string) ?? (raw.checkedAt as string) ?? new Date().toISOString(),
          details: (raw.details as Record<string, unknown>) ?? {},
        };
        if (stderr) {
          console.log('[verifyBigSellerSession]', stderr.split('\n').slice(-3).join('\n'));
        }
        resolve(result);
      } catch {
        resolve({
          status: 'unknown_error',
          message: `会话健康检查输出解析失败（exit=${code}）。请检查 Python 环境和依赖。`,
          checkedAt: new Date().toISOString(),
        });
      }
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeoutId);
      resolve({
        status: 'unknown_error',
        message: `无法启动会话健康检查进程: ${err.message}`,
        checkedAt: new Date().toISOString(),
      });
    });
  });
}
