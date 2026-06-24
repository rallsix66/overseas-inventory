// Sync Feature Module — 规则引擎测试 (P5-SY10A)
//
// 覆盖 R1–R11 每条规则的命中/不命中/边界，冷启动双路径，
// 多规则组合场景，division-by-zero 安全边界。

import { describe, it, expect } from 'vitest';
import { evaluateRules, evaluateSessionHealth } from './rules-engine';
import type { RuleInput, RuleLevel, SessionHealthResult } from './types';

// ─── Test Helpers ─────────────────────────────────────────────────

const HEALTHY: SessionHealthResult = {
  status: 'healthy',
  message: '已登录可用',
  checkedAt: '2026-06-24T09:00:00.000Z',
};

function unhealthy(status: SessionHealthResult['status']): SessionHealthResult {
  return { status, message: `会话异常: ${status}`, checkedAt: '2026-06-24T09:00:00.000Z' };
}

/** 构建一个"全部 PASS"的默认输入 */
function makeInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    sessionHealth: HEALTHY,
    dryRun: {
      status: 'ready',
      planDriftCheck: 'PASS',
      rawRowCount: 100,
      validSkuCount: 95,
      invalidSkuCount: 5,
      variantsCreated: 2,
      inventoryInserted: 2,
      inventoryUpdated: 80,
      inventoryUnchanged: 13,
      warehouseRenamePlan: null,
      failureReason: undefined,
    },
    history: {
      hasBaseline: true,
      consecutiveFailures: 0,
      lastSuccess: {
        finishedAt: '2026-06-23T09:00:00.000Z',
        newVariantsCount: 3,
      },
      stats: {
        avgRawRowCount: 98,
        avgValidSkuCount: 93,
        avgInvalidSkuCount: 5,
        avgVariantsCreated: 2.5,
      },
    },
  };

  if (overrides) {
    return deepMerge(base, overrides) as RuleInput;
  }
  return base;
}

/** 浅层深度合并（仅一层嵌套） */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      (result as Record<string, unknown>)[key as string] = {
        ...(tgtVal as Record<string, unknown>),
        ...(srcVal as Record<string, unknown>),
      };
    } else {
      (result as Record<string, unknown>)[key as string] = srcVal;
    }
  }
  return result;
}

/** 创建冷启动输入（!hasBaseline, stats=null） */
function coldInput(overrides?: Partial<RuleInput>): RuleInput {
  return makeInput({
    history: {
      hasBaseline: false,
      consecutiveFailures: 0,
      lastSuccess: null,
      stats: null,
    },
    ...overrides,
  });
}

/** 辅助：断言 verdict 的 decision 和命中规则列表 */
function expectVerdict(
  verdict: ReturnType<typeof evaluateRules>,
  expectedDecision: RuleLevel,
  expectedRules: string[],
) {
  expect(verdict.decision).toBe(expectedDecision);
  expect(verdict.evaluations.map((e) => e.rule)).toEqual(expectedRules);
}

// ─── R1: session_unhealthy ────────────────────────────────────────

describe('R1: session_unhealthy', () => {
  it('BLOCK when session health is not healthy', () => {
    const v = evaluateRules(makeInput({ sessionHealth: unhealthy('need_login') }));
    expectVerdict(v, 'BLOCK', ['session_unhealthy']);
    expect(v.evaluations[0].message).toContain('登录会话不可用');
  });

  it('does not trigger when session is healthy', () => {
    const v = evaluateRules(makeInput());
    expect(v.evaluations.find((e) => e.rule === 'session_unhealthy')).toBeUndefined();
  });

  it('each unhealthy status triggers BLOCK', () => {
    const statuses: SessionHealthResult['status'][] = [
      'need_login',
      'need_verification',
      'profile_unavailable',
      'page_structure_changed',
      'table_not_loaded',
      'unknown_error',
    ];
    for (const status of statuses) {
      const v = evaluateRules(makeInput({ sessionHealth: unhealthy(status) }));
      expect(v.decision).toBe('BLOCK');
      expect(v.evaluations[0].rule).toBe('session_unhealthy');
      expect(v.evaluations[0].details?.status).toBe(status);
    }
  });
});

