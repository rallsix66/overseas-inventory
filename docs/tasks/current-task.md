# Current Task Packet

## Task ID

`P5-SY10` — 自动 Dry Run 预审与后续自动化分阶段框架

## 状态

`IN_PROGRESS` — P5-SY10A DONE（规则引擎核心已实现并验收通过）。P5-SY10B~F 待启动。P5-SY9 全部子任务（A~K）DONE。

## 背景

P5-SY9 已完成全部 5 海外仓的生产化批量 Dry Run → 审核 → 批量真实写入闭环。当前同步流程依赖 Admin 手动触发：登录 → 检查 session → 点击批量 Dry Run → 逐仓审核 → 勾选 → 输入确认短语 → 写入。

P5-SY10 的目标不是替换这个人工审核闭环，而是在其上层增加一个**自动预审层**：定时自动执行 Dry Run、规则引擎自动评估、产出 PASS/WARN/BLOCK 决策。**PASS 仓库仍需 Admin 人工确认后才执行 Real Write**，不自动写库。

本任务仅做 Phase A（自动 Dry Run + 规则预审 + 人工确认 Real Write）。Phase B（PASS 仓库自动 Real Write）仅作为设计预留，不在首版启用。

## 任务目标

1. **自动 Dry Run 调度与预审**：定时或手动触发全部海外仓 Dry Run，自动执行规则评估。
2. **规则引擎输出 PASS / WARN / BLOCK**：每个仓库产出明确决策，附带规则命中详情和中文原因。
3. **PASS 也只进入人工确认 Real Write**：不自动写库，不绕过 Admin 审核。即使规则引擎判定 PASS，Real Write 仍需 Admin 勾选 + 输入「确认写入」。
4. **保留 P5-SY9 全部安全边界**：feature gate（`WEBSYNC_REAL_WRITE_ENABLED`）、Admin 审核、Dry Run 绑定、`sync_run`/`sync_log` 审计链、逐仓独立 claim/release。
5. **冷启动、新仓、首次同步、仓库改名不能按稳定期阈值硬拦**：无历史基线时新增 SKU 高比例只 WARN，不直接 BLOCK。仓库改名只 WARN，需人工确认。
6. **连续失败、session unhealthy、plan_drift != PASS 必须进入阻断规则**：避免定时任务反复制造无效 `sync_run` 和日志噪音。
7. **P5-SY11 软归档不启动**，只保留在后置计划。

## 强制架构边界

- 规则引擎为纯 TypeScript 函数，不依赖数据库、网络或文件系统。输入数据由调用方提供，输出为确定性决策。
- Cron / 后台任务不得直接调用真实写入入口，不得绕过 Admin 审核、feature gate、Dry Run 绑定和 sync_run/sync_log 审计链。
- 定时触发的 Dry Run 使用与手动触发相同的 `triggerBatchDryRun` 内部管线（claim → execute → release），不新建绕过路径。
- 新增 Server Action 必须校验 Admin 权限（手动触发）或 API key（定时触发）。
- 历史数据查询走 Repository 接口，不直接访问 Supabase。
- 不新增数据库表（Phase A 从 `sync_run` + `sync_log` 推导历史基线）。
- 不修改已执行 Migration。
- `service_role` 不得进入前端、不得进入 client bundle、不得输出到日志。

## 规则引擎设计

### 核心类型

