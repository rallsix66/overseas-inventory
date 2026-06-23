// Sync Feature Module — Mock SyncRunner (P5-SY5C2 V5.8)
//
// 纯内存实现，供测试和开发环境使用。
// 生产环境由 createSyncService 拒绝（通过 __mock__ 标记检测）。

import type { SyncRunner } from './sync-runner';
import type {
  SyncRunnerCapabilities,
  SyncExecuteParams,
  SyncExecuteParamsDryRun,
  SyncExecuteParamsRealWrite,
  SyncExecuteResult,
  JsonValue,
} from './types';
import { validateJsonValue } from './validate-json-value';

/** Mock Plan Artifact 构造器 — 返回与 plan_generator.generate_plan() 结构一致的固定数据 */
function buildMockPlanArtifact(): JsonValue {
  return {
    country: 'PH',
    warehouse_rename_required: null,
    new_variants: [
      {
        sku: 'WM0001',
        name: 'Mock Product',
        country: 'PH',
        product_id: null,
        match_status: 'unmatched',
        target_quantity: 100,
      },
    ],
    inventory_inserts: [],
    inventory_updates: [],
    inventory_unchanged: [],
    inventory_after_variant_create: [
      {
        sku: 'WM0001',
        warehouse_id: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
        warehouse_name: '菲律宾-新创启辰自建仓',
        new_quantity: 100,
        depends_on: 'variant_creation',
        note: 'P5-SY3B: 先创建 variant(WM0001) 获取 variant_id，再 INSERT inventory',
      },
    ],
    rejected_rows: [],
  };
}

function buildSuccessResult(
  params: SyncExecuteParams,
  planArtifact?: JsonValue,
  drift?: { check: 'PASS' | 'DRIFT_DETECTED'; count: number },
): SyncExecuteResult {
  return {
    success: true,
    exitCode: 0,
    summary: {
      warehouseId: params.warehouseId,
      warehouseName: '菲律宾-新创启辰自建仓',
      variantsCreated: 1,
      variantsSkipped: 0,
      inventoryInserted: 0,
      inventoryUpdated: 0,
      inventoryUnchanged: 0,
      warehouseRenamed: false,
    },
    syncLog: { status: 'success', written: true },
    planDriftCheck: drift?.check ?? 'PASS',
    planDriftCount: drift?.count ?? 0,
    planDriftDifferences: [],
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    planArtifact,
    scraperMeta: {
      rawRowCount: 91,
      validSkuCount: 91,
      invalidSkuCount: 0,
    },
  };
}

export class MockSyncRunner implements SyncRunner {
  /** 生产环境拒绝标记 */
  readonly __mock__ = true;

  /** 可配置的退出码（默认 0=成功） */
  exitCode: 0 | 1 | 2 = 0;

  /** 配置是否在 execute 时抛错（模拟未捕获异常） */
  shouldThrow = false;

  /** 配置抛出的错误消息 */
  throwMessage = 'MockSyncRunner 模拟未捕获异常';

  /** P5-SY9F: 可配置的计划漂移检查结果 */
  planDriftCheck: 'PASS' | 'DRIFT_DETECTED' = 'PASS';

  /** P5-SY9F: 可配置的计划漂移数量 */
  planDriftCount = 0;

  /** P5-SY9F: 可配置的仓库改名计划（null 表示无改名计划） */
  renamePlan: Record<string, unknown> | null = null;

  /** P5-SY9E: 模拟执行延迟（毫秒）。期间检查 signal 是否 aborted。
   *  用于测试 heartbeat 续租和 timeout/abort 行为。默认 0（立即完成）。 */
  delayMs = 0;

  /** P5-SY9E: signal aborted 时抛出的错误消息前缀 */
  abortErrorMessage = '同步被取消';

  /** P5-SY9E: 覆盖 capabilities（用于 timeout 测试） */
  private _capsOverride: Partial<SyncRunnerCapabilities> = {};

  /** P5-SY9E rework: capabilities() 抛错（测试 prepareRunnerContext 异常清理） */
  shouldThrowCapabilities = false;

  _setCapabilities(caps: Partial<SyncRunnerCapabilities>): void {
    this._capsOverride = caps;
  }

  async capabilities(): Promise<SyncRunnerCapabilities> {
    if (this.shouldThrowCapabilities) {
      throw new Error('Mock capabilities 查询失败');
    }
    return {
      supportsCancel: this._capsOverride.supportsCancel ?? false,
      supportsTimeout: this._capsOverride.supportsTimeout ?? false,
      maxTimeoutMs: this._capsOverride.maxTimeoutMs ?? 0,
      supportedModes: ['dry_run', 'real_write'],
    };
  }

  async execute(params: SyncExecuteParams): Promise<SyncExecuteResult> {
    if (this.shouldThrow) {
      throw new Error(this.throwMessage);
    }

    // P5-SY9E: 模拟执行延迟，期间定期检查 signal 是否 aborted
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + this.delayMs;
        const check = () => {
          if (params.signal?.aborted) {
            reject(new Error(`${this.abortErrorMessage}: ${params.signal.reason ?? '用户取消'}`));
            return;
          }
          if (Date.now() >= deadline) {
            resolve();
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    }

    // Mode-specific validation
    if (params.mode === 'dry_run') {
      const dryParams = params as SyncExecuteParamsDryRun;
      validateJsonValue(dryParams.inputArtifact);

      // Dry Run must not have confirmToken or boundPlanArtifact
      if ('confirmToken' in dryParams) {
        throw new Error('Dry Run SyncExecuteParams 不得包含 confirmToken');
      }
      if ('boundPlanArtifact' in dryParams) {
        throw new Error('Dry Run SyncExecuteParams 不得包含 boundPlanArtifact');
      }

      const planArtifact: JsonValue | undefined = this.exitCode === 0
        ? { ...(buildMockPlanArtifact() as Record<string, unknown>), warehouse_rename_required: this.renamePlan } as unknown as JsonValue
        : undefined;
      const result = buildSuccessResult(params, planArtifact, { check: this.planDriftCheck, count: this.planDriftCount });
      if (this.exitCode !== 0) {
        result.success = false;
        result.exitCode = this.exitCode;
        result.errors = [`MockSyncRunner exitCode=${this.exitCode}`];
      }
      return result;
    }

    // real_write mode
    const realParams = params as SyncExecuteParamsRealWrite;
    validateJsonValue(realParams.inputArtifact);
    validateJsonValue(realParams.boundPlanArtifact);

    // Real Write must have confirmToken + dryRunRunId + boundPlanArtifact
    const KNOWN_TOKENS = [
      'P5-SY3B-PH',
      'P5-SY8B-VN',
      'P5-SY8D-TH',
      'P5-SY8F-MY',
      'P5-SY8H-ID',
    ];
    if (!realParams.confirmToken || !KNOWN_TOKENS.includes(realParams.confirmToken)) {
      throw new Error(`Real Write 必须有效 confirmToken（已知令牌: ${KNOWN_TOKENS.join(', ')}）`);
    }
    if (!realParams.dryRunRunId) {
      throw new Error('Real Write 必须 dryRunRunId');
    }
    if (!realParams.boundPlanArtifact) {
      throw new Error('Real Write 必须 boundPlanArtifact');
    }

    // Real Write must NOT output planArtifact
    const result = buildSuccessResult(params, undefined, { check: this.planDriftCheck, count: this.planDriftCount });
    if (this.exitCode !== 0) {
      result.success = false;
      result.exitCode = this.exitCode;
      result.errors = [`MockSyncRunner exitCode=${this.exitCode}`];
    }
    return result;
  }
}
