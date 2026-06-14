# Current Task Packet

## Task ID

`P5-SY5C2` — Sync Feature Module 后端模块（类型补全 + Schema + Repository + SyncService + Server Actions + 依赖工厂 + Mock Provider/Runner）

## 状态

`NOT_STARTED` — 2026-06-14，P5-SY5C 独立验收通过（129/129），P5-SY5C2 任务包第三次修订完成（第二次复审未通过 → 7 项修正）。

## 背景

P5-SY5C 完成了 Sync Feature Module 的类型定义、validateJsonValue 运行时验证器、ArtifactProvider 接口契约、GC orchestrator 纯函数和 SyncRunner 接口。P5-SY5C2 在此基础上实现后端模块。本次修订修正了第二次复审中发现的 7 项设计缺陷。

## 依赖

- P5-SY5C（DONE）— 类型定义、validateJsonValue、ArtifactProvider 接口、GC orchestrator、SyncRunner 接口
- P5-SY5A（DONE）— Migration 00007 设计（sync_run RPC 契约参考）
- P5-SY5B（DONE）— 认证链（`getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()`）

## 本 Task 范围

### 1. 类型补全与重构 (`src/features/sync/types.ts`)

在现有类型基础上新增和修订。

#### 1a. SyncExecuteParams — mode 判别联合

将现有 flat interface 改为 `z.discriminatedUnion` 对应的类型判别联合：

```typescript
// dry_run 分支：禁止 confirmToken / boundPlanArtifact
export interface SyncExecuteParamsDryRun {
  runId: string;
  warehouseId: string;
  mode: 'dry_run';
  triggeredBy: string;
  signal?: AbortSignal;
  inputArtifact?: JsonValue;       // Runner 接收 normalizedContent
  // 禁止: confirmToken, boundPlanArtifact
}

// real_write 分支：强制 confirmToken + dryRunRunId + boundPlanArtifact
export interface SyncExecuteParamsRealWrite {
  runId: string;
  warehouseId: string;
  mode: 'real_write';
  confirmToken: string;            // 必须 'P5-SY3B-PH'
  triggeredBy: string;
  dryRunRunId: string;             // 绑定 Dry Run ID
  signal?: AbortSignal;
  inputArtifact?: JsonValue;       // 当前 input normalizedContent
  boundPlanArtifact: JsonValue;    // verified bound plan content（必须）
}

export type SyncExecuteParams = SyncExecuteParamsDryRun | SyncExecuteParamsRealWrite;
```

#### 1b. SyncExecuteResult — 新增 planArtifact 字段

```typescript
export interface SyncExecuteResult {
  // ... 现有字段保持不变 ...
  /** Dry Run 执行完成后 Runner 输出的 Plan Artifact。
   *  仅 dry_run 模式且 exitCode=0 时必须存在。
   *  real_write 模式必须为 undefined（使用绑定的 Dry Run plan）。 */
  planArtifact?: JsonValue;
}
```

**Plan Artifact 定义：** `planArtifact` 是 plan_generator 输出的实际写入计划 JSON — 包含目标 warehouse/SKU 列表、抓取页面 URL、选择器、字段映射规则、预估写入数量。它不是 `result.summary`（inventory 执行后的计数统计：variantsCreated / inventoryInserted 等）。`result.summary` 严禁被当作 Plan Artifact 存储或校验。

#### 1c. SyncServiceInput — mode 判别联合

区分于 Zod 校验后的客户端参数，是 `SyncService.executeSync()` 的输入契约：

```typescript
export interface SyncServiceInputDryRun {
  warehouseId: string;
  mode: 'dry_run';
  inputArtifact: JsonValue;        // 必须；缺失在 claim 前失败
  triggeredBy: string;
  signal?: AbortSignal;
}

export interface SyncServiceInputRealWrite {
  warehouseId: string;
  mode: 'real_write';
  inputArtifact: JsonValue;        // 必须（当前 input）
  dryRunRunId: string;             // 必须
  confirmToken: string;            // 必须
  triggeredBy: string;
  signal?: AbortSignal;
}

export type SyncServiceInput = SyncServiceInputDryRun | SyncServiceInputRealWrite;
```

