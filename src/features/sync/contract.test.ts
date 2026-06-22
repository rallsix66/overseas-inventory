// Sync Feature Module — 类型契约测试 (P5-SY5C2 V5.8)
//
// 验证 discriminator union、SyncServiceResult、SyncServiceInput、
// SyncRunAdminRow/OperatorRow、PreparedArtifact/Artifact 等类型。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  JsonValue,
  SyncExecuteParams,
  SyncExecuteParamsDryRun,
  SyncExecuteParamsRealWrite,
  SyncExecuteResult,
  SyncRunnerCapabilities,
  SyncServiceInput,
  SyncServiceInputDryRun,
  SyncServiceInputRealWrite,
  SyncServiceResult,
  SyncRunAdminRow,
  SyncRunOperatorRow,
  PreparedArtifact,
  Artifact,
  ArtifactCandidate,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────────

function validExecuteParamsDryRun(
  overrides?: Partial<SyncExecuteParamsDryRun>,
): SyncExecuteParamsDryRun {
  return {
    runId: '550e8400-e29b-41d4-a716-446655440000',
    warehouseId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
    mode: 'dry_run',
    triggeredBy: 'user-uuid',
    inputArtifact: { skus: ['A', 'B'] },
    ...overrides,
  };
}

function validExecuteParamsRealWrite(
  overrides?: Partial<SyncExecuteParamsRealWrite>,
): SyncExecuteParamsRealWrite {
  return {
    runId: '550e8400-e29b-41d4-a716-446655440000',
    warehouseId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
    mode: 'real_write',
    confirmToken: 'P5-SY3B-PH',
    triggeredBy: 'user-uuid',
    dryRunRunId: '660e8400-e29b-41d4-a716-446655440001',
    inputArtifact: { skus: ['C'] },
    boundPlanArtifact: { plan: 'data' },
    ...overrides,
  };
}

function validExecuteResult(
  overrides?: Partial<SyncExecuteResult>,
): SyncExecuteResult {
  return {
    success: true,
    exitCode: 0,
    summary: {
      warehouseId: 'wh-1',
      warehouseName: 'PH',
      variantsCreated: 10,
      variantsSkipped: 0,
      inventoryInserted: 5,
      inventoryUpdated: 3,
      inventoryUnchanged: 2,
      warehouseRenamed: false,
    },
    syncLog: { status: 'success', written: true },
    planDriftCheck: 'PASS',
    planDriftCount: 0,
    planDriftDifferences: [],
    errors: [],
    startedAt: '2026-06-19T12:00:00Z',
    finishedAt: '2026-06-19T12:05:00Z',
    durationMs: 300000,
    ...overrides,
  };
}

function validRunnerCapabilities(
  overrides?: Partial<SyncRunnerCapabilities>,
): SyncRunnerCapabilities {
  return {
    supportsCancel: false,
    supportsTimeout: false,
    maxTimeoutMs: 0,
    supportedModes: ['dry_run', 'real_write'],
    ...overrides,
  };
}

// ─── SyncExecuteParams discriminator union ──────────────────────────

describe('SyncExecuteParams — discriminator union', () => {
  it('SyncExecuteParamsDryRun has required fields (no confirmToken/boundPlanArtifact)', () => {
    const params = validExecuteParamsDryRun();
    expect(params.runId).toBeDefined();
    expect(params.warehouseId).toBeDefined();
    expect(params.mode).toBe('dry_run');
    expect(params.triggeredBy).toBeDefined();
    expect(params.inputArtifact).toEqual({ skus: ['A', 'B'] });
    // confirmToken / boundPlanArtifact / dryRunRunId MUST NOT exist on DryRun
    expect('confirmToken' in params).toBe(false);
    expect('boundPlanArtifact' in params).toBe(false);
    expect('dryRunRunId' in params).toBe(false);
  });

  it('SyncExecuteParamsRealWrite has confirmToken + dryRunRunId + boundPlanArtifact', () => {
    const params = validExecuteParamsRealWrite();
    expect(params.mode).toBe('real_write');
    expect(params.confirmToken).toBe('P5-SY3B-PH');
    expect(params.dryRunRunId).toBeDefined();
    expect(params.boundPlanArtifact).toEqual({ plan: 'data' });
    expect(params.inputArtifact).toEqual({ skus: ['C'] });
  });

  it('SyncExecuteParamsDryRun accepts optional signal', () => {
    const controller = new AbortController();
    const params = validExecuteParamsDryRun({ signal: controller.signal });
    expect(params.signal).toBe(controller.signal);
  });

  it('SyncExecuteParamsRealWrite accepts optional signal', () => {
    const controller = new AbortController();
    const params = validExecuteParamsRealWrite({ signal: controller.signal });
    expect(params.signal).toBe(controller.signal);
  });

  it('both branches assignable to SyncExecuteParams', () => {
    const dry: SyncExecuteParams = validExecuteParamsDryRun();
    const rw: SyncExecuteParams = validExecuteParamsRealWrite();
    expect(dry.mode).toBe('dry_run');
    expect(rw.mode).toBe('real_write');
  });
});