```typescript
// 规则决策级别
type RuleLevel = 'PASS' | 'WARN' | 'BLOCK';

// 单条规则评估结果
interface RuleEvaluation {
  rule: string;       // 规则标识，如 'session_unhealthy'
  level: RuleLevel;
  message: string;    // 中文可读描述
  details?: Record<string, unknown>;
}

// 规则引擎输入（逐仓）
interface RuleInput {
  // 会话健康
  sessionHealth: SessionHealthResult;
  
  // 当前 Dry Run 结果
  dryRun: {
    status: 'ready' | 'failed' | 'blocked';
    planDriftCheck: 'PASS' | 'DRIFT_DETECTED' | null;
    rawRowCount: number;
    validSkuCount: number;
    invalidSkuCount: number;
    variantsCreated: number;
    inventoryInserted: number;
    inventoryUpdated: number;
    inventoryUnchanged: number;
    warehouseRenamePlan: { action: 'rename' | 'none'; currentName?: string; targetName?: string; message?: string } | null;
    failureReason?: string;
  };

  // 历史上下文（来自 sync_run / sync_log）
  history: {
    /** 是否有历史成功同步 */
    hasBaseline: boolean;
    /** 连续 Dry Run 失败次数（不含当前） */
    consecutiveFailures: number;
    /** 最近一次成功同步 */
    lastSuccess: {
      finishedAt: string;
      newVariantsCount: number;
    } | null;
    /** 历史统计（最近 5 次成功同步的均值） */
    stats: {
      avgRawRowCount: number;
      avgValidSkuCount: number;
      avgInvalidSkuCount: number;
      avgVariantsCreated: number;
    } | null;
  };
}

// 规则引擎输出
interface RuleVerdict {
  /** 最终决策：取所有规则中最严重的级别 */
  decision: RuleLevel;
  /** 所有命中的规则评估（不含 PASS 规则，PASS 隐含） */
  evaluations: RuleEvaluation[];
  /** 阻断规则的简短摘要（供列表视图展示） */
  summary: string;
}
```

### 规则优先级（从高到低）

| # | 规则标识 | 条件 | 决策 | 说明 |
|---|---------|------|------|------|
| R1 | `session_unhealthy` | `sessionHealth.status !== 'healthy'` | **BLOCK** | 全局阻断，不进入逐仓评估。所有仓库直接 BLOCK。 |
| R2 | `all_zero` | `rawRowCount === 0 && validSkuCount === 0` | **BLOCK** | 抓取完全为空（非正常状态，可能是登录过期但 health check 遗漏、页面结构变更等） |
| R3 | `plan_drift` | `planDriftCheck !== 'PASS'` | **BLOCK** | 计划漂移，数据不可信 |
| R4 | `dry_run_failed` | `dryRun.status === 'failed'` | **BLOCK** | Dry Run 执行本身失败 |
| R5 | `consecutive_failures` | `history.consecutiveFailures >= 3` | **BLOCK** | 同仓连续 3 次及以上 Dry Run 失败，需人工排查后手动重置 |
| R6 | `warehouse_rename` | `dryRun.warehouseRenamePlan?.action === 'rename'` | **WARN** | 仓库改名需要人工确认，不自动处理 |
| R7 | `cold_start_high_new` | `!history.hasBaseline && ratio > 0.5` (variantsCreated / validSkuCount) | **WARN** | 冷启动/首次同步新增 SKU 比例高是正常的，不阻断 |
| R8 | `high_invalid_sku` | `history.hasBaseline && ratio > 0.1` (invalidSkuCount / rawRowCount) | **WARN** | 无效 SKU 比例异常升高 |
| R9 | `high_new_variants` | `history.hasBaseline && variantsCreated > max(5, stats.avgVariantsCreated * 3)` | **WARN** | 有历史基线后新增 Variant 数量异常 |
| R10 | `row_count_anomaly` | `history.hasBaseline && abs(rawRowCount - stats.avgRawRowCount) / stats.avgRawRowCount > 0.5` | **WARN** | 行数波动超过 50% |
| R11 | `high_invalid_sku_cold` | `!history.hasBaseline && invalidSkuCount > rawRowCount * 0.3` | **WARN** | 冷启动时无效 SKU 过多（>30%），需人工关注 |
| — | *default* | 以上规则均未命中 | **PASS** | 所有检查通过，可进入人工审核确认写入 |

**规则引擎核心约束**：
- 按 R1→R11 顺序评估，首个 BLOCK 规则命中后继续评估 WARN 规则（收集所有警告），但决策已定为 BLOCK。
- 所有命中规则的 `evaluation` 均返回（含 WARN 和 BLOCK），PASS 规则不返回。
- 冷启动（`!hasBaseline`）场景：R8/R9/R10 自动跳过（无历史基线可比），R7/R11 使用放宽阈值且仅 WARN。
- 最终 `decision` = evaluations 中最严重的级别（BLOCK > WARN > PASS）。

