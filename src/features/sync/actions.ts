// Sync Feature Module — Actions 依赖工厂 (P5-SY5C2 V5.8)
//
// createSyncActions 仅为服务调用工厂，不是客户端可直接调用的 Next.js Server Action。
// 不含 "use server" 指令，不导出预构建 Action 单例。
// 由后续任务负责创建顶层 "use server" Action 与真实依赖组合。

import 'server-only';

import type { SyncRepository } from './repository';
import type { SyncService } from './sync-service';
import type { JsonValue, SyncRunsResponse, SyncRunDetailResponse } from './types';
import { triggerSyncSchema, triggerSyncAllSchema, syncWarehouseSchema, getSyncRunsSchema, getSyncRunDetailSchema } from './schema';
import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';

// ─── InputArtifactSource ──────────────────────────────────────────

/** 服务端 input artifact 来源。
 *  在真实 Provider/Runner 就绪前，仅 Mock 实现存在。
 *  生产实现由后续任务提供（如文件系统读取、数据库加载）。 */
export interface InputArtifactSource {
  getInputArtifact(
    warehouseId: string,
    mode: 'dry_run' | 'real_write',
  ): Promise<JsonValue>;
}

// ─── SyncActionsDeps ─────────────────────────────────────────────

export interface SyncActionsDeps {
  repository: SyncRepository;
  syncService: SyncService; // 由 createSyncService() 创建
  inputArtifactSource: InputArtifactSource;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createSyncActions(deps: SyncActionsDeps) {
  return {
    async triggerSync(formData: FormData): Promise<{
      success: boolean;
      runId: string;
      status: string;
      error?: string;
    }> {
      // 1. requireActiveAdmin()
      const _user = await requireActiveAdmin();

      // 2. Zod 校验 triggerSyncSchema（含 .strict()）
      //    条件传入 dryRunRunId / confirmToken，避免 undefined key 触发 .strict() 拒绝
      const rawMode = formData.get('mode');
      const rawDryRunId = formData.get('dryRunRunId');
      const rawConfirmToken = formData.get('confirmToken');
      const parsed = triggerSyncSchema.parse({
        warehouseId: formData.get('warehouseId'),
        mode: rawMode,
        ...(rawDryRunId ? { dryRunRunId: rawDryRunId } : {}),
        ...(rawConfirmToken ? { confirmToken: rawConfirmToken } : {}),
      });

      // 3. 从 deps.inputArtifactSource.getInputArtifact() 获取 inputArtifact
      //    禁止从 formData、客户端 cookie、localStorage 或任何客户端可控来源获取
      const inputArtifact = await deps.inputArtifactSource.getInputArtifact(
        parsed.warehouseId,
        parsed.mode,
      );

      // 4. 构造 SyncServiceInput（判别联合，dry_run 不含 confirmToken）
      const triggeredBy = _user.id;
      if (parsed.mode === 'dry_run') {
        const result = await deps.syncService.executeSync({
          warehouseId: parsed.warehouseId,
          mode: 'dry_run',
          inputArtifact,
          triggeredBy,
        });
        return {
          success: result.status === 'completed',
          runId: result.runId,
          status: result.status,
          error: result.error,
        };
      }

      // real_write
      const result = await deps.syncService.executeSync({
        warehouseId: parsed.warehouseId,
        mode: 'real_write',
        inputArtifact,
        dryRunRunId: parsed.dryRunRunId!,
        confirmToken: parsed.confirmToken!,
        triggeredBy,
      });
      return {
        success: result.status === 'completed',
        runId: result.runId,
        status: result.status,
        error: result.error,
      };
    },

    async triggerSyncAll(
      warehouseIds: Array<{ id: string; name: string }>,
      formData: FormData,
    ): Promise<{
      results: Array<{
        warehouseId: string;
        warehouseName: string;
        success: boolean;
        runId: string;
        status: string;
        error?: string;
      }>;
      allSuccess: boolean;
    }> {
      await requireActiveAdmin();

      const rawMode = formData.get('mode');
      const rawDryRunId = formData.get('dryRunRunId');
      const rawConfirmToken = formData.get('confirmToken');
      const parsed = triggerSyncAllSchema.parse({
        mode: rawMode,
        ...(rawDryRunId ? { dryRunRunId: rawDryRunId } : {}),
        ...(rawConfirmToken ? { confirmToken: rawConfirmToken } : {}),
      });

      const triggeredBy = (await requireActiveAdmin()).id;
      const results: Array<{
        warehouseId: string;
        warehouseName: string;
        success: boolean;
        runId: string;
        status: string;
        error?: string;
      }> = [];

      for (const wh of warehouseIds) {
        // Build per-warehouse FormData
        const singleFd = new FormData();
        singleFd.set('warehouseId', wh.id);
        singleFd.set('mode', parsed.mode);
        if (parsed.mode === 'real_write') {
          singleFd.set('dryRunRunId', parsed.dryRunRunId);
          singleFd.set('confirmToken', parsed.confirmToken);
        }

        try {
          // Reuse triggerSync logic per warehouse
          const parsedSingle = triggerSyncSchema.parse({
            warehouseId: wh.id,
            mode: parsed.mode,
            ...(parsed.mode === 'real_write'
              ? { dryRunRunId: (parsed as { dryRunRunId: string }).dryRunRunId, confirmToken: (parsed as { confirmToken: string }).confirmToken }
              : {}),
          });

          const inputArtifact = await deps.inputArtifactSource.getInputArtifact(
            parsedSingle.warehouseId,
            parsedSingle.mode,
          );

          let result;
          if (parsedSingle.mode === 'dry_run') {
            result = await deps.syncService.executeSync({
              warehouseId: parsedSingle.warehouseId,
              mode: 'dry_run',
              inputArtifact,
              triggeredBy,
            });
          } else {
            result = await deps.syncService.executeSync({
              warehouseId: parsedSingle.warehouseId,
              mode: 'real_write',
              inputArtifact,
              dryRunRunId: parsedSingle.dryRunRunId,
              confirmToken: parsedSingle.confirmToken,
              triggeredBy,
            });
          }

          results.push({
            warehouseId: wh.id,
            warehouseName: wh.name,
            success: result.status === 'completed',
            runId: result.runId,
            status: result.status,
            error: result.error,
          });
        } catch (err) {
          results.push({
            warehouseId: wh.id,
            warehouseName: wh.name,
            success: false,
            runId: '',
            status: 'failed',
            error: (err as Error).message,
          });
        }
      }

      return {
        results,
        allSuccess: results.every((r) => r.success),
      };
    },

    async syncWarehouse(
      warehouseId: string,
      warehouseName: string,
      confirmToken: string,
    ): Promise<{
      warehouseId: string;
      warehouseName: string;
      success: boolean;
      runId: string;
      status: string;
      error?: string;
      dryRunRunId?: string;
    }> {
      const user = await requireActiveAdmin();
      const triggeredBy = user.id;

      // Validate warehouseId
      syncWarehouseSchema.parse({ warehouseId });

      // ─── Phase 1: Dry Run ─────────────────────────────────
      let dryRunRunId: string;
      try {
        const inputArtifact = await deps.inputArtifactSource.getInputArtifact(
          warehouseId,
          'dry_run',
        );

        const dryRunResult = await deps.syncService.executeSync({
          warehouseId,
          mode: 'dry_run',
          inputArtifact,
          triggeredBy,
        });

        if (dryRunResult.status !== 'completed') {
          return {
            warehouseId,
            warehouseName,
            success: false,
            runId: dryRunResult.runId,
            status: 'failed',
            error: dryRunResult.error || 'Dry Run 失败',
          };
        }

        dryRunRunId = dryRunResult.runId;
      } catch (err) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `Dry Run 异常: ${(err as Error).message}`,
        };
      }

      // ─── Phase 2: Real Write ──────────────────────────────
      try {
        const realInputArtifact = await deps.inputArtifactSource.getInputArtifact(
          warehouseId,
          'real_write',
        );

        const realResult = await deps.syncService.executeSync({
          warehouseId,
          mode: 'real_write',
          inputArtifact: realInputArtifact,
          dryRunRunId,
          confirmToken,
          triggeredBy,
        });

        return {
          warehouseId,
          warehouseName,
          success: realResult.status === 'completed',
          runId: realResult.runId,
          status: realResult.status,
          error: realResult.error,
          dryRunRunId,
        };
      } catch (err) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `Real Write 失败: ${(err as Error).message}`,
          dryRunRunId,
        };
      }
    },

    async getSyncRunsAction(
      warehouseId?: string,
      limit?: number,
    ): Promise<SyncRunsResponse> {
      await requireActiveAuth();
      const parsed = getSyncRunsSchema.parse({ warehouseId, limit });
      return deps.repository.getSyncRuns({
        warehouseId: parsed.warehouseId,
        limit: parsed.limit,
      });
    },

    async getSyncRunDetailAction(runId: string): Promise<SyncRunDetailResponse> {
      await requireActiveAuth();
      const parsed = getSyncRunDetailSchema.parse({ runId });
      return deps.repository.getSyncRunDetail(parsed.runId);
    },
  };
}

export type SyncActions = ReturnType<typeof createSyncActions>;
