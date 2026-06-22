// Sync Feature Module — Repository 接口 + Mock 实现 (P5-SY5C2 V5.8)

import type {
  SyncRunsResponse,
  SyncRunDetailResponse,
} from './types';

// ─── Repository 接口 ──────────────────────────────────────────────

export interface SyncRepository {
  /** claim_sync_run RPC — 返回获得的 run id，NULL 表示仓库被锁定或无可回收槽位 */
  claimSyncRun(params: {
    warehouseId: string;
    mode: 'dry_run' | 'real_write';
    runId: string;
    leaseDuration: number; // 秒，范围 [30, 900]
    triggeredBy: string;
    triggeredFrom: 'web';
    dryRunRunId?: string; // real_write 必须
    inputArtifactHash?: string;
    planArtifactHash?: string;
  }): Promise<string | null>;

  /** release_sync_run RPC */
  releaseSyncRun(params: {
    runId: string;
    status: 'completed' | 'failed';
    exitCode: 0 | 1 | 2;
    errorMessage?: string;
    resultSummary?: Record<string, unknown>;
    planDriftCheck?: 'PASS' | 'DRIFT_DETECTED';
    planDriftCount?: number;
    planDriftDifferences?: string[];
    planArtifactHash?: string;
  }): Promise<void>;

  /** heartbeat_sync_run RPC — runId + leaseDuration，内部验证 leaseDuration ∈ [30, 900] */
  heartbeatSyncRun(params: {
    runId: string;
    leaseDuration: number;
  }): Promise<void>;

  /** get_sync_runs RPC — 无 offset 参数，返回角色感知结果 */
  getSyncRuns(params: { warehouseId?: string; limit: number }): Promise<SyncRunsResponse>;

  /** get_sync_run_detail RPC — 返回角色感知结果，不存在返回 null */
  getSyncRunDetail(runId: string): Promise<SyncRunDetailResponse>;

  /** cleanup_expired_sync_runs RPC — 返回清理数量 */
  cleanupExpiredSyncRuns(): Promise<number>;

  /** 返回所有 status='in_progress' 的 runId 集合 */
  getActiveRunIds(): Promise<Set<string>>;

  /** 返回 finished_at >= since 的 completed runId 集合（保护窗口内） */
  getRecentlyCompletedRunIds(since: Date): Promise<Set<string>>;

  /** 返回所有 real_write 记录的 dry_run_run_id（非 NULL）— 被引用的 Dry Run */
  getReferencedDryRunIds(): Promise<Set<string>>;
}

// ─── Mock Repository ──────────────────────────────────────────────

interface MockRunRecord {
  id: string;
  warehouseId: string;
  mode: 'dry_run' | 'real_write';
  status: 'in_progress' | 'completed' | 'failed';
  triggeredBy: string;
  triggeredFrom: 'web' | 'cli';
  leaseExpiresAt: Date;
  heartbeatAt: Date;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  exitCode: number | null;
  errorMessage: string | null;
  resultSummary: Record<string, unknown> | null;
  planDriftCheck: 'PASS' | 'DRIFT_DETECTED' | null;
  planDriftCount: number | null;
  planDriftDifferences: string[] | null;
  planArtifactHash: string | null;
  inputArtifactHash: string | null;
  dryRunRunId: string | null;
}

export class MockRepository implements SyncRepository {
  private static runs = new Map<string, MockRunRecord>();
  private clock: () => Date;

  constructor(private callerRole: 'admin' | 'operator') {
    this.clock = () => new Date();
  }

  /** Override internal clock for testing */
  _setClock(clock: () => Date): void {
    this.clock = clock;
  }

  _getAllRuns(): MockRunRecord[] {
    return Array.from(MockRepository.runs.values());
  }

  static _resetAll(): void {
    MockRepository.runs.clear();
  }

  // Instance alias for backward compatibility in tests
  _reset(): void {
    MockRepository.runs.clear();
  }