`runId` 由 SyncService 预生成，不在输入中。`path`、`artifact hashes`、`triggeredFrom` 均为服务端内部生成。

#### 1d. 查询 RPC 精确返回类型

以 Migration 00007 RPC 脱敏矩阵为准：

```typescript
// Admin 视图 — get_sync_runs 单条记录
export interface SyncRunAdminRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  mode: 'dry_run' | 'real_write';
  status: 'in_progress' | 'completed' | 'failed';
  display_name: string;
  triggered_from: 'web' | 'cli';
  started_at: string;
  finished_at: string | null;
  created_at: string;
  exit_code: number | null;
  error_message: string | null;
  result_summary: Record<string, unknown> | null;
  plan_drift_check: 'PASS' | 'DRIFT_DETECTED' | null;
  plan_drift_count: number | null;
  dry_run_run_id: string | null;
}

// Operator 视图 — get_sync_runs 单条记录（脱敏）
export interface SyncRunOperatorRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  mode: 'dry_run' | 'real_write';
  status: 'in_progress' | 'completed' | 'failed';
  triggered_by_email: string | null;
  triggered_from: 'web' | 'cli';
  started_at: string;
  finished_at: string | null;
  created_at: string;
  plan_drift_check: 'PASS' | 'DRIFT_DETECTED' | null;
  plan_drift_count: number | null;
  result_summary: { variantsCreated: unknown; inventoryUpdated: unknown } | null;
  failure_summary: string | null;
}

// get_sync_runs 返回类型 — JSON 数组
export type SyncRunsResponse = SyncRunAdminRow[] | SyncRunOperatorRow[];

// get_sync_run_detail Admin 视图 — 比列表多 plan_drift_differences
export interface SyncRunDetailAdmin extends SyncRunAdminRow {
  plan_drift_differences: string[] | null;
}

// get_sync_run_detail Operator 视图 — 不含 plan_drift_differences
export type SyncRunDetailOperator = SyncRunOperatorRow;

export type SyncRunDetailResponse = SyncRunDetailAdmin | SyncRunDetailOperator | null;
```

所有角色禁止返回：`input_artifact_hash`、`plan_artifact_hash`、`lease_expires_at`、`heartbeat_at`、`triggered_by` 原始 UUID。

### 2. Zod Schema (`src/features/sync/schema.ts`)

使用 `z.discriminatedUnion('mode')`，两个分支均 `.strict()`：

**triggerSyncSchema**：

```typescript
import { z } from 'zod';

export const triggerSyncSchema = z.discriminatedUnion('mode', [
  z.object({
    warehouseId: z.string().uuid(),
    mode: z.literal('dry_run'),
  }).strict(),
  z.object({
    warehouseId: z.string().uuid(),
    mode: z.literal('real_write'),
    dryRunRunId: z.string().uuid(),
    confirmToken: z.literal('P5-SY3B-PH'),
  }).strict(),
]);
```

- `dry_run` `.strict()` 拒绝：`dryRunRunId`、`confirmToken`、`path`、`inputArtifact`、`planArtifact`、`inputArtifactHash`、`planArtifactHash`、`triggeredBy`、`triggeredFrom`、`signal`、`runId` 及任意拼写错误
- `real_write` `.strict()` 拒绝：`path`、`inputArtifact`、`planArtifact`、`inputArtifactHash`、`planArtifactHash`、`triggeredBy`、`triggeredFrom`、`signal`、`runId` 及任意拼写错误

**getSyncRunsSchema**（无 offset，对应 Migration 00007 `get_sync_runs(p_warehouse_id, p_limit)`）：

```typescript
export const getSyncRunsSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
```

**getSyncRunDetailSchema**：

```typescript
export const getSyncRunDetailSchema = z.object({
  runId: z.string().uuid(),
});
```

### 3. Repository 接口 (`src/features/sync/repository.ts`)

精确映射 Migration 00007 RPC 签名：

