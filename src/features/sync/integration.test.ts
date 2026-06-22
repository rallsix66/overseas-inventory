// Sync Feature Module — 集成/E2E 测试 (P5-SY5F)
//
// 组合 MockRepository + MockArtifactProvider + GC orchestrator
// 验证单元测试无法覆盖的端到端流程。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { createSyncService } from './sync-service';
import { MockSyncRunner } from './mock-sync-runner';
import {
  computeCutoff,
  isCompletedProtected,
  filterCandidates,
} from './gc-orchestrator';

const WH_ID = 'adc5ec45-cd98-42a8-a1d1-26600e80d481';
const TRIGGERED_BY = 'user-0000-0000-0000-000000000001';

// ─── Helpers ────────────────────────────────────────────────────────

/** 通过 bracket access 获取 MockArtifactProvider 的 private static store_ */
function getArtifactStore(): Map<string, { bytes: Uint8Array; hash: string; createdAt: Date }> {
  return (MockArtifactProvider as unknown as { store_: Map<string, { bytes: Uint8Array; hash: string; createdAt: Date }> }).store_;
}

/** 通过 Repository 接口获取 in_progress 的 runId 集合 */
async function getInProgressRunIds(repo: MockRepository): Promise<Set<string>> {
  return repo.getActiveRunIds();
}

/** 通过 Repository 接口获取 completed 且 finishedAt 在保护窗口内的 runId 集合 */
async function getRecentlyCompletedProtectedIds(repo: MockRepository, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  return repo.getRecentlyCompletedRunIds(since);
}

/** 构建完整的 protectedRunIds 集合（active ∪ recently completed ∪ referenced） */
async function buildProtectedRunIds(repo: MockRepository, now: Date): Promise<Set<string>> {
  const [active, recent, referenced] = await Promise.all([
    repo.getActiveRunIds(),
    repo.getRecentlyCompletedRunIds(new Date(now.getTime() - 60 * 60 * 1000)),
    repo.getReferencedDryRunIds(),
  ]);
  return new Set([...active, ...recent, ...referenced]);
}

// ─── Non-deterministic serialization safety ─────────────────────────

describe('Integration — non-deterministic serialization', () => {
  let provider: MockArtifactProvider;

  beforeEach(() => {
    MockArtifactProvider._resetAll();
    provider = new MockArtifactProvider();
  });

  it('prepare() 对相同内容产生一致 hash（幂等）', () => {
    const content = { skus: ['A', 'B'], warehouse: 'PH' };
    const p1 = provider.prepare(content);
    const p2 = provider.prepare(content);
    expect(p1.hash).toBe(p2.hash);
    expect(p1.bytes).toEqual(p2.bytes);
  });

  it('prepare() 对 JSON.parse 产生的等价对象产生一致 hash', () => {
    // 同一 JSON 字符串两次 parse 产生相同属性顺序的对象
    const json = '{"skus":["A","B"],"warehouse":"PH","count":42}';
    const content1 = JSON.parse(json);
    const content2 = JSON.parse(json);
    const p1 = provider.prepare(content1);
    const p2 = provider.prepare(content2);
    expect(p1.hash).toBe(p2.hash);
  });

  it('normalizedContent 二次 prepare 与原 hash 一致', () => {
    // 核心契约：prepare(obj).normalizedContent 再次 prepare 得到相同 hash
    const content = {
      warehouses: [{ id: 'wh-1', skus: ['A', 'B'] }],
      meta: { version: 1 },
    };
    const p1 = provider.prepare(content);
    const p2 = provider.prepare(p1.normalizedContent);
    expect(p2.hash).toBe(p1.hash);
    expect(p2.bytes).toEqual(p1.bytes);
  });

  it('normalizedContent 经过 JSON 文本 round-trip 仍保持 hash 一致', () => {
    // 模拟存储到 Supabase（JSON 文本）后重新读取的场景
    const content = { arr: [1, 'two', null], nested: { x: true } };
    const p1 = provider.prepare(content);
    // 模拟：存储为 JSON 文本 → 从文本 parse 回来
    const jsonText = new TextDecoder().decode(p1.bytes);
    const restored = JSON.parse(jsonText);
    const p2 = provider.prepare(restored);
    expect(p2.hash).toBe(p1.hash);
    expect(p2.normalizedContent).toEqual(p1.normalizedContent);
  });

  it('prepare() 先 validateJsonValue 后 stringify — 非法内容在 hash 计算前被拒绝', () => {
    expect(() => provider.prepare({ bad: undefined } as never)).toThrow('undefined');
  });
});