  async claimSyncRun(params: {
    warehouseId: string;
    mode: 'dry_run' | 'real_write';
    runId: string;
    leaseDuration: number;
    triggeredBy: string;
    triggeredFrom: 'web';
    dryRunRunId?: string;
    inputArtifactHash?: string;
    planArtifactHash?: string;
  }): Promise<string | null> {
    if (params.leaseDuration < 30 || params.leaseDuration > 900) {
      throw new Error('leaseDuration 必须在 [30, 900] 范围内');
    }

    const now = this.clock();

    // Check if any in_progress run exists for this warehouse with a valid lease
    for (const run of MockRepository.runs.values()) {
      if (run.warehouseId === params.warehouseId && run.status === 'in_progress') {
        if (run.leaseExpiresAt > now) {
          return null; // warehouse locked by another active run
        }
        // Expired lease — reclaimable
        run.status = 'failed';
        run.exitCode = 2;
        run.finishedAt = new Date(now.getTime());
        run.errorMessage = '租约过期，被后续 claim 回收';
      }
    }

    const newRun: MockRunRecord = {
      id: params.runId,
      warehouseId: params.warehouseId,
      mode: params.mode,
      status: 'in_progress',
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
      leaseExpiresAt: new Date(now.getTime() + params.leaseDuration * 1000),
      heartbeatAt: now,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      exitCode: null,
      errorMessage: null,
      resultSummary: null,
      planDriftCheck: null,
      planDriftCount: null,
      planDriftDifferences: null,
      planArtifactHash: null,
      inputArtifactHash: params.inputArtifactHash ?? null,
      dryRunRunId: params.dryRunRunId ?? null,
    };

    MockRepository.runs.set(params.runId, newRun);
    return params.runId;
  }

  async releaseSyncRun(params: {
    runId: string;
    status: 'completed' | 'failed';
    exitCode: 0 | 1 | 2;
    errorMessage?: string;
    resultSummary?: Record<string, unknown>;
    planDriftCheck?: 'PASS' | 'DRIFT_DETECTED';
    planDriftCount?: number;
    planDriftDifferences?: string[];
    planArtifactHash?: string;
  }): Promise<void> {
    const run = MockRepository.runs.get(params.runId);
    if (!run) {
      throw new Error(`sync_run ${params.runId} 不存在`);
    }
    if (run.status !== 'in_progress') {
      throw new Error(
        `无法 release 状态为 ${run.status} 的运行（仅 in_progress 可 release）`,
      );
    }

    // Business rules
    if (params.status === 'completed' && params.exitCode !== 0) {
      throw new Error('completed 状态必须 exitCode=0');
    }
    if (params.status === 'failed' && !(params.exitCode === 1 || params.exitCode === 2)) {
      throw new Error('failed 状态必须 exitCode IN (1, 2)');
    }

    // Dry Run completed must have plan drift fields
    if (run.mode === 'dry_run' && params.status === 'completed') {
      if (!params.planDriftCheck) {
        throw new Error('Dry Run completed 必须传 planDriftCheck');
      }
      if (params.planDriftCount === undefined || params.planDriftCount === null) {
        throw new Error('Dry Run completed 必须传 planDriftCount');
      }
      if (!params.planDriftDifferences) {
        throw new Error('Dry Run completed 必须传 planDriftDifferences');
      }
    }

    const now = this.clock();
    run.status = params.status;
    run.exitCode = params.exitCode;
    run.errorMessage = params.errorMessage ?? null;
    run.resultSummary = params.resultSummary ?? null;
    run.planDriftCheck = params.planDriftCheck ?? null;
    run.planDriftCount = params.planDriftCount ?? null;
    run.planDriftDifferences = params.planDriftDifferences ?? null;
    run.planArtifactHash = params.planArtifactHash ?? null;
    run.finishedAt = now;
  }

  async heartbeatSyncRun(params: {
    runId: string;
    leaseDuration: number;
  }): Promise<void> {
    if (params.leaseDuration < 30 || params.leaseDuration > 900) {
      throw new Error('leaseDuration 必须在 [30, 900] 范围内');
    }

    const run = MockRepository.runs.get(params.runId);
    if (!run) {
      throw new Error(`sync_run ${params.runId} 不存在`);
    }
    if (run.status !== 'in_progress') {
      throw new Error('只能对 in_progress 运行发送心跳');
    }

    const now = this.clock();
    run.heartbeatAt = now;
    run.leaseExpiresAt = new Date(now.getTime() + params.leaseDuration * 1000);
  }

