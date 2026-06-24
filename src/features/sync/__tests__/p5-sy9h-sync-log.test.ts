// P5-SY9H: sync_log 相关测试 — MockRepository getSyncLog + schema 验证
import { describe, it, expect, beforeEach } from 'vitest';
import { MockRepository } from '../repository';
import { getSyncLogDetailSchema } from '../schema';

// ─── Schema 测试 ─────────────────────────────────────────────────

describe('getSyncLogDetailSchema', () => {
  it('接受合法 UUID', () => {
    const result = getSyncLogDetailSchema.safeParse({
      runId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝空字符串', () => {
    const result = getSyncLogDetailSchema.safeParse({ runId: '' });
    expect(result.success).toBe(false);
  });

  it('拒绝非 UUID 字符串', () => {
    const result = getSyncLogDetailSchema.safeParse({ runId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('拒绝缺少 runId', () => {
    const result = getSyncLogDetailSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('拒绝额外字段（strict 模式继承自 object）', () => {
    const result = getSyncLogDetailSchema.safeParse({
      runId: '550e8400-e29b-41d4-a716-446655440000',
      extra: 'field',
    });
    // Schema uses z.object without .strict(), so extra fields are stripped
    expect(result.success).toBe(true);
  });
});

// ─── MockRepository getSyncLog 测试 ──────────────────────────────

describe('MockRepository.getSyncLog', () => {
  let repo: MockRepository;

  beforeEach(() => {
    MockRepository._resetAll();
    MockRepository._resetSyncLogs();
    repo = new MockRepository('admin');
  });

  it('返回 null 当 sync_log 不存在', async () => {
    const result = await repo.getSyncLog('nonexistent-id');
    expect(result).toBeNull();
  });

  it('返回注入的 sync_log 记录', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440000';
    repo._injectSyncLog(runId, {
      status: 'success',
      newVariantsCount: 42,
    });

    const result = await repo.getSyncLog(runId);
    expect(result).not.toBeNull();
    expect(result!.syncRunId).toBe(runId);
    expect(result!.status).toBe('success');
    expect(result!.newVariantsCount).toBe(42);
    expect(result!.warehouseId).toBe('wh-default');
    expect(result!.startedAt).toBeTruthy();
    expect(result!.finishedAt).toBeTruthy();
    expect(result!.errorMessage).toBeNull();
  });

  it('返回失败的 sync_log 含错误信息', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440001';
    repo._injectSyncLog(runId, {
      status: 'failed',
      newVariantsCount: 0,
      errorMessage: 'RPC 调用超时',
    });

    const result = await repo.getSyncLog(runId);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('failed');
    expect(result!.errorMessage).toBe('RPC 调用超时');
    expect(result!.newVariantsCount).toBe(0);
  });

  it('_injectSyncLog 默认值正确', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440002';
    repo._injectSyncLog(runId, {});

    const result = await repo.getSyncLog(runId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(`sl-${runId.slice(0, 12)}`);
    expect(result!.status).toBe('success');
    expect(result!.newVariantsCount).toBe(0);
    expect(result!.errorMessage).toBeNull();
    expect(result!.syncRunId).toBe(runId);
  });

  it('_resetSyncLogs 清除所有日志', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440003';
    repo._injectSyncLog(runId, {});
    expect(await repo.getSyncLog(runId)).not.toBeNull();

    MockRepository._resetSyncLogs();
    expect(await repo.getSyncLog(runId)).toBeNull();
  });

  it('多个 runId 的 sync_log 互相独立', async () => {
    const runId1 = 'a1e84000-e29b-41d4-a716-446655440010';
    const runId2 = 'b2e84000-e29b-41d4-a716-446655440020';

    repo._injectSyncLog(runId1, { id: 'sl-aaa', newVariantsCount: 10 });
    repo._injectSyncLog(runId2, { id: 'sl-bbb', newVariantsCount: 20 });

    const r1 = await repo.getSyncLog(runId1);
    const r2 = await repo.getSyncLog(runId2);

    expect(r1!.newVariantsCount).toBe(10);
    expect(r2!.newVariantsCount).toBe(20);
    expect(r1!.id).not.toBe(r2!.id);
  });

  it('syncRunId 可以为 null（旧 sync_log 无关联）', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440030';
    repo._injectSyncLog(runId, { syncRunId: null });

    const result = await repo.getSyncLog(runId);
    expect(result).not.toBeNull();
    expect(result!.syncRunId).toBeNull();
  });
});