### 与 P5-SY9 现有 status 字段的关系

P5-SY9 的 `BatchDryRunItemResult.status` 是 `'ready' | 'failed' | 'blocked'`，由 Dry Run 执行结果直接决定：
- `planDriftCheck !== 'PASS'` → `blocked`
- 执行异常 → `failed`
- 其它 → `ready`

P5-SY10 的规则引擎不修改这些 status。它在上层新增一个独立的 `RuleVerdict`：
- `BatchDryRunItemResult.status === 'ready'` 的仓库，规则引擎可能判定 WARN（如仓库改名、冷启动高新增比例）或 PASS。
- `BatchDryRunItemResult.status === 'blocked'` 的仓库，规则引擎必然判定 BLOCK（规则 R3 直接命中）。
- 页面展示时同时显示 Dry Run 执行状态和规则引擎决策，二者互补。

## 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| **P5-SY10A** | 规则引擎核心：类型 + 纯函数 + 单元测试 | 实现 `evaluateRules()` 纯函数，含全部 11 条规则 + 冷启动/有基线双路径。100% 单元测试覆盖每条规则和组合场景。 | P5-SY9 | **DONE**（2026-06-24。`rules-engine.ts` 200 行 + `rules-engine.test.ts` 1245 行 60 项测试。586/586 TS 测试，lint 0 errors，build pass。） |
| **P5-SY10B** | 历史上下文提供器：基线追踪 + 连续失败检测 | 实现 `getWarehouseHistory()` 从 sync_run + sync_log 推导 hasBaseline / consecutiveFailures / lastSuccess / stats。走 Repository 接口。 | P5-SY10A | PENDING |
| **P5-SY10C** | 自动预审编排：Server Action 串联 health → batch Dry Run → rule eval | 新增 `runAutoPreReview()` Server Action，调用 session health → triggerBatchDryRun → 逐仓 evaluateRules → 返回 `AutoPreReviewResult`。保留 session health guard + feature gate。 | P5-SY10B | PENDING |
| **P5-SY10D** | 预审页面 UI：扩展批量 Dry Run 对话框展示规则决策 | 在 BatchReviewCard 上新增规则决策徽标（PASS 绿 / WARN 黄 / BLOCK 红）。新增规则详情展开区。WARN 仓库仍可选（带警告提示），BLOCK 仓库不可选。扩展批量 Dry Run 对话框统计栏。 | P5-SY10C | PENDING |
| **P5-SY10E** | 调度机制：Vercel Cron Route Handler + 手动触发入口 | 新增 `src/app/api/cron/dry-run/route.ts`（API key 认证，非用户 session）。`vercel.json` cron 配置。Sync 页面新增「自动预审」按钮。 | P5-SY10D | PENDING |
| **P5-SY10F** | 独立验收与生产就绪 | 全量测试（TS + Python）+ lint/build + Codex 独立审查。架构边界合规审查。生产启用文档。 | P5-SY10E | PENDING |

## 子任务详细规格

### P5-SY10A — 规则引擎核心

**新文件**：
- `src/features/sync/rules-engine.ts` — 纯函数 `evaluateRules(input: RuleInput): RuleVerdict`
- `src/features/sync/rules-engine.test.ts` — 每条规则独立测试 + 组合场景

**关键实现**：
```typescript
export function evaluateRules(input: RuleInput): RuleVerdict {
  const evaluations: RuleEvaluation[] = [];

  // R1: session unhealthy → BLOCK (global, called before per-warehouse loop)
  // R2: all zero → BLOCK
  // R3: plan drift → BLOCK
  // R4: dry run failed → BLOCK
  // R5: consecutive failures >= 3 → BLOCK
  // R6: warehouse rename → WARN
  // R7–R11: conditional on hasBaseline

  const decision = deriveDecision(evaluations);
  return { decision, evaluations, summary: buildSummary(evaluations) };
}
```

