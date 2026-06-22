// Sync Feature Module — SupabaseSyncRepository
//
// 实现 SyncRepository 接口，通过 Supabase RPC 真实读写 sync_run 表。
// claim_sync_run / get_sync_runs / get_sync_run_detail 使用 authenticated client
// release_sync_run / heartbeat_sync_run / cleanup 使用 service_role client

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { SyncRepository } from './repository';
import type { SyncRunsResponse, SyncRunDetailResponse } from './types';

export class SupabaseSyncRepository implements SyncRepository {
  constructor(
    private authClient: SupabaseClient<Database>,
    private serviceClient: SupabaseClient<Database>,
  ) {}

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
    const { data, error } = await this.authClient.rpc('claim_sync_run', {
      p_warehouse_id: params.warehouseId,
      p_mode: params.mode,
      p_run_id: params.runId,
      p_lease_duration: params.leaseDuration,
      p_triggered_by: params.triggeredBy,
      p_triggered_from: params.triggeredFrom,
      p_dry_run_run_id: params.dryRunRunId ?? null,
      p_input_artifact_hash: params.inputArtifactHash ?? null,
      p_plan_artifact_hash: params.planArtifactHash ?? null,
    });

    if (error) throw new Error(`claim_sync_run RPC 失败: ${error.message}`);

    return data as string | null;
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
    const { error } = await this.serviceClient.rpc('release_sync_run', {
      p_run_id: params.runId,
      p_status: params.status,
      p_exit_code: params.exitCode,
      p_error_message: params.errorMessage ?? null,
      p_result_summary: params.resultSummary ?? null,
      p_plan_drift_check: params.planDriftCheck ?? null,
      p_plan_drift_count: params.planDriftCount ?? null,
      p_plan_drift_differences: params.planDriftDifferences ?? null,
      p_plan_artifact_hash: params.planArtifactHash ?? null,
    });

    if (error) throw new Error(`release_sync_run RPC 失败: ${error.message}`);
  }

  async heartbeatSyncRun(params: {
    runId: string;
    leaseDuration: number;
  }): Promise<void> {
    const { error } = await this.serviceClient.rpc('heartbeat_sync_run', {
      p_run_id: params.runId,
      p_lease_duration: params.leaseDuration,
    });

    if (error) throw new Error(`heartbeat_sync_run RPC 失败: ${error.message}`);
  }

  async getSyncRuns(params: {
    warehouseId?: string;
    limit: number;
  }): Promise<SyncRunsResponse> {
    const { data, error } = await this.authClient.rpc('get_sync_runs', {
      p_warehouse_id: params.warehouseId ?? null,
      p_limit: params.limit,
    });

    if (error) throw new Error(`get_sync_runs RPC 失败: ${error.message}`);

    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return (Array.isArray(parsed) ? parsed : []) as SyncRunsResponse;
  }

  async getSyncRunDetail(runId: string): Promise<SyncRunDetailResponse> {
    const { data, error } = await this.authClient.rpc('get_sync_run_detail', {
      p_run_id: runId,
    });

    if (error) throw new Error(`get_sync_run_detail RPC 失败: ${error.message}`);

    if (data === null || data === 'null') return null;

    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return (parsed ?? null) as SyncRunDetailResponse;
  }

  async cleanupExpiredSyncRuns(): Promise<number> {
    const { data, error } = await this.serviceClient.rpc(
      'cleanup_expired_sync_runs',
    );

    if (error)
      throw new Error(`cleanup_expired_sync_runs RPC 失败: ${error.message}`);

    return (data as number) ?? 0;
  }

  async getActiveRunIds(): Promise<Set<string>> {
    const { data, error } = await this.serviceClient
      .from('sync_run')
      .select('id')
      .eq('status', 'in_progress');

    if (error) throw new Error(`查询活跃运行失败: ${error.message}`);

    return new Set((data ?? []).map((r) => r.id));
  }

  async getRecentlyCompletedRunIds(since: Date): Promise<Set<string>> {
    const { data, error } = await this.serviceClient
      .from('sync_run')
      .select('id')
      .eq('status', 'completed')
      .gte('finished_at', since.toISOString());

    if (error) throw new Error(`查询近期完成运行失败: ${error.message}`);

    return new Set((data ?? []).map((r) => r.id));
  }

  async getReferencedDryRunIds(): Promise<Set<string>> {
    const { data, error } = await this.serviceClient
      .from('sync_run')
      .select('dry_run_run_id')
      .not('dry_run_run_id', 'is', null);

    if (error) throw new Error(`查询 Dry Run 引用失败: ${error.message}`);

    return new Set(
      (data ?? [])
        .map((r) => r.dry_run_run_id as string)
        .filter(Boolean),
    );
  }
}
