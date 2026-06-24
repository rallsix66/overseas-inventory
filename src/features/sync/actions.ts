// Sync Feature Module — Actions 依赖工厂 (P5-SY5C2 V5.8)
//
// createSyncActions 仅为服务调用工厂，不是客户端可直接调用的 Next.js Server Action。
// 不含 "use server" 指令，不导出预构建 Action 单例。
// 由后续任务负责创建顶层 "use server" Action 与真实依赖组合。

import 'server-only';

import type { SyncRepository } from './repository';
import type { SyncService } from './sync-service';
import type { ArtifactProvider } from './artifact-provider';
import type { JsonValue, SyncRunsResponse, SyncRunDetailResponse, TriggerDryRunResult, ConfirmRealWriteResult, BatchDryRunResult, BatchDryRunItemResult, BatchRealWriteItem, BatchRealWriteResult, BatchRealWriteItemResult, AutoPreReviewItem, AutoPreReviewResult, SessionHealthResult, WarehouseHistory, RuleVerdict } from './types';
import { evaluateRules } from './rules-engine';
import { triggerSyncSchema, triggerSyncAllSchema, syncWarehouseSchema, getSyncRunsSchema, getSyncRunDetailSchema, confirmRealWriteSchema, triggerBatchRealWriteSchema } from './schema';
import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';

/** Dry Run 过期窗口（毫秒）。超过此窗口的 Dry Run 不能绑定 Real Write。
 *  与 DB claim lease (300s) 对齐为 60 分钟（2× 典型抓取超时），防止跨天 Dry Run 绑定。 */