```typescript
import type { SyncRunsResponse, SyncRunDetailResponse } from './types';

export interface SyncRepository {
  /** claim_sync_run RPC — 返回获得的 run id，NULL 表示仓库被锁定或无可回收槽位 */
  claimSyncRun(params: {
    warehouseId: string;
    mode: 'dry_run' | 'real_write';
    runId: string;
    leaseDuration: number;          // 秒，范围 [30, 900]
    triggeredBy: string;
    triggeredFrom: 'web';
    dryRunRunId?: string;           // real_write 必须
    inputArtifactHash?: string;
    planArtifactHash?: string;
  }): Promise<string | null>;

  /** release_sync_run RPC */
  releaseSyncRun(params: {
    runId: string;
    status: 'completed' | 'failed';
    exitCode: 0 | 1 | 2;
    errorMessage?: string;
    resultSummary?: Record<string, unknown>;
    planDriftCheck?: 'PASS' | 'DRIFT_DETECTED';
    planDriftCount?: number;
    planDriftDifferences?: string[];
    planArtifactHash?: string;
  }): Promise<void>;

  /** heartbeat_sync_run RPC — runId + leaseDuration，内部验证 leaseDuration ∈ [30, 900] */
  heartbeatSyncRun(params: {
    runId: string;
    leaseDuration: number;
  }): Promise<void>;

  /** get_sync_runs RPC — 无 offset 参数，返回角色感知结果 */
  getSyncRuns(params: { warehouseId?: string; limit: number }): Promise<SyncRunsResponse>;

  /** get_sync_run_detail RPC — 返回角色感知结果，不存在返回 null */
  getSyncRunDetail(runId: string): Promise<SyncRunDetailResponse>;

  /** cleanup_expired_sync_runs RPC — 返回清理数量 */
  cleanupExpiredSyncRuns(): Promise<number>;
}
```

**MockRepository** 实现约束：

- 纯内存 Map 存储，模拟真实 claim/release 状态约束：
  - 同一 warehouse 同一时间只能有一个 in_progress 运行
  - claim 过期租约（leaseExpiresAt < now）可被回收
  - release 仅接受当前 status=in_progress 的运行
  - release completed 强制 exitCode=0
  - release failed 强制 exitCode IN (1,2)
  - Dry Run completed 必须传 planDriftCheck + planDriftCount + planDriftDifferences
- **使用显式注入的调用者角色上下文**（构造函数参数 `callerRole: 'admin' | 'operator'`）模拟角色感知 RPC 响应。禁止根据 `triggeredBy` 字段判断/猜测读取者角色
- `getSyncRuns` 返回 `SyncRunsResponse`，`getSyncRunDetail` 返回 `SyncRunDetailResponse`

### 4. InputArtifactSource 接口与 Actions 依赖工厂 (`src/features/sync/actions.ts`)

#### 4a. InputArtifactSource 接口

```typescript
/** 服务端 input artifact 来源。
 *  在真实 Provider/Runner 就绪前，仅 Mock 实现存在。
 *  生产实现由后续任务提供（如文件系统读取、数据库加载）。 */
export interface InputArtifactSource {
  getInputArtifact(warehouseId: string, mode: 'dry_run' | 'real_write'): Promise<JsonValue>;
}
```

#### 4b. Actions 依赖工厂

```typescript
import 'server-only';

export interface SyncActionsDeps {
  repository: SyncRepository;
  syncService: SyncService;           // 由 createSyncService() 创建
  inputArtifactSource: InputArtifactSource;
}

export function createSyncActions(deps: SyncActionsDeps) {
  return {
    async triggerSync(formData: FormData): Promise<{ success: boolean; runId?: string; error?: string }> {
      // 1. requireActiveAdmin()
      // 2. Zod 校验 triggerSyncSchema（含 .strict()）
      // 3. 从 deps.inputArtifactSource.getInputArtifact(warehouseId, mode) 获取 inputArtifact
      //    禁止从 formData、客户端 cookie、localStorage 或任何客户端可控来源获取
      // 4. 构造 SyncServiceInput（判别联合，dry_run 不含 confirmToken）
      // 5. 调用 deps.syncService.executeSync(input)
      // 6. 返回脱敏结果（仅 success + runId 或 error）
    },

    async getSyncRunsAction(warehouseId?, limit?): Promise<SyncRunsResponse> {
      // requireActiveAuth() → Zod → deps.repository.getSyncRuns() → 直接返回
    },

    async getSyncRunDetailAction(runId: string): Promise<SyncRunDetailResponse> {
      // requireActiveAuth() → Zod → deps.repository.getSyncRunDetail() → 直接返回
    },
  };
}

export type SyncActions = ReturnType<typeof createSyncActions>;
```