**验收标准**：
- 每条规则至少 3 项测试（命中 / 临界不命中 / 边界）
- 冷启动路径 R7/R11 仅 WARN，R8/R9/R10 自动跳过
- 有基线路径全部规则生效
- 多规则同时命中时 evaluations 包含全部命中规则
- decision 取最严重级别
- 纯函数，无副作用，可确定性测试

### P5-SY10B — 历史上下文提供器

**新文件/修改**：
- `src/features/sync/repository.ts` — SyncRepository 接口新增 `getWarehouseHistory(warehouseId: string): Promise<WarehouseHistory>`
- `src/features/sync/supabase-repository.ts` — 实现：查 sync_run（最近 10 条）+ sync_log（最近成功 5 条）
- `src/features/sync/types.ts` — 新增 `WarehouseHistory` 类型
- MockRepository 同步实现

**关键逻辑**：
```typescript
interface WarehouseHistory {
  hasBaseline: boolean;
  consecutiveFailures: number;
  lastSuccess: { finishedAt: string; newVariantsCount: number } | null;
  stats: { avgRawRowCount, avgValidSkuCount, avgInvalidSkuCount, avgVariantsCreated } | null;
}
```

- `hasBaseline`：是否存在 status='success' 的 sync_log
- `consecutiveFailures`：从最近一条往前数，连续 status='failed' 的 sync_run 数量（遇到 completed 或 real_write 停止）
- `stats`：最近 5 次 success sync_log 对应 sync_run 的 result_summary 均值

**验收标准**：
- 冷启动场景（无任何 sync_log）返回 `hasBaseline: false, consecutiveFailures: 0, stats: null`
- 3 次连续失败后 `consecutiveFailures === 3`
- 中间穿插成功则从成功之后重新计数
- stats 正确聚合最近 5 次成功数据

### P5-SY10C — 自动预审编排

**修改文件**：
- `src/features/sync/server-actions.ts` — 新增 `runAutoPreReview()` Server Action
- `src/features/sync/types.ts` — 新增 `AutoPreReviewResult`、`AutoPreReviewItem` 类型

**Server Action 签名**：
```typescript
export async function runAutoPreReview(): Promise<AutoPreReviewResult>
```

**执行流程**：
1. `requireActiveAdmin()`（手动触发）或 API key 验证（cron 触发）
2. Session health check → unhealthy 则全部 BLOCK，不执行 Dry Run
3. `getCachedOverseasWarehouses()` → 获取全部活跃海外仓
4. `triggerBatchDryRun(warehouses)` — 复用 P5-SY9F 管线
5. 逐仓 `getWarehouseHistory(warehouseId)` → `evaluateRules(input)` 
6. 返回 `AutoPreReviewResult`

**类型**：
```typescript
interface AutoPreReviewItem {
  warehouseId: string;
  warehouseName: string;
  country: string;
  dryRunRunId: string;
  // Dry Run 执行结果（来自 BatchDryRunItemResult）
  dryRunStatus: 'ready' | 'failed' | 'blocked';
  rawRowCount: number;
  validSkuCount: number;
  invalidSkuCount: number;
  variantsCreated: number;
  inventoryInserted: number;
  inventoryUpdated: number;
  inventoryUnchanged: number;
  warehouseRenamePlan: ... | null;
  planDriftCheck: 'PASS' | 'DRIFT_DETECTED' | null;
  // 规则引擎决策
  ruleDecision: 'PASS' | 'WARN' | 'BLOCK';
  ruleEvaluations: RuleEvaluation[];
  ruleSummary: string;
}

interface AutoPreReviewResult {
  results: AutoPreReviewItem[];
  allPassed: boolean;           // 全部 PASS
  passCount: number;
  warnCount: number;
  blockCount: number;
  failedCount: number;          // Dry Run 执行失败
  globalBlockReason?: string;   // session unhealthy 等全局阻断
  preReviewAt: string;          // ISO 时间戳
}
```

