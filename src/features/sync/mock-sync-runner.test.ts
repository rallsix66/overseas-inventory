// Sync Feature Module — MockSyncRunner 测试 (P5-SY5C2 V5.8)

import { describe, it, expect } from 'vitest';
import { MockSyncRunner } from './mock-sync-runner';
import type { SyncExecuteParamsDryRun, SyncExecuteParamsRealWrite, JsonValue } from './types';

const DRY_PARAMS: SyncExecuteParamsDryRun = {
  runId: 'run-1',
  warehouseId: 'wh-1',
  mode: 'dry_run',
  triggeredBy: 'user-1',
  inputArtifact: { skus: ['A', 'B'] },
};

const REAL_PARAMS: SyncExecuteParamsRealWrite = {
  runId: 'run-2',
  warehouseId: 'wh-1',
  mode: 'real_write',
  confirmToken: 'P5-SY3B-PH',
  triggeredBy: 'user-1',
  dryRunRunId: 'dry-run-1',
  inputArtifact: { skus: ['C'] },
  boundPlanArtifact: { warehouse_rename_required: null, new_variants: [] },
};

describe('MockSyncRunner — capabilities', () => {
  it('返回正确结构', async () => {
    const runner = new MockSyncRunner();
    const caps = await runner.capabilities();
    expect(caps.supportsCancel).toBe(false);
    expect(caps.supportsTimeout).toBe(false);
    expect(caps.maxTimeoutMs).toBe(0);
    expect(caps.supportedModes).toEqual(['dry_run', 'real_write']);
  });
});

describe('MockSyncRunner — execute exitCode', () => {
  it('默认 exitCode 0', async () => {
    const runner = new MockSyncRunner();
    const result = await runner.execute(DRY_PARAMS);
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  it('exitCode 可配置为 1', async () => {
    const runner = new MockSyncRunner();
    runner.exitCode = 1;
    const result = await runner.execute(DRY_PARAMS);
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
  });

  it('exitCode 可配置为 2', async () => {
    const runner = new MockSyncRunner();
    runner.exitCode = 2;
    const result = await runner.execute(DRY_PARAMS);
    expect(result.exitCode).toBe(2);
    expect(result.success).toBe(false);
  });

  it('shouldThrow 抛错', async () => {
    const runner = new MockSyncRunner();
    runner.shouldThrow = true;
    runner.throwMessage = '测试模拟异常';
    await expect(runner.execute(DRY_PARAMS)).rejects.toThrow('测试模拟异常');
  });
});

describe('MockSyncRunner — Dry Run', () => {
  it('exitCode=0 输出 planArtifact', async () => {
    const runner = new MockSyncRunner();
    const result = await runner.execute(DRY_PARAMS);
    expect(result.planArtifact).toBeDefined();
    const plan = result.planArtifact as Record<string, unknown>;
    expect(plan).toHaveProperty('warehouse_rename_required');
    expect(plan).toHaveProperty('new_variants');
    expect(plan).toHaveProperty('inventory_inserts');
    expect(plan).toHaveProperty('inventory_updates');
    expect(plan).toHaveProperty('inventory_unchanged');
    expect(plan).toHaveProperty('inventory_after_variant_create');
    expect(plan).toHaveProperty('rejected_rows');
    // Must NOT contain confirmToken or boundPlanArtifact
    expect(result).not.toHaveProperty('confirmToken');
  });

  it('planArtifact 为合法 JsonValue', async () => {
    const runner = new MockSyncRunner();
    const result = await runner.execute(DRY_PARAMS);
    const plan = result.planArtifact as Record<string, JsonValue>;
    expect(plan.rejected_rows).toEqual([]);
    expect(Array.isArray(plan.new_variants)).toBe(true);
  });

  it('非法 input（非 JsonValue）拒绝', async () => {
    const runner = new MockSyncRunner();
    const badParams = {
      ...DRY_PARAMS,
      inputArtifact: { bad: undefined },
    } as unknown as SyncExecuteParamsDryRun;
    await expect(runner.execute(badParams)).rejects.toThrow();
  });

  it('exitCode=1 不输出 planArtifact', async () => {
    const runner = new MockSyncRunner();
    runner.exitCode = 1;
    const result = await runner.execute(DRY_PARAMS);
    expect(result.planArtifact).toBeUndefined();
  });
});

describe('MockSyncRunner — Real Write', () => {
  it('exitCode=0 不输出 planArtifact', async () => {
    const runner = new MockSyncRunner();
    const result = await runner.execute(REAL_PARAMS);
    expect(result.planArtifact).toBeUndefined();
  });

  it('必须含 confirmToken + dryRunRunId + boundPlanArtifact', async () => {
    const runner = new MockSyncRunner();
    // Missing confirmToken
    const badParams = {
      ...REAL_PARAMS,
      confirmToken: 'WRONG',
    };
    await expect(runner.execute(badParams)).rejects.toThrow(
      '必须有效 confirmToken',
    );
  });

  it('非法 boundPlanArtifact 拒绝', async () => {
    const runner = new MockSyncRunner();
    const badParams = {
      ...REAL_PARAMS,
      boundPlanArtifact: { bad: undefined },
    } as unknown as SyncExecuteParamsRealWrite;
    await expect(runner.execute(badParams)).rejects.toThrow();
  });

  it('exitCode=1 不输出 planArtifact', async () => {
    const runner = new MockSyncRunner();
    runner.exitCode = 1;
    const result = await runner.execute(REAL_PARAMS);
    expect(result.planArtifact).toBeUndefined();
    expect(result.success).toBe(false);
  });
});

describe('MockSyncRunner — __mock__', () => {
  it('__mock__ 标记存在', () => {
    const runner = new MockSyncRunner();
    expect(runner.__mock__).toBe(true);
  });
});
