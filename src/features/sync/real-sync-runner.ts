// Real SyncRunner — 通过 Python 桥接执行 BigSeller 抓取 + Supabase RPC 写入
//
// 替换 MockSyncRunner，连接真实数据管道。
// 仅限服务端使用，生产环境需要 Python + Playwright 运行环境。

import type { SyncRunner } from './sync-runner';
import type {
  SyncRunnerCapabilities,
  SyncExecuteParams,
  SyncExecuteParamsDryRun,
  SyncExecuteParamsRealWrite,
  SyncExecuteResult,
  JsonValue,
} from './types';
import { callPythonBridge } from '@/lib/python-bridge';
import path from 'node:path';
import fs from 'node:fs';

/** 仓库 ID → Python 桥接参数映射 */
export interface WarehouseBridgeInfo {
  id: string;
  name: string;
  oldName: string;
  country: string;
  token: string;
}

export class RealSyncRunner implements SyncRunner {
  private warehouseMap: Map<string, WarehouseBridgeInfo>;

  constructor(warehouses: WarehouseBridgeInfo[]) {
    this.warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
  }

  async capabilities(): Promise<SyncRunnerCapabilities> {
    return {
      supportsCancel: true,
      supportsTimeout: true,
      maxTimeoutMs: 600_000, // 10 minutes (BigSeller scrape is slow)
      supportedModes: ['dry_run', 'real_write'],
    };
  }

  async execute(params: SyncExecuteParams): Promise<SyncExecuteResult> {
    const wh = this.warehouseMap.get(params.warehouseId);
    if (!wh) {
      return makeErrorResult(params.warehouseId, `未知仓库: ${params.warehouseId}`);
    }

    const token =
      params.mode === 'real_write'
        ? (params as SyncExecuteParamsRealWrite).confirmToken
        : wh.token;

    // P5-SY9D: real_write 模式下，将 boundPlanArtifact 写入临时文件并传递给 Python bridge
    let priorDryRunPath: string | undefined;
    if (params.mode === 'real_write') {
      const realParams = params as SyncExecuteParamsRealWrite;
      if (realParams.boundPlanArtifact) {
        const runtimeDir = path.resolve(
          process.cwd(),
          'tools', 'bigseller-scraper', 'runtime',
        );
        fs.mkdirSync(runtimeDir, { recursive: true });
        priorDryRunPath = path.join(
          runtimeDir,
          `bound-plan-${realParams.dryRunRunId}.json`,
        );
        fs.writeFileSync(
          priorDryRunPath,
          JSON.stringify(realParams.boundPlanArtifact),
          'utf-8',
        );
      }
    }

    try {
      const bridgeResult = await callPythonBridge(
        {
          warehouseId: wh.id,
          warehouseName: wh.name,
          oldName: wh.oldName,
          country: wh.country,
          token,
          mode: params.mode,
          priorDryRunPath,
        },
        params.signal,
      );

      const exitCode = bridgeResult.exit_code === 0 ? 0 as const : 1 as const;

      return {
        success: bridgeResult.success,
        exitCode,
        summary: {
          warehouseId: bridgeResult.warehouse_id,
          warehouseName: bridgeResult.warehouse_name,
          variantsCreated: bridgeResult.summary.variants_created,
          variantsSkipped: bridgeResult.summary.variants_skipped,
          inventoryInserted: bridgeResult.summary.inventory_inserted,
          inventoryUpdated: bridgeResult.summary.inventory_updated,
          inventoryUnchanged: bridgeResult.summary.inventory_unchanged,
          warehouseRenamed: bridgeResult.summary.warehouse_renamed,
        },
        syncLog: {
          status: bridgeResult.success ? 'success' : 'failed',
          written: bridgeResult.success,
        },
        planDriftCheck: bridgeResult.plan_drift_check ?? 'PASS',
        planDriftCount: bridgeResult.plan_drift_count,
        planDriftDifferences: bridgeResult.plan_drift_differences,
        errors: bridgeResult.errors,
        startedAt: bridgeResult.started_at,
        finishedAt: bridgeResult.finished_at ?? new Date().toISOString(),
        durationMs: 0,
        planArtifact: params.mode === 'dry_run' && bridgeResult.success
          ? bridgeResult.summary as unknown as JsonValue
          : undefined,
      };
    } catch (err) {
      return makeErrorResult(wh.id, `Python 桥接失败: ${(err as Error).message}`);
    } finally {
      // 清理临时绑定的 plan 文件
      if (priorDryRunPath) {
        try { fs.unlinkSync(priorDryRunPath); } catch { /* best effort */ }
      }
    }
  }
}

function makeErrorResult(warehouseId: string, error: string): SyncExecuteResult {
  return {
    success: false,
    exitCode: 1,
    summary: {
      warehouseId,
      warehouseName: '',
      variantsCreated: 0,
      variantsSkipped: 0,
      inventoryInserted: 0,
      inventoryUpdated: 0,
      inventoryUnchanged: 0,
      warehouseRenamed: false,
    },
    syncLog: { status: 'failed', written: false },
    planDriftCheck: 'PASS',
    planDriftCount: 0,
    planDriftDifferences: [],
    errors: [error],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
  };
}
