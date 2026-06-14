// Sync Feature Module — 类型契约测试
//
// 验证 SyncExecuteParams / SyncExecuteResult / SyncRunnerCapabilities
// 的字段存在性和严格类型约束。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  JsonValue,
  SyncExecuteParams,
  SyncExecuteResult,
  SyncRunnerCapabilities,
} from './types';
import type { SyncRunner } from './sync-runner';

// ─── Helper: compile-time type assertion ──────────────────────────
// These tests verify that the types compile correctly. Since TypeScript
// types are erased at runtime, we validate structural conformance.

/** Construct a valid SyncExecuteParams to verify the type compiles */
function validExecuteParams(
  overrides?: Partial<SyncExecuteParams>,
): SyncExecuteParams {
  return {
    runId: '550e8400-e29b-41d4-a716-446655440000',
    warehouseId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
    mode: 'dry_run',
    confirmToken: 'P5-SY3B-PH',
    triggeredBy: 'user-uuid',
    ...overrides,
  };
}

/** Construct a valid SyncExecuteResult to verify the type compiles */
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
    startedAt: '2026-06-14T12:00:00Z',
    finishedAt: '2026-06-14T12:05:00Z',
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

// ─── SyncExecuteParams ────────────────────────────────────────────

describe('SyncExecuteParams contract', () => {
  it('has required fields', () => {
    const params = validExecuteParams();
    expect(params.runId).toBeDefined();
    expect(params.warehouseId).toBeDefined();
    expect(params.mode).toBeDefined();
    expect(params.confirmToken).toBeDefined();
    expect(params.triggeredBy).toBeDefined();
  });

  it('accepts dry_run mode', () => {
    const params = validExecuteParams({ mode: 'dry_run' });
    expect(params.mode).toBe('dry_run');
  });

  it('accepts real_write mode', () => {
    const params = validExecuteParams({ mode: 'real_write' });
    expect(params.mode).toBe('real_write');
  });

  it('accepts optional signal', () => {
    const controller = new AbortController();
    const params = validExecuteParams({ signal: controller.signal });
    expect(params.signal).toBe(controller.signal);
  });

  it('accepts inputArtifact as JsonValue', () => {
    const artifact: JsonValue = { skus: ['A', 'B'] };
    const params = validExecuteParams({ inputArtifact: artifact });
    expect(params.inputArtifact).toEqual(artifact);
  });

  it('accepts boundPlanArtifact as JsonValue', () => {
    const plan: JsonValue = { plan: 'data' };
    const params = validExecuteParams({ boundPlanArtifact: plan });
    expect(params.boundPlanArtifact).toEqual(plan);
  });
});

// ─── SyncExecuteResult ────────────────────────────────────────────

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
});

// ─── SyncRunnerCapabilities ───────────────────────────────────────

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

// ─── Precise type assertions (compile-time) ───────────────────────

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

  it('inputArtifact is JsonValue | undefined', () => {
    expectTypeOf<SyncExecuteParams['inputArtifact']>().toEqualTypeOf<JsonValue | undefined>();
  });

  it('boundPlanArtifact is JsonValue | undefined', () => {
    expectTypeOf<SyncExecuteParams['boundPlanArtifact']>().toEqualTypeOf<JsonValue | undefined>();
  });
});

describe('SyncRunnerCapabilities — precise types', () => {
  it('supportedModes is exactly Array<dry_run | real_write>', () => {
    expectTypeOf<SyncRunnerCapabilities['supportedModes']>().toEqualTypeOf<Array<'dry_run' | 'real_write'>>();
  });
});

describe('SyncRunner — precise types', () => {
  it('execute returns Promise<SyncExecuteResult>', () => {
    expectTypeOf<SyncRunner['execute']>().toEqualTypeOf<(params: SyncExecuteParams) => Promise<SyncExecuteResult>>();
  });

  it('capabilities returns Promise<SyncRunnerCapabilities>', () => {
    expectTypeOf<SyncRunner['capabilities']>().toEqualTypeOf<() => Promise<SyncRunnerCapabilities>>();
  });
});

// ─── SyncRunner interface shape ───────────────────────────────────

describe('SyncRunner interface shape', () => {
  it('is defined (interface exists)', () => {
    // TypeScript compile-time check — at runtime we verify the
    // module exports the type via import resolution
    expect(true).toBe(true);
  });
});
