// Sync Feature Module — 规则引擎 (P5-SY10A)
//
// evaluateRules 是纯函数：不依赖数据库、网络、文件系统或全局状态。
// 调用方负责提供完整的 RuleInput（含当前 Dry Run 结果和历史上下文）。
// 函数输出确定性 RuleVerdict，不执行任何副作用。

import type { RuleInput, RuleVerdict, RuleEvaluation, RuleLevel, SessionHealthResult } from './types';

const BLOCK: RuleLevel = 'BLOCK';
const WARN: RuleLevel = 'WARN';
const PASS: RuleLevel = 'PASS';

/** 从评估列表推导最终决策级别 */
function deriveDecision(evaluations: RuleEvaluation[]): RuleLevel {
  if (evaluations.length === 0) return PASS;
  for (const e of evaluations) {
    if (e.level === BLOCK) return BLOCK;
  }
  for (const e of evaluations) {
    if (e.level === WARN) return WARN;
  }
  return PASS;
}

/** 构建简短中文摘要 */
function buildSummary(evaluations: RuleEvaluation[]): string {
  const blockCount = evaluations.filter((e) => e.level === BLOCK).length;
  const warnCount = evaluations.filter((e) => e.level === WARN).length;
  const parts: string[] = [];
  if (blockCount > 0) parts.push(`${blockCount} 项阻断`);
  if (warnCount > 0) parts.push(`${warnCount} 项警告`);
  if (parts.length === 0) return '全部通过';
  return parts.join('，');
}

/**
 * 评估单仓 Dry Run 结果与历史上下文，返回规则决策。
 *
 * 规则优先级 R1→R11，所有命中规则均收集到 evaluations 中。
 * 最终 decision 取最严重级别（BLOCK > WARN > PASS）。
 *
 * 冷启动（!history.hasBaseline）时：
 *   - R8/R9/R10（需要历史基线）自动跳过
 *   - R7/R11 生效但仅 WARN，不直接 BLOCK
 */