**禁止创建不可用的生产 action 单例。** 在真实 Provider/Runner 尚未实现时，actions 模块仅导出工厂函数和接口，不导出预构建的 `triggerSync` / `getSyncRunsAction` 单例。调用方（测试或未来页面）通过 `createSyncActions(deps)` 获取实例。

权限分工：
- **触发类**：`requireActiveAdmin()` — 不自行组合 `requireActiveAuth()` + role 判断
- **查询类**：`requireActiveAuth()`
- **不做自行脱敏**：查询结果以 RPC 返回的角色感知结果为边界

### 5. SyncService (`src/features/sync/sync-service.ts`)

#### 5a. 依赖组合工厂

```typescript
import 'server-only';
import type { SyncRepository } from './repository';
import type { ArtifactProvider } from './artifact-provider';
import type { SyncRunner } from './sync-runner';
import type { SyncServiceInput, SyncExecuteResult } from './types';

export interface SyncServiceDeps {
  repository: SyncRepository;
  artifactProvider: ArtifactProvider;
  runner: SyncRunner;
}

export function createSyncService(deps: SyncServiceDeps) {
  return { executeSync(input: SyncServiceInput): Promise<SyncExecuteResult> { /* ... */ } };
}

export type SyncService = ReturnType<typeof createSyncService>;
```

**Mock 防护：** 工厂函数在 `NODE_ENV === 'production'` 时检查 `deps` 中的 `artifactProvider.__mock__` / `runner.__mock__` 标记，拒绝 Mock 实例。Mock 文件不得被非测试代码 import。

#### 5b. executeSync 完整生命周期