// ─── GC orchestrator full pipeline ──────────────────────────────────

describe('Integration — GC orchestrator full pipeline', () => {
  let repo: MockRepository;
  let provider: MockArtifactProvider;

  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    repo = new MockRepository('admin');
    provider = new MockArtifactProvider();
  });

  async function seedRunWithArtifacts(
    runId: string,
    warehouseId: string,
    mode: 'dry_run' | 'real_write',
    status: 'in_progress' | 'completed' | 'failed',
    opts?: { finishedAt?: Date; dryRunRunId?: string },
  ): Promise<void> {
    await repo.claimSyncRun({
      runId,
      warehouseId,
      mode,
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
      dryRunRunId: opts?.dryRunRunId,
    });

    if (status !== 'in_progress') {
      const exitCode = status === 'completed' ? 0 : 1;
      // When opts.finishedAt is provided, override clock so releaseSyncRun
      // sets finishedAt to the backdated value instead of real current time.
      if (opts?.finishedAt) {
        repo._setClock(() => opts.finishedAt!);
      }
      await repo.releaseSyncRun({
        runId,
        status: status as 'completed' | 'failed',
        exitCode,
        planDriftCheck: mode === 'dry_run' ? 'PASS' : undefined,
        planDriftCount: mode === 'dry_run' ? 0 : undefined,
        planDriftDifferences: mode === 'dry_run' ? [] : undefined,
        errorMessage: status === 'failed' ? 'test failure' : undefined,
      });
      if (opts?.finishedAt) {
        repo._setClock(() => new Date());
      }
    }

    // Store artifacts
    const prepared = provider.prepare({ runId, mode });
    await provider.store(runId, 'input', prepared);
    if (mode === 'dry_run' && status === 'completed') {
      await provider.store(runId, 'plan', provider.prepare({ plan: 'data' }));
    }
  }

  it('完整 GC 管道：listCandidates → filterCandidates → deleteMany', async () => {
    const now = new Date('2026-06-19T12:00:00Z');
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

    // Seed: run-1 (completed long ago, no protection) — should be deleted
    // Pass finishedAt=oldDate so releaseSyncRun backdates the run outside the 60-min protection window
    await seedRunWithArtifacts('run-0001', WH_ID, 'dry_run', 'completed', { finishedAt: oldDate });
    // Seed: run-2 (in_progress) — should be protected
    await seedRunWithArtifacts('run-0002', WH_ID + '2', 'dry_run', 'in_progress');

    // Backdate run-1's artifacts to make them appear old (> 7 days)
    const store = getArtifactStore();
    for (const [key, entry] of store) {
      if (key.startsWith('run-0001:')) {
        entry.createdAt = oldDate;
      }
    }

    // Step 1: List old candidates
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);

    // Only run-0001's artifacts should be candidates (old)
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const run1Candidates = candidates.filter((c) => c.runId === 'run-0001');
    expect(run1Candidates.length).toBeGreaterThanOrEqual(1);

    // Step 2: Build protection sets from repository
    const protectedRunIds = await getRecentlyCompletedProtectedIds(repo, now);
    const inProgressRunIds = await getInProgressRunIds(repo);

    // run-0002 should be in in_progress set
    expect(inProgressRunIds.has('run-0002')).toBe(true);

    // Step 3: Filter (remove protected and in-progress)
    const toDelete = filterCandidates(candidates, protectedRunIds, inProgressRunIds);

    // Only run-0001 artifacts should remain
    expect(toDelete.every((c) => c.runId === 'run-0001')).toBe(true);
    const run2Deleted = toDelete.filter((c) => c.runId === 'run-0002');
    expect(run2Deleted.length).toBe(0);

    // Step 4: Delete
    const deleteCount = await provider.deleteMany(toDelete);
    expect(deleteCount).toBe(run1Candidates.length);

    // Step 5: Verify run-0001 artifacts are gone, run-0002 artifacts remain
    await expect(provider.get('run-0001', 'input')).rejects.toThrow('不存在');
    await expect(provider.get('run-0002', 'input')).resolves.toBeDefined();
  });

  it('GC 管道：空候选集 → filterCandidates 返回空 → deleteMany(0)', async () => {
    const now = new Date('2026-06-19T12:00:00Z');
    const cutoff = computeCutoff(now);

    // No artifacts at all
    const candidates = await provider.listCandidates(cutoff);
    expect(candidates.length).toBe(0);

    const toDelete = filterCandidates(candidates, new Set(), new Set());
    expect(toDelete.length).toBe(0);

    const deleteCount = await provider.deleteMany(toDelete);
    expect(deleteCount).toBe(0);
  });

  it('GC 管道：全部被保护时 deleteMany 为 0', async () => {
    const now = new Date('2026-06-19T12:00:00Z');
    // Set clock so finishedAt lands within 60-min protection window
    repo._setClock(() => new Date(now.getTime() - 30 * 60 * 1000));

    // Seed: run-1 completed recently (within 60 min)
    await seedRunWithArtifacts('run-0001', WH_ID, 'dry_run', 'completed');
    // Also seed in_progress run-2
    await seedRunWithArtifacts('run-0002', WH_ID + '2', 'dry_run', 'in_progress');

    // Backdate both artifacts to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // Both artifacts should appear in listCandidates (old)
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Both runs are protected (completed recently + in_progress)
    const protectedRunIds = await getRecentlyCompletedProtectedIds(repo, now);
    const inProgressRunIds = await getInProgressRunIds(repo);
    expect(protectedRunIds.has('run-0001')).toBe(true);
    expect(inProgressRunIds.has('run-0002')).toBe(true);

    const toDelete = filterCandidates(candidates, protectedRunIds, inProgressRunIds);
    expect(toDelete.length).toBe(0);

    const deleteCount = await provider.deleteMany(toDelete);
    expect(deleteCount).toBe(0);

    // Both artifacts should still exist
    await expect(provider.get('run-0001', 'input')).resolves.toBeDefined();
    await expect(provider.get('run-0002', 'input')).resolves.toBeDefined();
  });
});

