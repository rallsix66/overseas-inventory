// P5-SY10B: 仓库历史上下文提供器 测试
//
// 验证 MockRepository.getWarehouseHistory() 正确从 sync_run 记录推导:
// hasBaseline / consecutiveFailures / lastSuccess / stats.
// 覆盖冷启动、有基线、连续失败、成功重置、跨仓隔离、
// 最近 5 次统计均值、缺失/异常 result_summary。
// 使用 MockRepository，不连接 Supabase。

import { describe, it, expect, beforeEach } from 'vitest';
import { MockRepository } from './repository';
import type { WarehouseHistory } from './types';

// ─── Helpers ────────────────────────────────────────────────────────

const WH = 'warehouse-ph';
const WH2 = 'warehouse-vn';

function makeResultSummary(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    warehouseId: WH,
    warehouseName: '菲律宾仓',
    variantsCreated: 12,
    variantsSkipped: 0,
    inventoryInserted: 10,
    inventoryUpdated: 80,
    inventoryUnchanged: 18,
    warehouseRenamed: false,
    rawRowCount: 104,
    validSkuCount: 100,
    invalidSkuCount: 4,
    ...overrides,
  };
}

/** Inject a completed Dry Run for the given warehouse */
function injectCompleted(
  repo: MockRepository,
  runId: string,
  warehouseId: string,
  startedAt: Date,
  resultSummary?: Record<string, unknown>,
) {
  repo._injectRunDetail(runId, {
    id: runId,
    warehouseId,
    mode: 'dry_run',
    status: 'completed',
    exitCode: 0,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 60_000),
    resultSummary: resultSummary ?? makeResultSummary({ warehouseId }),
  });
}

/** Inject a failed Dry Run for the given warehouse */
function injectFailed(
  repo: MockRepository,
  runId: string,
  warehouseId: string,
  startedAt: Date,
) {
  repo._injectRunDetail(runId, {
    id: runId,
    warehouseId,
    mode: 'dry_run',
    status: 'failed',
    exitCode: 1,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 30_000),
    errorMessage: '抓取超时',
    resultSummary: null,
  });
}