```
executeSync(input: SyncServiceInput): Promise<SyncExecuteResult>

0. 预生成 runId = crypto.randomUUID()

1. inputArtifact 验证 + prepare（两种模式均必须）：
   a. validateJsonValue(input.inputArtifact)
   b. inputPrepared = artifactProvider.prepare(input.inputArtifact)
   — 若 inputArtifact 缺失 → exitCode=1，不得进入 claim

2. Dry Run 流程：
   a. claim = repository.claimSyncRun({
        runId, warehouseId, mode: 'dry_run', leaseDuration,
        triggeredBy, triggeredFrom: 'web',
        inputArtifactHash: inputPrepared.hash
      })
      若 null → exitCode=1，不得产生 artifact
   b. store input：
      artifactProvider.store(runId, 'input', inputPrepared)
      若失败 → releaseSyncRun(runId, 'failed', exitCode=1, errorMessage)
                + artifactProvider.delete(runId, 'input')  ← 清理
                + 返回失败，不执行 runner
   c. 执行 Runner：
      params: SyncExecuteParamsDryRun = {
        runId, warehouseId, mode: 'dry_run',
        triggeredBy, signal,
        inputArtifact: inputPrepared.normalizedContent
        // 注意：dry_run 分支不含 confirmToken / boundPlanArtifact
      }
      result = runner.execute(params)
   d. 若 exitCode === 0：
      - result.planArtifact 必须存在（Runner 契约），否则 release failed
      - validateJsonValue(result.planArtifact)
      - planPrepared = artifactProvider.prepare(result.planArtifact)
      - artifactProvider.store(runId, 'plan', planPrepared)
        若 store 失败 →
          releaseSyncRun(runId, 'failed', exitCode=1, errorMessage)
          + artifactProvider.delete(runId, 'input')   ← 清理已存储的 input
          + 返回失败
      - releaseSyncRun(runId, 'completed', exitCode=0,
          resultSummary, planDriftCheck, planDriftCount, planDriftDifferences,
          planArtifactHash: planPrepared.hash)
        若 release 失败（网络/超时等）→
          artifactProvider.delete(runId, 'plan')  ← release 失败，清理 plan
          + 记录日志但不覆盖原始业务结果
          + 仍返回原始 result（业务成功，仅审计写入失败）
   e. 若 exitCode !== 0：
      - releaseSyncRun(runId, 'failed', exitCode, errorMessage)
      - artifactProvider.delete(runId, 'input')  ← 清理已存储的 input

   Runner 抛错（未捕获异常）：
      - releaseSyncRun(runId, 'failed', exitCode=1, errorMessage)
      - artifactProvider.delete(runId, 'input')   ← 清理
      - 若 plan 已 store → artifactProvider.delete(runId, 'plan')  ← 清理
      - 返回失败

3. Real Write 流程：
   a. 通过 ArtifactProvider.get() 加载绑定 Dry Run artifacts：
      - inputArtifact_dr = artifactProvider.get(dryRunRunId, 'input')
        → 返回 Artifact { content, hash }，hash 由 get() 内部验证存储字节后返回
      - planArtifact_dr = artifactProvider.get(dryRunRunId, 'plan')
        → 返回 Artifact { content, hash }
      - 任一 get() 失败（不存在/hash 不匹配）→ exitCode=1，不得进入 claim
      — 禁止通过 get_sync_runs / get_sync_run_detail 查询获取 artifact hashes
        （查询 RPC 不返回 input_artifact_hash / plan_artifact_hash）
   b. 将 get() 返回的 hash 传入原子 claim：
      - currentInputPrepared = artifactProvider.prepare(input.inputArtifact)
      - claim = repository.claimSyncRun({
          runId, warehouseId, mode: 'real_write', leaseDuration,
          triggeredBy, triggeredFrom: 'web', dryRunRunId,
          inputArtifactHash: currentInputPrepared.hash,     // 当前 input hash
          planArtifactHash: planArtifact_dr.hash            // get() 返回的已验证 hash
        })
        claim_sync_run RPC 在 DB 层比对传入的 hash 与存储的 input_artifact_hash / plan_artifact_hash
        若比对失败 → RPC raise EXCEPTION → claim 失败
        若 null → exitCode=1，不得产生 artifact
   c. store 当前 input：
      artifactProvider.store(runId, 'input', currentInputPrepared)
      若失败 → release failed + delete input + 返回失败，不执行 runner
   d. 执行 Runner：
      params: SyncExecuteParamsRealWrite = {
        runId, warehouseId, mode: 'real_write',
        confirmToken, triggeredBy, dryRunRunId, signal,
        inputArtifact: currentInputPrepared.normalizedContent,
        boundPlanArtifact: planArtifact_dr.content   // verified bound plan
      }
      result = runner.execute(params)
      - Runner 不得输出 planArtifact（result.planArtifact 必须 undefined）
   e. 若 exitCode === 0：
      releaseSyncRun(runId, 'completed', exitCode=0, resultSummary,
        planDriftCheck, planDriftCount, planDriftDifferences)
   f. 若 exitCode !== 0：
      releaseSyncRun(runId, 'failed', exitCode, errorMessage)
      + artifactProvider.delete(runId, 'input')

   Runner 抛错：同 Dry Run 清理逻辑。

4. Artifact 清理契约汇总：

   | 失败点 | release | delete input | delete plan | 执行 runner |
   |--------|---------|-------------|-------------|-------------|
   | inputArtifact 缺失 | 否（未 claim） | 否 | 否 | 否 |
   | claim 返回 null | 否 | 否 | 否 | 否 |
   | input store 失败 | release failed | **是** | 否 | 否 |
   | Runner 抛错 | release failed | **是** | **是**（若已 store）| (已执行但抛错) |
   | exitCode !== 0 (dry) | release failed | **是** | 否 | 是 |
   | exitCode !== 0 (real) | release failed | **是** | 否 | 是 |
   | exitCode=0 plan store 失败 (dry) | release failed | **是** | 否 | 是 |
   | exitCode=0 release 失败 (dry) | (失败) | 否（保留） | **是** | 是 |
   | exitCode=0 全部成功 | release completed | 否 | 否 | 是 |

5. 全局约束：
   - claim 失败 → 不得产生 artifact（store 仅在 claim 成功后调用）
   - Runner 仅执行 normalizedContent（JsonValue），不得执行原始 bytes
   - 预生成 runId 在 prepare 之前完成
```

### 6. MockArtifactProvider (`src/features/sync/mock-artifact-provider.ts`)

实现 ArtifactProvider 接口，纯内存：

