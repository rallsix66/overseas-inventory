// Sync Feature Module — GC orchestrator 纯函数
//
// GC (Garbage Collection) 双层保护：
//   第一层（存储层）：cutoff = now - 7 天 → listCandidates 仅返回 createdAt ≥ 7 天前的 artifact
//   第二层（业务层）：getRecentlyCompletedRunIds(now - 60min) 保护 finished_at 在 60 分钟内的 completed Dry Run
//
// GC orchestrator 负责过滤逻辑，不直接查询 sync_run 或调用 ArtifactProvider。
// 实际 GC 由 SyncService 协调：listCandidates → filterCandidates → deleteMany。

import type { ArtifactCandidate } from './types';

/** 审计保留期（天）— artifact 创建后至少保留 7 天 */
export const GC_CUTOFF_DAYS = 7;

/** completed Dry Run 的绑定保护窗口（分钟）— finished_at 在 60 分钟内受保护 */
export const COMPLETED_PROTECTION_MINUTES = 60;

/** 计算 GC 截止时间：now - 7 days */
export function computeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - GC_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
}

/** 判断 completed run 的 finishedAt 是否在保护窗口内（60 分钟） */
export function isCompletedProtected(
  finishedAt: Date,
  now: Date = new Date(),
): boolean {
  const protectionMs = COMPLETED_PROTECTION_MINUTES * 60 * 1000;
  return now.getTime() - finishedAt.getTime() < protectionMs;
}

/** 从 candidates 中过滤出可安全删除的 orphans */
export function filterCandidates(
  candidates: ArtifactCandidate[],
  protectedRunIds: Set<string>,
  inProgressRunIds: Set<string>,
): ArtifactCandidate[] {
  return candidates.filter(
    (c) => !protectedRunIds.has(c.runId) && !inProgressRunIds.has(c.runId),
  );
}