// ─── GC anti-delete boundary ────────────────────────────────────────

describe('Integration — GC anti-delete boundary', () => {
  let repo: MockRepository;
  let provider: MockArtifactProvider;

  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    repo = new MockRepository('admin');
    provider = new MockArtifactProvider();
  });

  it('artifact 超过 7 天但关联 Dry Run 在 60 分钟内完成 → 受保护', async () => {
    const now = new Date('2026-06-19T12:00:00Z');

    // 1. Create a completed Dry Run (finishedAt = now - 30 min)
    const finishTime = new Date(now.getTime() - 30 * 60 * 1000);
    const runId = 'dry-run-protected';

    // Use clock control to set finished_at precisely
    repo._setClock(() => finishTime);

    await repo.claimSyncRun({
      runId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    // Store artifact before release (at finish time)
    const prepared = provider.prepare({ data: 'protected-run' });
    await provider.store(runId, 'input', prepared);

    await repo.releaseSyncRun({
      runId,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    // 2. Backdate the artifact's createdAt to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // 3. Verify: artifact appears in listCandidates (older than 7-day cutoff)
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.some((c) => c.runId === runId)).toBe(true);

    // 4. Verify: isCompletedProtected returns true (30 min ago < 60 min)
    expect(isCompletedProtected(finishTime, now)).toBe(true);

    // 5. Verify: run is in protected set
    const protectedRunIds = await getRecentlyCompletedProtectedIds(repo, now);
    expect(protectedRunIds.has(runId)).toBe(true);

    // 6. GC filter removes it from deletion candidates
    const toDelete = filterCandidates(candidates, protectedRunIds, new Set());
    expect(toDelete.some((c) => c.runId === runId)).toBe(false);

    // 7. Delete should not touch it
    await provider.deleteMany(toDelete);
    // artifact still exists
    await expect(provider.get(runId, 'input')).resolves.toBeDefined();
  });

  it('artifact 超过 7 天且关联 Dry Run 超过 60 分钟 → 可删除', async () => {
    const now = new Date('2026-06-19T12:00:00Z');

    // Create a completed Dry Run (finishedAt = now - 61 min)
    const finishTime = new Date(now.getTime() - 61 * 60 * 1000);
    const runId = 'dry-run-expired';

    repo._setClock(() => finishTime);

    await repo.claimSyncRun({
      runId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const prepared = provider.prepare({ data: 'expired-run' });
    await provider.store(runId, 'input', prepared);

    await repo.releaseSyncRun({
      runId,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    // Backdate artifact to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // isCompletedProtected returns false (61 min ago >= 60 min)
    expect(isCompletedProtected(finishTime, now)).toBe(false);

    // run is NOT in protected set
    const protectedRunIds = await getRecentlyCompletedProtectedIds(repo, now);
    expect(protectedRunIds.has(runId)).toBe(false);

    // GC filter keeps it in deletion candidates
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    const toDelete = filterCandidates(candidates, protectedRunIds, new Set());
    expect(toDelete.some((c) => c.runId === runId)).toBe(true);
  });

  it('in_progress 运行引用的 artifact 受保护不删除', async () => {
    const now = new Date('2026-06-19T12:00:00Z');
    const runId = 'run-in-progress';

    await repo.claimSyncRun({
      runId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const prepared = provider.prepare({ data: 'in-progress-run' });
    await provider.store(runId, 'input', prepared);

    // Backdate artifact to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // Verify in_progress
    const inProgressRunIds = await getInProgressRunIds(repo);
    expect(inProgressRunIds.has(runId)).toBe(true);

    // GC filter excludes it
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    const toDelete = filterCandidates(candidates, new Set(), inProgressRunIds);
    expect(toDelete.some((c) => c.runId === runId)).toBe(false);

    // Artifact still exists
    await expect(provider.get(runId, 'input')).resolves.toBeDefined();
  });

  it('被 completed Dry Run（60 分钟内）的 plan artifact 同样受保护', async () => {
    const now = new Date('2026-06-19T12:00:00Z');
    const runId = 'dry-run-with-plan';

    // Set clock so finishedAt lands within 60-min protection window
    repo._setClock(() => new Date(now.getTime() - 30 * 60 * 1000));

    await repo.claimSyncRun({
      runId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });

    const inputPrep = provider.prepare({ data: 'input-data' });
    const planPrep = provider.prepare({ plan: 'plan-data' });
    await provider.store(runId, 'input', inputPrep);
    await provider.store(runId, 'plan', planPrep);

    await repo.releaseSyncRun({
      runId,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    // Backdate both artifacts to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // Both input and plan artifacts appear in listCandidates
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    expect(candidates.filter((c) => c.runId === runId).length).toBe(2);

    // Both are protected
    const protectedRunIds = await getRecentlyCompletedProtectedIds(repo, now);
    expect(protectedRunIds.has(runId)).toBe(true);

    const toDelete = filterCandidates(candidates, protectedRunIds, new Set());
    expect(toDelete.some((c) => c.runId === runId)).toBe(false);

    // Both input and plan artifacts survive
    await expect(provider.get(runId, 'input')).resolves.toBeDefined();
    await expect(provider.get(runId, 'plan')).resolves.toBeDefined();
  });

  it('被 Real Write 引用的 Dry Run artifact（超 60 分钟 + 超 7 天）受保护不删除', async () => {
    // 核心场景：completed Dry Run 的 finishedAt 超过 60 分钟（不再被 recently-completed 保护），
    // artifact.createdAt 超过 7 天（进入 GC 候选列表），
    // 但该 Dry Run 被 Real Write 的 dry_run_run_id 引用 → GC 不得删除其 input + plan artifact。
    const now = new Date('2026-06-19T12:00:00Z');

    const dryRunId = 'dr-ref-0001';
    const realWriteId = 'rw-ref-0001';
    const dryFinishTime = new Date(now.getTime() - 120 * 60 * 1000); // 2 hours ago — outside 60-min window

    // 1. Create completed Dry Run with input + plan artifacts
    repo._setClock(() => dryFinishTime);
    await repo.claimSyncRun({
      runId: dryRunId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    const drInput = provider.prepare({ data: 'ref-protected-input' });
    const drPlan = provider.prepare({ plan: 'ref-protected-plan' });
    await provider.store(dryRunId, 'input', drInput);
    await provider.store(dryRunId, 'plan', drPlan);
    await repo.releaseSyncRun({
      runId: dryRunId,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    // 2. Create completed Real Write referencing the Dry Run
    const rwFinishTime = new Date(now.getTime() - 90 * 60 * 1000); // 90 min ago
    repo._setClock(() => rwFinishTime);
    await repo.claimSyncRun({
      runId: realWriteId,
      warehouseId: WH_ID,
      mode: 'real_write',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
      dryRunRunId: dryRunId,
    });
    const rwInput = provider.prepare({ data: 'real-write-input' });
    await provider.store(realWriteId, 'input', rwInput);
    await repo.releaseSyncRun({
      runId: realWriteId,
      status: 'completed',
      exitCode: 0,
    });

    // 3. Backdate Dry Run artifacts to 8 days ago (enter GC candidate list)
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [key, entry] of store) {
      if (key.startsWith(`${dryRunId}:`)) {
        entry.createdAt = oldDate;
      }
    }

    // 4. Verify: isCompletedProtected returns false (120 min ago >= 60 min)
    expect(isCompletedProtected(dryFinishTime, now)).toBe(false);

    // 5. Verify: getReferencedDryRunIds includes the Dry Run
    const referencedIds = await repo.getReferencedDryRunIds();
    expect(referencedIds.has(dryRunId)).toBe(true);

    // 6. Run full GC pipeline with buildProtectedRunIds
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    // Dry Run input + plan should be in candidates (old enough)
    const dryRunCandidates = candidates.filter((c) => c.runId === dryRunId);
    expect(dryRunCandidates.length).toBe(2); // input + plan

    const protectedRunIds = await buildProtectedRunIds(repo, now);
    // Dry Run should be protected via referenced set (despite being outside 60-min window)
    expect(protectedRunIds.has(dryRunId)).toBe(true);

    const inProgressIds = await getInProgressRunIds(repo);
    const toDelete = filterCandidates(candidates, protectedRunIds, inProgressIds);

    // Dry Run artifacts MUST NOT be in the delete list
    expect(toDelete.some((c) => c.runId === dryRunId)).toBe(false);

    // 7. Execute delete and verify artifacts survive
    await provider.deleteMany(toDelete);
    await expect(provider.get(dryRunId, 'input')).resolves.toBeDefined();
    await expect(provider.get(dryRunId, 'plan')).resolves.toBeDefined();

    // Verify deleteCount doesn't include Dry Run artifacts
    const dryRunDeleted = toDelete.filter((c) => c.runId === dryRunId).length;
    expect(dryRunDeleted).toBe(0);
  });

  it('未被引用且超过保护窗口的旧 artifact 可删除（反例验证）', async () => {
    // 反例：completed Dry Run 的 finishedAt 超过 60 分钟，
    // artifact > 7 天，且未被任何 Real Write 引用 → GC 可删除。
    const now = new Date('2026-06-19T12:00:00Z');

    const orphanRunId = 'dr-orphan-0001';
    const orphanFinishTime = new Date(now.getTime() - 120 * 60 * 1000); // 2 hours ago

    repo._setClock(() => orphanFinishTime);
    await repo.claimSyncRun({
      runId: orphanRunId,
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: TRIGGERED_BY,
      triggeredFrom: 'web',
    });
    const orphanInput = provider.prepare({ data: 'orphan-input' });
    const orphanPlan = provider.prepare({ plan: 'orphan-plan' });
    await provider.store(orphanRunId, 'input', orphanInput);
    await provider.store(orphanRunId, 'plan', orphanPlan);
    await repo.releaseSyncRun({
      runId: orphanRunId,
      status: 'completed',
      exitCode: 0,
      planDriftCheck: 'PASS',
      planDriftCount: 0,
      planDriftDifferences: [],
    });

    // Backdate artifacts to 8 days ago
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const store = getArtifactStore();
    for (const [, entry] of store) {
      entry.createdAt = oldDate;
    }

    // Not recently completed (> 60 min)
    expect(isCompletedProtected(orphanFinishTime, now)).toBe(false);

    // Not referenced by any Real Write
    const referencedIds = await repo.getReferencedDryRunIds();
    expect(referencedIds.has(orphanRunId)).toBe(false);

    // Not in_progress
    const inProgressIds = await getInProgressRunIds(repo);
    expect(inProgressIds.has(orphanRunId)).toBe(false);

    // GC should delete it
    const cutoff = computeCutoff(now);
    const candidates = await provider.listCandidates(cutoff);
    const protectedRunIds = await buildProtectedRunIds(repo, now);
    const toDelete = filterCandidates(candidates, protectedRunIds, inProgressIds);

    expect(toDelete.some((c) => c.runId === orphanRunId)).toBe(true);

    const deleteCount = await provider.deleteMany(toDelete);
    expect(deleteCount).toBeGreaterThanOrEqual(2); // input + plan

    // Artifacts are gone
    await expect(provider.get(orphanRunId, 'input')).rejects.toThrow('不存在');
    await expect(provider.get(orphanRunId, 'plan')).rejects.toThrow('不存在');
  });
});

// ─── End-to-end Dry Run → Real Write artifact lifecycle ─────────────

describe('Integration — Dry Run → Real Write artifact lifecycle', () => {
  let repo: MockRepository;
  let provider: MockArtifactProvider;
  let runner: MockSyncRunner;

  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    repo = new MockRepository('admin');
    provider = new MockArtifactProvider();
    runner = new MockSyncRunner();
  });

  it('完整的 Dry Run → Real Write 流程：artifact 跨请求保留', async () => {
    // Step 1: Dry Run
    const drySvc = createSyncService({ repository: repo, artifactProvider: provider, runner });
    const dryResult = await drySvc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: { skus: ['WM0001', 'WM0002'] },
      triggeredBy: TRIGGERED_BY,
    });

    expect(dryResult.status).toBe('completed');
    expect(dryResult.runnerResult!.planArtifact).toBeDefined();

    // Verify both input and plan artifacts stored
    const dryInput = await provider.get(dryResult.runId, 'input');
    expect(dryInput).toBeDefined();
    const dryPlan = await provider.get(dryResult.runId, 'plan');
    expect(dryPlan).toBeDefined();

    // Step 2: Real Write (new instances — simulates new HTTP request)
    const repo2 = new MockRepository('admin');
    const provider2 = new MockArtifactProvider(); // shares static storage
    const runner2 = new MockSyncRunner();

    const rwSvc = createSyncService({
      repository: repo2,
      artifactProvider: provider2,
      runner: runner2,
    });
    const rwResult = await rwSvc.executeSync({
      warehouseId: WH_ID,
      mode: 'real_write',
      inputArtifact: { skus: ['WM0001'] },
      dryRunRunId: dryResult.runId,
      confirmToken: 'P5-SY3B-PH',
      triggeredBy: TRIGGERED_BY,
    });

    expect(rwResult.status).toBe('completed');

    // Verify Real Write input artifact stored
    const rwInput = await provider2.get(rwResult.runId, 'input');
    expect(rwInput).toBeDefined();

    // Dry Run artifacts still exist (not cleaned prematurely)
    await expect(provider2.get(dryResult.runId, 'input')).resolves.toBeDefined();
    await expect(provider2.get(dryResult.runId, 'plan')).resolves.toBeDefined();
  });

  it('Real Write 失败时 bind Dry Run artifacts 不受影响', async () => {
    // Set up completed Dry Run
    const drySvc = createSyncService({ repository: repo, artifactProvider: provider, runner });
    const dryResult = await drySvc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: { skus: ['WM0001'] },
      triggeredBy: TRIGGERED_BY,
    });

    // Real Write: runner throws
    runner.shouldThrow = true;
    runner.throwMessage = 'Real Write 执行失败';
    const rwSvc = createSyncService({
      repository: new MockRepository('admin'),
      artifactProvider: new MockArtifactProvider(),
      runner,
    });
    const rwResult = await rwSvc.executeSync({
      warehouseId: WH_ID,
      mode: 'real_write',
      inputArtifact: { skus: ['WM0001'] },
      dryRunRunId: dryResult.runId,
      confirmToken: 'P5-SY3B-PH',
      triggeredBy: TRIGGERED_BY,
    });

    expect(rwResult.status).toBe('failed');

    // Dry Run artifacts are preserved
    const checkProvider = new MockArtifactProvider();
    await expect(checkProvider.get(dryResult.runId, 'input')).resolves.toBeDefined();
    await expect(checkProvider.get(dryResult.runId, 'plan')).resolves.toBeDefined();
  });

  it('claim 失败不产生 artifact', async () => {
    // Occupy the warehouse
    await repo.claimSyncRun({
      runId: 'existing-run',
      warehouseId: WH_ID,
      mode: 'dry_run',
      leaseDuration: 300,
      triggeredBy: 'other-user',
      triggeredFrom: 'web',
    });

    const svc = createSyncService({ repository: repo, artifactProvider: provider, runner });
    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: { skus: ['WM0001'] },
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(result.runnerResult).toBeUndefined();

    // No artifact should exist for this failed run
    await expect(provider.get(result.runId, 'input')).rejects.toThrow('不存在');
  });

  it('store 失败 → release failed + 不执行 runner', async () => {
    // Force store to fail
    const origStore = provider.store.bind(provider);
    let storeCalled = false;
    provider.store = async (...args) => {
      // Fail on first store call (input artifact)
      if (!storeCalled) {
        storeCalled = true;
        throw new Error('模拟 store 失败');
      }
      return origStore(...args);
    };

    const executeSpy = vi.spyOn(runner, 'execute');
    const svc = createSyncService({ repository: repo, artifactProvider: provider, runner });
    const result = await svc.executeSync({
      warehouseId: WH_ID,
      mode: 'dry_run',
      inputArtifact: { skus: ['WM0001'] },
      triggeredBy: TRIGGERED_BY,
    });

    expect(result.status).toBe('failed');
    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
