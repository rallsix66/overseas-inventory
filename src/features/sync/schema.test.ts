// Sync Feature Module — Schema 测试 (P5-SY5C2 V5.8)

import { describe, it, expect } from 'vitest';
import {
  triggerSyncSchema,
  getSyncRunsSchema,
  getSyncRunDetailSchema,
} from './schema';

describe('triggerSyncSchema — dry_run', () => {
  it('接受合法 dry_run 参数', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('dry_run');
      expect(result.data.warehouseId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('dry_run .strict() 拒绝 confirmToken', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      confirmToken: 'P5-SY3B-PH',
    });
    expect(result.success).toBe(false);
  });

  it('dry_run .strict() 拒绝 dryRunRunId', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      dryRunRunId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
    });
    expect(result.success).toBe(false);
  });

  it('dry_run .strict() 拒绝未知字段', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      unknownField: 'value',
    });
    expect(result.success).toBe(false);
  });

  it('dry_run .strict() 拒绝 path', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'dry_run',
      path: '/some/path',
    });
    expect(result.success).toBe(false);
  });

  it('dry_run 拒绝缺少 warehouseId', () => {
    const result = triggerSyncSchema.safeParse({ mode: 'dry_run' });
    expect(result.success).toBe(false);
  });

  it('dry_run 拒绝无效 uuid', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: 'not-a-uuid',
      mode: 'dry_run',
    });
    expect(result.success).toBe(false);
  });
});

describe('triggerSyncSchema — real_write', () => {
  it('接受合法 real_write 参数', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'real_write',
      dryRunRunId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
      confirmToken: 'P5-SY3B-PH',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('real_write');
    }
  });

  it('real_write .strict() 拒绝未知字段', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'real_write',
      dryRunRunId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
      confirmToken: 'P5-SY3B-PH',
      path: '/some/path',
    });
    expect(result.success).toBe(false);
  });

  it('real_write 拒绝缺少 dryRunRunId', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'real_write',
      confirmToken: 'P5-SY3B-PH',
    });
    expect(result.success).toBe(false);
  });

  it('real_write 拒绝错误 confirmToken', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'real_write',
      dryRunRunId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
      confirmToken: 'WRONG-TOKEN',
    });
    expect(result.success).toBe(false);
  });

  it('real_write 拒绝 signal 字段', () => {
    const result = triggerSyncSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'real_write',
      dryRunRunId: 'adc5ec45-cd98-42a8-a1d1-26600e80d481',
      confirmToken: 'P5-SY3B-PH',
      signal: 'some-signal',
    });
    expect(result.success).toBe(false);
  });
});

describe('getSyncRunsSchema', () => {
  it('接受合法参数', () => {
    const result = getSyncRunsSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it('warehouseId 可选', () => {
    const result = getSyncRunsSchema.safeParse({ limit: 10 });
    expect(result.success).toBe(true);
  });

  it('limit 默认值 100', () => {
    const result = getSyncRunsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it('拒绝 limit < 1', () => {
    const result = getSyncRunsSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('拒绝 limit > 100', () => {
    const result = getSyncRunsSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('拒绝 offset 参数', () => {
    const result = getSyncRunsSchema.safeParse({
      limit: 10,
      offset: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('getSyncRunDetailSchema', () => {
  it('接受合法 runId', () => {
    const result = getSyncRunDetailSchema.safeParse({
      runId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝无效 uuid', () => {
    const result = getSyncRunDetailSchema.safeParse({ runId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('拒绝缺少 runId', () => {
    const result = getSyncRunDetailSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