**验收标准**：
- session unhealthy → 全局 BLOCK，不执行任何 Dry Run
- 正常流程：Dry Run → 逐仓规则评估 → 完整 AutoPreReviewResult
- 单仓 Dry Run 失败不影响其他仓的规则评估
- 不触发任何 Real Write
- Admin 权限校验有效

### P5-SY10D — 预审页面 UI

**修改文件**：
- `src/app/dashboard/sync/_components/sync-page-content.tsx` — 主要修改

**变更内容**：
1. **BatchReviewCard 扩展**：
   - 卡片顶部新增规则决策徽标：PASS（绿）/ WARN（黄）/ BLOCK（红）
   - 新增可展开的「规则详情」区域，列出每条命中规则的 message
   - WARN 仓库复选框保持可用（勾选时旁边显示警告图标 + tooltip）
   - BLOCK 仓库复选框禁用（灰色 + 阻断原因）

2. **批量 Dry Run 对话框扩展**：
   - 统计栏新增 PASS/WARN/BLOCK 三色计数
   - 新增「自动预审」按钮（调用 `runAutoPreReview()` 而非 `triggerBatchDryRun()`）
   - 保留原有「批量 Dry Run」按钮（仅执行 Dry Run，不运行规则引擎）

3. **仓库概览卡片扩展**（可选，P5-SY9H 的 warehouse overview cards）：
   - 显示最近一次预审决策徽标

4. **新增规则决策徽标组件** — `RuleBadge`（PASS 绿 / WARN 黄 / BLOCK 红，参考现有 `StatusBadge`/`DriftBadge` 模式）

**验收标准**：
- 三种决策徽标颜色和标签正确
- WARN 卡片可勾选（带警告提示），BLOCK 卡片不可勾选
- 规则详情展开/折叠正常
- 统计计数与逐仓决策一致
- 自动预审按钮与手动批量 Dry Run 按钮共存，行为区分清晰
- Operator 只读，无操作按钮

### P5-SY10E — 调度机制

**新文件**：
- `src/app/api/cron/dry-run/route.ts` — Vercel Cron Route Handler
- `vercel.json` — cron 配置（项目根目录）