const DRY_RUN_EXPIRY_MS = 60 * 60 * 1000; // 60 minutes

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
  /** P5-SY9D rework: artifactProvider 用于加载绑定的 Dry Run artifact */
  artifactProvider: ArtifactProvider;
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

    // ─── P5-SY9D: 单仓 Dry Run（仅 Dry Run，不自动链 Real Write） ──

    async triggerDryRun(
      warehouseId: string,
      warehouseName: string,
    ): Promise<TriggerDryRunResult> {
      const user = await requireActiveAdmin();
      const triggeredBy = user.id;

      syncWarehouseSchema.parse({ warehouseId });

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

        // 构造审核摘要
        const summary = dryRunResult.runnerResult?.summary;
        const planContent = dryRunResult.runnerResult?.planArtifact as Record<string, unknown> | undefined;
        const scraperMeta = dryRunResult.runnerResult?.scraperMeta;
        return {
          warehouseId,
          warehouseName,
          success: true,
          runId: dryRunResult.runId,
          status: 'completed',
          summary: {
            warehouseName,
            country: (planContent?.country as string) ?? '',
            rawRowCount: scraperMeta?.rawRowCount ?? 0,
            validSkuCount: scraperMeta?.validSkuCount ?? 0,
            invalidSkuCount: scraperMeta?.invalidSkuCount ?? 0,
            variantsCreated: summary?.variantsCreated ?? 0,
            inventoryInserted: summary?.inventoryInserted ?? 0,
            inventoryUpdated: summary?.inventoryUpdated ?? 0,
            inventoryUnchanged: summary?.inventoryUnchanged ?? 0,
            warehouseRenamed: summary?.warehouseRenamed ?? false,
            planDriftCheck: dryRunResult.runnerResult?.planDriftCheck ?? 'PASS',
            planDriftCount: dryRunResult.runnerResult?.planDriftCount ?? 0,
          },
        };
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
    },

    // ─── P5-SY9D rework: 确认 Real Write（绑定已完成 Dry Run） ───

    async confirmRealWrite(
      warehouseId: string,
      warehouseName: string,
      country: string,
      dryRunRunId: string,
      confirmToken: string,
    ): Promise<ConfirmRealWriteResult> {
      const user = await requireActiveAdmin();
      const triggeredBy = user.id;

      confirmRealWriteSchema.parse({ warehouseId, dryRunRunId });

      // ── 1. 加载 Dry Run 绑定元数据（含 hash 字段） ─────────
      //     getDryRunBindingMetadata 使用 serviceClient 直查 public.sync_run，
      //     绕过 get_sync_run_detail RPC 的脱敏设计，返回 input_artifact_hash
      //     和 plan_artifact_hash。仅供 Server Action 后端调用。
      const metadata = await deps.repository.getDryRunBindingMetadata(dryRunRunId);
      if (!metadata) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 不存在: ${dryRunRunId}`,
          dryRunRunId,
        };
      }

      // 验证 mode — 必须为 dry_run
      if (metadata.mode !== 'dry_run') {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的运行不是 Dry Run（模式: ${metadata.mode}）`,
          dryRunRunId,
        };
      }

      // 验证 status — 必须为 completed
      if (metadata.status !== 'completed') {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 未完成（状态: ${metadata.status}）`,
          dryRunRunId,
        };
      }

      // 验证 warehouse_id 一致
      if (metadata.warehouse_id !== warehouseId) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 仓库不匹配（预期: ${warehouseId}, 实际: ${metadata.warehouse_id}）`,
          dryRunRunId,
        };
      }

      // ── 2. 验证 Dry Run 未过期 ────────────────────────────
      if (!metadata.finished_at) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 缺少完成时间，无法验证是否过期`,
          dryRunRunId,
        };
      }
      const finishedAt = new Date(metadata.finished_at);
      const ageMs = Date.now() - finishedAt.getTime();
      if (ageMs >= DRY_RUN_EXPIRY_MS) {
        const ageMinutes = Math.round(ageMs / 60000);
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 已过期（完成于 ${finishedAt.toISOString()}，距今约 ${ageMinutes} 分钟，超过 ${DRY_RUN_EXPIRY_MS / 60000} 分钟限制）`,
          dryRunRunId,
        };
      }

      // 验证 plan_drift_check — 必须为 PASS
      if (metadata.plan_drift_check !== 'PASS') {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 计划漂移未通过（plan_drift_check: ${metadata.plan_drift_check}）`,
          dryRunRunId,
        };
      }

      // ── 3. 从 ArtifactProvider 加载 Dry Run artifact ───────
      //     禁止重新抓取：Real Write 必须使用绑定的 Dry Run 的
      //     input artifact + plan artifact，不得调用
      //     inputArtifactSource.getInputArtifact(..., 'real_write')
      let dryRunInput: { content: JsonValue; hash: string };
      let dryRunPlan: { content: JsonValue; hash: string };
      try {
        const inputArtifact = await deps.artifactProvider.get(dryRunRunId, 'input');
        dryRunInput = { content: inputArtifact.content, hash: inputArtifact.hash };
      } catch (err) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定 Dry Run input artifact 加载失败: ${(err as Error).message}`,
          dryRunRunId,
        };
      }

      try {
        const planArtifact = await deps.artifactProvider.get(dryRunRunId, 'plan');
        dryRunPlan = { content: planArtifact.content, hash: planArtifact.hash };
      } catch (err) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定 Dry Run plan artifact 加载失败: ${(err as Error).message}`,
          dryRunRunId,
        };
      }

      // ── 4. 验证 country 一致（强制，不得条件跳过）──────────
      const planContent = dryRunPlan.content as Record<string, unknown>;
      const planCountry = planContent?.country;
      if (typeof planCountry !== 'string' || planCountry.length === 0) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 计划缺少有效的 country 字段（值: ${String(planCountry)}）`,
          dryRunRunId,
        };
      }
      if (planCountry !== country) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 国家不匹配（预期: ${country}, Dry Run: ${planCountry}）`,
          dryRunRunId,
        };
      }

      // ── 5. 应用层 Hash 校验（强制） ───────────────────────
      //     对比 metadata（serviceClient 直查 sync_run）的 hash 与
      //     ArtifactProvider 当前存储 hash。
      //     hash 字段缺失则阻断，不得"字段存在才校验"。
      //     DB claim_sync_run RPC 在事务内做二次防御性验证。

      if (!metadata.input_artifact_hash) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 缺少 input_artifact_hash（DB sync_run 记录），无法验证输入完整性`,
          dryRunRunId,
        };
      }
      if (metadata.input_artifact_hash !== dryRunInput.hash) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `input hash 不一致（DB: ${metadata.input_artifact_hash}, artifact: ${dryRunInput.hash}）`,
          dryRunRunId,
        };
      }

      if (!metadata.plan_artifact_hash) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `绑定的 Dry Run 缺少 plan_artifact_hash（DB sync_run 记录），无法验证计划完整性`,
          dryRunRunId,
        };
      }
      if (metadata.plan_artifact_hash !== dryRunPlan.hash) {
        return {
          warehouseId,
          warehouseName,
          success: false,
          runId: '',
          status: 'failed',
          error: `plan hash 不一致（DB: ${metadata.plan_artifact_hash}, artifact: ${dryRunPlan.hash}）`,
          dryRunRunId,
        };
      }

      // ── 6. 执行 Real Write ──────────────────────────────────
      //     使用绑定的 Dry Run input artifact（不重新抓取）
      try {
        const realResult = await deps.syncService.executeSync({
          warehouseId,
          mode: 'real_write',
          inputArtifact: dryRunInput.content,
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

    // ─── P5-SY9F: 批量全部海外仓 Dry Run ───────────────────────

    async triggerBatchDryRun(
      warehouses: Array<{ id: string; name: string; country: string }>,
    ): Promise<BatchDryRunResult> {
      const triggeredBy = (await requireActiveAdmin()).id;

      const results: BatchDryRunItemResult[] = [];

      for (const wh of warehouses) {
        try {
          syncWarehouseSchema.parse({ warehouseId: wh.id });

          const inputArtifact = await deps.inputArtifactSource.getInputArtifact(
            wh.id,
            'dry_run',
          );

          const dryRunResult = await deps.syncService.executeSync({
            warehouseId: wh.id,
            mode: 'dry_run',
            inputArtifact,
            triggeredBy,
          });

          if (dryRunResult.status !== 'completed') {
            results.push({
              warehouseId: wh.id,
              warehouseName: wh.name,
              country: wh.country,
              runId: dryRunResult.runId,
              status: 'failed',
              rawRowCount: 0,
              validSkuCount: 0,
              invalidSkuCount: 0,
              variantsCreated: 0,
              inventoryInserted: 0,
              inventoryUpdated: 0,
              inventoryUnchanged: 0,
              warehouseRenamePlan: null,
              planDriftCheck: null,
              planDriftCount: 0,
              failureReason: dryRunResult.error || 'Dry Run 失败',
            });
            continue;
          }

          const summary = dryRunResult.runnerResult?.summary;
          const planContent = dryRunResult.runnerResult?.planArtifact as Record<string, unknown> | undefined;
          const scraperMeta = dryRunResult.runnerResult?.scraperMeta;
          const planDriftCheck = dryRunResult.runnerResult?.planDriftCheck ?? 'PASS';
          const renameRequired = planContent?.warehouse_rename_required as Record<string, unknown> | undefined;

          // Build warehouse rename plan details from plan artifact
          let warehouseRenamePlan: BatchDryRunItemResult['warehouseRenamePlan'] = null;
          if (renameRequired) {
            warehouseRenamePlan = {
              action: (renameRequired.action === 'rename' ? 'rename' : 'none') as 'rename' | 'none',
              currentName: renameRequired.current_name as string | undefined,
              targetName: renameRequired.target_name as string | undefined,
              message: renameRequired.message as string | undefined,
            };
          }

          // DRIFT_DETECTED → blocked, not ready
          const isBlocked = planDriftCheck !== 'PASS';

          results.push({
            warehouseId: wh.id,
            warehouseName: wh.name,
            country: (planContent?.country as string) || wh.country,
            runId: dryRunResult.runId,
            status: isBlocked ? 'blocked' : 'ready',
            rawRowCount: scraperMeta?.rawRowCount ?? 0,
            validSkuCount: scraperMeta?.validSkuCount ?? 0,
            invalidSkuCount: scraperMeta?.invalidSkuCount ?? 0,
            variantsCreated: summary?.variantsCreated ?? 0,
            inventoryInserted: summary?.inventoryInserted ?? 0,
            inventoryUpdated: summary?.inventoryUpdated ?? 0,
            inventoryUnchanged: summary?.inventoryUnchanged ?? 0,
            warehouseRenamePlan,
            planDriftCheck,
            planDriftCount: dryRunResult.runnerResult?.planDriftCount ?? 0,
            failureReason: isBlocked ? `计划漂移未通过（plan_drift_check=${planDriftCheck}，${dryRunResult.runnerResult?.planDriftCount ?? 0} 项差异）` : undefined,
          });
        } catch (err) {
          results.push({
            warehouseId: wh.id,
            warehouseName: wh.name,
            country: wh.country,
            runId: '',
            status: 'failed',
            rawRowCount: 0,
            validSkuCount: 0,
            invalidSkuCount: 0,
            variantsCreated: 0,
            inventoryInserted: 0,
            inventoryUpdated: 0,
            inventoryUnchanged: 0,
            warehouseRenamePlan: null,
            planDriftCheck: null,
            planDriftCount: 0,
            failureReason: `Dry Run 异常: ${(err as Error).message}`,
          });
        }
      }

      return {
        results,
        allSucceeded: results.every((r) => r.status === 'ready'),
        successCount: results.filter((r) => r.status === 'ready').length,
        failedCount: results.filter((r) => r.status === 'failed').length,
        blockedCount: results.filter((r) => r.status === 'blocked').length,
      };
    },

    // ─── P5-SY10C: 自动预审编排 ─────────────────────────────────

    /** 串联 session health → 逐仓预取历史 → 批量 Dry Run → 规则评估。
     *  在 triggerBatchDryRun 之前先获取各仓历史上下文并缓存，
     *  确保本次 Dry Run 不会污染规则评估所用的 history 数据。
     *  PASS 仍需走人工审核 + confirmRealWrite，不自动写库。 */
    async runAutoPreReview(
      warehouses: Array<{ id: string; name: string; country: string }>,
      sessionHealth: SessionHealthResult,
    ): Promise<AutoPreReviewResult> {
      // 1. 逐仓预取历史上下文（必须在 triggerBatchDryRun 之前，
      //    避免本次 Dry Run 写入的 sync_run 记录污染历史判断）。
      const preRunHistory = new Map<string, { history: WarehouseHistory | null; error?: string }>();
      for (const wh of warehouses) {
        try {
          const history = await deps.repository.getWarehouseHistory(wh.id);
          preRunHistory.set(wh.id, { history });
        } catch (err) {
          preRunHistory.set(wh.id, { history: null, error: (err as Error).message });
        }
      }

      // 2. 执行批量 Dry Run
      let batchResult: BatchDryRunResult;
      try {
        batchResult = await this.triggerBatchDryRun(warehouses);
      } catch (err) {
        return {
          items: [],
          summary: { total: 0, pass: 0, warn: 0, block: 0, failed: 0 },
          sessionHealth,
          blockReason: `批量 Dry Run 执行失败: ${(err as Error).message}`,
        };
      }

      // 全局阻断（如 triggerBatchDryRun 内部异常保护）——正常情况下由
      // Server Action 层的 session health guard 提前拦截，此处为防御性检查。
      if (batchResult.blockReason) {
        return {
          items: [],
          summary: { total: 0, pass: 0, warn: 0, block: 0, failed: 0 },
          sessionHealth,
          blockReason: batchResult.blockReason,
        };
      }

      // 3. 逐仓规则评估（使用预取的 pre-run history，不查当前 run 后的状态）
      const items: AutoPreReviewItem[] = [];
      for (const item of batchResult.results) {
        const cached = preRunHistory.get(item.warehouseId);

        let history: WarehouseHistory;
        let ruleVerdict: RuleVerdict;

        if (cached?.history) {
          // 历史上下文获取成功 — 使用预取历史进行规则评估
          history = cached.history;
          ruleVerdict = evaluateRules({
            sessionHealth,
            dryRun: {
              status: item.status,
              planDriftCheck: item.planDriftCheck,
              rawRowCount: item.rawRowCount,
              validSkuCount: item.validSkuCount,
              invalidSkuCount: item.invalidSkuCount,
              variantsCreated: item.variantsCreated,
              inventoryInserted: item.inventoryInserted,
              inventoryUpdated: item.inventoryUpdated,
              inventoryUnchanged: item.inventoryUnchanged,
              warehouseRenamePlan: item.warehouseRenamePlan ?? null,
              failureReason: item.failureReason,
            },
            history,
          });
        } else {
          // 历史上下文获取失败 — 该仓必须 BLOCK，不使用冷启动默认值
          history = {
            hasBaseline: false,
            consecutiveFailures: 0,
            lastSuccess: null,
            stats: null,
          };
          ruleVerdict = {
            decision: 'BLOCK',
            evaluations: [
              {
                rule: 'history_unavailable',
                level: 'BLOCK',
                message: `历史上下文读取失败，无法安全预审${cached?.error ? `：${cached.error}` : ''}`,
              },
            ],
            summary: '1 项阻断',
          };
        }

        items.push({
          warehouseId: item.warehouseId,
          warehouseName: item.warehouseName,
          country: item.country,
          dryRun: {
            status: item.status,
            runId: item.runId,
            failureReason: item.failureReason,
            rawRowCount: item.rawRowCount,
            validSkuCount: item.validSkuCount,
            invalidSkuCount: item.invalidSkuCount,
            variantsCreated: item.variantsCreated,
            inventoryInserted: item.inventoryInserted,
            inventoryUpdated: item.inventoryUpdated,
            inventoryUnchanged: item.inventoryUnchanged,
            planDriftCheck: item.planDriftCheck,
            planDriftCount: item.planDriftCount,
            warehouseRenamePlan: item.warehouseRenamePlan ?? null,
          },
          history,
          ruleVerdict,
        });
      }

      // 4. 汇总统计
      return {
        items,
        summary: {
          total: items.length,
          pass: items.filter((i) => i.ruleVerdict.decision === 'PASS').length,
          warn: items.filter((i) => i.ruleVerdict.decision === 'WARN').length,
          block: items.filter((i) => i.ruleVerdict.decision === 'BLOCK').length,
          failed: items.filter((i) => i.dryRun.status === 'failed').length,
        },
        sessionHealth,
      };
    },

    // ─── P5-SY9G: 批量审核后真实写入 ──────────────────────────

    async triggerBatchRealWrite(
      items: BatchRealWriteItem[],
      confirmationPhrase: string,
    ): Promise<BatchRealWriteResult> {
      await requireActiveAdmin();

      // Zod 校验确认短语和勾选项清单
      triggerBatchRealWriteSchema.parse({ confirmationPhrase, items });

      const results: BatchRealWriteItemResult[] = [];

      for (const item of items) {
        try {
          // 逐仓调用 confirmRealWrite，复用全部绑定校验
          // （Dry Run 存在性/状态/仓库一致/未过期/plan_drift_check=PASS/
          //   country 一致/input hash/plan hash）
          const realResult = await this.confirmRealWrite(
            item.warehouseId,
            item.warehouseName,
            item.country,
            item.dryRunRunId,
            item.confirmToken,
          );

          if (realResult.success) {
            results.push({
              warehouseId: item.warehouseId,
              warehouseName: item.warehouseName,
              country: item.country,
              dryRunRunId: item.dryRunRunId,
              status: 'success',
              runId: realResult.runId,
            });
          } else {
            results.push({
              warehouseId: item.warehouseId,
              warehouseName: item.warehouseName,
              country: item.country,
              dryRunRunId: item.dryRunRunId,
              status: 'failed',
              runId: realResult.runId || '',
              failureReason: realResult.error || 'Real Write 失败',
            });
          }
        } catch (err) {
          results.push({
            warehouseId: item.warehouseId,
            warehouseName: item.warehouseName,
            country: item.country,
            dryRunRunId: item.dryRunRunId,
            status: 'failed',
            runId: '',
            failureReason: `Real Write 异常: ${(err as Error).message}`,
          });
        }
      }

      return {
        results,
        allSucceeded: results.every((r) => r.status === 'success'),
        successCount: results.filter((r) => r.status === 'success').length,
        failedCount: results.filter((r) => r.status === 'failed').length,
        skippedCount: results.filter((r) => r.status === 'skipped').length,
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