// ─── R2: all_zero ─────────────────────────────────────────────────

describe('R2: all_zero', () => {
  it('BLOCK when both rawRowCount and validSkuCount are 0', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expectVerdict(v, 'BLOCK', ['all_zero']);
  });

  it('does not trigger when rawRowCount > 0', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 1,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'all_zero')).toBeUndefined();
  });

  it('does not trigger when validSkuCount > 0 (even if rawRowCount = 0)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 5,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 5,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'all_zero')).toBeUndefined();
  });
});

// ─── R3: plan_drift ───────────────────────────────────────────────

describe('R3: plan_drift', () => {
  it('BLOCK when planDriftCheck is DRIFT_DETECTED', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'blocked',
          planDriftCheck: 'DRIFT_DETECTED',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.some((e) => e.rule === 'plan_drift')).toBe(true);
  });

  it('BLOCK when planDriftCheck is null (unknown state)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: null,
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.some((e) => e.rule === 'plan_drift')).toBe(true);
  });

  it('does not trigger when planDriftCheck is PASS', () => {
    const v = evaluateRules(makeInput());
    expect(v.evaluations.find((e) => e.rule === 'plan_drift')).toBeUndefined();
  });
});

// ─── R4: dry_run_failed ──────────────────────────────────────────

describe('R4: dry_run_failed', () => {
  it('BLOCK when dryRun.status is failed', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'failed',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
          failureReason: 'BigSeller 抓取超时',
        },
      }),
    );
    const r4 = v.evaluations.find((e) => e.rule === 'dry_run_failed');
    expect(r4).toBeDefined();
    expect(r4!.level).toBe('BLOCK');
    expect(r4!.message).toContain('抓取超时');
  });

  it('does not trigger when dryRun.status is ready', () => {
    const v = evaluateRules(makeInput());
    expect(v.evaluations.find((e) => e.rule === 'dry_run_failed')).toBeUndefined();
  });

  it('does not trigger when dryRun.status is blocked (different rule)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'blocked',
          planDriftCheck: 'DRIFT_DETECTED',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'dry_run_failed')).toBeUndefined();
  });

  it('failureReason is optional, message still readable', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'failed',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r4 = v.evaluations.find((e) => e.rule === 'dry_run_failed');
    expect(r4).toBeDefined();
    expect(r4!.message).toBe('Dry Run 执行失败');
  });
});

// ─── R5: consecutive_failures ─────────────────────────────────────

describe('R5: consecutive_failures', () => {
  it('BLOCK when consecutiveFailures >= 3', () => {
    const v = evaluateRules(
      makeInput({ history: { hasBaseline: true, consecutiveFailures: 3, lastSuccess: null, stats: null } }),
    );
    expectVerdict(v, 'BLOCK', ['consecutive_failures']);
    expect(v.evaluations[0].message).toContain('连续 3 次');
  });

  it('BLOCK when consecutiveFailures > 3', () => {
    const v = evaluateRules(
      makeInput({ history: { hasBaseline: true, consecutiveFailures: 5, lastSuccess: null, stats: null } }),
    );
    expect(v.evaluations[0].message).toContain('连续 5 次');
  });

  it('does not trigger when consecutiveFailures = 2', () => {
    const v = evaluateRules(
      makeInput({ history: { hasBaseline: true, consecutiveFailures: 2, lastSuccess: null, stats: null } }),
    );
    expect(v.evaluations.find((e) => e.rule === 'consecutive_failures')).toBeUndefined();
  });

  it('does not trigger when consecutiveFailures = 0', () => {
    const v = evaluateRules(makeInput());
    expect(v.evaluations.find((e) => e.rule === 'consecutive_failures')).toBeUndefined();
  });
});