**Route Handler 设计**：
```typescript
// GET /api/cron/dry-run
// Authorization: Bearer <CRON_API_KEY>
export async function GET(request: NextRequest) {
  // 1. 验证 API key
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_API_KEY}`) {
    return Response.json({ error: '未授权' }, { status: 401 });
  }
  
  // 2. 调用 runAutoPreReview 内部逻辑（不经过 requireActiveAdmin）
  //    使用系统账号 UUID 作为 triggeredBy
  
  // 3. 返回 AutoPreReviewResult（不含敏感信息）
}
```

**vercel.json**：
```json
{
  "crons": [
    {
      "path": "/api/cron/dry-run",
      "schedule": "0 9 * * *"
    }
  ]
}
```

> 注意：Vercel Hobby 计划仅支持每日一次 cron。生产环境可调整为更高频。cron 时间使用 UTC，需在注释中标注对应的北京时间。

**Sync 页面手动入口**：
- 在 session health 状态栏旁新增「自动预审」按钮（仅 Admin 可见）
- 点击后调用 `runAutoPreReview()`，展示预审结果对话框
- 对话框与批量 Dry Run 对话框结构一致，但统计栏和卡片额外显示规则决策

**验收标准**：
- Route Handler 正确验证 API key（错误 key → 401）
- Route Handler 不依赖用户 session
- `vercel.json` 格式正确，`npm run build` 通过
- 手动「自动预审」按钮功能正常
- 定时触发使用的 triggeredBy 为系统账号
- Route Handler 不调用真实写入

### P5-SY10F — 独立验收与生产就绪

**质量门**：
- `npm run test` 全部通过（排除 `**/concurrency.test.ts`）
- `npm run lint` 0 errors
- `npm run build` 通过
- Python 测试全部通过（compileall + 所有 test_*.py）
- 架构边界合规：规则引擎为纯函数、Repository 隔离、无前端直调 Supabase、无生产 Mock

**测试覆盖要求**：
- 规则引擎：每条规则 ≥3 项测试，组合场景 ≥5 项
- 历史上下文：≥10 项测试（冷启动/有基线/连续失败/混合/边界）
- 预审编排：≥15 项测试（正常流程/health block/单仓失败/权限/feature gate）
- 调度 Route Handler：≥8 项测试（auth/key/系统账号/响应结构）
- 不退化现有 526 项 TS 测试 + 252 项 Python 测试

**文档同步**：
- `docs/current-state.md`：P5-SY10 进度
- `docs/tasks/current-task.md`：子任务状态
- `docs/tasks/phase-5-sync.md`：P5-SY10 更新
- 明确记录：Phase B（自动 Real Write）仅设计预留，不实现

## 验收标准

- 规则引擎纯函数可测试，每条规则独立验证。
- 冷启动/新仓场景不按稳定期阈值硬拦（R7/R11 仅 WARN，R8/R9/R10 自动跳过）。
- 连续 3 次失败、session unhealthy、plan_drift != PASS、全零计数均 BLOCK。
- 仓库改名只 WARN，需人工确认。
- PASS 仓库仍需 Admin 勾选 + 输入「确认写入」后才执行 Real Write。
- 定时触发或手动触发均不自动 Real Write。
- 定时触发使用 API key 认证，不依赖用户 session。
- Dry Run 绑定、sync_run/sync_log 审计链、feature gate 完整保留。
- 规则引擎决策与 Dry Run 执行状态分别展示，互补不冲突。
- Admin / Operator 权限正确（Operator 只读，无操作按钮）。
- `npm run test` 通过（排除 concurrency.test.ts）。
- `npm run lint` 0 errors。
- `npm run build` 通过。
- Python tests 全部通过。
- 不新增数据库表（Phase A）。
- 不修改已执行 Migration。
- 不重新提交 `.env.local`、`runtime/profile`、cookie、抓取产物。

## 测试要求

- 规则引擎单元测试：每条规则命中/不命中/边界 ≥3 项，多规则组合 ≥5 项。
- 历史上下文测试：≥10 项（MockRepository 注入不同历史数据）。
- 预审编排测试：≥15 项（含 session health block / 单仓失败 / 权限 / feature gate）。
- Route Handler 测试：≥8 项（含 API key 认证 / 系统账号 / 响应结构）。
- 现有 526 项 TS 测试 + 252 项 Python 测试不退化。

## 文档同步要求

- `docs/current-state.md`：Current Task 改为 P5-SY10，状态更新。
- `docs/tasks/phase-5-sync.md`：P5-SY10 状态更新，子任务拆分表新增。
- `docs/implementation-plan.md`：如涉及，记录规则引擎决策逻辑摘要。
- 明确记录 Phase B（PASS 仓库自动 Real Write）为设计预留，不在 P5-SY10 实现。

## 停止条件

- P5-SY10A~E 全部完成后停止，等待 Codex 独立验收（P5-SY10F）。
- 不启用 Phase B 自动 Real Write。
- 不连接生产 Supabase 执行真实写入。
- 不修改已执行 Migration。
- 不新增数据库表。
- 不启动 P5-SY11。
- WEBSYNC_REAL_WRITE_ENABLED 保持 false。

## 依赖

- P5-SY9 全部子任务（A~K）DONE — 全部 5 海外仓批量真实写入完成。
- P5-SY6 运行时设计文档（`docs/tasks/archive/p5-sy6-runtime-design.md`）— Vercel Cron 推荐方案。
- Sync Feature Module（`src/features/sync/`）— 现有 types / actions / server-actions / repository / sync-service。
- Migration 00006/00007/00008/00009（已执行）。
- Supabase 当前生产数据库配置。
- `COUNTRY_TOKEN_MAP` / `COUNTRY_OLDNAME_MAP`（`server-actions.ts`）— 海外仓 token 和名称映射。

## 后置计划

- **P5-SY11** — ProductVariant 软归档与库存视图降噪（依赖 P5-SY9，当前不启动）。
- **P5-SY10 Phase B** — PASS 仓库自动 Real Write（设计预留，需运行稳定并建立每仓基线后评估）。