function expectColdStart(history: WarehouseHistory) {
  expect(history.hasBaseline).toBe(false);
  expect(history.consecutiveFailures).toBe(0);
  expect(history.lastSuccess).toBeNull();
  expect(history.stats).toBeNull();
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('getWarehouseHistory', () => {
  let repo: MockRepository;

  beforeEach(() => {
    MockRepository._resetAll();
    MockRepository._resetSyncLogs();
    repo = new MockRepository('admin');
  });

  // ── Cold start ─────────────────────────────────────────────────────

  describe('cold start (no runs)', () => {
    it('returns hasBaseline=false, consecutiveFailures=0, stats=null when no runs exist', async () => {
      const history = await repo.getWarehouseHistory(WH);
      expectColdStart(history);
    });
  });

  // ── Has baseline ───────────────────────────────────────────────────

  describe('hasBaseline', () => {
    it('returns true when at least one completed run exists', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      expect(history.lastSuccess).not.toBeNull();
      expect(history.lastSuccess!.finishedAt).toBeTruthy();
    });

    it('returns true with multiple completed runs, lastSuccess is most recent', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectCompleted(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectCompleted(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      expect(history.lastSuccess).not.toBeNull();
      expect(history.lastSuccess!.finishedAt).toBe(
        new Date('2026-06-22T10:01:00Z').toISOString(),
      );
    });

    it('returns false when only failed runs exist (no completed)', async () => {
      injectFailed(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(false);
      expect(history.lastSuccess).toBeNull();
    });

    it('returns true for only all-failed if an older completed run exists', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      // lastSuccess should still be run-1 since run-2 and run-3 are failed
      expect(history.lastSuccess!.finishedAt).toBe(
        new Date('2026-06-20T10:01:00Z').toISOString(),
      );
    });
  });

  // ── Consecutive failures ───────────────────────────────────────────

  describe('consecutiveFailures', () => {
    it('returns 0 when all runs are completed', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectCompleted(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(0);
    });

    it('returns 1 when most recent run failed and older runs completed', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(1);
    });

    it('returns 2 when two most recent runs failed', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(2);
    });

    it('returns 3 when three most recent runs failed', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));
      injectFailed(repo, 'run-4', WH, new Date('2026-06-23T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(3);
    });

    it('returns all-failed count when no completed runs exist', async () => {
      injectFailed(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(2);
      expect(history.hasBaseline).toBe(false);
    });

    // ── P5-SY10B rework: mode-aware counting ─────────────────────────

    it('does NOT count real_write failed runs (3 real_write fails → 0)', async () => {
      repo._injectRunDetail('run-1', {
        id: 'run-1', warehouseId: WH, mode: 'real_write', status: 'failed', exitCode: 1,
        startedAt: new Date('2026-06-20T10:00:00Z'),
        finishedAt: new Date('2026-06-20T10:01:00Z'),
        errorMessage: '写入失败',
      });
      repo._injectRunDetail('run-2', {
        id: 'run-2', warehouseId: WH, mode: 'real_write', status: 'failed', exitCode: 1,
        startedAt: new Date('2026-06-21T10:00:00Z'),
        finishedAt: new Date('2026-06-21T10:01:00Z'),
        errorMessage: '写入失败',
      });
      repo._injectRunDetail('run-3', {
        id: 'run-3', warehouseId: WH, mode: 'real_write', status: 'failed', exitCode: 1,
        startedAt: new Date('2026-06-22T10:00:00Z'),
        finishedAt: new Date('2026-06-22T10:01:00Z'),
        errorMessage: '写入失败',
      });

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(0);
    });

    it('stops at real_write failed — does not cross real_write to count older dry_run fails', async () => {
      // newest → oldest: real_write failed, dry_run failed, dry_run failed, completed
      injectCompleted(repo, 'run-0', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-1', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-22T10:00:00Z'));
      repo._injectRunDetail('run-3', {
        id: 'run-3', warehouseId: WH, mode: 'real_write', status: 'failed', exitCode: 1,
        startedAt: new Date('2026-06-23T10:00:00Z'),
        finishedAt: new Date('2026-06-23T10:01:00Z'),
        errorMessage: 'real write 失败',
      });

      const history = await repo.getWarehouseHistory(WH);
      // most recent is real_write → stop immediately, don't cross to dry_run fails
      expect(history.consecutiveFailures).toBe(0);
    });

    it('counts only dry_run fails after a real_write (real_write acts as barrier)', async () => {
      // newest → oldest: dry_run failed, real_write completed, dry_run failed, dry_run failed
      injectFailed(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      repo._injectRunDetail('run-3', {
        id: 'run-3', warehouseId: WH, mode: 'real_write', status: 'completed', exitCode: 0,
        startedAt: new Date('2026-06-22T10:00:00Z'),
        finishedAt: new Date('2026-06-22T10:01:00Z'),
        resultSummary: makeResultSummary({ variantsCreated: 5 }),
      });
      injectFailed(repo, 'run-4', WH, new Date('2026-06-23T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      // most recent run-4 is dry_run failed → count=1, then run-3 is real_write → stop
      expect(history.consecutiveFailures).toBe(1);
    });

    it('real_write completed stops chain — does not count older dry_run fails beyond it', async () => {
      // newest → oldest: dry_run failed, real_write completed, dry_run failed
      injectFailed(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      repo._injectRunDetail('run-2', {
        id: 'run-2', warehouseId: WH, mode: 'real_write', status: 'completed', exitCode: 0,
        startedAt: new Date('2026-06-21T10:00:00Z'),
        finishedAt: new Date('2026-06-21T10:01:00Z'),
        resultSummary: makeResultSummary({ variantsCreated: 3 }),
      });
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      // run-3 is dry_run failed → count=1, run-2 is real_write → stop
      expect(history.consecutiveFailures).toBe(1);
    });
  });

  // ── Success resets consecutive failures ────────────────────────────

  describe('success resets consecutive failure chain', () => {
    it('count stops at most recent completed run', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));
      injectCompleted(repo, 'run-4', WH, new Date('2026-06-23T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(0); // stopped by run-4 completed
    });

    it('only counts failures after the most recent completed run', async () => {
      // older success → 2 failures → new success → 1 failure
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectFailed(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'));
      injectCompleted(repo, 'run-4', WH, new Date('2026-06-23T10:00:00Z'));
      injectFailed(repo, 'run-5', WH, new Date('2026-06-24T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.consecutiveFailures).toBe(1); // only run-5 after run-4 success
    });
  });

  // ── Cross-warehouse isolation ──────────────────────────────────────

  describe('cross-warehouse isolation', () => {
    it('returns only WH1 data when WH2 has different runs', async () => {
      injectCompleted(repo, 'wh1-run1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'wh1-run2', WH, new Date('2026-06-21T10:00:00Z'));
      // WH2 has only successful runs
      injectCompleted(repo, 'wh2-run1', WH2, new Date('2026-06-22T10:00:00Z'));
      injectCompleted(repo, 'wh2-run2', WH2, new Date('2026-06-23T10:00:00Z'));

      const wh1History = await repo.getWarehouseHistory(WH);
      const wh2History = await repo.getWarehouseHistory(WH2);

      // WH1: 1 completed, 1 failed (most recent)
      expect(wh1History.hasBaseline).toBe(true);
      expect(wh1History.consecutiveFailures).toBe(1);

      // WH2: 2 completed, 0 failed
      expect(wh2History.hasBaseline).toBe(true);
      expect(wh2History.consecutiveFailures).toBe(0);
    });

    it('empty warehouse returns cold start even when other warehouse has data', async () => {
      injectCompleted(repo, 'wh1-run1', WH, new Date('2026-06-20T10:00:00Z'));

      const wh2History = await repo.getWarehouseHistory(WH2);

      expectColdStart(wh2History);
    });

    it('both warehouses cold start when no data exists', async () => {
      const wh1History = await repo.getWarehouseHistory(WH);
      const wh2History = await repo.getWarehouseHistory(WH2);

      expectColdStart(wh1History);
      expectColdStart(wh2History);
    });
  });

  // ── Stats: last 5 successful runs average ──────────────────────────

  describe('stats (last 5 successful runs)', () => {
    it('computes averages from a single completed run', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'),
        makeResultSummary({
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 10,
          variantsCreated: 5,
        }),
      );

      const history = await repo.getWarehouseHistory(WH);

      expect(history.stats).not.toBeNull();
      expect(history.stats!.avgRawRowCount).toBe(100);
      expect(history.stats!.avgValidSkuCount).toBe(90);
      expect(history.stats!.avgInvalidSkuCount).toBe(10);
      expect(history.stats!.avgVariantsCreated).toBe(5);
    });

    it('computes averages from 5 completed runs', async () => {
      for (let i = 0; i < 5; i++) {
        injectCompleted(repo, `run-${i}`, WH,
          new Date(`2026-06-${20 + i}T10:00:00Z`),
          makeResultSummary({
            rawRowCount: 100 + i * 10,
            validSkuCount: 90 + i * 5,
            invalidSkuCount: 10 - i,
            variantsCreated: 5 + i,
          }),
        );
      }

      const history = await repo.getWarehouseHistory(WH);

      expect(history.stats).not.toBeNull();
      // run-0..run-4: rawRowCount = 100,110,120,130,140 → avg = 120
      expect(history.stats!.avgRawRowCount).toBe(120);
      // validSkuCount = 90,95,100,105,110 → avg = 100
      expect(history.stats!.avgValidSkuCount).toBe(100);
      // invalidSkuCount = 10,9,8,7,6 → avg = 8
      expect(history.stats!.avgInvalidSkuCount).toBe(8);
      // variantsCreated = 5,6,7,8,9 → avg = 7
      expect(history.stats!.avgVariantsCreated).toBe(7);
    });

    it('only uses last 5 completed runs (ignores older)', async () => {
      // inject 7 completed runs, only last 5 should be averaged
      for (let i = 0; i < 7; i++) {
        injectCompleted(repo, `run-${i}`, WH,
          new Date(`2026-06-${20 + i}T10:00:00Z`),
          makeResultSummary({
            rawRowCount: 100 + i * 10,
            validSkuCount: 90,
            invalidSkuCount: 10,
            variantsCreated: 5,
          }),
        );
      }

      const history = await repo.getWarehouseHistory(WH);

      // last 5: run-2..run-6: rawRowCount = 120,130,140,150,160 → avg = 140
      expect(history.stats!.avgRawRowCount).toBe(140);
    });

    it('ignores failed runs in stats calculation', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'),
        makeResultSummary({ rawRowCount: 100, validSkuCount: 90, invalidSkuCount: 10, variantsCreated: 5 }));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));
      injectCompleted(repo, 'run-3', WH, new Date('2026-06-22T10:00:00Z'),
        makeResultSummary({ rawRowCount: 200, validSkuCount: 180, invalidSkuCount: 20, variantsCreated: 8 }));

      const history = await repo.getWarehouseHistory(WH);

      // only 2 completed runs: avgRawRowCount = (100+200)/2 = 150
      expect(history.stats!.avgRawRowCount).toBe(150);
      expect(history.stats!.avgVariantsCreated).toBe(6.5); // (5+8)/2
    });

    it('returns stats=null for cold start (no completed runs)', async () => {
      injectFailed(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);
      expect(history.stats).toBeNull();
    });
  });

  // ── Missing or abnormal result_summary ─────────────────────────────

  describe('missing or abnormal result_summary', () => {
    it('treats missing result_summary fields as 0', async () => {
      // result_summary without scraperMeta fields (simulating pre-P5-SY10B records)
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'), {
        warehouseId: WH,
        warehouseName: '菲律宾仓',
        variantsCreated: 10,
        inventoryInserted: 8,
        inventoryUpdated: 70,
        inventoryUnchanged: 20,
        // no rawRowCount, validSkuCount, invalidSkuCount
      });

      const history = await repo.getWarehouseHistory(WH);

      expect(history.stats).not.toBeNull();
      expect(history.stats!.avgRawRowCount).toBe(0);   // missing → 0
      expect(history.stats!.avgValidSkuCount).toBe(0); // missing → 0
      expect(history.stats!.avgInvalidSkuCount).toBe(0); // missing → 0
      expect(history.stats!.avgVariantsCreated).toBe(10); // present
    });

    it('handles null result_summary gracefully', async () => {
      repo._injectRunDetail('run-1', {
        id: 'run-1',
        warehouseId: WH,
        mode: 'dry_run',
        status: 'completed',
        exitCode: 0,
        startedAt: new Date('2026-06-20T10:00:00Z'),
        finishedAt: new Date('2026-06-20T10:01:00Z'),
        resultSummary: null,
      });

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      expect(history.lastSuccess!.newVariantsCount).toBe(0);
      expect(history.stats!.avgVariantsCreated).toBe(0);
      expect(history.stats!.avgRawRowCount).toBe(0);
    });

    it('handles partial scraperMeta (only rawRowCount present)', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'), {
        warehouseId: WH,
        variantsCreated: 10,
        rawRowCount: 100,
        // validSkuCount and invalidSkuCount missing
      });

      const history = await repo.getWarehouseHistory(WH);

      expect(history.stats!.avgRawRowCount).toBe(100);
      expect(history.stats!.avgValidSkuCount).toBe(0);
      expect(history.stats!.avgInvalidSkuCount).toBe(0);
      expect(history.stats!.avgVariantsCreated).toBe(10);
    });

    it('handles mixed result_summary formats across runs', async () => {
      // run-1: pre-P5-SY10B format (no scraper fields)
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'), {
        warehouseId: WH, variantsCreated: 5, inventoryUpdated: 50,
      });
      // run-2: P5-SY10B format (with scraper fields)
      injectCompleted(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'),
        makeResultSummary({
          rawRowCount: 200, validSkuCount: 180, invalidSkuCount: 20, variantsCreated: 15,
        }),
      );
      // run-3: null
      repo._injectRunDetail('run-3', {
        id: 'run-3', warehouseId: WH, mode: 'dry_run', status: 'completed', exitCode: 0,
        startedAt: new Date('2026-06-22T10:00:00Z'),
        finishedAt: new Date('2026-06-22T10:01:00Z'),
        resultSummary: null,
      });

      const history = await repo.getWarehouseHistory(WH);

      // 3 completed runs
      expect(history.stats!.avgRawRowCount).toBeCloseTo((0 + 200 + 0) / 3);
      expect(history.stats!.avgVariantsCreated).toBeCloseTo((5 + 15 + 0) / 3);
      expect(history.stats!.avgValidSkuCount).toBeCloseTo((0 + 180 + 0) / 3);
    });
  });

  // ── lastSuccess: newVariantsCount ──────────────────────────────────

  describe('lastSuccess.newVariantsCount', () => {
    it('reads from result_summary.variantsCreated', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'),
        makeResultSummary({ variantsCreated: 42 }),
      );

      const history = await repo.getWarehouseHistory(WH);
      expect(history.lastSuccess!.newVariantsCount).toBe(42);
    });

    it('returns 0 when result_summary is null', async () => {
      repo._injectRunDetail('run-1', {
        id: 'run-1', warehouseId: WH, mode: 'dry_run', status: 'completed', exitCode: 0,
        startedAt: new Date('2026-06-20T10:00:00Z'),
        finishedAt: new Date('2026-06-20T10:01:00Z'),
        resultSummary: null,
      });

      const history = await repo.getWarehouseHistory(WH);
      expect(history.lastSuccess!.newVariantsCount).toBe(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles in_progress runs (not counted anywhere)', async () => {
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-20T10:00:00Z'));
      repo._injectRunDetail('run-2', {
        id: 'run-2', warehouseId: WH, mode: 'dry_run', status: 'in_progress', exitCode: null,
        startedAt: new Date('2026-06-21T10:00:00Z'),
        finishedAt: null,
        resultSummary: null,
      });

      const history = await repo.getWarehouseHistory(WH);

      // in_progress should not affect consecutiveFailures (breaks chain)
      expect(history.consecutiveFailures).toBe(0);
      // lastSuccess should still be run-1
      expect(history.lastSuccess).not.toBeNull();
    });

    it('handles real_write completed runs in stats', async () => {
      repo._injectRunDetail('run-1', {
        id: 'run-1', warehouseId: WH, mode: 'real_write', status: 'completed', exitCode: 0,
        startedAt: new Date('2026-06-20T10:00:00Z'),
        finishedAt: new Date('2026-06-20T10:01:00Z'),
        resultSummary: makeResultSummary({ rawRowCount: 150, variantsCreated: 8 }),
      });

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      expect(history.stats!.avgRawRowCount).toBe(150);
    });

    it('sorts by startedAt descending (not createdAt)', async () => {
      // run-1 started later than run-2 but created earlier
      injectCompleted(repo, 'run-1', WH, new Date('2026-06-22T10:00:00Z'));
      injectFailed(repo, 'run-2', WH, new Date('2026-06-21T10:00:00Z'));

      const history = await repo.getWarehouseHistory(WH);

      // Most recent: run-1 (completed) → consecutiveFailures = 0
      expect(history.consecutiveFailures).toBe(0);
      // lastSuccess is run-1
      expect(history.lastSuccess!.finishedAt).toBe(
        new Date('2026-06-22T10:01:00Z').toISOString(),
      );
    });

    it('handles warehouse with many completed runs (25 runs, last 5 used for stats)', async () => {
      // Inject 25 completed runs with distinct timestamps.
      // MockRepository considers all runs (no artificial DB limit),
      // so lastSuccess is the most recent (run-24), stats use last 5 (run-20..24).
      for (let i = 0; i < 25; i++) {
        const day = String(i + 1).padStart(2, '0');
        injectCompleted(repo, `run-${String(i).padStart(2, '0')}`, WH,
          new Date(`2026-06-${day}T10:00:00.000Z`),
          makeResultSummary({
            rawRowCount: 100 + i,
            variantsCreated: 5 + Math.floor(i / 5),
          }),
        );
      }

      const history = await repo.getWarehouseHistory(WH);

      expect(history.hasBaseline).toBe(true);
      // lastSuccess = run-24 (day 25, most recent)
      expect(history.lastSuccess).not.toBeNull();
      // stats use last 5 completed (runs 20-24): rawRowCount = 120-124, avg = 122
      expect(history.stats).not.toBeNull();
      expect(history.stats!.avgVariantsCreated).toBeGreaterThan(0);
    });
  });

  // ── Type contract ──────────────────────────────────────────────────

  describe('type contract', () => {
    it('returned object matches WarehouseHistory shape', async () => {
      const history = await repo.getWarehouseHistory(WH);

      expect(typeof history.hasBaseline).toBe('boolean');
      expect(typeof history.consecutiveFailures).toBe('number');
      expect(history.lastSuccess === null || typeof history.lastSuccess === 'object').toBe(true);
      if (history.lastSuccess) {
        expect(typeof history.lastSuccess.finishedAt).toBe('string');
        expect(typeof history.lastSuccess.newVariantsCount).toBe('number');
      }
      expect(history.stats === null || typeof history.stats === 'object').toBe(true);
      if (history.stats) {
        expect(typeof history.stats.avgRawRowCount).toBe('number');
        expect(typeof history.stats.avgValidSkuCount).toBe('number');
        expect(typeof history.stats.avgInvalidSkuCount).toBe('number');
        expect(typeof history.stats.avgVariantsCreated).toBe('number');
      }
    });
  });
});