// ─── R6: warehouse_rename ─────────────────────────────────────────

describe('R6: warehouse_rename', () => {
  it('WARN when warehouseRenamePlan.action is rename', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: {
            action: 'rename',
            currentName: '旧仓库名',
            targetName: '新仓库名',
            message: 'BigSeller 仓库名称已变更',
          },
        },
      }),
    );
    expectVerdict(v, 'WARN', ['warehouse_rename']);
    expect(v.evaluations[0].message).toContain('旧仓库名');
    expect(v.evaluations[0].message).toContain('新仓库名');
  });

  it('does not trigger when action is none', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'none', currentName: '仓库', message: '名称一致' },
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'warehouse_rename')).toBeUndefined();
  });

  it('does not trigger when warehouseRenamePlan is null', () => {
    const v = evaluateRules(makeInput());
    expect(v.evaluations.find((e) => e.rule === 'warehouse_rename')).toBeUndefined();
  });
});

// ─── R7: cold_start_high_new ──────────────────────────────────────

describe('R7: cold_start_high_new', () => {
  it('WARN when cold start and variantsCreated / validSkuCount > 0.5', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 100,
          invalidSkuCount: 0,
          variantsCreated: 80,
          inventoryInserted: 80,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r7 = v.evaluations.find((e) => e.rule === 'cold_start_high_new');
    expect(r7).toBeDefined();
    expect(r7!.level).toBe('WARN');
    expect(r7!.message).toContain('冷启动');
    expect(r7!.message).toContain('80%');
  });

  it('does not trigger when ratio <= 0.5 (boundary)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 100,
          invalidSkuCount: 0,
          variantsCreated: 50, // exactly 0.5
          inventoryInserted: 50,
          inventoryUpdated: 0,
          inventoryUnchanged: 50,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'cold_start_high_new')).toBeUndefined();
  });

  it('does not trigger when cold start and ratio is low', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 100,
          invalidSkuCount: 0,
          variantsCreated: 5,
          inventoryInserted: 5,
          inventoryUpdated: 0,
          inventoryUnchanged: 95,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'cold_start_high_new')).toBeUndefined();
  });

  it('does not trigger when hasBaseline (not cold start)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 100,
          invalidSkuCount: 0,
          variantsCreated: 80,
          inventoryInserted: 80,
          inventoryUpdated: 0,
          inventoryUnchanged: 20,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'cold_start_high_new')).toBeUndefined();
  });

  it('does not trigger when validSkuCount is 0 (division by zero guard)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'cold_start_high_new')).toBeUndefined();
  });
});

// ─── R8: high_invalid_sku ─────────────────────────────────────────

describe('R8: high_invalid_sku', () => {
  it('WARN when hasBaseline and invalidSkuCount / rawRowCount > 0.1', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 85,
          invalidSkuCount: 15,
          variantsCreated: 2,
          inventoryInserted: 2,
          inventoryUpdated: 83,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r8 = v.evaluations.find((e) => e.rule === 'high_invalid_sku');
    expect(r8).toBeDefined();
    expect(r8!.level).toBe('WARN');
    expect(r8!.message).toContain('15%');
  });

  it('does not trigger when ratio = 0.1 (boundary)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 10, // exactly 0.1
          variantsCreated: 2,
          inventoryInserted: 2,
          inventoryUpdated: 88,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku')).toBeUndefined();
  });

  it('does not trigger when cold start (skipped)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 75,
          invalidSkuCount: 25,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku')).toBeUndefined();
  });

  it('does not trigger when rawRowCount is 0 (division by zero guard)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku')).toBeUndefined();
  });
});

// ─── R9: high_new_variants ────────────────────────────────────────