- `prepare(content)` — `validateJsonValue()` → `JSON.stringify()` → SHA-256 hash → `{ bytes, hash, normalizedContent }`
- `store(runId, type, prepared)` — 内存 Map（key: `${runId}:${type}`），记录 `createdAt`
- `get(runId, type)` — 读取存储字节 → SHA-256 验证与存储时 hash 一致 → JSON.parse → 返回 `Artifact { runId, type, content, hash, storedAt }`。**hash 由 get() 内部验证存储字节后返回**，调用方不自行计算
- `verify(runId, type, expectedHash)` — hash 比对
- `delete(runId, type)` — 幂等删除
- `listCandidates(olderThan)` — 按 `createdAt < olderThan` 过滤
- `deleteMany(artifacts)` — 批量删除，返回数量
- **必须 `__mock__: true`**，供生产环境检测

### 7. MockSyncRunner (`src/features/sync/mock-sync-runner.ts`)

实现 SyncRunner 接口：

- `capabilities()` — `{ supportsCancel: false, supportsTimeout: false, maxTimeoutMs: 0, supportedModes: ['dry_run', 'real_write'] }`
- `execute(params)` — 根据 `params.mode` 判别类型：
  - `dry_run`：校验 `inputArtifact` 为合法 JsonValue；输出 `planArtifact: JsonValue`（plan_generator 输出的实际写入计划 JSON — 含目标 SKU 列表、映射规则；Mock 可基于 inputArtifact 构造固定结构）。**不含 confirmToken / boundPlanArtifact 字段**
  - `real_write`：校验 `inputArtifact` + `boundPlanArtifact` 为合法 JsonValue；**必须含 confirmToken + dryRunRunId + boundPlanArtifact**；不输出 `planArtifact`
  - exitCode 可配置（默认 0）
- **必须 `__mock__: true`**

### 8. 单元测试

#### 8a. Schema 测试 (`schema.test.ts`)

- dry_run 合法参数通过
- real_write 合法参数通过（含 dryRunRunId + confirmToken）
- dry_run `.strict()` 拒绝 confirmToken / dryRunRunId / 未知字段 / 拼写错误
- real_write `.strict()` 拒绝缺少 dryRunRunId / 错误 confirmToken / 未知字段 / 拼写错误
- 两分支均拒绝：path、inputArtifact、planArtifact、inputArtifactHash、planArtifactHash、triggeredBy、triggeredFrom、signal、runId
- getSyncRunsSchema 拒绝 offset 参数（不存在于 Migration 00007 签名中）

#### 8b. Repository 接口 + MockRepository 测试 (`repository.test.ts`)

- claim 成功返回 runId
- 同 warehouse 重复 claim 拒绝（返回 null）
- 过期租约回收成功
- release completed 强制 exitCode=0 / failed 强制 exitCode IN (1,2)
- release 仅接受 in_progress 状态
- dry_run completed 必须传 planDriftCheck + planDriftCount + planDriftDifferences
- heartbeat 更新 leaseExpiresAt + heartbeatAt；leaseDuration 无效值（<30 或 >900）拒绝
- getSyncRuns 返回角色感知结果（显式 callerRole）；无 offset 参数
- getSyncRunDetail 返回角色感知结果；不存在返回 null
- cleanupExpiredSyncRuns 返回 number
- 禁止根据 triggeredBy 判断角色（同一 run × 不同 callerRole → 不同字段）

#### 8c. SyncService 测试 (`sync-service.test.ts`)

