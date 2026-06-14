// Sync Feature Module — GC orchestrator 单元测试
import { describe, it, expect } from 'vitest';
import {
  computeCutoff,
  isCompletedProtected,
  filterCandidates,
  GC_CUTOFF_DAYS,
  COMPLETED_PROTECTION_MINUTES,
} from './gc-orchestrator';
import type { ArtifactCandidate } from './types';

// ─── Constants ────────────────────────────────────────────────────

describe('GC constants', () => {
  it('GC_CUTOFF_DAYS is 7', () => {
    expect(GC_CUTOFF_DAYS).toBe(7);
  });

  it('COMPLETED_PROTECTION_MINUTES is 60', () => {
    expect(COMPLETED_PROTECTION_MINUTES).toBe(60);
  });
});

// ─── computeCutoff ────────────────────────────────────────────────

describe('computeCutoff', () => {
  it('returns date 7 days before given now', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const cutoff = computeCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-06-07T12:00:00.000Z');
  });

  it('defaults to current time minus 7 days', () => {
    const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cutoff = computeCutoff();
    // Allow 10s tolerance
    expect(Math.abs(cutoff.getTime() - before.getTime())).toBeLessThan(10000);
  });

  it('returns a Date object', () => {
    expect(computeCutoff()).toBeInstanceOf(Date);
  });
});

// ─── isCompletedProtected ─────────────────────────────────────────

describe('isCompletedProtected', () => {
  it('returns true for finishedAt within 60 minutes', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const finishedAt = new Date('2026-06-14T11:01:00Z'); // 59 min ago
    expect(isCompletedProtected(finishedAt, now)).toBe(true);
  });

  it('returns true for finishedAt exactly 59 minutes ago', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const finishedAt = new Date('2026-06-14T11:01:00Z');
    expect(isCompletedProtected(finishedAt, now)).toBe(true);
  });

  it('returns false for finishedAt >= 60 minutes ago', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const finishedAt = new Date('2026-06-14T11:00:00Z'); // exactly 60 min ago
    expect(isCompletedProtected(finishedAt, now)).toBe(false);
  });

  it('returns false for finishedAt 120 minutes ago', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const finishedAt = new Date('2026-06-14T10:00:00Z');
    expect(isCompletedProtected(finishedAt, now)).toBe(false);
  });

  it('returns true for finishedAt just now', () => {
    const now = new Date('2026-06-14T12:00:00Z');
    const finishedAt = new Date('2026-06-14T11:59:59Z');
    expect(isCompletedProtected(finishedAt, now)).toBe(true);
  });

  it('default now parameter', () => {
    const finishedAt = new Date(); // just now
    expect(isCompletedProtected(finishedAt)).toBe(true);
  });
});

// ─── filterCandidates ─────────────────────────────────────────────

function candidate(
  runId: string,
  type: 'input' | 'plan' = 'input',
): ArtifactCandidate {
  return { runId, type, createdAt: new Date('2026-06-01') };
}

describe('filterCandidates', () => {
  it('returns empty for empty candidates', () => {
    expect(filterCandidates([], new Set(), new Set())).toEqual([]);
  });

  it('returns all candidates when no protections', () => {
    const candidates = [candidate('run-1'), candidate('run-2')];
    expect(filterCandidates(candidates, new Set(), new Set())).toEqual(
      candidates,
    );
  });

  it('filters out protected runIds', () => {
    const candidates = [candidate('run-1'), candidate('run-2'), candidate('run-3')];
    const protected_ = new Set(['run-2']);
    const result = filterCandidates(candidates, protected_, new Set());
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.runId)).toEqual(['run-1', 'run-3']);
  });

  it('filters out in-progress runIds', () => {
    const candidates = [candidate('run-1'), candidate('run-2')];
    const inProgress = new Set(['run-1']);
    const result = filterCandidates(candidates, new Set(), inProgress);
    expect(result.map((c) => c.runId)).toEqual(['run-2']);
  });

  it('filters out both protected and in-progress', () => {
    const candidates = [
      candidate('run-1'),
      candidate('run-2'),
      candidate('run-3'),
      candidate('run-4'),
    ];
    const protected_ = new Set(['run-2']);
    const inProgress = new Set(['run-4']);
    const result = filterCandidates(candidates, protected_, inProgress);
    expect(result.map((c) => c.runId)).toEqual(['run-1', 'run-3']);
  });

  it('returns empty when all candidates protected or in-progress', () => {
    const candidates = [candidate('run-1'), candidate('run-2')];
    expect(filterCandidates(candidates, new Set(['run-1']), new Set(['run-2']))).toEqual([]);
  });

  it('handles input and plan artifacts for same runId', () => {
    const candidates = [
      candidate('run-1', 'input'),
      candidate('run-1', 'plan'),
      candidate('run-2', 'input'),
    ];
    const protected_ = new Set(['run-1']);
    const result = filterCandidates(candidates, protected_, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe('run-2');
  });
});