describe('R9: high_new_variants', () => {
  it('WARN when variantsCreated > max(5, avgVariantsCreated * 3)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 0,
          variantsCreated: 20, // threshold = max(5, 2.5*3=7.5) = 7.5
          inventoryInserted: 20,
          inventoryUpdated: 70,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r9 = v.evaluations.find((e) => e.rule === 'high_new_variants');
    expect(r9).toBeDefined();
    expect(r9!.level).toBe('WARN');
    expect(r9!.message).toContain('阈值 7.5');
  });

  it('does not trigger when variantsCreated = max(5, avg*3) (boundary)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 0,
          variantsCreated: 8, // Math.ceil(2.5*3) = 7.5 → max(5, 7.5) = 7.5 → > 7.5? No, 8 > 7.5 → triggers!
          inventoryInserted: 8,
          inventoryUpdated: 82,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    // threshold = max(5, 2.5*3=7.5) = 7.5, variantsCreated=8 > 7.5 → triggers
    expect(v.evaluations.find((e) => e.rule === 'high_new_variants')).toBeDefined();
  });

  it('does not trigger when variantsCreated <= max(5, avg*3)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 0,
          variantsCreated: 7, // below threshold 7.5
          inventoryInserted: 7,
          inventoryUpdated: 83,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_new_variants')).toBeUndefined();
  });

  it('threshold is at least 5 even when avg is very low', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 0,
          variantsCreated: 5,
          inventoryInserted: 5,
          inventoryUpdated: 85,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
        history: {
          hasBaseline: true,
          consecutiveFailures: 0,
          lastSuccess: { finishedAt: '2026-06-23T09:00:00.000Z', newVariantsCount: 0 },
          stats: { avgRawRowCount: 100, avgValidSkuCount: 95, avgInvalidSkuCount: 5, avgVariantsCreated: 0 },
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_new_variants')).toBeUndefined();
  });

  it('does not trigger when cold start (skipped)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 50,
          inventoryInserted: 50,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_new_variants')).toBeUndefined();
  });
});

// ─── R10: row_count_anomaly ───────────────────────────────────────

describe('R10: row_count_anomaly', () => {
  it('WARN when deviation > 0.5', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 160, // avg=98, deviation = 62/98 ≈ 0.63
          validSkuCount: 150,
          invalidSkuCount: 10,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r10 = v.evaluations.find((e) => e.rule === 'row_count_anomaly');
    expect(r10).toBeDefined();
    expect(r10!.level).toBe('WARN');
    expect(r10!.message).toContain('波动异常');
  });

  it('does not trigger when deviation = 0.5 (boundary)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 147, // avg=98, deviation = 49/98 = 0.5
          validSkuCount: 140,
          invalidSkuCount: 7,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'row_count_anomaly')).toBeUndefined();
  });

  it('does not trigger when deviation < 0.5', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 120, // deviation = 22/98 ≈ 0.22
          validSkuCount: 110,
          invalidSkuCount: 10,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'row_count_anomaly')).toBeUndefined();
  });

  it('does not trigger when cold start (skipped)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 200,
          validSkuCount: 190,
          invalidSkuCount: 10,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'row_count_anomaly')).toBeUndefined();
  });

  it('does not trigger when avgRawRowCount is 0 (division by zero guard)', () => {
    const v = evaluateRules(
      makeInput({
        history: {
          hasBaseline: true,
          consecutiveFailures: 0,
          lastSuccess: null,
          stats: { avgRawRowCount: 0, avgValidSkuCount: 0, avgInvalidSkuCount: 0, avgVariantsCreated: 0 },
        },
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'row_count_anomaly')).toBeUndefined();
  });
});

// ─── R11: high_invalid_sku_cold ───────────────────────────────────