  async getSyncRuns(params: {
    warehouseId?: string;
    limit: number;
  }): Promise<SyncRunsResponse> {
    let result = Array.from(MockRepository.runs.values());

    if (params.warehouseId) {
      result = result.filter((r) => r.warehouseId === params.warehouseId);
    }

    result.sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
    result = result.slice(0, params.limit);

    if (this.callerRole === 'admin') {
      return result.map((r) => ({
        id: r.id,
        warehouse_id: r.warehouseId,
        warehouse_name: `仓库-${r.warehouseId.slice(0, 8)}`,
        mode: r.mode,
        status: r.status,
        display_name: `用户-${r.triggeredBy.slice(0, 8)}`,
        triggered_from: r.triggeredFrom,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        exit_code: r.exitCode,
        error_message: r.errorMessage,
        result_summary: r.resultSummary,
        plan_drift_check: r.planDriftCheck,
        plan_drift_count: r.planDriftCount,
        dry_run_run_id: r.dryRunRunId,
      }));
    }

    // Operator view
    return result.map((r) => ({
      id: r.id,
      warehouse_id: r.warehouseId,
      warehouse_name: `仓库-${r.warehouseId.slice(0, 8)}`,
      mode: r.mode,
      status: r.status,
      triggered_by_email: `${r.triggeredBy.slice(0, 6)}***@example.com`,
      triggered_from: r.triggeredFrom,
      started_at: r.startedAt.toISOString(),
      finished_at: r.finishedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
      plan_drift_check: r.planDriftCheck,
      plan_drift_count: r.planDriftCount,
      result_summary: r.resultSummary
        ? {
            variantsCreated: (r.resultSummary as Record<string, unknown>).variantsCreated,
            inventoryUpdated: (r.resultSummary as Record<string, unknown>).inventoryUpdated,
          }
        : null,
      failure_summary: r.status === 'failed' && r.errorMessage
        ? `同步失败：${r.errorMessage.slice(0, 50)}`
        : null,
    }));
  }

  async getSyncRunDetail(runId: string): Promise<SyncRunDetailResponse> {
    const run = MockRepository.runs.get(runId);
    if (!run) return null;

    if (this.callerRole === 'admin') {
      return {
        id: run.id,
        warehouse_id: run.warehouseId,
        warehouse_name: `仓库-${run.warehouseId.slice(0, 8)}`,
        mode: run.mode,
        status: run.status,
        display_name: `用户-${run.triggeredBy.slice(0, 8)}`,
        triggered_from: run.triggeredFrom,
        started_at: run.startedAt.toISOString(),
        finished_at: run.finishedAt?.toISOString() ?? null,
        created_at: run.createdAt.toISOString(),
        exit_code: run.exitCode,
        error_message: run.errorMessage,
        result_summary: run.resultSummary,
        plan_drift_check: run.planDriftCheck,
        plan_drift_count: run.planDriftCount,
        dry_run_run_id: run.dryRunRunId,
        plan_drift_differences: run.planDriftDifferences,
      };
    }

    // Operator view
    return {
      id: run.id,
      warehouse_id: run.warehouseId,
      warehouse_name: `仓库-${run.warehouseId.slice(0, 8)}`,
      mode: run.mode,
      status: run.status,
      triggered_by_email: `${run.triggeredBy.slice(0, 6)}***@example.com`,
      triggered_from: run.triggeredFrom,
      started_at: run.startedAt.toISOString(),
      finished_at: run.finishedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
      plan_drift_check: run.planDriftCheck,
      plan_drift_count: run.planDriftCount,
      result_summary: run.resultSummary
        ? {
            variantsCreated: (run.resultSummary as Record<string, unknown>).variantsCreated,
            inventoryUpdated: (run.resultSummary as Record<string, unknown>).inventoryUpdated,
          }
        : null,
      failure_summary: run.status === 'failed' && run.errorMessage
        ? `同步失败：${run.errorMessage.slice(0, 50)}`
        : null,
    };
  }

  async getActiveRunIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const run of MockRepository.runs.values()) {
      if (run.status === 'in_progress') {
        ids.add(run.id);
      }
    }
    return ids;
  }

  async getRecentlyCompletedRunIds(since: Date): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const run of MockRepository.runs.values()) {
      if (
        run.status === 'completed' &&
        run.finishedAt !== null &&
        run.finishedAt >= since
      ) {
        ids.add(run.id);
      }
    }
    return ids;
  }

  async getReferencedDryRunIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const run of MockRepository.runs.values()) {
      if (run.dryRunRunId !== null) {
        ids.add(run.dryRunRunId);
      }
    }
    return ids;
  }

  async cleanupExpiredSyncRuns(): Promise<number> {
    const now = this.clock();
    let count = 0;

    for (const run of MockRepository.runs.values()) {
      if (run.status === 'in_progress' && run.leaseExpiresAt <= now) {
        run.status = 'failed';
        run.exitCode = 2;
        run.finishedAt = new Date(now.getTime());
        run.errorMessage = '租约过期，被 cleanup 清理';
        count++;
      }
    }

    return count;
  }
}