- **Dry Run 完整生命周期**：prepare input → claim(dry_run, inputHash) → store input → execute(SyncExecuteParamsDryRun) → planArtifact prepare/store → release(completed, planHash)
- **Dry Run Runner 输出 planArtifact**：验证 planArtifact 被 prepare→store→release 链路正确传递
- **Dry Run SyncExecuteParams 不含 confirmToken / boundPlanArtifact**
- **Dry Run 缺失 inputArtifact**：claim 前失败（exitCode=1），不产生 artifact
- **claim 失败不产生 artifact**：store 从未被调用
- **input store 失败清理**：release failed + delete input（验证 artifactProvider.delete 被调用）
- **Runner 抛错清理**：release failed + delete input（+ delete plan 若已 store）
- **exitCode !== 0 (dry_run)**：release failed + delete input
- **plan store 失败 (dry_run exitCode=0)**：release failed + delete input（清理已存储 input），不残留 plan
- **release 失败 (dry_run exitCode=0)**：delete plan，保留 input（release 失败不撤销已成功的业务结果），返回原始 result
- **Runner 仅接收 normalizedContent**：验证 inputArtifact 为 JsonValue 非 bytes
- **exitCode 0→completed / exitCode 1/2→failed**
- **Real Write 完整生命周期**：
  - `artifactProvider.get(dryRunRunId, 'input')` → 返回 hash
  - `artifactProvider.get(dryRunRunId, 'plan')` → 返回 hash + content
  - prepare current input
  - claim(real_write, currentInputHash, **get() 返回的 plan hash**)
  - store current input
  - execute(SyncExecuteParamsRealWrite: current input + verified bound plan)
  - release completed（不含 planArtifactHash）
- **Real Write get() 失败**：input 或 plan get 失败 → exitCode=1，不进入 claim
- **Real Write 禁止通过查询 RPC 获取 hash**
- **Real Write claim 失败**：不产生 artifact
- **Real Write Runner 不得输出 planArtifact**
- **Real Write SyncExecuteParams 必须含 confirmToken + dryRunRunId + boundPlanArtifact**
- **预生成 runId**：在 prepare 之前已生成

#### 8d. Server Actions 测试 (`actions.test.ts`)

- triggerSync 未登录 → 拒绝
- triggerSync Operator → 拒绝（requireActiveAdmin）
- triggerSync Admin → 通过
- triggerSync Zod 拒绝非法参数
- triggerSync inputArtifact 来自 `InputArtifactSource` 依赖（验证不从 formData 提取）
- getSyncRunsAction 未登录 → 拒绝
- getSyncRunsAction Operator → 通过（requireActiveAuth）
- getSyncRunDetailAction Operator → 通过
- 查询结果不做自行脱敏
- `createSyncActions` 工厂创建实例，无预构建单例导出

#### 8e. MockArtifactProvider 测试 (`mock-artifact-provider.test.ts`)

- prepare hash 一致性（same input → same hash）
- store/get/verify/delete 完整流程
- get() 返回的 hash 与 prepare() 的 hash 一致（验证内部 hash 计算）
- listCandidates 时间过滤
- deleteMany 返回删除数量
- delete 幂等（不存在不抛错）
- `__mock__` 标记存在

#### 8f. MockSyncRunner 测试 (`mock-sync-runner.test.ts`)

- capabilities 返回正确结构
- execute exitCode 可配置（默认 0）
- Dry Run execute 输出 planArtifact（JsonValue）且不含 confirmToken
- Real Write execute 不输出 planArtifact，必须含 confirmToken + dryRunRunId + boundPlanArtifact
- 非法 input（非 JsonValue）拒绝
- `__mock__` 标记存在

#### 8g. 类型契约测试补充 (`contract.test.ts`)

在现有 32 个测试基础上新增：

- `SyncExecuteParams` 为判别联合：dry_run 不含 confirmToken / boundPlanArtifact
- `SyncExecuteResult.planArtifact` 类型为 `JsonValue | undefined`
- `SyncServiceInput` 为判别联合：dry_run 不含 confirmToken
- `SyncRunAdminRow` 含全部 Admin 字段（exit_code、error_message、dry_run_run_id）
- `SyncRunOperatorRow` 不含 exit_code、error_message、dry_run_run_id
- `SyncRunsResponse` = `SyncRunAdminRow[] | SyncRunOperatorRow[]`
- `SyncRunDetailResponse` = `SyncRunDetailAdmin | SyncRunDetailOperator | null`

## 禁止

- 连接真实 Supabase
- 执行 Migration 00006 或 00007
- 实现真实 ArtifactProvider（文件系统/对象存储）
- 实现真实 SyncRunner（child_process / BigSeller 抓取）
- 实现真实 InputArtifactSource（文件读取/数据库加载）
- 创建前端页面或组件（P5-SY5D/E）
- 导出预构建的 action 单例（仅导出工厂函数 `createSyncActions`）
- Server Actions 自行进行 Admin/Operator 字段脱敏
- 触发类 Action 使用 `requireActiveAuth()` + 手动 role 判断
- MockRepository 根据 `triggeredBy` 判断读取者角色
- 使用 `result.summary` 作为 Plan Artifact
- 通过查询 RPC 获取 artifact hashes（应使用 `ArtifactProvider.get()`）
- Mock Provider/Runner 进入生产执行路径
- Schema 静默忽略未知字段
- 开始 P5-SY5F（集成测试）