describe('R11: high_invalid_sku_cold', () => {
  it('WARN when cold start and invalidSkuCount / rawRowCount > 0.3', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 60,
          invalidSkuCount: 40, // ratio = 0.4
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const r11 = v.evaluations.find((e) => e.rule === 'high_invalid_sku_cold');
    expect(r11).toBeDefined();
    expect(r11!.level).toBe('WARN');
    expect(r11!.message).toContain('40%');
    expect(r11!.message).toContain('冷启动');
  });

  it('does not trigger when ratio = 0.3 (boundary)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 70,
          invalidSkuCount: 30, // exactly 0.3
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku_cold')).toBeUndefined();
  });

  it('does not trigger when warm (hasBaseline = true)', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 50,
          invalidSkuCount: 50,
          variantsCreated: 2,
          inventoryInserted: 2,
          inventoryUpdated: 48,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku_cold')).toBeUndefined();
  });

  it('does not trigger when rawRowCount is 0 (division by zero guard)', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku_cold')).toBeUndefined();
  });
});

// ─── Cold Start Combined Behavior ─────────────────────────────────

describe('cold start: R8/R9/R10 skipped, R7/R11 active as WARN only', () => {
  it('R7 + R11 both fire in cold start with extreme values', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 30,
          invalidSkuCount: 70,
          variantsCreated: 30, // 30/30 = 1.0 → R7 fires
          inventoryInserted: 30,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    const rules = v.evaluations.map((e) => e.rule);
    expect(rules).toContain('cold_start_high_new');
    expect(rules).toContain('high_invalid_sku_cold');
    expect(rules).not.toContain('high_invalid_sku');
    expect(rules).not.toContain('high_new_variants');
    expect(rules).not.toContain('row_count_anomaly');
    expect(v.decision).toBe('WARN'); // only WARNs, no BLOCK
  });

  it('R8/R9/R10 never fire in cold start even with abnormal values', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 80,
          invalidSkuCount: 20, // would be R8 if warm
          variantsCreated: 30, // would be R9 if warm
          inventoryInserted: 30,
          inventoryUpdated: 50,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
        },
      }),
    );
    expect(v.evaluations.find((e) => e.rule === 'high_invalid_sku')).toBeUndefined();
    expect(v.evaluations.find((e) => e.rule === 'high_new_variants')).toBeUndefined();
    expect(v.evaluations.find((e) => e.rule === 'row_count_anomaly')).toBeUndefined();
  });
});

// ─── Combination Scenarios ────────────────────────────────────────

describe('combination scenarios', () => {
  it('BLOCK + WARN → decision is BLOCK, all evaluations present', () => {
    const v = evaluateRules(
      makeInput({
        sessionHealth: unhealthy('need_login'),
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 95,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.decision).toBe('BLOCK');
    const rules = v.evaluations.map((e) => e.rule);
    expect(rules).toContain('session_unhealthy');
    expect(rules).toContain('warehouse_rename');
    expect(v.evaluations.length).toBeGreaterThanOrEqual(2);
    expect(v.summary).toContain('项阻断');
    expect(v.summary).toContain('项警告');
  });

  it('multiple WARNs → decision is WARN, all evaluations present', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 85,
          invalidSkuCount: 15,
          variantsCreated: 30,
          inventoryInserted: 30,
          inventoryUpdated: 55,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: '旧', targetName: '新' },
        },
      }),
    );
    expect(v.decision).toBe('WARN');
    const rules = v.evaluations.map((e) => e.rule);
    expect(rules).toContain('warehouse_rename');
    expect(rules).toContain('high_invalid_sku');
    expect(rules).toContain('high_new_variants');
    expect(v.summary).not.toContain('项阻断');
    expect(v.summary).toContain('项警告');
  });

  it('no rules fire → decision is PASS, evaluations empty', () => {
    const v = evaluateRules(makeInput());
    expect(v.decision).toBe('PASS');
    expect(v.evaluations).toHaveLength(0);
    expect(v.summary).toBe('全部通过');
  });

  it('all BLOCK rules fire → decision is BLOCK, all present', () => {
    const v = evaluateRules(
      makeInput({
        sessionHealth: unhealthy('need_verification'),
        dryRun: {
          status: 'failed',
          planDriftCheck: 'DRIFT_DETECTED',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: null,
          failureReason: '超时',
        },
        history: {
          hasBaseline: true,
          consecutiveFailures: 4,
          lastSuccess: null,
          stats: null,
        },
      }),
    );
    expect(v.decision).toBe('BLOCK');
    const rules = v.evaluations.map((e) => e.rule);
    expect(rules).toContain('session_unhealthy');
    expect(rules).toContain('all_zero');
    expect(rules).toContain('plan_drift');
    expect(rules).toContain('dry_run_failed');
    expect(rules).toContain('consecutive_failures');
    expect(v.summary).toContain('5 项阻断');
  });

  it('cold start: rename + R7 + R11, no BLOCK', () => {
    const v = evaluateRules(
      coldInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 30,
          invalidSkuCount: 70,
          variantsCreated: 30, // 30/30 = 1.0 → R7
          inventoryInserted: 30,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.decision).toBe('WARN');
    expect(v.evaluations.map((e) => e.rule).sort()).toEqual(
      ['cold_start_high_new', 'high_invalid_sku_cold', 'warehouse_rename'].sort(),
    );
  });
});