// ─── SyncExecuteResult ──────────────────────────────────────────────

describe('SyncExecuteResult contract', () => {
  it('has exitCode 0 for success', () => {
    const result = validExecuteResult({ exitCode: 0 });
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  it('has exitCode 1 for RPC/audit failure', () => {
    const result = validExecuteResult({ exitCode: 1, success: false });
    expect(result.exitCode).toBe(1);
  });

  it('has exitCode 2 for sync_log write failure', () => {
    const result = validExecuteResult({ exitCode: 2, success: false });
    expect(result.exitCode).toBe(2);
  });

  it('has strict summary fields', () => {
    const result = validExecuteResult();
    expect(result.summary.warehouseId).toBeDefined();
    expect(result.summary.warehouseName).toBeDefined();
    expect(typeof result.summary.variantsCreated).toBe('number');
    expect(typeof result.summary.variantsSkipped).toBe('number');
    expect(typeof result.summary.inventoryInserted).toBe('number');
    expect(typeof result.summary.inventoryUpdated).toBe('number');
    expect(typeof result.summary.inventoryUnchanged).toBe('number');
    expect(typeof result.summary.warehouseRenamed).toBe('boolean');
  });

  it('has syncLog with status and written', () => {
    const result = validExecuteResult();
    expect(result.syncLog.status).toBe('success');
    expect(result.syncLog.written).toBe(true);
  });

  it('has syncLog fallbackPath for failed writes', () => {
    const result = validExecuteResult({
      syncLog: { status: 'failed', written: false, fallbackPath: '/tmp/fallback.json' },
    });
    expect(result.syncLog.fallbackPath).toBe('/tmp/fallback.json');
  });

  it('has plan drift fields', () => {
    const result = validExecuteResult();
    expect(result.planDriftCheck).toBe('PASS');
    expect(result.planDriftCount).toBe(0);
    expect(result.planDriftDifferences).toEqual([]);
  });

  it('has DRIFT_DETECTED with drift count and differences', () => {
    const diffs = ['SKU A: quantity changed'];
    const result = validExecuteResult({
      planDriftCheck: 'DRIFT_DETECTED',
      planDriftCount: 1,
      planDriftDifferences: diffs,
    });
    expect(result.planDriftCheck).toBe('DRIFT_DETECTED');
    expect(result.planDriftCount).toBe(1);
    expect(result.planDriftDifferences).toBe(diffs);
  });

  it('has timing fields', () => {
    const result = validExecuteResult();
    expect(result.startedAt).toBeDefined();
    expect(result.finishedAt).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });

  it('has errors array', () => {
    const result = validExecuteResult({ errors: ['error 1', 'error 2'] });
    expect(result.errors).toEqual(['error 1', 'error 2']);
  });

  it('has optional planArtifact', () => {
    const result = validExecuteResult({
      planArtifact: { warehouse_rename_required: null, new_variants: [] },
    });
    expect(result.planArtifact).toBeDefined();
  });
});

// ─── SyncRunnerCapabilities ─────────────────────────────────────────

describe('SyncRunnerCapabilities contract', () => {
  it('has all required fields', () => {
    const caps = validRunnerCapabilities();
    expect(typeof caps.supportsCancel).toBe('boolean');
    expect(typeof caps.supportsTimeout).toBe('boolean');
    expect(typeof caps.maxTimeoutMs).toBe('number');
    expect(Array.isArray(caps.supportedModes)).toBe(true);
  });

  it('accepts dry_run only', () => {
    const caps = validRunnerCapabilities({ supportedModes: ['dry_run'] });
    expect(caps.supportedModes).toEqual(['dry_run']);
  });

  it('accepts real_write only', () => {
    const caps = validRunnerCapabilities({ supportedModes: ['real_write'] });
    expect(caps.supportedModes).toEqual(['real_write']);
  });
});

// ─── SyncServiceInput discriminator union ───────────────────────────

describe('SyncServiceInput — discriminator union', () => {
  it('SyncServiceInputDryRun has mode, warehouseId, inputArtifact, triggeredBy', () => {
    const input: SyncServiceInputDryRun = {
      warehouseId: 'wh-1',
      mode: 'dry_run',
      inputArtifact: { skus: ['A'] },
      triggeredBy: 'user-1',
    };
    expect(input.mode).toBe('dry_run');
    expect('confirmToken' in input).toBe(false);
    expect('dryRunRunId' in input).toBe(false);
  });

  it('SyncServiceInputRealWrite has confirmToken + dryRunRunId', () => {
    const input: SyncServiceInputRealWrite = {
      warehouseId: 'wh-1',
      mode: 'real_write',
      inputArtifact: { skus: ['B'] },
      dryRunRunId: 'dry-1',
      confirmToken: 'P5-SY3B-PH',
      triggeredBy: 'user-1',
    };
    expect(input.mode).toBe('real_write');
    expect(input.confirmToken).toBe('P5-SY3B-PH');
    expect(input.dryRunRunId).toBe('dry-1');
  });

  it('both branches assignable to SyncServiceInput', () => {
    const dry: SyncServiceInput = {
      warehouseId: 'wh-1',
      mode: 'dry_run',
      inputArtifact: {},
      triggeredBy: 'u',
    };
    const rw: SyncServiceInput = {
      warehouseId: 'wh-1',
      mode: 'real_write',
      inputArtifact: {},
      dryRunRunId: 'd',
      confirmToken: 'P5-SY3B-PH',
      triggeredBy: 'u',
    };
    expect(dry.mode).toBe('dry_run');
    expect(rw.mode).toBe('real_write');
  });
});

// ─── SyncServiceResult ──────────────────────────────────────────────

describe('SyncServiceResult contract', () => {
  it('completed: runId, status, runnerResult (success=true)', () => {
    const result: SyncServiceResult = {
      runId: 'run-1',
      status: 'completed',
      runnerResult: validExecuteResult({ exitCode: 0, success: true }),
    };
    expect(result.runId).toBe('run-1');
    expect(result.status).toBe('completed');
    expect(result.runnerResult).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('failed: runId, status, error (no runnerResult)', () => {
    const result: SyncServiceResult = {
      runId: 'run-2',
      status: 'failed',
      error: 'claim 失败',
    };
    expect(result.status).toBe('failed');
    expect(result.error).toBe('claim 失败');
    expect(result.runnerResult).toBeUndefined();
  });

  it('indeterminate: runId, status, runnerResult, error, artifactDisposition', () => {
    const result: SyncServiceResult = {
      runId: 'run-3',
      status: 'indeterminate',
      runnerResult: validExecuteResult({ exitCode: 0, success: true }),
      error: 'release completed 失败',
      artifactDisposition: {
        inputRetained: true,
        planRetained: false,
        reason: '审计写入失败：运行状态落库失败',
      },
    };
    expect(result.status).toBe('indeterminate');
    expect(result.runnerResult).toBeDefined();
    expect(result.error).toBeDefined();
    expect(result.artifactDisposition?.inputRetained).toBe(true);
    expect(result.artifactDisposition?.planRetained).toBe(false);
  });
});

// ─── SyncRunAdminRow / SyncRunOperatorRow ───────────────────────────

describe('SyncRunAdminRow contract', () => {
  it('has admin-specific fields', () => {
    const row: SyncRunAdminRow = {
      id: 'run-1',
      warehouse_id: 'wh-1',
      warehouse_name: 'PH Warehouse',
      mode: 'dry_run',
      status: 'completed',
      display_name: 'Admin User',
      triggered_from: 'web',
      started_at: '2026-06-19T12:00:00Z',
      finished_at: '2026-06-19T12:05:00Z',
      created_at: '2026-06-19T12:00:00Z',
      exit_code: 0,
      error_message: null,
      result_summary: null,
      plan_drift_check: 'PASS',
      plan_drift_count: 0,
      dry_run_run_id: null,
    };
    expect(row.exit_code).toBe(0);
    expect(row.error_message).toBeNull();
    expect(row.display_name).toBe('Admin User');
    expect(row.dry_run_run_id).toBeNull();
  });
});

describe('SyncRunOperatorRow contract', () => {
  it('has operator-specific fields (no exit_code, has triggered_by_email, failure_summary)', () => {
    const row: SyncRunOperatorRow = {
      id: 'run-1',
      warehouse_id: 'wh-1',
      warehouse_name: 'PH Warehouse',
      mode: 'dry_run',
      status: 'completed',
      triggered_by_email: 'u***@example.com',
      triggered_from: 'web',
      started_at: '2026-06-19T12:00:00Z',
      finished_at: '2026-06-19T12:05:00Z',
      created_at: '2026-06-19T12:00:00Z',
      plan_drift_check: 'PASS',
      plan_drift_count: 0,
      result_summary: null,
      failure_summary: null,
    };
    expect(row.triggered_by_email).toBe('u***@example.com');
    expect(row.failure_summary).toBeNull();
    // Operator row MUST NOT have exit_code
    expect('exit_code' in row).toBe(false);
    expect('error_message' in row).toBe(false);
    expect('display_name' in row).toBe(false);
  });
});

// ─── PreparedArtifact / Artifact ────────────────────────────────────

describe('PreparedArtifact contract', () => {
  it('has bytes, hash, normalizedContent', () => {
    const pa: PreparedArtifact = {
      bytes: new Uint8Array([1, 2, 3]),
      hash: 'abc123',
      normalizedContent: { key: 'value' },
    };
    expect(pa.bytes).toBeInstanceOf(Uint8Array);
    expect(typeof pa.hash).toBe('string');
    expect(pa.normalizedContent).toEqual({ key: 'value' });
  });
});

describe('Artifact contract', () => {
  it('has runId, type, content, hash, storedAt', () => {
    const art: Artifact = {
      runId: 'run-1',
      type: 'input',
      content: { sku: 'WM0001' },
      hash: 'def456',
      storedAt: '2026-06-19T12:00:00Z',
    };
    expect(art.runId).toBe('run-1');
    expect(art.type).toBe('input');
    expect(typeof art.storedAt).toBe('string');
  });

  it('type is input | plan', () => {
    const input: Artifact = {
      runId: 'r1', type: 'input', content: {}, hash: 'h', storedAt: 's',
    };
    const plan: Artifact = {
      runId: 'r1', type: 'plan', content: {}, hash: 'h', storedAt: 's',
    };
    expect(input.type).toBe('input');
    expect(plan.type).toBe('plan');
  });
});

describe('ArtifactCandidate contract', () => {
  it('has runId, type, createdAt', () => {
    const candidate: ArtifactCandidate = {
      runId: 'run-1',
      type: 'input',
      createdAt: new Date('2026-06-19T12:00:00Z'),
    };
    expect(candidate.runId).toBe('run-1');
    expect(candidate.type).toBe('input');
    expect(candidate.createdAt).toBeInstanceOf(Date);
  });
});

// ─── Precise type assertions (compile-time) ─────────────────────────

describe('SyncExecuteResult — precise types', () => {
  it('exitCode is exactly 0 | 1 | 2', () => {
    expectTypeOf<SyncExecuteResult['exitCode']>().toEqualTypeOf<0 | 1 | 2>();
  });

  it('planDriftCheck is exactly PASS | DRIFT_DETECTED', () => {
    expectTypeOf<SyncExecuteResult['planDriftCheck']>().toEqualTypeOf<'PASS' | 'DRIFT_DETECTED'>();
  });

  it('syncLog.status is exactly success | failed', () => {
    expectTypeOf<SyncExecuteResult['syncLog']['status']>().toEqualTypeOf<'success' | 'failed'>();
  });
});

describe('SyncExecuteParams — precise types', () => {
  it('mode is exactly dry_run | real_write', () => {
    expectTypeOf<SyncExecuteParams['mode']>().toEqualTypeOf<'dry_run' | 'real_write'>();
  });

  it('SyncExecuteParamsDryRun has inputArtifact as JsonValue (required)', () => {
    expectTypeOf<SyncExecuteParamsDryRun['inputArtifact']>().toEqualTypeOf<JsonValue>();
  });

  it('SyncExecuteParamsRealWrite has boundPlanArtifact as JsonValue (required)', () => {
    expectTypeOf<SyncExecuteParamsRealWrite['boundPlanArtifact']>().toEqualTypeOf<JsonValue>();
  });

  it('SyncExecuteParamsRealWrite has confirmToken as string (required)', () => {
    expectTypeOf<SyncExecuteParamsRealWrite['confirmToken']>().toEqualTypeOf<string>();
  });
});

describe('SyncRunnerCapabilities — precise types', () => {
  it('supportedModes is exactly Array<dry_run | real_write>', () => {
    expectTypeOf<SyncRunnerCapabilities['supportedModes']>().toEqualTypeOf<Array<'dry_run' | 'real_write'>>();
  });
});

describe('SyncServiceResult — precise types', () => {
  it('status is completed | failed | indeterminate', () => {
    expectTypeOf<SyncServiceResult['status']>().toEqualTypeOf<'completed' | 'failed' | 'indeterminate'>();
  });
});

describe('ArtifactCandidate — precise types', () => {
  it('type is input | plan', () => {
    expectTypeOf<ArtifactCandidate['type']>().toEqualTypeOf<'input' | 'plan'>();
  });
});