export function evaluateRules(input: RuleInput): RuleVerdict {
  const evaluations: RuleEvaluation[] = [];
  const { sessionHealth, dryRun, history } = input;

  // ── R1: session unhealthy → BLOCK ──────────────────────────────
  if (sessionHealth.status !== 'healthy') {
    evaluations.push({
      rule: 'session_unhealthy',
      level: BLOCK,
      message: `BigSeller 登录会话不可用（${sessionHealth.message}）`,
      details: { status: sessionHealth.status },
    });
  }

  // ── R2: all zero → BLOCK ───────────────────────────────────────
  if (dryRun.rawRowCount === 0 && dryRun.validSkuCount === 0) {
    evaluations.push({
      rule: 'all_zero',
      level: BLOCK,
      message:
        '抓取结果完全为空（rawRowCount=0 且 validSkuCount=0），可能登录已过期或页面结构异常',
      details: { rawRowCount: 0, validSkuCount: 0 },
    });
  }

  // ── R3: plan drift → BLOCK ─────────────────────────────────────
  if (dryRun.planDriftCheck !== 'PASS') {
    evaluations.push({
      rule: 'plan_drift',
      level: BLOCK,
      message: `计划漂移未通过（plan_drift_check=${dryRun.planDriftCheck ?? 'null'}），数据不可信`,
      details: { planDriftCheck: dryRun.planDriftCheck },
    });
  }

  // ── R4: dry run failed → BLOCK ─────────────────────────────────
  if (dryRun.status === 'failed') {
    evaluations.push({
      rule: 'dry_run_failed',
      level: BLOCK,
      message: `Dry Run 执行失败${dryRun.failureReason ? `：${dryRun.failureReason}` : ''}`,
      details: { failureReason: dryRun.failureReason ?? null },
    });
  }

  // ── R5: consecutive failures >= 3 → BLOCK ──────────────────────
  if (history.consecutiveFailures >= 3) {
    evaluations.push({
      rule: 'consecutive_failures',
      level: BLOCK,
      message: `同仓连续 ${history.consecutiveFailures} 次 Dry Run 失败，需人工排查后手动重置`,
      details: { consecutiveFailures: history.consecutiveFailures },
    });
  }

  // ── R6: warehouse rename → WARN ────────────────────────────────
  if (dryRun.warehouseRenamePlan?.action === 'rename') {
    const plan = dryRun.warehouseRenamePlan;
    evaluations.push({
      rule: 'warehouse_rename',
      level: WARN,
      message: `仓库改名需人工确认：${plan.currentName ?? '?'} → ${plan.targetName ?? '?'}${plan.message ? `（${plan.message}）` : ''}`,
      details: {
        currentName: plan.currentName ?? null,
        targetName: plan.targetName ?? null,
      },
    });
  }

  // ── R7: cold start high new variants → WARN (only !hasBaseline) ─
  if (!history.hasBaseline && dryRun.validSkuCount > 0) {
    const ratio = dryRun.variantsCreated / dryRun.validSkuCount;
    if (ratio > 0.5) {
      evaluations.push({
        rule: 'cold_start_high_new',
        level: WARN,
        message: `冷启动：新增 SKU 比例 ${(ratio * 100).toFixed(0)}%（${dryRun.variantsCreated}/${dryRun.validSkuCount}），首次同步属正常现象`,
        details: {
          variantsCreated: dryRun.variantsCreated,
          validSkuCount: dryRun.validSkuCount,
          ratio: Math.round(ratio * 1000) / 1000,
        },
      });
    }
  }

  // ── R8: high invalid SKU ratio → WARN (requires baseline) ──────
  if (history.hasBaseline && dryRun.rawRowCount > 0) {
    const ratio = dryRun.invalidSkuCount / dryRun.rawRowCount;
    if (ratio > 0.1) {
      evaluations.push({
        rule: 'high_invalid_sku',
        level: WARN,
        message: `无效 SKU 比例异常：${(ratio * 100).toFixed(0)}%（${dryRun.invalidSkuCount}/${dryRun.rawRowCount}），超过 10% 阈值`,
        details: {
          invalidSkuCount: dryRun.invalidSkuCount,
          rawRowCount: dryRun.rawRowCount,
          ratio: Math.round(ratio * 1000) / 1000,
        },
      });
    }
  }

  // ── R9: high new variants → WARN (requires baseline) ───────────
  if (history.hasBaseline && history.stats) {
    const threshold = Math.max(5, history.stats.avgVariantsCreated * 3);
    if (dryRun.variantsCreated > threshold) {
      evaluations.push({
        rule: 'high_new_variants',
        level: WARN,
        message: `新增 Variant 数量异常：${dryRun.variantsCreated}（阈值 ${threshold}，历史均值 ${history.stats.avgVariantsCreated.toFixed(1)}）`,
        details: {
          variantsCreated: dryRun.variantsCreated,
          threshold,
          avgVariantsCreated: history.stats.avgVariantsCreated,
        },
      });
    }
  }

  // ── R10: row count anomaly → WARN (requires baseline) ──────────
  //        rawRowCount > 0: 避免与 R2 (all_zero) 重复触发；
  //        avgRawRowCount > 0: 防止除零。
  if (
    history.hasBaseline &&
    history.stats &&
    dryRun.rawRowCount > 0 &&
    history.stats.avgRawRowCount > 0
  ) {
    const deviation =
      Math.abs(dryRun.rawRowCount - history.stats.avgRawRowCount) /
      history.stats.avgRawRowCount;
    if (deviation > 0.5) {
      evaluations.push({
        rule: 'row_count_anomaly',
        level: WARN,
        message: `抓取行数波动异常：${dryRun.rawRowCount} 行（历史均值 ${history.stats.avgRawRowCount.toFixed(0)}，偏差 ${(deviation * 100).toFixed(0)}%）`,
        details: {
          rawRowCount: dryRun.rawRowCount,
          avgRawRowCount: history.stats.avgRawRowCount,
          deviation: Math.round(deviation * 1000) / 1000,
        },
      });
    }
  }

  // ── R11: high invalid SKU cold → WARN (only !hasBaseline) ──────
  if (!history.hasBaseline && dryRun.rawRowCount > 0) {
    const ratio = dryRun.invalidSkuCount / dryRun.rawRowCount;
    if (ratio > 0.3) {
      evaluations.push({
        rule: 'high_invalid_sku_cold',
        level: WARN,
        message: `冷启动：无效 SKU 比例 ${(ratio * 100).toFixed(0)}%（${dryRun.invalidSkuCount}/${dryRun.rawRowCount}），超过 30% 阈值`,
        details: {
          invalidSkuCount: dryRun.invalidSkuCount,
          rawRowCount: dryRun.rawRowCount,
          ratio: Math.round(ratio * 1000) / 1000,
        },
      });
    }
  }

  const decision = deriveDecision(evaluations);
  const summary = buildSummary(evaluations);

  return { decision, evaluations, summary };
}

/**
 * 全局会话健康检查 — 在逐仓评估前调用。
 * 返回 RuleEvaluation（unhealthy 时）或 null（healthy 时）。
 * R1 由逐仓 evaluateRules 内部重复评估；本函数提供提前短路能力。
 */
export function evaluateSessionHealth(
  health: SessionHealthResult,
): RuleEvaluation | null {
  if (health.status !== 'healthy') {
    return {
      rule: 'session_unhealthy',
      level: BLOCK,
      message: `BigSeller 登录会话不可用（${health.message}）`,
      details: { status: health.status },
    };
  }
  return null;
}