// ─── decision derivation ──────────────────────────────────────────

describe('decision derivation (deriveDecision)', () => {
  it('PASS when no evaluations', () => {
    const v = evaluateRules(makeInput());
    expect(v.decision).toBe('PASS');
    expect(v.evaluations).toHaveLength(0);
  });

  it('WARN when only WARN rules fire', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.decision).toBe('WARN');
  });

  it('BLOCK wins over WARN', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.decision).toBe('BLOCK');
    expect(v.evaluations.some((e) => e.level === 'BLOCK')).toBe(true);
    expect(v.evaluations.some((e) => e.level === 'WARN')).toBe(true);
  });
});

// ─── evaluateSessionHealth ────────────────────────────────────────

describe('evaluateSessionHealth', () => {
  it('returns null when healthy', () => {
    expect(evaluateSessionHealth(HEALTHY)).toBeNull();
  });

  it('returns BLOCK RuleEvaluation when unhealthy', () => {
    const result = evaluateSessionHealth(unhealthy('need_login'));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('session_unhealthy');
    expect(result!.level).toBe('BLOCK');
    expect(result!.message).toContain('登录会话不可用');
    expect(result!.details?.status).toBe('need_login');
  });

  it('each unhealthy status returns BLOCK', () => {
    const statuses: SessionHealthResult['status'][] = [
      'need_login',
      'need_verification',
      'profile_unavailable',
      'page_structure_changed',
      'table_not_loaded',
      'unknown_error',
    ];
    for (const status of statuses) {
      const result = evaluateSessionHealth(unhealthy(status));
      expect(result!.level).toBe('BLOCK');
      expect(result!.details?.status).toBe(status);
    }
  });
});

// ─── Summary Format ───────────────────────────────────────────────

describe('summary format', () => {
  it('全部通过 when no evaluations', () => {
    const v = evaluateRules(makeInput());
    expect(v.summary).toBe('全部通过');
  });

  it('N 项阻断 when only BLOCK', () => {
    const v = evaluateRules(
      makeInput({
        sessionHealth: unhealthy('need_login'),
      }),
    );
    expect(v.summary).toBe('1 项阻断');
  });

  it('N 项警告 when only WARN', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 100,
          validSkuCount: 90,
          invalidSkuCount: 5,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.summary).toBe('1 项警告');
  });

  it('N 项阻断，M 项警告 when mixed', () => {
    const v = evaluateRules(
      makeInput({
        dryRun: {
          status: 'ready',
          planDriftCheck: 'PASS',
          rawRowCount: 0,
          validSkuCount: 0,
          invalidSkuCount: 0,
          variantsCreated: 0,
          inventoryInserted: 0,
          inventoryUpdated: 0,
          inventoryUnchanged: 0,
          warehouseRenamePlan: { action: 'rename', currentName: 'A', targetName: 'B' },
        },
      }),
    );
    expect(v.summary).toBe('1 项阻断，1 项警告');
  });
});