## 验收标准

- [ ] `SyncExecuteParams` 为 mode 判别联合（dry_run 不含 confirmToken / boundPlanArtifact；real_write 强制 confirmToken + dryRunRunId + boundPlanArtifact）
- [ ] `SyncExecuteResult` 新增 `planArtifact?: JsonValue`（plan_generator 输出的实际写入计划 JSON）
- [ ] `SyncServiceInput` 为 mode 判别联合（dry_run 不含 confirmToken；real_write 强制 confirmToken + dryRunRunId）
- [ ] 查询 RPC 精确返回类型：`SyncRunAdminRow`、`SyncRunOperatorRow`、`SyncRunsResponse`、`SyncRunDetailAdmin`、`SyncRunDetailOperator`、`SyncRunDetailResponse`
- [ ] `InputArtifactSource` 接口定义；actions 通过 `createSyncActions(deps)` 工厂创建，无预构建单例
- [ ] Zod Schema `z.discriminatedUnion('mode')` + 两分支 `.strict()`
- [ ] Zod getSyncRunsSchema 不含 offset
- [ ] Repository `getSyncRuns` 返回 `SyncRunsResponse`（非 `unknown`），无 offset 参数
- [ ] Repository `getSyncRunDetail` 返回 `SyncRunDetailResponse`（非 `unknown`）
- [ ] Repository `cleanupExpiredSyncRuns` 返回 `number`（非 `{ cleaned, failed }`）
- [ ] Repository `heartbeatSyncRun` 接收 `{ runId, leaseDuration }`，验证 leaseDuration ∈ [30, 900]
- [ ] MockRepository 显式 `callerRole` 注入，禁止根据 `triggeredBy` 判断角色
- [ ] SyncService `createSyncService(deps)` 工厂 + `import 'server-only'`
- [ ] SyncService 工厂在生产环境拒绝 `__mock__` 实例
- [ ] SyncService Dry Run：prepare input → claim(dry_run, inputHash) → store → execute(SyncExecuteParamsDryRun) → plan prepare/store → release(planHash)
- [ ] SyncService Real Write：`ArtifactProvider.get()` 获取 hash → prepare current input → claim(real_write, currentInputHash, get() 返回的 plan hash) → store → execute(SyncExecuteParamsRealWrite, verified bound plan) → release
- [ ] SyncService 禁止通过查询 RPC 获取 artifact hashes；hash 来源为 `ArtifactProvider.get()` 内部验证后返回
- [ ] Artifact 清理契约：input store 失败 delete input；plan store 成功但 release 失败 delete plan；Runner 抛错 delete input + delete plan（若已 store）
- [ ] SyncService Runner 仅执行 normalizedContent（JsonValue）
- [ ] SyncService Dry Run `result.planArtifact` 必须存在且非 `result.summary`
- [ ] SyncService Real Write Runner 不得输出 `planArtifact`
- [ ] Server Actions 触发类 `requireActiveAdmin()`，查询类 `requireActiveAuth()`
- [ ] Server Actions 不做自行脱敏
- [ ] MockArtifactProvider 完整接口 + `get()` 返回验证后的 hash + `__mock__`
- [ ] MockSyncRunner Dry Run 输出 planArtifact 不含 confirmToken / Real Write 不输出 planArtifact 含 confirmToken + `__mock__`
- [ ] 所有单元测试通过（Schema ~13 + Repository ~12 + SyncService ~21 + Actions ~10 + MockArtifactProvider ~7 + MockSyncRunner ~7 + 类型契约补充 ~7 = ~77 场景）
- [ ] `npm run lint` 0 errors + `npm run build` 通过

## 停止条件

P5-SY5C2 实现、测试、lint、build 全部通过后停止，等待独立验收。
不连接 Supabase，不执行 Migration，不创建前端页面，不开始 P5-SY5D/E/F。
