# P5-SY5 手动同步入口 — 架构设计（第十五次修订）

## 状态

`AWAITING_REVIEW` — V5.8 第五次任务包修订完成，等待独立复审。P5-SY5A/B/C 已实现并通过验收。

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| V1 | 2026-06-13 | 初版，10 项设计要点，P5-SY5A~F 拆分 |
| V2 | 2026-06-13 | 第一次独立验收返工：参数净化、is_active 前置、sync_run 独立表、原子租约、接口修正、脱敏契约、权限统一、真实写入绑定 Dry Run、子任务重排序 |
| V3 | 2026-06-13 | 第二次独立验收返工：pg_advisory_xact_lock 仓库级原子锁 + 防御约束、安全 VIEW/RPC 数据访问边界、getCurrentActiveUser 闭环认证、artifact hash 不可变绑定 + ArtifactProvider、SECURITY DEFINER RPC 完整文档化、状态转换矩阵 + actor 模型、删除 confirm_token_hash |
| V4 | 2026-06-13 | 第三次独立验收返工：取消 authenticated 直接查询 VIEW 仅保留 RPC、修复 get_sync_runs 读 public.sync_run 直接表 + p_limit 范围、cleanup 仅清 matching locked_by 锁行 + 统一锁获取顺序、release_sync_run 支持 plan_artifact_hash + 修复 CHECK 约束、completed Dry Run 必需字段明确、lease_duration 范围 [30..900] + NULL 拒绝、删除 pending 状态 + 终态必需字段与 release 对齐、P5-SY5A 前向一次性 Migration |
| V5 | 2026-06-13 | 第四次独立验收返工：真正统一 claim/release/cleanup 全部按 advisory → FOR UPDATE → sync_run 锁顺序，重写 release/cleanup SQL、删除不符合 PG 可见性的 cleanup 分步交错描述、P5-SY5G 增加 deadlock 验证；修复 artifact 与 runId 生命周期（SyncService 预生成 UUID，claim_sync_run 接收 p_run_id，hash 基于规范化内容）；落实终态字段约束（新增 plan_drift_check 枚举、plan_drift_count 非负、failed_requires_fields CHECK；cleanup 设置明确 exit_code，返回标记 failed 运行数）；修正文档（删除残留"143"、CLAUDE.md→AGENTS.md、P5-SY5A 严格前向 Migration 不用 IF NOT EXISTS） |
| V5.1 | 2026-06-14 | V5 内部修订：修复 cleanup_expired_sync_runs 的 v_failed_count 计数逻辑（从 fragile error_message 文本匹配+时间窗口改为从 expired CTE 直接 `SELECT count(*)`）；修正 P5-SY5A 验收 CHECK 约束计数（6→7） |
| V5.2 | 2026-06-14 | 第五次独立验收聚焦返工（仅文档，不实现代码）：(1) 重做 artifact hash 契约——删除自创 canonical JSON（`Object.keys(content).sort()`），改为 SHA-256 on stored UTF-8 bytes，verify 校验相同存储字节；(2) 修复 artifact 生命周期——改为预生成 runId → hash → claim → store → execute，claim 失败不得产生 artifact，新增 delete/GC 契约处理孤儿；(3) 完整落实终态约束——completed 强制 exit_code=0、failed 强制 exit_code IN (1,2)、plan_drift_differences 数组长度等于 plan_drift_count、release_sync_run 使用 v_mode 强制 Dry Run completed 的 plan_artifact_hash；新增 3 个 CHECK（completed_exit_code_zero + plan_drift_differences_length + 强化 failed_requires_fields），共 10 个 CHECK；更新 P5-SY5A/P5-SY5F 验收标准；新增 D19/D20/D21 设计决策 |
| V5.3 | 2026-06-14 | 第六次独立验收聚焦返工（仅文档，不实现代码）：(1) 重做 ArtifactProvider bytes 契约——引入 `prepare(content) → { bytes, hash }`，`store` 接受 prepared bytes，claim/store/verify 使用同一份 bytes，禁止 SyncService 与 Provider 分别 JSON.stringify；(2) 重做 GC 所有权——ArtifactProvider 不得自行查询 sync_run，改为 `listCandidates()` + GC orchestrator 过滤 + `deleteMany()`，受保护判定在 SyncService 中；(3) 新增 `completed_dry_run_requires_plan_artifact` CHECK——completed Dry Run 必须同时具有 input_artifact_hash 和 plan_artifact_hash，与 release_sync_run RPC 双重保障，共 11 个 CHECK；新增 D22/D23/D24 设计决策；更新 P5-SY5C/P5-SY5F 验收标准 |
| V5.4 | 2026-06-14 | 第七次独立验收聚焦返工（仅文档，不实现代码）：(1) 绑定 Runner 执行内容——Artifact content 类型限制为严格 JsonValue（禁止函数/undefined/Symbol/BigInt/自定义原型/toJSON），prepare() 返回 normalizedContent（JSON.parse of same bytes），Runner 只能执行 normalizedContent；(2) 原子验证 Real Write 绑定——claim_sync_run 在同一事务内原子验证 dry_run_run_id（warehouse 匹配 + mode=dry_run + status=completed + plan_drift_check=PASS + finished_at < 60 min + hashes 匹配），消除 TOCTOU 窗口；(3) 收紧 GC——GC cutoff 强制 ≥ 审计保留期（7 天），安全性证明（7 天 ≫ 60 分钟），删除 getRecentlyCompletedRunIds；(4) 新增 D25/D26/D27 设计决策；更新 P5-SY5A/P5-SY5C/P5-SY5F/P5-SY5G 验收标准 |
| V5.4.1 | 2026-06-14 | 第八次独立验收聚焦返工（仅文档，不实现代码）：(1) 移动 claim_sync_run dry_run_run_id 验证至 advisory lock + FOR UPDATE 之后、UPDATE/INSERT 之前——更新 SQL 草案、TOCTOU 说明和 P5-SY5G 测试；(2) 修复 GC 时间模型——cutoff 直接使用 now-7days（移除错误的 max()），恢复 getRecentlyCompletedRunIds(now-60min)，禁止从 artifact.createdAt 推导 sync_run.finished_at，新增"artifact>7天但 Dry Run 刚完成"防误删测试；(3) 定义 validateJsonValue 运行时验证器——递归拒绝 undefined/function/Symbol/BigInt/toJSON/自定义原型，number 必须 Number.isFinite，prepare() 先验证后 stringify，新增 NaN/Infinity/嵌套 undefined/toJSON/自定义原型测试；(4) 新增 D28 设计决策；更新 P5-SY5A/P5-SY5C/P5-SY5F/P5-SY5G 验收标准 |
| V5.4.2 | 2026-06-14 | 第九次独立验收聚焦返工（仅文档，不实现代码）：(1) 完善 validateJsonValue 草案——WeakSet 循环引用检测（含路径）、Reflect.ownKeys 明确拒绝 Symbol 键（对象和数组）、拒绝稀疏数组（`!(i in value)` 空洞检测）、拒绝数组额外属性（非数字索引字符串键）、拒绝 accessor/getter 属性（`Object.getOwnPropertyDescriptor` 检测 descriptor.get/set）、全面禁止 any 类型；(2) 清理冲突文档——删除 current-task.md 验收标准中 V5.4 旧 GC 单层截止项和"取代旧安全性证明"引用；修正 D22 非确定性描述（移除 replacer/Date，仅保留 toJSON）；全文检查删除与 V5.4.1/V5.4.2 冲突的现行结论；更新 D28 覆盖 V5.4.2 全部增强项；更新各文件状态至第十次独立设计验收 |
| V5.4.3 | 2026-06-14 | 第十次独立验收聚焦返工（仅文档，不实现代码）：(1) 修复数组验证——仅接受规范数组索引（String(index) === key 且 index < length），拒绝 "01"/"4294967295" 等伪数字额外属性；要求 Object.getPrototypeOf(array) === Array.prototype；拒绝数组自身或继承的 toJSON；(2) 修复对象验证——遍历 Reflect.ownKeys() 全部字符串键；拒绝 descriptor.enumerable === false 的不可枚举属性；使用 descriptor.value 递归验证（禁止因读取属性触发行为）；(3) 修复循环检测——WeakSet 仅表示当前递归祖先链；递归完成后通过 try/finally 执行 seen.delete(value)；共享引用必须通过，真正循环引用必须拒绝；(4) 新增 ~8 项聚焦测试——数组属性 "01"/"4294967295"、对象不可枚举属性、Array 子类、自身/继承 toJSON、共享对象引用通过、真实循环拒绝。更新 D28 覆盖 V5.4.3 增强项；更新各文件状态至第十一次独立设计验收 |
| V5.5 | 2026-06-14 | P5-SY5C2 任务包第二次修订（复审未通过 → 8 项修正）：(1) heartbeatSyncRun 签名修正——接收 `{ runId, leaseDuration }`，验证 leaseDuration ∈ [30, 900]；(2) 定义 SyncServiceInput 类型——`inputArtifact` 为两模式必需字段，缺失在 claim 前失败；(3) Dry Run Runner 输出 `planArtifact: JsonValue`——严禁使用 `result.summary` 作为 Plan Artifact，同步类型契约测试；(4) 补全 Real Write 流程——加载并 verify 绑定 Dry Run input/plan artifacts → prepare 当前 input → claim（当前 input hash + 绑定 plan hash）→ Runner 仅执行 normalized current input + verified bound plan；(5) MockRepository 显式注入 callerRole——禁止根据 triggeredBy 判断读取者角色；(6) Zod `.strict()` 两个分支均拒绝未知字段；(7) 查询 RPC 精确返回类型 + `import 'server-only'` 依赖组合工厂 + Mock `__mock__` 标记防护；(8) 验收标准与测试矩阵更新（~65 场景）。更新各文件状态至第十二次独立设计验收。 |
| V5.6 | 2026-06-14 | P5-SY5C2 任务包第三次修订（第二次复审未通过 → 7 项修正）：(1) Real Write hash 来源修正——`ArtifactProvider.get()` 内部验证存储字节并返回 hash，传给 claim 与 DB 绑定 hash 比对；禁止通过查询 RPC 获取 artifact hashes；(2) 定义 `InputArtifactSource` 接口 + `createSyncActions(deps)` 工厂——triggerSync 从明确服务端依赖取得 inputArtifact；禁止导出不可用的生产 action 单例；(3) `SyncExecuteParams` / `SyncServiceInput` 改为 mode 判别联合——dry_run 不含 confirmToken/boundPlanArtifact；real_write 强制 confirmToken + dryRunRunId + boundPlanArtifact；(4) Repository 精确对齐 Migration 00007——getSyncRuns 移除 offset 返回 SyncRunsResponse；getSyncRunDetail 返回 SyncRunDetailResponse；cleanupExpiredSyncRuns 返回 number；补充类型契约测试；(5) Artifact 清理契约——input store 失败 delete input；plan store 成功但 release 失败 delete plan；Runner 抛错/plan store 失败/release 失败的清理矩阵与测试；(6) Plan Artifact 描述统一为 plan_generator 输出的实际写入计划 JSON；(7) 设计文档状态恢复为等待复审。 |
| V5.7 | 2026-06-19 | P5-SY5C2 任务包第四次修订（第三次复审未通过 → 7 项修正）：(1) 新增独立 `SyncServiceResult` 类型——`runId` + `status: completed|failed|indeterminate` + `runnerResult?` + `error?` + `artifactDisposition?`；claim 前失败不得伪造完整 `SyncExecuteResult`；(2) release completed 失败不得返回 success——Dry Run 标记 indeterminate、plan 删除、input 保留、提示"运行状态落库失败"；Real Write 标记 indeterminate、明确"写入结果可能已生效，但运行状态落库失败"；`release_sync_run` 不得被描述为普通审计写入；(3) 修正 Artifact 保留规则——input store 失败 delete 部分 input；plan store 失败 delete 部分 plan；completed release 失败 delete plan 保留 input；Runner 抛错/exitCode 1/2 且 release failed 成功保留 input 由 7 天 GC 清理；release failed 自身失败保留全部 artifact 返回 indeterminate；同步更新清理矩阵（8→12 行）和测试；(4) `SyncExecuteParamsDryRun.inputArtifact` 与 `SyncExecuteParamsRealWrite.inputArtifact` 均改为必需 `JsonValue`；(5) Plan Artifact 描述严格对齐 `plan_generator.generate_plan()` 实际输出——删除 URL、选择器、映射规则等不存在字段，列出 `warehouse_rename_required`/`new_variants`/`inventory_inserts`/`inventory_updates`/`inventory_unchanged`/`inventory_after_variant_create`/`rejected_rows` 完整结构；(6) 明确 `createSyncActions` 仅为服务调用工厂（不含 `"use server"`），指定后续任务负责创建顶层 `"use server"` Action 与真实依赖组合，避免 P5-SY5D 直接调用闭包；(7) 增加 release completed/failed 失败、indeterminate 状态、审计 Artifact 保留测试（12 项新增）。更新所有依赖文档。 |
| V5.8 | 2026-06-19 | P5-SY5C2 任务包第五次修订（第四次复审未通过 → 4 项修正）：(1) 统一 triggerSync 返回映射——`success` 仅在 `result.status === 'completed'` 时为 true；`failed` 和 `indeterminate` 均 `success = false`；同步更新 actions 测试和验收标准；(2) 统一失败 Artifact 保留规则消除矛盾——从流程步骤、清理矩阵、测试列表和验收标准中删除全部"delete input ← 保留"自相矛盾描述；Runner 抛错/exitCode 1/2 且 release failed 成功时输入保留由 7 天 GC 清理（不立即 delete）；清理矩阵 Runner抛错行 delete input 列从"是"改为"否（保留，7 天 GC）"；(3) Plan Artifact `rejected_rows.row` 类型从 `object` 改为 `Record<string, JsonValue>`（严格 JsonValue 兼容）；(4) current-task.md 状态日期更新为 2026-06-19，同步 current-state 残留旧日期。 |

## 背景

P5-SY4E 已完成 CLI 集成与 Dry Run 端到端验证。当前同步只能通过命令行手动执行：

```bash
python -m tools.bigseller-scraper.sync.cli_execute \
  --input-json <path> --dry-run-report <path> \
  --execute --confirm P5-SY3B-PH
```

缺少 Web 端入口。本设计定义手动同步入口的完整架构方案，暂不实现代码。具体运行环境（child_process / 消息队列 / 外部调度器）留待 P5-SY6 评估。

---

## 1. 目标用户与页面位置

### 目标用户
- **主要用户**：Admin（管理员），负责触发和管理海外库存同步
- **次要用户**：Operator（运营），可查看同步状态和历史但不能触发

### 页面位置
- **路由**：`/dashboard/sync`
- **侧边栏**：在 `sidebar-nav.tsx` 中新增独立导航项
  - 标签：`同步管理`
  - 图标：`RefreshCw`（lucide-react）
  - 权限：Admin 与 Operator 均可查看（Operator 仅查看历史，不显示触发控件）
  - 初始 phase：`'5'`（实施时改为 `'0'` 启用）

### 页面布局（方案）
```
┌──────────────────────────────────────────────┐
│  同步管理                                     │
├──────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ 最近同步 │ │ 当前状态 │ │ 上次结果 │        │
│  │ 2分钟前  │ │ 空闲     │ │ 91 SKU  │        │
│  │ dry_run  │ │          │ │ PASS    │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│                                              │
│  [Dry Run 同步]  [真实写入] ← 仅 Admin 可见   │
│                                              │
│  ┌─ 同步运行历史 ───────────────────────────┐ │
│  │ 时间        仓库   模式     状态   SKU   │ │
│  │ 14:30      PH     real_write ✓成功 91   │ │
│  │ 14:25      PH     dry_run   ✓完成 91   │ │
│  │ 14:00      PH     real_write ✗失败 0    │ │
│  │ 13:30      PH     dry_run   ✓完成 91   │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 2. 权限矩阵

| 操作 | Admin | Operator | 实现 |
|------|-------|----------|------|
| 查看同步管理页面 | Yes | Yes | Server Component `requireActiveAuth()` |
| 查看运行历史 | Yes | Yes（脱敏摘要） | `get_sync_runs()` RPC，按角色过滤字段 |
| 查看技术详情 | Yes | No | `get_sync_run_detail()` RPC，Operator 返回脱敏版本 |
| 触发 Dry Run | Yes | **No** | Server Action `requireActiveAdmin()` |
| 触发真实写入 | Yes | **No** | Server Action `requireActiveAdmin()` + 二次确认 |
| 取消同步 | **全部 No** | **No** | P5-SY6 前不可用，页面不提供取消按钮 |

### 实施要点
- **认证闭环**：所有 sync 模块 Server Actions 必须使用 `requireActiveAuth()`（查询类）或 `requireActiveAdmin()`（触发类），两者均校验 `profiles.is_active = true`
- **数据库边界**：`authenticated` 角色不得直接 SELECT `sync_run` 表或任何 VIEW；所有用户查询必须通过 SECURITY DEFINER RPC（`get_sync_runs` / `get_sync_run_detail`），RPC 内部读取 `public.sync_run` 并按角色构造安全返回值
- **UI 层**：触发按钮通过 `roleName === 'admin'` 条件渲染（UX 优化，非安全边界）
- **RLS 层**：`sync_run` 表 SELECT/INSERT/UPDATE/DELETE 仅 `service_role`；`authenticated` 无任何直接表访问权限

---

## 3. 调用链设计

### 强制架构边界（遵守 AGENTS.md）

```text
浏览器 (Client Component)
  → Server Action ('use server')
    → Sync Service (src/features/sync/sync-service.ts)
      → Sync Repository (sync_run 元数据 CRUD, claim/release RPC, 查询 RPC)
      → Artifact Provider (artifact 存储/检索, hash 校验)
      → Sync Runner Interface (抽象接口)
        → [P5-SY6: 具体运行环境实现]
```

### 各层职责

| 层 | 文件 | 职责 | 不能做 |
|----|------|------|--------|
| **Client Component** | `sync-page-content.tsx` | 渲染 UI、用户交互、调用 Server Action | 直接访问 Supabase、构造文件路径、读取凭据 |
| **Server Action** | `src/features/sync/actions.ts` | `'use server'`，requireActiveAuth/requireActiveAdmin、Zod 校验、调用 Sync Service | 直接调用 child_process、直接访问 Python CLI、接收客户端文件路径 |
| **Sync Service** | `src/features/sync/sync-service.ts` | **预生成 runId**（UUID v4）、通过 ArtifactProvider.prepare() 唯一序列化获取 bytes + hash + normalizedContent、先 claim 后 store prepared bytes、传入 normalizedContent 给 Runner、GC orchestrator（listCandidates → 过滤 → deleteMany）、调用 claim/release RPC、调用 Sync Runner、脱敏结果 | 直接访问文件系统、绑定具体运行环境、自行 JSON.stringify |
| **Sync Repository** | `src/features/sync/repository.ts` | sync_run/sync_log 元数据 CRUD（通过 RPC）、claim/release/heartbeat/cleanup RPC 封装、查询 RPC 封装 | 文件路径解析、artifact 存取、业务逻辑 |
| **Artifact Provider** | `src/features/sync/artifact-provider.ts` | artifact 的 prepare（唯一序列化）、存储（prepared bytes）、检索、hash 校验、listCandidates、delete/deleteMany | 查询 sync_run、自行判断业务引用（GC 决策在 SyncService 中） |
| **Sync Runner Interface** | `src/features/sync/sync-runner.ts` | 抽象接口定义 | N/A（纯类型） |

### 关键设计：runId 预生成与 artifact 生命周期（V5）

**问题**：`claim_sync_run` 插入 `sync_run` 行时需要 `input_artifact_hash`，但 `ArtifactProvider.store()` 需要 `runId` 才能存储 artifact。V4 存在鸡生蛋问题。

**V5.4 方案**：SyncService 预生成 UUID，通过 ArtifactProvider.prepare() 唯一序列化，claim 用 hash，store 用同一份 bytes，Runner 执行 normalizedContent：

```
1. SyncService 生成 runId = crypto.randomUUID()
2. prepared = ArtifactProvider.prepare(inputContent)
   → JSON.stringify(content) → UTF-8 bytes → SHA-256(bytes) → JSON.parse(bytes) → { bytes, hash, normalizedContent }
   → 全系统唯一一次序列化 + 反序列化；normalizedContent 是纯 JsonValue（无函数/undefined/自定义原型）
3. claim_sync_run(p_run_id=runId, input_artifact_hash=prepared.hash, ...)
   → 若 claim 返回 NULL（同仓被占用）：不存储任何 artifact，返回错误给用户
   → 若 claim 抛出异常：不存储任何 artifact，抛出给调用方
4. ArtifactProvider.store(runId, 'input', prepared)
   → store 内部验证 SHA-256(bytes) === hash → 持久化存储 bytes
   → 若 store 失败：release_sync_run(runId, 'failed', error_message='input artifact 存储失败', exit_code=1)
   → 调用 ArtifactProvider.delete(runId, 'input') 清理可能的部分写入
5. Runner.execute(inputArtifact=prepared.normalizedContent, ...)
   → Runner 只能执行 normalizedContent（JsonValue），不得执行原始 content 或自行 JSON.parse
```

**约束**：
- `prepare()` 是全系统唯一调用 `JSON.stringify(content)` 的位置；SyncService、Runner、Repository 均不得独立序列化
- `prepare()` 返回 `normalizedContent`（`JSON.parse(bytes)` 的结果）——Runner 只能执行此值，不能执行原始 content
- Artifact content 类型限制为严格 `JsonValue`：禁止函数、undefined、Symbol、BigInt、自定义原型、toJSON 方法
- `store()` 接收 prepared bytes + hash，内部验证一致性，不得重新序列化
- claim 用的 hash 与 store 用的 bytes 来自同一次 prepare() 调用——不可能出现 "claim hash 与存储 hash 分离"
- Runner 执行的 normalizedContent 与存储的 bytes 来自同一次 prepare()——不可能出现 "Runner 执行内容与已存储 artifact 内容分离"
- ArtifactProvider.store() 不得在未知 runId 时调用
- claim_sync_run 接收 p_run_id 参数（UUID，由调用方预生成），不再内部 gen_random_uuid()
- claim 返回 NULL 或异常时不得产生 artifact
- claim 成功后 store 失败必须 release 为 failed，并尝试 delete 清理
- GC 由 SyncService orchestrator 控制：listCandidates() → 过滤受保护 runId → deleteMany()，ArtifactProvider 不自行判断业务引用

### 关键设计：客户端参数净化

客户端仅提交以下经过 Zod 校验的参数：

```typescript
// 客户端 → Server Action 的合法参数
triggerSyncParams = {
  warehouseId: string;       // uuid, Zod 校验
  mode: 'dry_run' | 'real_write';
  dryRunRunId?: string;      // real_write 时必须：最近成功 Dry Run 的 sync_run.id
  confirmToken?: string;     // real_write 时必须为 'P5-SY3B-PH'
}
```

**绝对禁止客户端传入**：`inputJsonPath`、`dryRunReportPath`、任何文件系统路径。

**服务端 artifact 解析链路**（V5.4 修订）：
1. SyncService 预生成 `runId = crypto.randomUUID()`
2. `ArtifactProvider.prepare(inputContent)` → `{ bytes, hash, normalizedContent }`（唯一一次序列化 + 反序列化；normalizedContent 是严格 JsonValue）
3. `claim_sync_run(p_run_id=runId, input_artifact_hash=hash, ...)` → INSERT 指定 ID 的 sync_run 行
4. 若 claim 成功：`ArtifactProvider.store(runId, 'input', { bytes, hash, normalizedContent })` → store 内部验证 SHA-256(bytes) === hash → 持久化
5. `SyncService` 调用 `Runner.execute(inputArtifact=normalizedContent, ...)` —— Runner 只能执行 normalizedContent（JsonValue），不得执行原始 object
6. Dry Run 完成后：Runner 输出 plan → `ArtifactProvider.prepare(planContent)` → `{ bytes: planBytes, hash: planHash, normalizedContent: planNormalized }` → `ArtifactProvider.store(runId, 'plan', { bytes: planBytes, hash: planHash, normalizedContent: planNormalized })` → `release_sync_run(runId, 'completed', plan_artifact_hash=planHash, ...)`
7. Real Write 时：通过 `dryRunRunId` 从 `sync_run` 获取 hash → ArtifactProvider.get() 检索并校验存储字节 hash → get() 返回 content（JsonValue）→ 传给 Runner 作为 `boundPlanArtifact`
8. 若步骤 4 store 失败：`release_sync_run(runId, 'failed', ...)` + `ArtifactProvider.delete(runId, 'input')`
9. 若步骤 6 plan store 成功但 release 失败：`ArtifactProvider.delete(runId, 'plan')` 清理
10. GC 清理：`ArtifactProvider.listCandidates()` → GC orchestrator 过滤受保护 runId → `ArtifactProvider.deleteMany()`
11. Artifact Provider 内部实现决定存储位置（文件系统 / 数据库 / 对象存储），调用方不感知
12. Repository 层禁止解析文件路径或访问文件系统；仅管理元数据

### Server Action 签名设计

```typescript
// src/features/sync/actions.ts
'use server'

// 查询同步运行历史（所有已登录活跃用户，Operator 返回脱敏数据）
getSyncRuns(warehouseId?: string, limit?: number): Promise<SyncRunSummary[]>

// 获取最近同步状态（用于状态卡片）
getSyncStatus(): Promise<{ latestRun?: SyncRunSummary; isInProgress: boolean }>

// 触发 Dry Run（仅活跃 admin）
triggerDryRun(params: { warehouseId: string }): Promise<ActionResult>

// 触发真实写入（仅活跃 admin，必须绑定最近成功 Dry Run）
triggerRealWrite(params: {
  warehouseId: string;
  dryRunRunId: string;       // 最近成功 Dry Run 的 run_id
  confirmToken: string;      // 必须为 'P5-SY3B-PH'
}): Promise<ActionResult>

// 获取单次运行详情（活跃 admin 完整，活跃 operator 脱敏）
getSyncRunDetail(runId: string): Promise<SyncRunDetail>
```

**注意**：不提供 `cancelSync` Action。取消能力需 Sync Runner 实现 `AbortSignal` 支持，留待 P5-SY6 评估。P5-SY5 页面不展示取消按钮。

---

## 4. 凭据隔离方案

### 敏感凭据清单

| 凭据 | 存储位置 | 使用方 | 绝对禁止到达客户端 |
|------|----------|--------|---------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local`（服务端） | Server Action → Sync Service → Sync Runner | Yes |
| BigSeller 登录凭据 | `.env.local`（服务端） | Python CLI（由 Sync Runner 调用） | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`（客户端可读） | 客户端 Supabase 初始化 | No（已公开） |

### 隔离措施

1. **Server Action 边界**：`SUPABASE_SERVICE_ROLE_KEY` 仅在服务端通过 `process.env` 读取，Server Action 内部使用，不通过返回值、props 或序列化传递
2. **Sync Runner 隔离**：Runner 接口的实现（无论 child_process / HTTP / 队列）必须由服务端代码实例化，客户端仅接收脱敏后的执行结果摘要
3. **Python CLI 隔离**：若 P5-SY6 决定使用 child_process，调用必须封装在 Sync Runner 实现内部，Server Action 通过 Runner 接口间接调用，不直接访问 `child_process` 模块
4. **文件路径隔离**：客户端不提供任何文件路径参数。服务端通过 `runId` + Artifact Provider 内部解析存储位置
5. **代码审查规则**：`src/features/sync/` 下所有文件禁止从 `process.env` 解构 `SUPABASE_SERVICE_ROLE_KEY` 以外的敏感变量到模块顶层（需在使用点惰性读取）

---

## 5. 禁止事项（安全边界）

### 绝对禁止

| 禁止行为 | 原因 |
|----------|------|
| 页面或 Client Component 直接调用 `supabase.from()` | 违反 Repository Pattern |
| 页面或 Client Component 传入文件路径参数 | 路径遍历风险，客户端不应知道服务端文件系统 |
| 页面或 Client Component 导入 `child_process` | 暴露系统调用能力到浏览器 |
| Server Action 直接 `exec()` / `spawn()` Python CLI | 违反运行环境隔离（应由 Runner 封装） |
| Server Action 直接使用 `service_role` key 查询 | 应由 Repository 层封装 |
| 同步凭据通过 `NEXT_PUBLIC_*` 前缀暴露 | 编译到客户端 bundle |
| 返回 artifact 内容、存储路径、凭据或原始技术异常到客户端 | 信息泄露 |
| `authenticated` 角色直接 SELECT `sync_run` 表或任何 VIEW | 绕过脱敏边界；所有用户查询必须通过 SECURITY DEFINER RPC |
| "先查询再插入" 做并发控制 | 竞态条件 |
| 仅按 `started_at + 固定 300s` 判定僵尸并直接覆盖 | 不安全，需原子锁 + 租约双重机制 |

### 允许

| 允许行为 | 说明 |
|----------|------|
| Server Action → Sync Service → Sync Runner 调用链 | 逐层封装 |
| Sync Runner 接口返回结构化摘要 → 经脱敏后序列化到客户端 | `SyncRunSummary` 不含路径/凭据/原始异常 |
| Server Action 通过 Repository 调用 SECURITY DEFINER 查询 RPC | 标准数据访问路径 |
| 客户端通过 Server Action 返回的 `ActionResult` / `SyncRunSummary` 展示结果 | 标准模式 |
| Artifact Provider 通过 `runId` + `artifactType` 在受信任的服务端存储中定位 | 封装在 provider 内部 |

---

## 6. 同步运行器接口

### 设计原则

- **可替换**：接口不绑定 child_process、HTTP、消息队列或任何具体传输
- **同步返回**：每次调用返回完整结果摘要，不依赖流式传输
- **无状态**：Runner 不持有会话状态，每次调用独立
- **能力声明**：Runner 声明自身能力（支持取消、超时等），调用方据此决定行为

### 接口定义

```typescript
// src/features/sync/sync-runner.ts

/** 同步运行器能力声明 */
interface SyncRunnerCapabilities {
  supportsCancel: boolean;      // 是否支持 AbortSignal 取消
  supportsTimeout: boolean;     // 是否支持超时控制
  maxTimeoutMs: number;         // 最大超时毫秒数（0 = 无限制）
  supportedModes: Array<'dry_run' | 'real_write'>;
}

/** 同步执行参数 */
interface SyncExecuteParams {
  runId: string;                // sync_run.id，由调用方（Sync Service）在 claim 成功后传入
  warehouseId: string;
  mode: 'dry_run' | 'real_write';
  confirmToken: string;         // 必须为 'P5-SY3B-PH'
  triggeredBy: string;          // 触发者 user.id（审计用）
  signal?: AbortSignal;         // 取消/超时信号（若 Runner 支持）
  inputArtifact?: JsonValue;    // 输入快照内容（由 SyncService 通过 ArtifactProvider 解析后传入；严格 JsonValue，不含函数/undefined/自定义原型）
  boundPlanArtifact?: JsonValue;// 绑定的计划内容（仅 real_write，用于漂移对比；严格 JsonValue）
}

/** 同步执行结果摘要（完整版，仅服务端内部使用，不直接返回客户端） */
interface SyncExecuteResult {
  success: boolean;
  exitCode: 0 | 1 | 2;
  // 0=成功, 1=RPC/审计失败/参数拒绝, 2=RPC 成功但 sync_log 写入失败
  summary: {
    warehouseId: string;
    warehouseName: string;
    variantsCreated: number;
    variantsSkipped: number;
    inventoryInserted: number;
    inventoryUpdated: number;
    inventoryUnchanged: number;
    warehouseRenamed: boolean;
  };
  syncLog: {
    status: 'success' | 'failed';
    written: boolean;
    fallbackPath?: string;       // 仅服务端内部使用，禁止返回客户端
  };
  planDriftCheck: 'PASS' | 'DRIFT_DETECTED';
  planDriftCount: number;
  planDriftDifferences: string[];
  errors: string[];             // 原始技术错误，需脱敏后才返回客户端
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/** 同步运行器接口 */
interface SyncRunner {
  /** 返回当前运行器能力声明 */
  capabilities(): Promise<SyncRunnerCapabilities>;

  /** 执行同步，返回完整结果摘要（服务端内部） */
  execute(params: SyncExecuteParams): Promise<SyncExecuteResult>;
}
```

### 实施说明

- P5-SY5 仅定义接口，不提供真实实现
- P5-SY6 提供第一个真实实现（具体运行环境待评估）
- P5-SY5 的测试实现使用 `MockSyncRunner` 返回预定义结果
- `cancelSync` 从 P5-SY5 页面和 Server Action 中完全移除；P5-SY6 评估 `AbortSignal` 可行性后再决定是否添加
- `inputArtifact` / `boundPlanArtifact` 参数：类型为 `JsonValue`（严格 JSON 值类型，不含函数/undefined/自定义原型），由 SyncService 通过 ArtifactProvider.prepare() 返回的 normalizedContent 或 get() 返回的 content 传入，Runner 不再自行解析文件路径或 JSON.parse

---

## 7. 运行控制数据模型

### 7.1 设计决策：sync_run 与 sync_log 分离

**问题**：V1 设计复用 `sync_log` 管理 Dry Run、并发锁和历史查询。但 `sync_log` 的原始职责是记录已尝试真实写入的成功/失败，不应承载 Dry Run（不写入数据库）和并发锁（运行控制）。

**决策**：新增独立 `sync_run` 表管理所有运行生命周期（Dry Run + 真实写入），`sync_log` 继续仅记录已尝试真实写入的结果。

| 关注点 | sync_run | sync_log |
|--------|----------|----------|
| Dry Run 记录 | Yes | No |
| 真实写入运行记录 | Yes | 仅记录 success/failed 结果 |
| 并发锁（in_progress + lease + advisory lock） | Yes | No |
| 触发者审计 | Yes（triggered_by） | 通过 sync_run_id 关联 |
| 页面历史查询 | Yes（通过 SECURITY DEFINER 查询 RPC） | 辅助（真实写入详情） |
| Artifact 绑定 | Yes（input_artifact_hash, plan_artifact_hash） | No |
| 关联 | — | sync_log.sync_run_id → sync_run.id |

### 7.2 sync_run 表结构（V4 修订）

```sql
-- Migration 00007 新增（V5: 严格前向 Migration，不用 IF NOT EXISTS）
CREATE TABLE sync_run (
  id                  uuid        PRIMARY KEY,  -- V5: 由 SyncService 预生成，不再 DEFAULT gen_random_uuid()
  warehouse_id        uuid        NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  mode                text        NOT NULL CHECK (mode IN ('dry_run', 'real_write')),
  -- V4: 删除 pending 状态（无创建入口，claim 直接创建 in_progress）
  status              text        NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  triggered_by        uuid        NOT NULL REFERENCES profiles(id),
  triggered_from      text        NOT NULL CHECK (triggered_from IN ('web', 'cli')),
  dry_run_run_id      uuid        REFERENCES sync_run(id),  -- real_write 绑定的 Dry Run
  input_artifact_hash text,       -- SHA-256 hex digest of stored UTF-8 bytes
  plan_artifact_hash  text,       -- SHA-256 hex digest of stored UTF-8 bytes
  lease_expires_at    timestamptz,  -- 并发租约过期时间
  heartbeat_at        timestamptz,  -- 最后心跳时间
  result_summary      jsonb,        -- 结构化结果摘要
  plan_drift_check    text,         -- 'PASS' | 'DRIFT_DETECTED' (from dry_run)
  plan_drift_count    integer,
  plan_drift_differences jsonb,
  error_message       text,         -- 脱敏错误信息
  exit_code           integer,      -- 0/1/2
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_run_time_check CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT real_write_requires_dry_run CHECK (
    mode = 'dry_run' OR dry_run_run_id IS NOT NULL
  ),
  CONSTRAINT real_write_requires_artifacts CHECK (
    mode = 'dry_run' OR (input_artifact_hash IS NOT NULL AND plan_artifact_hash IS NOT NULL)
  ),
  -- V5 确认: 若 mode=dry_run 则 input_artifact_hash 必须非空
  CONSTRAINT dry_run_requires_input_artifact CHECK (
    mode != 'dry_run' OR input_artifact_hash IS NOT NULL
  ),
  -- V5 强化: completed 状态必须具有完整结果字段（含 plan_drift_count, plan_drift_differences）
  CONSTRAINT completed_requires_fields CHECK (
    status != 'completed' OR (
      result_summary IS NOT NULL
      AND plan_drift_check IS NOT NULL
      AND plan_drift_count IS NOT NULL
      AND plan_drift_differences IS NOT NULL
      AND exit_code IS NOT NULL
      AND finished_at IS NOT NULL
    )
  ),
  -- V5 新增: plan_drift_check 值约束
  CONSTRAINT plan_drift_check_enum CHECK (
    plan_drift_check IS NULL OR plan_drift_check IN ('PASS', 'DRIFT_DETECTED')
  ),
  -- V5 新增: plan_drift_count 非负
  CONSTRAINT plan_drift_count_non_negative CHECK (
    plan_drift_count IS NULL OR plan_drift_count >= 0
  ),
  -- V5 新增: failed 状态必须具有 error_message, exit_code (1 或 2), finished_at
  CONSTRAINT failed_requires_fields CHECK (
    status != 'failed' OR (
      error_message IS NOT NULL
      AND exit_code IN (1, 2)
      AND finished_at IS NOT NULL
    )
  ),
  -- V5.2 新增: completed 状态 exit_code 必须为 0
  CONSTRAINT completed_exit_code_zero CHECK (
    status != 'completed' OR exit_code = 0
  ),
  -- V5.2 新增: plan_drift_differences 必须为 JSON array，数组长度等于 plan_drift_count
  CONSTRAINT plan_drift_differences_length CHECK (
    plan_drift_differences IS NULL
    OR jsonb_array_length(plan_drift_differences) = plan_drift_count
  ),
  -- V5.3 新增: completed Dry Run 必须同时具有 input_artifact_hash 和 plan_artifact_hash
  -- （与 dry_run_requires_input_artifact CHECK + release_sync_run RPC 校验形成三重保障）
  CONSTRAINT completed_dry_run_requires_plan_artifact CHECK (
    NOT (status = 'completed' AND mode = 'dry_run')
    OR (input_artifact_hash IS NOT NULL AND plan_artifact_hash IS NOT NULL)
  )
);

-- 查询索引
CREATE INDEX idx_sync_run_warehouse_id ON sync_run(warehouse_id);
CREATE INDEX idx_sync_run_status       ON sync_run(status);
CREATE INDEX idx_sync_run_mode         ON sync_run(mode);
CREATE INDEX idx_sync_run_started_at   ON sync_run(started_at DESC);
CREATE INDEX idx_sync_run_triggered_by ON sync_run(triggered_by);

-- 并发控制防御索引：数据库级约束，确保同一 warehouse 最多一个 in_progress
CREATE UNIQUE INDEX idx_sync_run_one_in_progress
  ON sync_run(warehouse_id)
  WHERE status = 'in_progress';
```

**V5.3 变更说明**：
- **PRIMARY KEY 不再 `DEFAULT gen_random_uuid()`**：`claim_sync_run` 接收 `p_run_id`（SyncService 预生成），直接 INSERT 指定 ID
- **`id` 为 PK 且无默认值**：由调用方（SyncService）通过 `crypto.randomUUID()` 预生成；`ArtifactProvider.prepare()` 唯一序列化产生 bytes + hash；claim 用 hash，store 用同一份 bytes
- **新增 `plan_drift_check_enum` CHECK**：plan_drift_check 值仅允许 NULL、'PASS'、'DRIFT_DETECTED'
- **新增 `plan_drift_count_non_negative` CHECK**：plan_drift_count 为 NULL 或 >= 0
- **新增 `failed_requires_fields` CHECK**：failed 状态必须具有 error_message、exit_code（1 或 2）、finished_at
- **新增 `completed_exit_code_zero` CHECK**：completed 状态 exit_code 必须为 0
- **新增 `plan_drift_differences_length` CHECK**：plan_drift_differences 为 NULL 或 jsonb_array_length = plan_drift_count
- **新增 `completed_dry_run_requires_plan_artifact` CHECK**：completed Dry Run 必须同时具有 input_artifact_hash 和 plan_artifact_hash；与 `dry_run_requires_input_artifact` CHECK + release_sync_run RPC v_mode 校验形成三重保障
- **强化 `completed_requires_fields`**：新增 plan_drift_count、plan_drift_differences、exit_code、finished_at 的 NOT NULL 约束
- **严格前向 Migration**：CREATE TABLE 不用 IF NOT EXISTS（冲突时 fail loud）；仅函数使用 CREATE OR REPLACE
- **全部 CHECK 约束共 11 个**：sync_run_time_check + real_write_requires_dry_run + real_write_requires_artifacts + dry_run_requires_input_artifact + completed_requires_fields + plan_drift_check_enum + plan_drift_count_non_negative + failed_requires_fields + completed_exit_code_zero + plan_drift_differences_length + completed_dry_run_requires_plan_artifact

**V4 变更说明**（历史）：
- **删除 `pending` 状态**：`claim_sync_run` 直接创建 `in_progress`，无 pending 创建入口；`status` CHECK 从 4 值缩减为 3 值
- **修复 `dry_run_requires_input_artifact` CHECK**：原约束 `mode = 'dry_run' OR input_artifact_hash IS NOT NULL` 对 dry_run 恒真；修正为 `mode != 'dry_run' OR input_artifact_hash IS NOT NULL`
- **新增 `completed_requires_fields` CHECK**：completed 状态必须具有 `result_summary`、`plan_drift_check`、`exit_code`、`finished_at`

### 7.3 数据访问边界：仅 RPC，无 VIEW（V4 重设计）

**V3 设计**：`authenticated` 可 SELECT `sync_run_summary` VIEW（暴露非敏感字段），并通过 RPC 获取脱敏详情。

**V4 修正**：`authenticated` **不得直接 SELECT 任何 `sync_run` 相关对象**（表或 VIEW）。所有用户查询必须通过 SECURITY DEFINER RPC，RPC 内部读取 `public.sync_run` 并按角色构造安全返回值。

```sql
-- sync_run 表：仅 service_role 可 SELECT/INSERT/UPDATE/DELETE
-- authenticated 用户的所有访问通过 SECURITY DEFINER RPC 间接完成
ALTER TABLE sync_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_sync_run" ON sync_run
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated 无任何 sync_run 策略（拒绝所有直接访问）
```

**RPC 读取 `public.sync_run` 的模式**：查询 RPC 以 SECURITY DEFINER 运行（使用函数所有者的 service_role 权限），直接 `SELECT ... FROM public.sync_run`，在函数内部调用 `public.get_user_role()` 获取真实调用者角色，按角色构造返回值。

**设计说明**：
- 即使前端绕过 Server Action 直接调用 Supabase SDK 的 `supabase.rpc('get_sync_runs')`，RPC 内部仍执行脱敏逻辑
- 不存在 VIEW 可被 authenticated 以任何方式读取
- 漏洞面最小：只有两个查询 RPC（`get_sync_runs`、`get_sync_run_detail`）暴露给 authenticated

### 7.4 sync_log 表扩展

```sql
-- Migration 00007 扩展 sync_log
ALTER TABLE sync_log
  ADD COLUMN sync_run_id     uuid        REFERENCES sync_run(id),
  ADD COLUMN triggered_by    uuid        REFERENCES profiles(id),
  ADD COLUMN triggered_from  text        DEFAULT 'cli' CHECK (triggered_from IN ('web', 'cli')),
  ADD COLUMN mode            text        DEFAULT 'real_write' CHECK (mode = 'real_write'),
  ADD COLUMN exit_code       integer     DEFAULT 1;
```

**设计说明**：
- `sync_log` 仅记录真实写入结果（`mode = 'real_write'`），Dry Run 不在 sync_log 中
- `sync_run_id` 关联到对应的 `sync_run` 记录，可追溯完整运行上下文
- 旧数据（CLI 执行）的 `triggered_from` 默认为 `'cli'`，`mode` 默认为 `'real_write'`
- `sync_log` RLS 策略保持不变：admin ALL，operator SELECT

### 7.5 两表关系

```
sync_run (id = run-001, mode = 'dry_run', status = 'completed')
  │  含 input_artifact_hash（输入快照 hash）
  │  含 plan_artifact_hash（Dry Run 生成的计划 hash — V4 明确：completed Dry Run 必须具有）
  │  含 plan_drift_check = 'PASS' | 'DRIFT_DETECTED'
  │
  │  (用户查看 Dry Run 报告后决定真实写入)
  │
  ▼
sync_run (id = run-002, mode = 'real_write', dry_run_run_id = run-001, status = 'completed')
  │  含 input_artifact_hash（与 run-001 相同输入快照的 hash）
  │  含 plan_artifact_hash（与 run-001 的 plan 一致的 hash）
  │
  │  (真实写入执行完成，sync_log 记录结果)
  │
  ▼
sync_log (id = log-001, sync_run_id = run-002, status = 'success')
```

### 7.6 状态转换矩阵（V4 修订 — 删除 pending）

```
  claim_sync_run() 直接创建 in_progress
  ┌──────────────────────────┐
  │                          │
  ▼                          │
in_progress ──release──▶ completed        (release_sync_run with success)
    │                   (含 result_summary, plan_drift_check, exit_code, finished_at)
    │
    ├──release──▶ failed                 (release_sync_run with error)
    │             (含 error_message, exit_code, finished_at)
    │
    └──cleanup──▶ failed                 (cleanup_expired_sync_runs)
                  (lease_expires_at < now(); error_message = '租约过期')
```

| 转换 | 触发者 | 前置条件 | 结果状态 | 必需字段 |
|------|--------|----------|----------|----------|
| `(新建) → in_progress` | `claim_sync_run()` | 同仓无有效 in_progress + advisory lock 获取成功 + lock row 获取成功 | in_progress | warehouse_id, mode, triggered_by, triggered_from, lease_expires_at, started_at |
| `in_progress → completed` | `release_sync_run()` | run 存在且 status = 'in_progress' + p_status = 'completed' | completed | result_summary, plan_drift_check, exit_code, finished_at |
| `in_progress → failed` | `release_sync_run()` | run 存在且 status = 'in_progress' + p_status = 'failed' | failed | error_message, exit_code, finished_at |
| `in_progress → failed` | `cleanup_expired_sync_runs()` | lease_expires_at < now() + lock row locked_by matching | failed (租约过期) | error_message, finished_at |

**禁止的转换**：
- `completed → *`（终态不可变）
- `failed → *`（终态不可变）
- 直接修改 `status` 列绕过 RPC（所有写入必须通过 claim/release/cleanup RPC）
- `release_sync_run` 以 `completed` 调用但不提供 `result_summary` / `plan_drift_check` / `exit_code`（由 `completed_requires_fields` CHECK 约束 + RPC 内校验双重保障）

### 7.7 Actor 模型（V4 修订）

| Actor | 身份 | 数据库角色 | 允许的操作 |
|-------|------|-----------|-----------|
| **Sync Runner** | 执行同步的进程/函数 | `service_role` | `sync_run`: INSERT, UPDATE, SELECT 全部字段（通过 claim/release/heartbeat/cleanup RPC）<br>`sync_log`: INSERT<br>`sync_warehouse_lock`: SELECT FOR UPDATE, UPDATE |
| **Admin** | 已登录 + admin + is_active | `authenticated` | `get_sync_runs()` RPC: 完整列表（含 exit_code、error_message）<br>`get_sync_run_detail()` RPC: 完整详情（含 result_summary, plan_drift_differences） |
| **Operator** | 已登录 + operator + is_active | `authenticated` | `get_sync_runs()` RPC: 脱敏列表（无 exit_code）<br>`get_sync_run_detail()` RPC: 脱敏详情（无 result_summary 完整, 无 plan_drift_differences） |
| **Deactivated User** | 已登录 + is_active=false | `authenticated` | 拒绝：`public.get_user_role()` 返回 NULL → RPC 抛出 EXCEPTION |
| **Anonymous** | 未登录 | `anon` | 拒绝：middleware 路由守卫 + RPC EXECUTE 仅 GRANT TO authenticated |

### 7.8 sync_warehouse_lock 表（V4 确认）

每个 warehouse 一行，用于原子锁序列化：

```sql
-- 仓库级锁行表：保证 claim_sync_run 原子性
CREATE TABLE sync_warehouse_lock (
  warehouse_id  uuid        PRIMARY KEY REFERENCES warehouse(id) ON DELETE CASCADE,
  locked_by     uuid        REFERENCES sync_run(id),  -- 当前持有锁的 sync_run
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 仅 service_role 可访问
REVOKE ALL ON sync_warehouse_lock FROM anon, authenticated;
GRANT SELECT, UPDATE ON sync_warehouse_lock TO service_role;

-- 自动为已有和新 warehouse 创建锁行
CREATE OR REPLACE FUNCTION public.create_sync_warehouse_lock_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.sync_warehouse_lock (warehouse_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_warehouse_create_lock
  AFTER INSERT ON public.warehouse
  FOR EACH ROW
  EXECUTE FUNCTION public.create_sync_warehouse_lock_row();

-- 为已有 warehouse 补建锁行
INSERT INTO public.sync_warehouse_lock (warehouse_id)
SELECT id FROM public.warehouse
ON CONFLICT DO NOTHING;
```

---

## 8. 并发控制 — 三层防御原子锁（V4 修订）

### 8.1 统一锁获取顺序（V5 强化）

**所有修改 sync_run 状态的操作（claim / release / cleanup）必须严格按以下顺序获取锁**，防止死锁：

```
1. pg_advisory_xact_lock  (事务级，PG 内核保证，key = hashtext('sync_run:' || warehouse_id))
2. sync_warehouse_lock    (行级 SELECT FOR UPDATE)
3. sync_run 行            (通过 INSERT / UPDATE WHERE)
```

**规则**：
- **claim**：获取全部三层（先 advisory 再 lock row 再 INSERT sync_run）
- **release**：先读 warehouse_id → 获取 advisory → 获取 lock row → UPDATE sync_run
- **cleanup**：按 warehouse_id 排序遍历每个有过期运行的仓库 → 获取 advisory → 获取 lock row → UPDATE sync_run + 清锁
- **heartbeat**：仅 UPDATE sync_run（不修改状态，不涉及锁行竞争，无需 advisory lock）

**死锁预防分析**：
- 所有操作获取 advisory lock 的 key 相同（`hashtext('sync_run:' || warehouse_id)`），PG advisory lock 自身不产生死锁（等待而非持有并等待）
- cleanup 按 `ORDER BY warehouse_id` 确定顺序，与 claim/release 的单仓库单次获取一致
- 不存在两个操作各自持有一个仓库的 advisory lock 并等待对方的情况（每个操作只持有一个仓库的 advisory，或按顺序依次持有）

### 8.2 三层防御架构

```
第一层: pg_advisory_xact_lock  → 事务级互斥（PG 内核保证）
第二层: sync_warehouse_lock    → 行级锁序列化（应用可见，可查询）
第三层: 部分唯一索引            → 数据库约束防御（最后防线）
```

### 8.3 claim_sync_run RPC（V5 修订）

```sql
-- Migration 00007: 原子 claim RPC（三层防御 + 预生成 runId + V5.4.1: real_write dry_run_run_id 行级验证移至 advisory lock + FOR UPDATE 之后）
CREATE OR REPLACE FUNCTION public.claim_sync_run(
  p_run_id            uuid,     -- V5: 由 SyncService 预生成，不再内部 gen_random_uuid()
  p_warehouse_id      uuid,
  p_mode              text,
  p_triggered_by      uuid,
  p_triggered_from    text,
  p_dry_run_run_id    uuid DEFAULT NULL,
  p_input_artifact_hash text DEFAULT NULL,
  p_plan_artifact_hash  text DEFAULT NULL,
  p_lease_duration    integer DEFAULT 300
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_key    bigint;
  v_existing_id uuid;
  v_now         timestamptz := now();
BEGIN
  -- ============================================
  -- 参数校验
  -- ============================================
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'p_warehouse_id 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode NOT IN ('dry_run', 'real_write') THEN
    RAISE EXCEPTION 'p_mode 必须为 dry_run 或 real_write, 实际: %', p_mode
      USING ERRCODE = 'P0001';
  END IF;

  IF p_triggered_by IS NULL THEN
    RAISE EXCEPTION 'p_triggered_by 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_triggered_from NOT IN ('web', 'cli') THEN
    RAISE EXCEPTION 'p_triggered_from 必须为 web 或 cli, 实际: %', p_triggered_from
      USING ERRCODE = 'P0001';
  END IF;

  -- lease_duration 范围校验 [30, 900]
  IF p_lease_duration IS NULL THEN
    RAISE EXCEPTION 'p_lease_duration 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'p_lease_duration 必须在 [30, 900] 范围内, 实际: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  IF p_mode = 'real_write' THEN
    IF p_dry_run_run_id IS NULL THEN
      RAISE EXCEPTION 'real_write 模式必须提供 dry_run_run_id' USING ERRCODE = 'P0001';
    END IF;
    IF p_input_artifact_hash IS NULL OR p_plan_artifact_hash IS NULL THEN
      RAISE EXCEPTION 'real_write 模式必须提供 input_artifact_hash 和 plan_artifact_hash'
        USING ERRCODE = 'P0001';
    END IF;
    -- 注意：dry_run_run_id 的行级验证（warehouse/mode/status/plan_drift_check/60min/hashes）
    -- 在获取 pg_advisory_xact_lock + sync_warehouse_lock FOR UPDATE 之后执行
    -- 见下方 "real_write dry_run_run_id 原子验证" 步骤
  END IF;

  IF p_mode = 'dry_run' AND p_input_artifact_hash IS NULL THEN
    RAISE EXCEPTION 'dry_run 模式必须提供 input_artifact_hash' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 校验 warehouse 存在且为 overseas 且 is_active
  -- ============================================
  PERFORM 1 FROM public.warehouse
  WHERE id = p_warehouse_id
    AND type = 'overseas'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse 不存在、非 overseas 或已停用: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 第一层：事务级 advisory lock
  -- hashtext('sync_run:' || warehouse_id) 确保同仓互斥
  -- ============================================
  v_lock_key := hashtext('sync_run:' || p_warehouse_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ============================================
  -- 第二层：SELECT FOR UPDATE on warehouse lock row
  -- 串行化同仓操作
  -- ============================================
  PERFORM 1 FROM public.sync_warehouse_lock
  WHERE warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行缺失: warehouse_id=%', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- V5.4.1: real_write dry_run_run_id 原子验证
  -- 必须在获取 advisory lock + FOR UPDATE 之后、任何 UPDATE/INSERT 之前执行
  -- 在同一事务内原子验证全部 7 项条件，消除 TOCTOU 窗口
  -- ============================================
  IF p_mode = 'real_write' THEN
    PERFORM 1 FROM public.sync_run
    WHERE id = p_dry_run_run_id
      AND warehouse_id = p_warehouse_id
      AND mode = 'dry_run'
      AND status = 'completed'
      AND plan_drift_check = 'PASS'
      AND finished_at IS NOT NULL
      AND finished_at > v_now - INTERVAL '60 minutes'
      AND input_artifact_hash IS NOT NULL
      AND plan_artifact_hash IS NOT NULL
      AND input_artifact_hash = p_input_artifact_hash
      AND plan_artifact_hash = p_plan_artifact_hash;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'dry_run_run_id 验证失败：指定的 Dry Run 无效、已过期、计划漂移、不属于同仓库或 artifact hash 不匹配'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ============================================
  -- 检查是否存在有效 in_progress（租约未过期）
  -- ============================================
  SELECT id INTO v_existing_id
  FROM public.sync_run
  WHERE warehouse_id = p_warehouse_id
    AND status = 'in_progress'
    AND lease_expires_at > v_now;

  IF FOUND THEN
    -- 存在有效租约，无法获取锁
    RETURN NULL;
  END IF;

  -- ============================================
  -- 清理过期 in_progress → failed（僵尸回收）
  -- ============================================
  UPDATE public.sync_run
  SET status = 'failed',
      finished_at = v_now,
      error_message = '租约过期（被新同步请求回收）',
      exit_code = 2  -- V5: cleanup 设置明确 exit_code = 2（sync_log 写入失败等价）
  WHERE warehouse_id = p_warehouse_id
    AND status = 'in_progress'
    AND lease_expires_at <= v_now;

  -- ============================================
  -- 插入新 sync_run（直接 in_progress，无 pending，使用预生成 p_run_id）
  -- 第三层：idx_sync_run_one_in_progress 唯一索引阻止重复插入
  -- ============================================
  INSERT INTO public.sync_run (
    id, warehouse_id, mode, status,
    triggered_by, triggered_from,
    dry_run_run_id,
    input_artifact_hash, plan_artifact_hash,
    lease_expires_at, heartbeat_at,
    started_at
  ) VALUES (
    p_run_id, p_warehouse_id, p_mode, 'in_progress',
    p_triggered_by, p_triggered_from,
    p_dry_run_run_id,
    p_input_artifact_hash, p_plan_artifact_hash,
    v_now + (p_lease_duration || ' seconds')::interval,
    v_now,
    v_now
  );

  -- ============================================
  -- 回填锁行
  -- ============================================
  UPDATE public.sync_warehouse_lock
  SET locked_by = p_run_id,
      locked_at = v_now
  WHERE warehouse_id = p_warehouse_id;

  RETURN p_run_id;
  -- pg_advisory_xact_lock 在事务提交时自动释放
END;
$$;

-- 权限收口
REVOKE EXECUTE ON FUNCTION public.claim_sync_run FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_run TO service_role;
```

### 8.4 release_sync_run RPC（V5 修订 — 统一锁顺序）

```sql
-- Migration 00007: 释放同步运行（完成或失败）
-- V5: 统一按 advisory lock → FOR UPDATE → sync_run 行操作顺序
CREATE OR REPLACE FUNCTION public.release_sync_run(
  p_run_id              uuid,
  p_status              text,   -- 'completed' | 'failed'
  p_result_summary      jsonb DEFAULT NULL,
  p_error_message       text DEFAULT NULL,
  p_exit_code           integer DEFAULT NULL,
  p_plan_drift_check    text DEFAULT NULL,
  p_plan_drift_count    integer DEFAULT NULL,
  p_plan_drift_differences jsonb DEFAULT NULL,
  p_plan_artifact_hash  text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_warehouse_id uuid;
  v_lock_key     bigint;
  v_now          timestamptz := now();
  v_mode         text;
BEGIN
  -- ============================================
  -- 参数校验
  -- ============================================
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'p_status 必须为 completed 或 failed, 实际: %', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- V5: 先读取 warehouse_id 以确定 advisory lock key
  SELECT warehouse_id, mode INTO v_warehouse_id, v_mode
  FROM public.sync_run
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 不存在: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  -- completed 状态必须提供完整结果字段
  -- （与 completed_requires_fields CHECK 约束双重保障）
  IF p_status = 'completed' THEN
    IF p_result_summary IS NULL THEN
      RAISE EXCEPTION 'completed 状态必须提供 result_summary' USING ERRCODE = 'P0001';
    END IF;
    IF p_plan_drift_check IS NULL OR p_plan_drift_check NOT IN ('PASS', 'DRIFT_DETECTED') THEN
      RAISE EXCEPTION 'completed 状态必须提供有效的 plan_drift_check (PASS 或 DRIFT_DETECTED)'
        USING ERRCODE = 'P0001';
    END IF;
    IF p_plan_drift_count IS NULL OR p_plan_drift_count < 0 THEN
      RAISE EXCEPTION 'completed 状态必须提供非负 plan_drift_count' USING ERRCODE = 'P0001';
    END IF;
    IF p_plan_drift_differences IS NULL THEN
      RAISE EXCEPTION 'completed 状态必须提供 plan_drift_differences' USING ERRCODE = 'P0001';
    END IF;
    IF p_exit_code IS NULL OR p_exit_code != 0 THEN
      RAISE EXCEPTION 'completed 状态 exit_code 必须为 0, 实际: %', p_exit_code
        USING ERRCODE = 'P0001';
    END IF;
    -- V5.2: 验证 plan_drift_differences 为 JSON array 且长度 = plan_drift_count
    IF jsonb_typeof(p_plan_drift_differences) != 'array' THEN
      RAISE EXCEPTION 'completed 状态 plan_drift_differences 必须为 JSON array'
        USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(p_plan_drift_differences) != p_plan_drift_count THEN
      RAISE EXCEPTION 'plan_drift_differences 数组长度 (%) 不等于 plan_drift_count (%)',
        jsonb_array_length(p_plan_drift_differences), p_plan_drift_count
        USING ERRCODE = 'P0001';
    END IF;
    -- V5.2: Dry Run completed 必须提供 plan_artifact_hash
    IF v_mode = 'dry_run' AND p_plan_artifact_hash IS NULL THEN
      RAISE EXCEPTION 'Dry Run completed 状态必须提供 plan_artifact_hash'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- failed 状态必须提供 error_message / exit_code
  -- （与 failed_requires_fields CHECK 约束双重保障）
  IF p_status = 'failed' THEN
    IF p_error_message IS NULL THEN
      RAISE EXCEPTION 'failed 状态必须提供 error_message' USING ERRCODE = 'P0001';
    END IF;
    IF p_exit_code IS NULL OR p_exit_code NOT IN (1, 2) THEN
      RAISE EXCEPTION 'failed 状态 exit_code 必须为 1 或 2, 实际: %', p_exit_code
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ============================================
  -- 第一层：事务级 advisory lock（与 claim 相同 key）
  -- ============================================
  v_lock_key := hashtext('sync_run:' || v_warehouse_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ============================================
  -- 第二层：SELECT FOR UPDATE on warehouse lock row
  -- ============================================
  PERFORM 1 FROM public.sync_warehouse_lock
  WHERE warehouse_id = v_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行缺失: warehouse_id=%', v_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 第三层：UPDATE sync_run 行
  -- ============================================
  UPDATE public.sync_run
  SET status = p_status,
      finished_at = v_now,
      result_summary = CASE
        WHEN p_result_summary IS NOT NULL THEN p_result_summary
        ELSE result_summary
      END,
      error_message = CASE
        WHEN p_error_message IS NOT NULL THEN p_error_message
        ELSE error_message
      END,
      exit_code = CASE
        WHEN p_exit_code IS NOT NULL THEN p_exit_code
        ELSE exit_code
      END,
      plan_drift_check = CASE
        WHEN p_plan_drift_check IS NOT NULL THEN p_plan_drift_check
        ELSE plan_drift_check
      END,
      plan_drift_count = CASE
        WHEN p_plan_drift_count IS NOT NULL THEN p_plan_drift_count
        ELSE plan_drift_count
      END,
      plan_drift_differences = CASE
        WHEN p_plan_drift_differences IS NOT NULL THEN p_plan_drift_differences
        ELSE plan_drift_differences
      END,
      plan_artifact_hash = CASE
        WHEN p_plan_artifact_hash IS NOT NULL THEN p_plan_artifact_hash
        ELSE plan_artifact_hash
      END,
      lease_expires_at = NULL,
      heartbeat_at = NULL
  WHERE id = p_run_id
    AND status = 'in_progress';

  IF NOT FOUND THEN
    -- run 不存在或状态不是 in_progress（可能已由 cleanup 回收）
    -- advisory lock 在事务提交时自动释放
    RETURN false;
  END IF;

  -- 释放锁行（仅当 locked_by 匹配当前 run_id 时清锁）
  UPDATE public.sync_warehouse_lock
  SET locked_by = NULL,
      locked_at = NULL
  WHERE warehouse_id = v_warehouse_id
    AND locked_by = p_run_id;

  RETURN true;
  -- pg_advisory_xact_lock 在事务提交时自动释放
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_sync_run FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_sync_run TO service_role;
```

### 8.5 heartbeat_sync_run RPC（V4 修订）

```sql
-- Migration 00007: 心跳续期
CREATE OR REPLACE FUNCTION public.heartbeat_sync_run(
  p_run_id          uuid,
  p_lease_duration  integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  -- V4 修订: lease_duration 范围 [30, 900]（与 claim 一致）
  IF p_lease_duration IS NULL THEN
    RAISE EXCEPTION 'p_lease_duration 不能为 NULL' USING ERRCODE = 'P0001';
  END IF;

  IF p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'p_lease_duration 必须在 [30, 900] 范围内, 实际: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.sync_run
  SET heartbeat_at = v_now,
      lease_expires_at = v_now + (p_lease_duration || ' seconds')::interval
  WHERE id = p_run_id
    AND status = 'in_progress';

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_sync_run FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_sync_run TO service_role;
```

### 8.6 cleanup_expired_sync_runs RPC（V5 修订 — 统一锁顺序）

```sql
-- Migration 00007: 清理过期租约，标记为 failed
-- V5: 统一按 advisory lock → FOR UPDATE → sync_run 行操作顺序
--     遍历每个有超时运行的 warehouse，分别获取 advisory lock
CREATE OR REPLACE FUNCTION public.cleanup_expired_sync_runs()
RETURNS integer  -- V5: 返回标记 failed 的运行数（非仅清除的锁行数）
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_warehouse_record record;
  v_lock_key         bigint;
  v_failed_count     integer := 0;
  v_batch_count      integer;
BEGIN
  -- 遍历每个有过期 in_progress 的 warehouse，按 warehouse_id 排序防止死锁
  FOR v_warehouse_record IN
    SELECT DISTINCT warehouse_id
    FROM public.sync_run
    WHERE status = 'in_progress'
      AND lease_expires_at < now()
    ORDER BY warehouse_id  -- V5: 确定性排序，与其他事务的锁获取顺序一致
  LOOP
    -- ============================================
    -- 第一层：事务级 advisory lock
    -- ============================================
    v_lock_key := hashtext('sync_run:' || v_warehouse_record.warehouse_id::text);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- ============================================
    -- 第二层：SELECT FOR UPDATE on warehouse lock row
    -- ============================================
    PERFORM 1 FROM public.sync_warehouse_lock
    WHERE warehouse_id = v_warehouse_record.warehouse_id
    FOR UPDATE;

    -- ============================================
    -- 第三层：标记过期运行 + 释放匹配锁行
    -- ============================================
    WITH expired AS (
      UPDATE public.sync_run
      SET status = 'failed',
          finished_at = now(),
          error_message = '租约过期（心跳超时），同步进程可能已崩溃',
          exit_code = 2  -- V5: 明确 exit_code = 2
      WHERE warehouse_id = v_warehouse_record.warehouse_id
        AND status = 'in_progress'
        AND lease_expires_at < now()
      RETURNING id
    ),
    cleared_locks AS (
      UPDATE public.sync_warehouse_lock swl
      SET locked_by = NULL, locked_at = NULL
      FROM expired e
      WHERE swl.warehouse_id = v_warehouse_record.warehouse_id
        AND swl.locked_by = e.id
    )
    SELECT count(*) INTO v_batch_count FROM expired;

    -- v_batch_count 是从 expired CTE 直接计数的标记 failed 运行数
    v_failed_count := v_failed_count + v_batch_count;
  END LOOP;

  RETURN v_failed_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sync_runs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sync_runs TO service_role;
```

### 8.7 超时策略

| 超时类型 | 默认值 | 行为 |
|----------|--------|------|
| 租约时长 | 300s（范围 [30, 900]） | claim 时设定，心跳可续期 |
| 心跳间隔 | 30s | Runner/SyncService 内部定时调用 heartbeat_sync_run |
| 僵尸清理 | 租约过期后 | `cleanup_expired_sync_runs()` 标记 failed + 释放匹配锁行 |
| 执行超时 | Runner capabilities.maxTimeoutMs | 通过 AbortSignal 通知 Runner，Runner 自行终止后调用 release_sync_run |
| 网络超时 | P5-SY4C 已定义 | `network_timeout_unknown` 分类 |

### 8.8 并发流程示例（V5 修订 — 统一锁顺序）

```
事务 A (claim_sync_run PH, lease_duration=300):
  1. pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功
  2. SELECT FOR UPDATE on sync_warehouse_lock WHERE warehouse_id=PH → 锁定行
  3. 检查 in_progress → 无有效运行
  4. INSERT sync_run (PH, in_progress) → idx_sync_run_one_in_progress 检查通过
  5. UPDATE sync_warehouse_lock SET locked_by=A.id → 标记持有者
  6. 事务提交 → pg_advisory_xact_lock 自动释放 → 锁行 UPDATE 生效

事务 B (同时 claim_sync_run PH，在 A 提交前到达):
  1. pg_advisory_xact_lock(hash('sync_run:PH')) → 阻塞等待 A 提交
  2. (A 提交后) → 获取 advisory lock
  3. SELECT FOR UPDATE on sync_warehouse_lock
  4. 检查 in_progress → 发现 A 的 in_progress（lease 未过期）
  5. RETURN NULL → 事务提交

事务 C (release, 正常完成, V5 统一锁顺序):
  release_sync_run(A.id, 'completed', result_summary, plan_drift_check, plan_drift_count,
                   plan_drift_differences, exit_code):
    1. 读 warehouse_id=PH from sync_run WHERE id=A.id
    2. pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功（A 的事务已提交）
    3. SELECT FOR UPDATE on sync_warehouse_lock WHERE warehouse_id=PH → 锁定行
    4. 校验 completed 必需字段 → 通过
    5. UPDATE sync_run SET status='completed', ... WHERE id=A.id AND status='in_progress' → FOUND
    6. UPDATE sync_warehouse_lock SET locked_by=NULL WHERE warehouse_id=PH AND locked_by=A.id → 清锁
    7. 事务提交 → advisory lock 释放

事务 D (release 与新 claim 并发, V5 deadlock-free 验证):
  事务 R (release A=completed) 开始:
    1. 读 warehouse_id=PH → pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功
    2. SELECT FOR UPDATE on sync_warehouse_lock → 锁定行
    3. UPDATE sync_run SET status='completed' WHERE id=A.id AND status='in_progress' → FOUND
    -- R 尚未提交，advisory lock 仍被 R 持有
  事务 N (新 claim PH) 到达:
    1. pg_advisory_xact_lock(hash('sync_run:PH')) → 阻塞等待 R 提交
  事务 R 继续:
    4. UPDATE sync_warehouse_lock SET locked_by=NULL → 清锁
    5. 事务提交 → advisory lock 释放
  事务 N 继续:
    2. 获取 advisory lock → 成功
    3. 检查 in_progress → 无有效运行（A 已 completed）
    4. INSERT 新 sync_run → 成功 → 无死锁 ✓

事务 E (cleanup, A 崩溃 5 分钟后, V5 统一锁顺序):
  cleanup_expired_sync_runs():
    1. 扫描 → 找到 PH 有过期 in_progress (A, lease 已过期)
    2. FOR LOOP warehouse_id=PH:
       a. pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功
       b. SELECT FOR UPDATE on sync_warehouse_lock → 锁定行
       c. CTE: UPDATE sync_run SET status='failed', exit_code=2 → RETURNING A.id
       d. UPDATE sync_warehouse_lock SET locked_by=NULL WHERE locked_by=A.id → 清锁
    3. RETURN 1（标记 failed 的运行数）

事务 F (cleanup 与新 claim 并发, V5 deadlock-free 验证):
  cleanup 对 PH 获取 advisory lock → 正在处理:
    新 claim PH → pg_advisory_xact_lock → 阻塞等待 cleanup 提交
  cleanup 完成 → 提交 → advisory lock 释放
    新 claim → 获取 advisory lock → 检查 in_progress → 无有效 → INSERT 成功
  结论: 统一锁顺序下不存在 cleanup 与新 claim 的交错风险 ✓

事务 G (release 与 cleanup 并发, V5 deadlock-free 验证):
  事务 R (release A=completed):
    1. 读 warehouse_id=PH
    2. pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功
  事务 C (cleanup) 同时:
    1. 扫描 → PH 有过期 in_progress (B, 非 A)
    2. pg_advisory_xact_lock(hash('sync_run:PH')) → 阻塞等待 R 提交
  事务 R 继续:
    3. SELECT FOR UPDATE → UPDATE sync_run A → 清锁 → 提交
  事务 C 继续:
    3. 获取 advisory lock → 处理过期 B → 提交
  结论: 无死锁（cleanup 被 advisory lock 阻塞，不是持有并等待）✓

事务 H (run 已被 cleanup 标记 failed 后 release):
  release_sync_run(A.id, 'completed', ...):
    1. 读 warehouse_id=PH
    2. pg_advisory_xact_lock(hash('sync_run:PH')) → 获取成功
    3. SELECT FOR UPDATE on sync_warehouse_lock → 锁定行
    4. UPDATE sync_run SET status='completed' WHERE id=A.id AND status='in_progress'
       → NOT FOUND（A 已被 cleanup 标记为 failed）
    5. RETURN false（advisory lock 在事务提交时释放）
```

---

## 9. 数据访问与脱敏边界（V4 重设计）

### 9.1 访问路径架构

```
authenticated 用户
       │
       │  (不得直接 SELECT 任何 sync_run 表或 VIEW)
       │
       ├──▶ public.get_sync_runs() RPC (SECURITY DEFINER)
       │      └─ 内部: SELECT ... FROM public.sync_run (以函数所有者 service_role 权限)
       │      └─ 内部: 调用 public.get_user_role() 获取真实调用者角色
       │      └─ 返回: SyncRunSummary[] — 按角色脱敏
       │         Admin: 完整字段（含 exit_code, error_message 脱敏版, display_name）
       │         Operator: 无 exit_code, 简短中文错误摘要, 脱敏 email
       │
       └──▶ public.get_sync_run_detail() RPC (SECURITY DEFINER)
              └─ 内部: SELECT * FROM public.sync_run WHERE id = p_run_id
              └─ 内部: 调用 public.get_user_role() 获取真实调用者角色
              └─ 返回: SyncRunDetail — 按角色脱敏
                 Admin: 完整详情（含 result_summary, plan_drift_differences）
                 Operator: 脱敏版本（无技术字段）

service_role
       │
       ├──▶ sync_run 表 (SELECT/INSERT/UPDATE/DELETE)
       ├──▶ sync_log 表 (全部操作)
       └──▶ sync_warehouse_lock 表 (SELECT/UPDATE)
```

### 9.2 get_sync_runs RPC（V4 重写）

```sql
-- Migration 00007: 查询同步运行历史（角色感知脱敏）
-- 直接读取 public.sync_run，不通过 VIEW
CREATE OR REPLACE FUNCTION public.get_sync_runs(
  p_warehouse_id uuid DEFAULT NULL,
  p_limit        integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  -- V4: 使用完全限定名称 public.get_user_role()
  SELECT public.get_user_role() INTO v_role;
  IF v_role IS NULL THEN
    RAISE EXCEPTION '未登录或账号已停用' USING ERRCODE = 'P0001';
  END IF;

  -- V4: p_limit 范围 [1, 100]
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit 必须在 [1, 100] 范围内, 实际: %', p_limit
      USING ERRCODE = 'P0001';
  END IF;

  -- 直接读取 public.sync_run，JOIN public.warehouse 获取名称
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.started_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        sr.id,
        sr.warehouse_id,
        w.name AS warehouse_name,
        sr.mode,
        sr.status,
        sr.triggered_from,
        sr.dry_run_run_id,
        sr.plan_drift_check,
        sr.plan_drift_count,
        -- 从 result_summary 提取摘要计数
        (sr.result_summary->>'variantsCreated')::integer AS variants_created,
        (sr.result_summary->>'inventoryUpdated')::integer AS inventory_updated,
        sr.started_at,
        sr.finished_at,
        -- 角色感知字段: exit_code
        CASE WHEN v_role = 'admin'
          THEN sr.exit_code
          ELSE NULL
        END AS exit_code,
        -- 角色感知字段: error_message（Admin 脱敏原文，Operator 简短摘要）
        CASE
          WHEN v_role = 'admin' THEN sr.error_message
          WHEN sr.error_message IS NOT NULL THEN '同步失败，请联系管理员'
          ELSE NULL
        END AS error_summary,
        -- 角色感知字段: 触发者显示
        CASE WHEN v_role = 'admin'
          THEN (SELECT display_name FROM public.profiles WHERE id = sr.triggered_by)
          ELSE overlay(
            (SELECT email FROM auth.users WHERE id = sr.triggered_by)
            placing '***' from 2
            for position('@' in (SELECT email FROM auth.users WHERE id = sr.triggered_by)) - 2
          )
        END AS triggered_by_display
      FROM public.sync_run sr
      JOIN public.warehouse w ON w.id = sr.warehouse_id
      WHERE (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id)
      ORDER BY sr.started_at DESC
      LIMIT p_limit
    ) t
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sync_runs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sync_runs TO authenticated;
```

**调用身份**：`authenticated`（Admin 和 Operator 均可调用，内部按 `public.get_user_role()` 脱敏）
**审计字段来源**：`triggered_by_display` — Admin 通过 `public.profiles.display_name`，Operator 通过 `auth.users.email` 脱敏
**V4 关键修复**：
- 直接读取 `public.sync_run`（不通过 VIEW），不再引用不存在的 VIEW 字段（如 `sr.variants_created`）
- 派生字段（`variants_created`, `inventory_updated`）从 `result_summary` jsonb 提取
- `p_limit` 范围 [1, 100]，拒绝 NULL/负数/过大值
- 使用完全限定名称 `public.get_user_role()`

### 9.3 get_sync_run_detail RPC（V4 修订）

```sql
-- Migration 00007: 查询单次运行详情（角色感知脱敏）
CREATE OR REPLACE FUNCTION public.get_sync_run_detail(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_run  record;
BEGIN
  SELECT public.get_user_role() INTO v_role;
  IF v_role IS NULL THEN
    RAISE EXCEPTION '未登录或账号已停用' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM public.sync_run WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_run 不存在: %', p_run_id USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'id', v_run.id,
    'warehouse_id', v_run.warehouse_id,
    'warehouse_name', (SELECT name FROM public.warehouse WHERE id = v_run.warehouse_id),
    'mode', v_run.mode,
    'status', v_run.status,
    'triggered_by', (
      CASE WHEN v_role = 'admin'
        THEN (SELECT display_name FROM public.profiles WHERE id = v_run.triggered_by)
        ELSE overlay(
          (SELECT email FROM auth.users WHERE id = v_run.triggered_by)
          placing '***' from 2
          for position('@' in (SELECT email FROM auth.users WHERE id = v_run.triggered_by)) - 2
        )
      END
    ),
    'triggered_from', v_run.triggered_from,
    'dry_run_run_id', v_run.dry_run_run_id,
    'plan_drift_check', v_run.plan_drift_check,
    'plan_drift_count', v_run.plan_drift_count,
    'plan_drift_differences', (
      CASE WHEN v_role = 'admin'
        THEN v_run.plan_drift_differences
        ELSE NULL
      END
    ),
    'result_summary', (
      CASE WHEN v_role = 'admin'
        THEN v_run.result_summary
        ELSE jsonb_build_object(
          'variantsCreated', v_run.result_summary->>'variantsCreated',
          'inventoryUpdated', v_run.result_summary->>'inventoryUpdated'
        )
      END
    ),
    'error_message', (
      CASE WHEN v_role = 'admin'
        THEN v_run.error_message
        WHEN v_run.error_message IS NOT NULL
        THEN '同步失败，请联系管理员'
        ELSE NULL
      END
    ),
    'exit_code', (CASE WHEN v_role = 'admin' THEN v_run.exit_code ELSE NULL END),
    'started_at', v_run.started_at,
    'finished_at', v_run.finished_at,
    'created_at', v_run.created_at
    -- artifact hashes 绝不返回客户端（任何角色）
    -- fallbackPath 绝不返回客户端
    -- 凭据绝不返回客户端
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sync_run_detail FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sync_run_detail TO authenticated;
```

### 9.4 字段可见性矩阵

| 字段 | Admin | Operator | Anon | 传递路径 |
|------|-------|----------|------|----------|
| `id` | Yes | Yes | No | RPC |
| `warehouseId` / `warehouseName` | Yes | Yes | No | RPC |
| `mode` | Yes | Yes | No | RPC |
| `status` | Yes | Yes | No | RPC |
| `triggered_by` (完整) | Yes (display_name) | 脱敏 email | No | RPC |
| `triggered_from` | Yes | Yes | No | RPC |
| `plan_drift_check` | Yes | Yes | No | RPC |
| `plan_drift_count` | Yes | Yes | No | RPC |
| `plan_drift_differences` | Yes | **No** | No | RPC（仅 Admin） |
| `result_summary` 完整 | Yes | **No** | No | RPC（仅 Admin） |
| `result_summary` 摘要计数 | Yes | Yes | No | RPC |
| `error_message` | Yes（脱敏） | 简短中文摘要 | No | RPC |
| `exit_code` | Yes | **No** | No | RPC（仅 Admin） |
| `input_artifact_hash` | **No** | **No** | **No** | 仅 service_role |
| `plan_artifact_hash` | **No** | **No** | **No** | 仅 service_role |
| `lease_expires_at` | **No** | **No** | **No** | 仅 service_role |
| `heartbeat_at` | **No** | **No** | **No** | 仅 service_role |
| `fallbackPath` | **No** | **No** | **No** | 永不返回客户端 |
| 凭据/密钥 | **No** | **No** | **No** | 永不返回客户端 |
| 服务端文件路径 | **No** | **No** | **No** | 永不返回客户端 |
| 原始技术堆栈 | **No** | **No** | **No** | 永不返回客户端 |

### 9.5 sync_run 表 RLS 策略

```sql
-- sync_run 表：仅 service_role 可直接访问
-- authenticated 无任何直接访问权限（所有查询通过 SECURITY DEFINER RPC）
ALTER TABLE sync_run ENABLE ROW LEVEL SECURITY;

-- service_role 全权（sync runner 使用）
CREATE POLICY "service_role_all_sync_run" ON sync_run
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated 无策略 = 拒绝所有直接访问
-- 查询通过 public.get_sync_runs() / public.get_sync_run_detail() RPC 完成
```

---

## 10. 认证链闭环（V4 确认）

### 10.1 现状分析

当前 `src/lib/auth.ts` 认证链存在缺口：

| 函数 | 校验登录 | 校验角色 | 校验 is_active | 缺口 |
|------|---------|---------|---------------|------|
| `getCurrentUser()` | Yes | No | **No** | profiles 查询未过滤 is_active |
| `requireAuth()` | Yes | No | **No** | 调用 getCurrentUser，同上 |
| `requireAdmin()` | Yes | admin only | **No** | 调用 getCurrentUser，同上 |
| `public.get_user_role()` (PG) | Yes | Yes | **Yes** | RLS 层面已校验，但应用层未兜底 |

**关键发现**：`public.get_user_role()` PostgreSQL 函数中 `WHERE p.is_active = true` 在 RLS 层校验了 is_active，但应用层的 `getCurrentUser()` 直接查询 profiles 表，不检查 is_active。

### 10.2 修复方案

**新增函数，不修改现有签名**（避免影响已有模块）：

```typescript
// src/lib/auth.ts 新增

/**
 * 获取当前活跃用户。
 * 与 getCurrentUser() 的区别：额外校验 profiles.is_active = true。
 * 停用用户返回 null。
 */
export async function getCurrentActiveUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, is_active, role:role_id (name)')
    .eq('id', user.id)
    .single();

  if (!profile) return null;
  if (!profile.is_active) return null;  // 停用用户明确拒绝

  const role = unwrapJoin<{ name: string }>(profile.role);
  const roleName = role?.name ?? 'operator';

  return {
    id: user.id,
    email: user.email,
    displayName: profile.display_name ?? user.email?.split('@')[0] ?? '用户',
    roleName,
  };
}

/**
 * 确认当前用户已登录且处于启用状态。
 * 用于需要校验 is_active 的页面 Server Component 和查询类 Server Action。
 */
export async function requireActiveAuth(): Promise<CurrentUser> {
  const user = await getCurrentActiveUser();
  if (!user) throw new Error('未登录或账号已停用');
  return user;
}

/**
 * 确认当前用户是已启用的管理员。
 * 用于需要校验 is_active 的管理类 Server Action（触发同步等）。
 */
export async function requireActiveAdmin(): Promise<CurrentUser> {
  const user = await getCurrentActiveUser();
  if (!user) throw new Error('未登录或账号已停用');
  if (user.roleName !== 'admin') throw new Error('无权限：需要管理员角色');
  return user;
}
```

**关键设计决定**：
- `getCurrentUser()` **保持不变**，现有调用方不受影响
- 新增 `getCurrentActiveUser()`：应用层主动查询 `profiles.is_active` 并明确拒绝
- `requireActiveAuth()` / `requireActiveAdmin()` 使用 `getCurrentActiveUser()`
- Sync 模块的所有 Server Action 使用 `requireActiveAuth()`（查询）或 `requireActiveAdmin()`（触发）
- 停用用户调用时统一收到 "未登录或账号已停用" 中文错误

### 10.3 页面与 Action 认证分配

| 层级 | 函数 | 使用的认证函数 |
|------|------|---------------|
| Sync 页面 Server Component | `page.tsx` | `requireActiveAuth()` |
| 查询运行历史 Action | `getSyncRuns()` | `requireActiveAuth()` |
| 查询同步状态 Action | `getSyncStatus()` | `requireActiveAuth()` |
| 查询运行详情 Action | `getSyncRunDetail()` | `requireActiveAuth()` |
| 触发 Dry Run Action | `triggerDryRun()` | `requireActiveAdmin()` |
| 触发 Real Write Action | `triggerRealWrite()` | `requireActiveAdmin()` |

### 10.4 数据库层双重保障

| 层级 | 机制 | 校验内容 |
|------|------|---------|
| PostgreSQL `public.get_user_role()` | RLS + RPC 内部角色检测 | `is_active = true`（已有） |
| 应用层 `getCurrentActiveUser()` | 显式查询 | `is_active = true`（新增） |
| 应用层 `requireActiveAuth()` | 调用 getCurrentActiveUser | 登录 + is_active |
| 应用层 `requireActiveAdmin()` | 调用 getCurrentActiveUser | 登录 + admin + is_active |

停用用户无论通过 RPC（`public.get_user_role()` 返回 NULL → 抛出 EXCEPTION）还是应用层（`getCurrentActiveUser()` 返回 null → 抛出错误）均被拒绝。

---

## 11. Dry Run → Real Write 不可变绑定（V4 修订）

### 11.1 Artifact 模型

每个同步运行关联两个 artifact。所有 artifact 的 content 类型为严格 `JsonValue`（string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }），禁止函数、undefined、Symbol、BigInt、自定义原型和 toJSON 方法。

| Artifact 类型 | 内容 | 存储时机 | 必须条件 |
|---------------|------|----------|----------|
| **Input Artifact** | 来源系统原始快照 JSON（p_variants + p_inventory），类型 JsonValue | claim 时由 SyncService 通过 prepare() 生成 normalizedContent 并存储 | Dry Run + Real Write 均必须 |
| **Plan Artifact** | 写入计划 JSON（plan_generator 输出），类型 JsonValue | Dry Run 完成后由 Runner 输出，SyncService 通过 ArtifactProvider.prepare() + store() 存储，release_sync_run 回填 hash | **completed Dry Run 必须具有**；Real Write 必须（绑定 Dry Run 的计划） |

### 11.2 completed Dry Run 必需字段（V5 强化）

一个 `status = 'completed'` 的 Dry Run 必须具有以下全部 8 个字段（由 `completed_requires_fields` CHECK + `plan_drift_check_enum` CHECK + `release_sync_run` RPC 校验三重保障）：

| 字段 | 来源 | 设置时机 | 约束 |
|------|------|----------|------|
| `input_artifact_hash` | claim 时传入（SHA-256 of stored UTF-8 bytes） | claim_sync_run | NOT NULL |
| `plan_artifact_hash` | Runner 输出计划后，SyncService 序列化为 UTF-8 bytes → store → SHA-256 | release_sync_run (p_plan_artifact_hash) | NOT NULL |
| `result_summary` | Runner 输出 | release_sync_run | NOT NULL (jsonb) |
| `plan_drift_check` | Runner 输出 | release_sync_run | NOT NULL, CHECK IN ('PASS', 'DRIFT_DETECTED') |
| `plan_drift_count` | Runner 输出 | release_sync_run | NOT NULL, CHECK >= 0 |
| `plan_drift_differences` | Runner 输出 | release_sync_run | NOT NULL (jsonb array) |
| `exit_code` | Runner 输出 | release_sync_run | NOT NULL, 0=成功 |
| `finished_at` | release_sync_run 设置 now() | release_sync_run | NOT NULL |

**Real Write completed 额外要求**：
- `dry_run_run_id` NOT NULL（由 `real_write_requires_dry_run` CHECK 保障）
- `input_artifact_hash` 和 `plan_artifact_hash` 均 NOT NULL（由 `real_write_requires_artifacts` CHECK 保障）
- 其余 8 个字段与 Dry Run completed 相同

**failed 状态必需字段**（由 `failed_requires_fields` CHECK + release/cleanup 写入对齐）：
| 字段 | 来源 | 约束 |
|------|------|------|
| `error_message` | release_sync_run 或 cleanup | NOT NULL |
| `exit_code` | release_sync_run 或 cleanup（cleanup 固定=2） | NOT NULL, 1 或 2 |
| `finished_at` | release_sync_run 或 cleanup 设置 now() | NOT NULL |

**Hash 计算要求（V5.4 修订）**：
- 对实际存储的 UTF-8 bytes 计算 SHA-256
- `ArtifactProvider.prepare(content)` 内部流程：`JSON.stringify(content)` 序列化为 UTF-8 字节 → `SHA-256(bytes)` 计算 hex digest → `JSON.parse(bytes)` 反序列化为 `normalizedContent` → 返回 `{ bytes, hash, normalizedContent }`。`prepare()` 是全系统唯一调用 `JSON.stringify` 的位置
- `ArtifactProvider.store()` 接收 prepared bytes + hash，内部验证 SHA-256(bytes) === hash 后持久化存储 bytes。**store() 内部不重新序列化**——只使用 prepare() 产生的 bytes
- `ArtifactProvider.verify()` 必须对相同存储字节重新计算 SHA-256 并比对，不得重新序列化 content 或使用独立序列化结果
- `ArtifactProvider.get()` 返回时：读取存储字节 → 重新计算 SHA-256 → 与存储时记录的 hash 比对 → 一致则解析 JSON 返回 `Artifact.content`（JsonValue，等于 prepare() 时的 normalizedContent）
- **Runner 只执行 normalizedContent**：Runner 从 `SyncExecuteParams.inputArtifact` / `boundPlanArtifact` 接收 JsonValue，不是原始 object——这是 prepare() 产生的 normalizedContent，与存储的 bytes 来自同一次序列化
- **禁止自创 "canonical JSON"**：`JSON.stringify(content, Object.keys(content).sort())` 仅排序顶层键，不覆盖嵌套对象、数组元素顺序，不是任何已知标准，不可跨语言一致，V5.2 删除
- **若未来需要跨语言一致 hash**：必须采用明确标准（如 RFC 8785 JCS），并提供 Python/TypeScript 共用 golden vectors 覆盖嵌套对象、数组、Unicode 字符、整数和小数精度场景
- **当前方案**：序列化一次（prepare），存储字节，hash = SHA-256(存储字节)，verify = SHA-256(同一存储字节) 比较，Runner 执行 normalizedContent（JSON.parse 同一字节） — 零歧义，bytes/hash/normalizedContent 三位一体不可分离

### 11.3 Artifact 不可变绑定流程（V5.4 修订 — prepare() + normalizedContent + JsonValue）

```
Dry Run 执行:
  0. SyncService 预生成 runId = crypto.randomUUID()

  1. prepared = ArtifactProvider.prepare(inputContent)
     → JSON.stringify(content) → UTF-8 bytes → SHA-256(bytes) → JSON.parse(bytes)
     → { bytes, hash, normalizedContent }
     → 这是全系统唯一一次序列化 + 反序列化；normalizedContent 是严格 JsonValue
     → Runner 只能执行 normalizedContent，不能执行原始 content

  2. claim_sync_run(p_run_id=runId, dry_run, input_artifact_hash=prepared.hash, ...)
     → INSERT sync_run WITH id=runId, status='in_progress', input_artifact_hash=prepared.hash
     → 若返回 NULL（同仓被占用）：不存储任何 artifact，返回错误"同步正在进行中"
     → 若抛出异常：不存储任何 artifact，异常向上传播

  3. ArtifactProvider.store(runId, 'input', prepared)
     → store 内部：验证 SHA-256(bytes) === hash → 持久化存储 bytes → 返回 hash
     → hash 不一致：store 自身抛出（prepare 产生的 bytes 与 hash 必须匹配，否则为 Provider bug）
     → 若 store 本身失败（IO 错误等）：
       release_sync_run(runId, 'failed', error_message='input artifact 存储失败', exit_code=1)
       + ArtifactProvider.delete(runId, 'input')

  4. SyncService 调用 Runner.execute(mode=dry_run, inputArtifact=prepared.normalizedContent)
     → Runner 只能执行 normalizedContent（JsonValue），不得执行原始 object 或自行 JSON.parse
     Runner 生成计划并返回 planContent（必须为 JsonValue）+ planDriftCheck + planDriftCount + planDriftDifferences

  5. planPrepared = ArtifactProvider.prepare(planContent)
     → 第二次（也是最后一次）prepare——plan 内容序列化
     → { bytes: planBytes, hash: planHash, normalizedContent: planNormalized }

  6. ArtifactProvider.store(runId, 'plan', planPrepared)
     → 验证 SHA-256(bytes) === hash → 持久化存储 → 返回 planHash
     → 若 store 失败：release_sync_run(runId, 'failed', error_message='plan artifact 存储失败', exit_code=1)
       + ArtifactProvider.delete(runId, 'plan')

  7. release_sync_run(runId, 'completed',
       result_summary, exit_code=0,
       plan_drift_check, plan_drift_count, plan_drift_differences,
       plan_artifact_hash=planHash)

     sync_run: status='completed', plan_artifact_hash=planHash,
               result_summary, plan_drift_check, plan_drift_count,
               plan_drift_differences, exit_code=0, finished_at

     → 若 release_sync_run 失败：SyncService 调用 ArtifactProvider.delete(runId, 'plan')
       清理已存储的 plan artifact
       （input artifact 保留——已 claim 的 sync_run 最终由 cleanup_expired_sync_runs 回收）

Real Write 执行:
  0. SyncService 预生成 runId = crypto.randomUUID()

  1. SyncService 从 ArtifactProvider.get(dryRunRunId, 'input') 检索
     → ArtifactProvider 内部重新 SHA-256(存储字节) 与存储 hash 比对
     → 校验 get 返回的 hash 与 dryRun.input_artifact_hash 一致
     → get 返回的 content 是 JsonValue（等于 prepare() 时的 normalizedContent）

  2. SyncService 从 ArtifactProvider.get(dryRunRunId, 'plan') 检索
     → 同上 hash 校验流程
     → 校验 get 返回的 hash 与 dryRun.plan_artifact_hash 一致
     → get 返回的 content 是 JsonValue

  3. currentPrepared = ArtifactProvider.prepare(currentInputContent)
     → 唯一一次序列化 + 反序列化当前输入 → { bytes, hash, normalizedContent }

  4. claim_sync_run(p_run_id=runId, real_write, dry_run_run_id=dryRunRunId,
       input_artifact_hash=currentPrepared.hash,
       plan_artifact_hash=dryRun.plan_artifact_hash)
     → claim_sync_run 在同一事务内原子验证 dry_run_run_id 有效性（见 11.5b）

  5. ArtifactProvider.store(runId, 'input', currentPrepared)
     → 同 Dry Run 步骤 3 的 store 逻辑

  6. SyncService 调用 Runner.execute(mode=real_write,
       inputArtifact=currentPrepared.normalizedContent,
       boundPlanArtifact=dryRunPlanArtifact.content)
     → 两者均为 JsonValue，来自 prepare() 的 normalizedContent 或 get() 的 content
     Runner 从 normalizedContent 重新生成计划
     Runner 对比 boundPlanArtifact vs 新计划 → PASS or DRIFT_DETECTED
     若 DRIFT_DETECTED → 返回失败，不执行写入
     若 PASS → 执行真实写入

  7. release_sync_run(runId, 'completed'/'failed', ...)
```
**关键规则**：
- `prepare()` 是全系统唯一调用 `JSON.stringify(content)` 的位置
- `prepare()` 返回 `normalizedContent`（`JSON.parse(bytes)`）——Runner 只能执行此值
- Artifact content 类型限制为严格 `JsonValue`：禁止函数、undefined、Symbol、BigInt、自定义原型、toJSON 方法
- SyncService、Runner、Repository 均不得独立序列化 content
- claim 用的 hash 与 store 用的 bytes 与 Runner 执行的 normalizedContent 全部来自同一次 `prepare()` 调用
- store 内部验证 SHA-256(bytes) === hash，不一致时 store 自身抛出
- **禁止场景 1**：SyncService 自己 `JSON.stringify` 算 hash 用于 claim，然后传 content 给 store 再 `JSON.stringify`——两次序列化可能产生不同 bytes
- **禁止场景 2**：Runner 执行原始 content 而非 prepare() 返回的 normalizedContent——原始 content 可能含非 JSON 值，且与已存储 artifact 内容不一致

### 11.3b GC 所有权与流程（V5.4 修订 — GC cutoff 强制 ≥ 审计保留期）

ArtifactProvider **不自行查询 sync_run 或判断业务引用**。GC 由 SyncService 中的 GC orchestrator 完成：

```
GC 流程:
  1. GC orchestrator 确定 cutoff:
     cutoff = now() - AUDIT_RETENTION_DAYS  // 固定 7 天，不取 max()
     → 仅删除 createdAt < now() - 7 days 的 artifact
     → 注意：artifact.createdAt 与 sync_run.finished_at 是独立时间戳，不可互相推导

  2. ArtifactProvider.listCandidates(cutoff) → candidates[]
     （纯存储层：返回 createdAt < cutoff 的 { runId, type, createdAt }[]，不查询 sync_run）

  3. GC orchestrator 从 Repository 获取受保护 runId 集合:
     - getActiveRunIds(): status='in_progress' 的所有 runId
     - getRecentlyCompletedRunIds(now() - 60 minutes): finished_at 在 60 分钟内的 completed runId
       （这些 Dry Run 仍在 Real Write 绑定窗口内，即使其 artifact 已超过 7 天也需保护）
     - getReferencedDryRunIds(): 所有 real_write 记录的 dry_run_run_id（非 NULL）
     → protectedRunIds = activeRunIds ∪ recentCompletedRunIds ∪ referencedDryRunIds

  4. GC orchestrator 过滤 candidates:
     orphans = candidates.filter(c => !protectedRunIds.has(c.runId))

  5. ArtifactProvider.deleteMany(orphans) → deletedCount

  6. 返回 deletedCount（用于日志/审计）
```

**GC cutoff 强制约束（V5.4.1 修正）**：
- **GC cutoff 直接使用 `now() - AUDIT_RETENTION_DAYS`**（默认 7 天）。`listCandidates(olderThan)` 的 `olderThan` 参数 = `now() - 7 days`
- **禁止使用 `max()`**：V5.4 的 `max(now() - 7d, now() - 60min)` 语义错误——两个过去时间点的 `max()` 取更近者，实际 cutoff = `now() - 60min`，审计保留期完全失效
- **SyncService GC orchestrator 在调用 listCandidates 前验证**：`if (olderThan > now() - 7 days) throw new Error('GC cutoff 不得短于审计保留期')`
- 这是代码层强制约束（非数据库 CHECK），确保 GC 不会误删近期 artifact

**artifact.createdAt 与 sync_run.finished_at 独立（V5.4.1 明确）**：
- `artifact.createdAt` 是 ArtifactProvider 存储层时间戳——记录 artifact 写入存储的时间
- `sync_run.finished_at` 是 sync_run 完成时间——由 release_sync_run 设置
- **禁止从 artifact.createdAt 推导 sync_run.finished_at**：两者是独立的时间戳，artifact 可能在 sync_run 完成后任意时间存储（如延迟写入、重试），且 artifact 存储和 sync_run 完成之间无事务保证
- GC 判定仅使用 artifact.createdAt 判断存储年龄（是否超过审计保留期），使用 sync_run.finished_at（通过 Repository 查询）判断业务保护状态

**安全性证明：GC 不会误删可被 Real Write 合法引用的 Dry Run artifact（V5.4.1 修正）**：
1. Real Write 只能绑定 completed Dry Run（`real_write_requires_dry_run` CHECK）
2. claim_sync_run 原子验证 Dry Run 的 `finished_at > now() - 60 minutes`（见 11.5b）
3. GC cutoff = `now() - 7 days`——仅删除 artifact 存储时间超过 7 天的条目
4. **双层保护**：
   - **第一层（存储层）**：cutoff = now() - 7 天 → listCandidates 仅返回 createdAt ≥ 7 天前的 artifact
   - **第二层（业务层）**：即使 artifact > 7 天进入候选列表，`getRecentlyCompletedRunIds(now - 60min)` 保护 finished_at 在 60 分钟内的 completed Dry Run
5. 第二层保护覆盖关键边界场景：Dry Run 恰好在 7 天前执行并存储 artifact，但刚刚才完成（finished_at 在 60 分钟内）——artifact 已满 7 天但因 finished_at 在绑定窗口内，被 protectedRunIds 保护
6. 结论：**两层保护共同确保 GC 不会删除可被合法 claim 的 Dry Run artifact** ∎

**受保护判定规则**（全部在 GC orchestrator 中，不在 ArtifactProvider 中）：
- **in_progress 运行**的 input artifact（正在执行中）
- **completed 在 Real Write 绑定窗口内**（finished_at 在 60 分钟内）的 input + plan artifact——由 `getRecentlyCompletedRunIds(now - 60min)` 保护
- **被 Real Write 引用**的 completed Dry Run（dry_run_run_id 指向的）的 input + plan artifact
- **审计保留期内**的 artifact（createdAt ≥ now() - 7 天）——由 GC cutoff 保证不进入 listCandidates

**反例（必须删除）**：
- completed Dry Run 的 artifact 超过审计保留期（>7 天）**且** Dry Run finished_at 超过 60 分钟 **且** 未被任何 Real Write 引用 → GC 可删除其 input + plan
- failed 运行（终态，无引用价值）的 artifact 超过审计保留期 → GC 可删除
- sync_run 已被删除（CASCADE）但 artifact 残留且 > 7 天 → GC 可删除

**V5.4.1 新增防误删场景**：
- **artifact > 7 天但 Dry Run 刚完成**：Dry Run 的 artifact 在 7 天前存储（如长时间运行的 Dry Run），但 finished_at 在 60 分钟内 → GC 候选列表包含此 artifact → `getRecentlyCompletedRunIds` 保护 → 不删除 ✓

### 11.4 ArtifactProvider 接口（V5.3 修订 — prepare + GC 所有权）

```typescript
// src/features/sync/artifact-provider.ts

type ArtifactType = 'input' | 'plan';

/**
 * 严格的 JSON 值类型。
 * 禁止传入函数、Symbol、undefined、自定义原型、toJSON 方法。
 * 只接受 JSON 规范允许的纯数据类型。
 * Runner 只能执行 normalizedContent（JsonValue），不得执行原始 object。
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface PreparedArtifact {
  bytes: Uint8Array;             // UTF-8 序列化后的字节（唯一权威序列化）
  hash: string;                  // SHA-256 hex digest of bytes
  normalizedContent: JsonValue;  // JSON.parse(bytes)——与 bytes 完全一致的反序列化结果
}

interface Artifact {
  runId: string;
  type: ArtifactType;
  content: JsonValue;           // JSON.parse(存储字节) 还原，等于 prepare() 时的 normalizedContent
  hash: string;                 // SHA-256 hex digest of stored bytes
  storedAt: string;             // ISO timestamp
}

/** GC 候选条目——纯存储层信息，不查询 sync_run */
interface ArtifactCandidate {
  runId: string;
  type: ArtifactType;
  createdAt: Date;
}

/**
 * JsonValue 运行时验证器（V5.4.2 完善）。
 * 在 prepare() 调用 JSON.stringify 之前执行，拒绝所有非 JSON 安全的值。
 *
 * 验证规则：
 * - 拒绝 `undefined`、`function`、`Symbol`、`BigInt`
 * - number 必须通过 `Number.isFinite`（拒绝 NaN、Infinity、-Infinity）
 * - 拒绝携带 `toJSON` 方法的对象（可能产生非确定性序列化输出）
 * - 拒绝自定义原型（`Object.getPrototypeOf(obj) !== Object.prototype` 且 `!== null`）
 * - 使用 WeakSet 检测并拒绝循环引用
 * - 使用 Reflect.ownKeys() 明确拒绝 Symbol 键（对象和数组均检查）
 * - 拒绝稀疏数组（存在空洞，JSON.stringify 会将空洞转为 null，round-trip 不一致）
 * - 拒绝数组额外属性：仅接受规范数组索引（String(index) === key 且 index < length），拒绝 "01"/"4294967295" 等伪数字
 * - 拒绝 Array 子类（原型必须严格为 Array.prototype）和数组自身/继承的 toJSON
 * - 拒绝 accessor/getter 属性（可能产生非确定性序列化输出）
 * - 拒绝不可枚举属性（可能被 JSON.stringify 静默丢弃）
 * - 使用 descriptor.value 读取对象属性值（禁止因属性访问触发 getter 行为）
 * - 循环引用检测使用 WeakSet 仅代表当前递归祖先链；递归完成后通过 try/finally 执行 seen.delete(value)
 * - 共享引用（同一对象出现在不同分支）通过；真正循环引用必须拒绝
 * - 递归检查数组和对象的所有嵌套值
 * - 不允许静默丢弃字段：JSON.stringify 会丢弃 undefined 属性值、Symbol 键、函数值——
 *   validateJsonValue 必须在序列化前检测并拒绝这些值
 *
 * 返回：通过验证的原始值（不变）。
 * 抛出：遇到非法值时抛出带有路径信息（如 "root.warehouses[3].name"）的详细错误。
 */
function validateJsonValue(value: unknown, path: string = 'root', seen: WeakSet<object> = new WeakSet()): JsonValue {
  // undefined
  if (value === undefined) {
    throw new Error(`JsonValue 不允许 undefined: ${path}`);
  }

  // null is valid JSON
  if (value === null) {
    return value;
  }

  const type = typeof value;

  // 拒绝 function
  if (type === 'function') {
    throw new Error(`JsonValue 不允许函数: ${path}`);
  }

  // 拒绝 symbol
  if (type === 'symbol') {
    throw new Error(`JsonValue 不允许 Symbol: ${path}`);
  }

  // 拒绝 bigint
  if (type === 'bigint') {
    throw new Error(`JsonValue 不允许 BigInt: ${path}`);
  }

  // boolean and string are valid
  if (type === 'boolean' || type === 'string') {
    return value;
  }

  // number: 必须有限
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `JsonValue number 必须为有限值，收到 ${Number.isNaN(value) ? 'NaN' : 'Infinity'}: ${path}`
      );
    }
    return value;
  }

  // array
  if (Array.isArray(value)) {
    // 循环引用检测（WeakSet — 仅代表当前递归祖先链）
    if (seen.has(value)) {
      throw new Error(`JsonValue 不允许循环引用: ${path}`);
    }
    seen.add(value);
    try {
      // 拒绝 Array 子类：原型必须严格为 Array.prototype
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(
          `JsonValue 不允许 Array 子类或自定义原型数组: ${path} (prototype: ${Object.getPrototypeOf(value)?.constructor?.name || 'null'})`
        );
      }

      // 拒绝数组自身或继承的 toJSON
      if ('toJSON' in value) {
        throw new Error(
          `JsonValue 数组不允许携带 toJSON 方法: ${path}（toJSON 可能导致非确定性序列化）`
        );
      }

      // 拒绝稀疏数组：检查是否存在空洞
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) {
          throw new Error(`JsonValue 不允许稀疏数组（索引 ${i} 为空洞）: ${path}`);
        }
      }

      // 使用 Reflect.ownKeys 检查 Symbol 键和数组额外属性
      // 仅接受满足 String(index) === key、index < length 的规范数组索引
      // 拒绝 "01"、"4294967295" 等伪数字额外属性
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key === 'symbol') {
          throw new Error(`JsonValue 数组不允许 Symbol 键 (${key.toString()}): ${path}`);
        }
        // 'length' 是数组内置属性，跳过
        if (key === 'length') continue;
        // 仅接受规范数组索引：String(index) === key 且 index < length
        const index = Number(key);
        if (!(typeof key === 'string' &&
            String(index) === key &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < value.length)) {
          throw new Error(`JsonValue 数组不允许非规范索引属性 (${key}): ${path}`);
        }
      }

      // 拒绝 accessor/getter 属性
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, i);
        if (descriptor && (descriptor.get || descriptor.set)) {
          throw new Error(`JsonValue 数组不允许 getter/setter 属性（索引 ${i}）: ${path}`);
        }
      }

      return value.map((item, idx) => validateJsonValue(item, `${path}[${idx}]`, seen)) as JsonValue;
    } finally {
      seen.delete(value);
    }
  }

  // object
  if (type === 'object') {
    // 循环引用检测（WeakSet — 仅代表当前递归祖先链）
    if (seen.has(value)) {
      throw new Error(`JsonValue 不允许循环引用: ${path}`);
    }
    seen.add(value);
    try {
      // 拒绝自定义原型（仅允许 Object.prototype 或 null 原型）
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(
          `JsonValue 不允许自定义原型对象: ${path} (prototype: ${proto?.constructor?.name || 'null'})`
        );
      }

      // 拒绝 toJSON — 使用 'in' 操作符，不使用 any
      if ('toJSON' in value) {
        throw new Error(
          `JsonValue 不允许携带 toJSON 方法的对象: ${path}（toJSON 可能导致非确定性序列化）`
        );
      }

      const result: Record<string, JsonValue> = {};
      // 使用 Reflect.ownKeys 遍历全部字符串键
      // 使用 descriptor.value 读取值（禁止因属性访问触发 getter 行为）
      const ownKeys = Reflect.ownKeys(value as object);
      for (const key of ownKeys) {
        // 拒绝 Symbol 键
        if (typeof key === 'symbol') {
          throw new Error(`JsonValue 对象不允许 Symbol 键 (${key.toString()}): ${path}`);
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
          // 自有属性必定有 descriptor，此分支防御性编程
          throw new Error(`JsonValue 对象属性缺少 descriptor (${key}): ${path}`);
        }

        // 拒绝不可枚举属性（可能被 JSON.stringify 静默丢弃）
        if (descriptor.enumerable === false) {
          throw new Error(`JsonValue 对象不允许不可枚举属性 (${key}): ${path}`);
        }

        // 拒绝 accessor/getter 属性
        if (descriptor.get || descriptor.set) {
          throw new Error(`JsonValue 对象不允许 getter/setter 属性 (${key}): ${path}`);
        }

        // 使用 descriptor.value 读取值，禁止因属性访问触发 getter 行为
        const val = descriptor.value;
        // 拒绝 undefined 属性值（JSON.stringify 会静默丢弃）
        if (val === undefined) {
          throw new Error(
            `JsonValue 对象属性值不允许为 undefined（会被 JSON.stringify 静默丢弃）: ${path}.${key}`
          );
        }
        result[key] = validateJsonValue(val, `${path}.${key}`, seen);
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error(`JsonValue 不支持的类型 ${type}: ${path}`);
}

interface ArtifactProvider {
  /**
   * 准备 artifact：先通过 validateJsonValue 验证 → 序列化 content 为 UTF-8 bytes →
   * 计算 SHA-256 → 反序列化回 JsonValue（normalizedContent）。
   *
   * 这是整个系统中唯一对 content 进行 JSON.stringify 的位置。
   * 调用方用返回的 hash 调用 claim_sync_run，用返回的 bytes 调用 store，
   * 用返回的 normalizedContent 传给 Runner。
   *
   * 内部流程（V5.4.3 强制执行）：
   * 1. validateJsonValue(content) —— 先验证，拒绝所有非 JSON 安全值（含循环引用、Symbol 键、稀疏数组、非规范索引、Array 子类、getter、不可枚举属性）
   * 2. JSON.stringify(content) → UTF-8 bytes —— 唯一序列化
   * 3. SHA-256(bytes) → hash hex digest
   * 4. JSON.parse(bytes) → normalizedContent —— 反序列化回 JsonValue
   *
   * 实现保证：
   * - validateJsonValue 先于 stringify：不会让非法值进入序列化流程
   * - round-trip：JSON.parse(JSON.stringify(bytes 对应的 text)) === normalizedContent
   * - 若 content 包含 NaN/Infinity/undefined/function/Symbol/BigInt/toJSON/自定义原型/循环引用/Symbol 键/稀疏数组/非规范数组索引/Array 子类/getter/不可枚举属性，
   *   validateJsonValue 在第 1 步就抛出明确错误（含路径），不会进入 stringify
   * - 循环检测使用 WeakSet 递归祖先链（try/finally 删除）：共享引用通过，真正循环拒绝
   */
  prepare(content: JsonValue): PreparedArtifact;

  /**
   * 存储 artifact 字节。内部流程：
   * 1. 验证 SHA-256(bytes) === hash（hash 必须由 prepare() 产生）
   * 2. 持久化存储 bytes + hash + 元数据
   * 3. 返回 hash（必须与入参 hash 一致）
   *
   * 调用方必須先用 prepare() 產生 bytes/hash/normalizedContent，不得自行 JSON.stringify。
   * store() 不得内部重新序列化 content——只接受 prepared bytes。
   * 若 SHA-256(bytes) !== hash，抛出错误。
   */
  store(runId: string, type: ArtifactType, prepared: PreparedArtifact): Promise<string>;

  /**
   * 检索 artifact 内容（含 hash 校验）。
   * 内部流程：读取存储字节 → SHA-256(存储字节) → 与存储时 hash 比对 → 不一致则抛出 → 一致则 JSON.parse 返回 content。
   * 返回的 content 必须严格等于 prepare() 时的 normalizedContent（round-trip 一致）。
   */
  get(runId: string, type: ArtifactType): Promise<Artifact>;

  /**
   * 校验 artifact hash 是否匹配。
   * 对存储字节重新计算 SHA-256 并与 expectedHash 比对。
   */
  verify(runId: string, type: ArtifactType, expectedHash: string): Promise<boolean>;

  /**
   * 删除指定 artifact。幂等：不存在时静默成功。
   */
  delete(runId: string, type: ArtifactType): Promise<void>;

  /**
   * 列出早于 olderThan 的所有 artifact 候选。
   * 仅返回存储层元数据（runId, type, createdAt），不查询 sync_run，不判断业务引用。
   * 由调用方（GC orchestrator）决定哪些可以删除。
   */
  listCandidates(olderThan: Date): Promise<ArtifactCandidate[]>;

  /**
   * 批量删除指定 artifacts。幂等：不存在的 artifact 静默跳过。
   * 返回实际删除的数量。
   */
  deleteMany(artifacts: Array<{ runId: string; type: ArtifactType }>): Promise<number>;
}
```

**实施说明**：
- P5-SY5 使用 `MockArtifactProvider`（内存存储，实现 SHA-256 on prepared bytes + validateJsonValue）
- P5-SY6 实现 `FileSystemArtifactProvider` 或数据库存储
- ArtifactProvider 封装文件路径解析，Repository 和 Runner 均不直接访问文件系统
- `validateJsonValue(content)` 是 `prepare()` 的第一步——在序列化前递归拒绝所有非 JSON 安全值（V5.4.3：含循环引用/Symbol 键/稀疏数组/非规范索引/Array 子类/数组 toJSON/getter/不可枚举属性检测；WeakSet 递归祖先链 try/finally 删除；descriptor.value 读取对象属性值；禁止 any）
- `prepare()` 是系统中唯一调用 `JSON.stringify(content)` 的位置——SyncService、Runner、Repository 均不得独立序列化
- `store()` 必须验证 SHA-256(bytes) === hash，hash 不一致时抛出错误
- `delete()` / `deleteMany()` 幂等：artifact 不存在时静默成功，不抛异常
- `listCandidates()` 是纯存储层操作，不查询 sync_run 表
- **GC 所有权**：ArtifactProvider 只提供存储层原语（listCandidates + deleteMany）。GC 决策（哪些 artifact 可删）由 SyncService/GC orchestrator 完成：从 Repository 获取受保护的 runId 列表 → 过滤候选 → 调用 deleteMany
- 受保护判定规则（在 GC orchestrator 中，不在 ArtifactProvider 中）：
  - completed Dry Run 在绑定窗口内（finished_at 在 60 分钟内）的 input+plan artifact
  - completed Dry Run 被 Real Write 的 dry_run_run_id 引用时的 input+plan artifact
  - 审计保留期内的 artifact（createdAt 在 7 天内）
  - 当前 in_progress 运行关联的 artifact

### 11.5 真实写入绑定验证（V5 修订）

**Server Action 验证逻辑**：

```typescript
// src/features/sync/actions.ts
async function triggerRealWrite(params: {
  warehouseId: string;
  dryRunRunId: string;
  confirmToken: string;
}) {
  const user = await requireActiveAdmin();
  const parsed = schema.realWriteParams.parse(params);

  // 1. 验证 Dry Run 记录有效性
  const dryRun = await syncRepo.getRunById(parsed.dryRunRunId);
  if (!dryRun) throw new Error('指定的 Dry Run 不存在');
  if (dryRun.warehouse_id !== parsed.warehouseId)
    throw new Error('Dry Run 仓库与目标仓库不一致');
  if (dryRun.mode !== 'dry_run' || dryRun.status !== 'completed')
    throw new Error('指定的记录不是已完成的 Dry Run');

  // 2. 验证 completed Dry Run 全部 8 个必需字段（V5 强化）
  if (!dryRun.input_artifact_hash)
    throw new Error('指定的 Dry Run 缺少 input artifact hash，数据不完整');
  if (!dryRun.plan_artifact_hash)
    throw new Error('指定的 Dry Run 缺少计划 artifact，无法绑定。请重新执行 Dry Run');
  if (!dryRun.result_summary || !dryRun.plan_drift_check || !dryRun.plan_drift_differences)
    throw new Error('指定的 Dry Run 结果不完整，请重新执行');
  if (dryRun.plan_drift_count === null || dryRun.plan_drift_count < 0)
    throw new Error('指定的 Dry Run plan_drift_count 无效');
  if (dryRun.exit_code === null || dryRun.finished_at === null)
    throw new Error('指定的 Dry Run 缺少 exit_code 或 finished_at');

  // 3. 验证 Dry Run 计划漂移状态
  if (dryRun.plan_drift_check !== 'PASS')
    throw new Error('Dry Run 检测到计划漂移，无法执行真实写入。请重新执行 Dry Run');

  // 4. 验证 Dry Run 有效期
  const ageMinutes = (Date.now() - new Date(dryRun.finished_at!).getTime()) / 60000;
  if (ageMinutes > 60)
    throw new Error('Dry Run 已过期（超过 60 分钟），请重新执行 Dry Run');

  // 5. 验证确认令牌
  if (parsed.confirmToken !== 'P5-SY3B-PH')
    throw new Error('确认令牌不匹配');

  // 6. 加载 + 校验 artifact hash（ArtifactProvider 内部对存储字节重算 SHA-256 比对）
  const inputArtifact = await artifactProvider.get(parsed.dryRunRunId, 'input');
  const boundPlanArtifact = await artifactProvider.get(parsed.dryRunRunId, 'plan');

  if (inputArtifact.hash !== dryRun.input_artifact_hash)
    throw new Error('Input artifact hash 不匹配，数据完整性校验失败');
  if (boundPlanArtifact.hash !== dryRun.plan_artifact_hash)
    throw new Error('Plan artifact hash 不匹配，数据完整性校验失败');

  // 7. SyncService 预生成 runId → store current input artifact → claim → execute
  return syncService.executeRealWrite(user, {
    warehouseId: parsed.warehouseId,
    confirmToken: parsed.confirmToken,
    dryRunRunId: parsed.dryRunRunId,
    inputArtifact: inputArtifact.content,
    boundPlanArtifact: boundPlanArtifact.content,
  });
}
```

### 11.5b claim_sync_run 原子验证（V5.4.1 修订 — 防 TOCTOU）

**问题**：V5.3 中 Server Action 在应用层验证 Dry Run 有效性，然后调用 `claim_sync_run`。但验证和 claim 之间存在时间窗口——Dry Run 可能在应用层验证通过后、claim 执行前被修改（例如被 release_sync_run 或 cleanup 改变状态）。

**V5.4.1 方案**：`claim_sync_run` 在获取 `pg_advisory_xact_lock` + `sync_warehouse_lock` FOR UPDATE **之后**、任何 UPDATE/INSERT **之前**，执行 `dry_run_run_id` 的原子行级验证。验证处于锁保护区内——此时同仓不可能有并发写入——全部 7 项条件任一不满足则 RAISE EXCEPTION 拒绝。应用层验证仍是第一道防线（提供即时中文错误提示），数据库层原子验证是第二道防线（消除 TOCTOU 窗口）。

**执行顺序（V5.4.1 明确）**：
```
1. 参数基本校验（NULL/类型）
2. Warehouse 存在性校验
3. pg_advisory_xact_lock(hash('sync_run:' || warehouse_id))  ← 获取事务级互斥锁
4. SELECT FOR UPDATE on sync_warehouse_lock                 ← 行级锁序列化
5. ← V5.4.1: dry_run_run_id 行级验证在此处（锁保护区内）
6. 检查是否存在有效 in_progress
7. 清理过期 in_progress → failed
8. INSERT 新 sync_run
9. UPDATE sync_warehouse_lock.locked_by
```

**原子验证条件**（在 pg_advisory_xact_lock + FOR UPDATE 保护下，同一事务内）：

```sql
-- claim_sync_run 内对 real_write 模式的 dry_run_run_id 验证：
PERFORM 1 FROM public.sync_run
WHERE id = p_dry_run_run_id
  AND warehouse_id = p_warehouse_id          -- ① 同仓
  AND mode = 'dry_run'                       -- ② 必须是 Dry Run
  AND status = 'completed'                   -- ③ 必须已完成（终态不可变→stable）
  AND plan_drift_check = 'PASS'              -- ④ 无漂移
  AND finished_at IS NOT NULL
  AND finished_at > v_now - INTERVAL '60 minutes'  -- ⑤ 60 分钟内有效
  AND input_artifact_hash IS NOT NULL
  AND plan_artifact_hash IS NOT NULL
  AND input_artifact_hash = p_input_artifact_hash   -- ⑥ input hash 匹配
  AND plan_artifact_hash = p_plan_artifact_hash;    -- ⑦ plan hash 匹配

IF NOT FOUND THEN
  RAISE EXCEPTION 'dry_run_run_id 验证失败：...';
END IF;
```

**为什么 TOCTOU 不可能（V5.4.1 强化）**：
- **锁保护**：dry_run_run_id 验证在 `pg_advisory_xact_lock` + `sync_warehouse_lock` FOR UPDATE 之后执行——此时同仓不可能有并发 write 修改任何 sync_run 行
- **终态不可变**：`completed` 是终态——一旦 Dry Run 进入 completed，其 `plan_drift_check`、`finished_at`、`input_artifact_hash`、`plan_artifact_hash` 均不可再修改（`release_sync_run` 仅允许 `status = 'in_progress'` → `completed`/`failed`）
- **cleanup 不触碰 completed**：`cleanup_expired_sync_runs` 仅处理 `status = 'in_progress'` 的行
- **验证与 INSERT 在同一事务**：验证通过后立即 INSERT——两者之间没有提交点，外部不可能插入修改
- 唯一可能的时间相关失败：`finished_at > v_now - INTERVAL '60 minutes'` 因时钟自然流逝而失败——这恰好是期望行为（过期拒绝）

**双重验证对比**：

| 验证项 | 应用层（Server Action） | 数据库层（claim_sync_run） |
|--------|------------------------|---------------------------|
| warehouse 一致 | `dryRun.warehouse_id !== parsed.warehouseId` | `warehouse_id = p_warehouse_id` |
| 是 Dry Run | `dryRun.mode !== 'dry_run'` | `mode = 'dry_run'` |
| 已完成 | `dryRun.status !== 'completed'` | `status = 'completed'` |
| 无漂移 | `dryRun.plan_drift_check !== 'PASS'` | `plan_drift_check = 'PASS'` |
| 60 分钟有效 | `Date.now() - finished_at > 60min` | `finished_at > v_now - INTERVAL '60 minutes'` |
| input hash 匹配 | `inputArtifact.hash !== dryRun.input_artifact_hash` | `input_artifact_hash = p_input_artifact_hash` |
| plan hash 匹配 | `boundPlanArtifact.hash !== dryRun.plan_artifact_hash` | `plan_artifact_hash = p_plan_artifact_hash` |
| 完整字段 | 8 个必需字段逐一检查 | CHECK 约束兜底 |

**P5-SY5G 新增测试**：
- TOCTOU 边界：应用层验证通过后、claim 执行前，Dry Run 被 cleanup 标记 failed（不可能——completed 不在 cleanup 范围内；但需验证 claim_sync_run 内 SELECT 未找到记录时正确拒绝）
- 时钟边界：`finished_at` 恰好 59 分 59 秒 → claim 成功；恰好 60 分 0 秒 → claim 拒绝
- hash 不匹配边界：应用层验证通过后、claim 执行前，存储层 artifact 被篡改（不可能——但需验证 claim_sync_run 内 hash 不匹配时正确拒绝）

### 11.6 真实写入按钮禁用条件

真实写入按钮在以下任一情况下 `disabled`，并显示 tooltip 说明原因：

1. **无最近成功 Dry Run** — "请先执行 Dry Run 同步"
2. **Dry Run 缺少 plan artifact** — "Dry Run 数据不完整，请重新执行"
3. **Dry Run 计划漂移** — "上次 Dry Run 检测到计划漂移，请重新执行"
4. **Dry Run 已过期** — "Dry Run 已过期（超过 60 分钟），请重新执行"
5. **Artifact hash 校验失败** — "数据完整性异常，请联系管理员"
6. **Migration 00006 未执行** — "系统尚未完成真实写入配置"
7. **Sync Runner 不支持 real_write** — "当前运行环境不支持真实写入"

第 6、7 条为系统级禁用，在 P5-SY5 实施阶段始终为 true。

### 11.7 真实写入二次确认 Dialog

```
用户点击 "真实写入"（按钮 disabled 状态已通过上述条件排除）
  │
  ├─ 弹出 Dialog
  │   ├─ 标题: "确认执行真实写入"
  │   ├─ 警告: "将调用数据库 RPC 事务更新 inventory 表，写入后不可撤销。"
  │   ├─ 信息: 仓库名称、预计影响 SKU 数量（来自绑定的 Dry Run）
  │   ├─ 必填确认令牌: 输入 "P5-SY3B-PH"
  │   ├─ Checkbox: "我已知晓此操作将真实写入数据库"
  │   ├─ [取消] (Secondary)
  │   └─ [确认执行真实写入] (Destructive)
  │       └─ disabled 条件:
  │           - 令牌不匹配
  │           - Checkbox 未勾选
  │           - 已有同步 in_progress
  │
  └─ 确认后调用 triggerRealWrite({ warehouseId, dryRunRunId, confirmToken })
```

### 11.8 权限要求（四重验证）

1. **身份认证**：`requireActiveAdmin()` — 已登录 + admin 角色 + is_active
2. **令牌匹配**：`confirmToken === 'P5-SY3B-PH'` — 与 CLI 安全门一致
3. **Dry Run 绑定**：有效、无漂移、未过期的 completed Dry Run 含完整字段
4. **Artifact 完整性**：input 和 plan artifact hash 校验通过

---

## 12. sync_run 查询与展示

### 12.1 状态卡片（页面顶部）

| 卡片 | 内容 | 数据来源 |
|------|------|----------|
| 最近同步 | "2 分钟前" + 模式 Badge + 状态 Badge | `get_sync_runs(limit=1)` |
| 当前状态 | "空闲" / "执行中" | `get_sync_status().isInProgress` |
| 上次结果 | Dry Run: "91 SKU, PASS" / Real Write: "91 SKU 已同步" / Failed: "错误摘要" | `get_sync_runs(limit=1)` 最新完成记录 |

### 12.2 运行历史表格

| 列 | 字段 | 展示 |
|----|------|------|
| 时间 | `started_at` | 相对时间（"2 分钟前"）+ 绝对时间 tooltip |
| 仓库 | `warehouse_id` | 仓库名称（RPC JOIN warehouse.name） |
| 模式 | `mode` | Badge: "Dry Run" (灰) / "真实写入" (黄) |
| 状态 | `status` | Badge: completed=绿 / failed=红 / in_progress=蓝+动画 |
| SKU | `variants_created` | 数字（RPC 从 result_summary 提取） |
| 漂移 | `plan_drift_check` | Badge: PASS=绿 / DRIFT_DETECTED=黄 |
| 触发者 | `triggered_by_display` | RPC 按角色脱敏 |
| 详情 | — | "查看" 按钮 → Detail Dialog（调用 `get_sync_run_detail()` RPC） |

### 12.3 详情 Dialog

通过 `get_sync_run_detail()` RPC 获取，角色感知：

**Admin 可见**：
- 完整触发者 display_name
- 仓库名称
- 模式、状态、退出码
- 计划漂移状态 + 差异列表
- 完整 result_summary（variants/inventory 操作计数）
- 脱敏错误信息（无路径/凭据）
- 执行耗时
- 关联的 sync_log 记录（如有）

**Operator 可见**：
- 脱敏触发者 email
- 仓库名称
- 模式、状态（无 exit_code）
- 计划漂移状态（仅 PASS/DRIFT_DETECTED，无差异详情）
- 摘要 result_summary（仅 variantsCreated/inventoryUpdated）
- 简短中文错误摘要
- 执行耗时

**永远不可见**（任何角色）：
- `input_artifact_hash` / `plan_artifact_hash`
- `lease_expires_at` / `heartbeat_at`
- `fallbackPath` / 服务端文件路径
- 凭据
- 原始技术异常堆栈

---

## 13. P5-SY5 后续实施拆分（V4 修订）

### 子任务总览

| Sub-Task ID | 任务 | 依赖 | 类型 |
|-------------|------|------|------|
| **P5-SY5A** | Migration 00007：sync_run 表 + sync_warehouse_lock + advisory lock + 查询 RPC + sync_log 扩展 | P5-SY5 设计验收 | 数据模型 |
| **P5-SY5B** | 认证链修复：`getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()` | P5-SY5 设计验收 | 安全前置 |
| **P5-SY5C** | Sync Feature Module 骨架（含 ArtifactProvider + 更新后的 SyncRunner 接口） | P5-SY5A, P5-SY5B | 后端模块 |
| **P5-SY5C2** | 类型补全 + Schema + Repository + SyncService + 依赖工厂 + Server Actions + Mock Provider/Runner | P5-SY5C | 后端模块（任务包第三次修订完成，待独立复审） |
| **P5-SY5D** | Sync 页面与客户端组件 | P5-SY5C2 | 前端页面 |
| **P5-SY5E** | 侧边栏集成 | P5-SY5C2 | 前端导航 |
| **P5-SY5F** | MockSyncRunner + MockArtifactProvider + 端到端流程验证 | P5-SY5D | 集成测试 |
| **P5-SY5G** | 并发锁原子 claim 测试（**必须真实 PostgreSQL 双事务并发**，含 cleanup 交错场景） | P5-SY5A, P5-SY5F | 安全测试 |

**V5 变更**：
- P5-SY5A：严格前向 Migration（CREATE TABLE 不用 IF NOT EXISTS；仅函数用 CREATE OR REPLACE）；`sync_run.id` 无 DEFAULT（由 SyncService 预生成）；新增 `plan_drift_check_enum`、`plan_drift_count_non_negative`、`failed_requires_fields` CHECK；`completed_requires_fields` 扩展至含 plan_drift_count 和 plan_drift_differences；`claim_sync_run` 新增 `p_run_id` 参数；`release_sync_run` 新增 advisory lock + FOR UPDATE；`cleanup_expired_sync_runs` 新增 advisory lock + per-warehouse 循环 + exit_code=2 + 返回标记 failed 数
- P5-SY5G 新增 claim-vs-release、claim-vs-cleanup 死锁验证（要求无 deadlock）

**V5.3 变更**：
- P5-SY5A：新增 `completed_dry_run_requires_plan_artifact` CHECK；共 11 个 CHECK；新增真实 PostgreSQL 约束测试（INSERT/UPDATE 违反 CHECK 被拒绝）
- P5-SY5C：ArtifactProvider 接口重做——新增 `prepare(content) → { bytes, hash }`（唯一序列化点）；`store()` 改为接受 `PreparedArtifact`（不接受裸 content）；`gc()` 替换为 `listCandidates()` + `deleteMany()`；GC orchestrator 在 SyncService 中
- P5-SY5F：删除旧 gc() 测试；新增 prepare() 唯一序列化测试 + store hash 一致性测试 + 非确定性序列化安全测试 + GC 所有权测试（listCandidates → orchestrator 过滤 → deleteMany）+ 防误删测试（in_progress/被引用/有效期内 completed Dry Run）

**V5.4 变更**：
- P5-SY5A：`claim_sync_run` real_write 模式新增原子 dry_run_run_id 验证（warehouse + mode + status + plan_drift_check + 60min + hash 匹配，全部在同一事务内）
- P5-SY5C：ArtifactProvider 接口——`prepare()` 返回 `{ bytes, hash, normalizedContent }`（`normalizedContent = JSON.parse(bytes)`）；content 类型为严格 `JsonValue`；`SyncRunner.execute()` 的 `inputArtifact` / `boundPlanArtifact` 改为 `JsonValue` 类型；GC orchestrator 强制 `olderThan ≤ now() - 7 days`
- P5-SY5F：新增 normalizedContent round-trip 一致性测试（`JSON.parse(bytes) === normalizedContent`）；Runner 接收 JsonValue 验证；GC 双层保护验证（7 天审计保留期 + getRecentlyCompletedRunIds 60 分钟业务保护）；GC orchestrator 拒绝过短 cutoff 测试
- P5-SY5G：新增 Real Write claim 原子验证测试（7 条件逐一拒绝 + 全部通过）；TOCTOU 边界测试；时钟边界测试（59:59 vs 60:00）；GC vs claim 并发安全测试

**V5.4.1 变更**：
- P5-SY5A：`claim_sync_run` dry_run_run_id 行级验证移至 advisory lock + FOR UPDATE 之后、UPDATE/INSERT 之前（在锁保护区内执行）
- P5-SY5C：新增 `validateJsonValue()` 运行时验证器（递归拒绝 undefined/function/Symbol/BigInt/toJSON/自定义原型，Number.isFinite；V5.4.2 增强：WeakSet 循环引用检测、Reflect.ownKeys Symbol 键拒绝、稀疏数组拒绝、数组额外属性拒绝、accessor/getter 拒绝、禁止 any）；`prepare()` 内部第 1 步调用 validateJsonValue；Repository 恢复 `getRecentlyCompletedRunIds(since)`
- P5-SY5F：新增 validateJsonValue 测试（NaN/Infinity/嵌套 undefined/toJSON/自定义原型/函数/Symbol/BigInt/数组非法值/合法值/null，共 12 项 + V5.4.2 新增 Symbol 键/循环引用/稀疏数组/getter 属性，共 16 项 + V5.4.3 新增非规范索引/不可枚举/Array 子类/数组 toJSON/共享引用/循环祖先链，共 24 项）；GC 防误删测试新增 "artifact > 7 天但 Dry Run 刚完成" 边界场景
- P5-SY5G：新增验证执行顺序测试（确认 dry_run_run_id 在 advisory lock 之后）；TOCTOU 测试更新（验证在锁保护区内）；GC vs claim 测试新增 "artifact > 7 天但 Dry Run 刚完成" 边界

**V5.4.3 变更**：
- P5-SY5C：validateJsonValue() 增强——数组验证仅接受规范索引（String(index) === key 且 index < length），拒绝 "01"/"4294967295" 等伪数字；新增 Array 子类检测（Object.getPrototypeOf(array) === Array.prototype）；新增数组 toJSON 检测；对象验证使用 Reflect.ownKeys 遍历全部字符串键 + descriptor.enumerable 拒绝不可枚举属性 + descriptor.value 读取值（禁止触发 getter）；循环检测 WeakSet try/finally 删除（仅代表递归祖先链，共享引用通过、真正循环拒绝）
- P5-SY5F：新增 validateJsonValue 测试 ~8 项（数组 "01"/"4294967295"、不可枚举属性、Array 子类、自身/继承 toJSON、共享引用通过、真实循环拒绝）；validateJsonValue 测试总数 ~16→~24；端到端总测试数 ~38→~46

**V4 变更**（历史）：
- P5-SY5A 不再包含 `sync_run_summary` VIEW（已删除）；查询仅通过 `get_sync_runs` / `get_sync_run_detail` RPC 直接读取 `public.sync_run`
- P5-SY5G 新增 cleanup 与新 claim 并发交错测试（V5 已删除该场景，改由统一锁顺序消除）

### 各项验收标准与停止条件

#### P5-SY5A — Migration 00007（V5.3 修订）

**产出**：
- `supabase/migrations/00007_sync_run.sql` 包含：
  - `sync_run` 表创建（**严格前向，不用 `IF NOT EXISTS`**；`id` 无 `DEFAULT gen_random_uuid()`——由 SyncService 预生成；删除 `confirm_token_hash`；含 `input_artifact_hash`/`plan_artifact_hash`；新增 `plan_drift_check_enum` + `plan_drift_count_non_negative` + `failed_requires_fields`（exit_code IN (1,2)）+ `completed_exit_code_zero` + `plan_drift_differences_length` + `completed_dry_run_requires_plan_artifact` CHECK；`completed_requires_fields` 扩展至含 plan_drift_count + plan_drift_differences；共 11 个 CHECK）
  - `sync_warehouse_lock` 表 + trigger（自动为 warehouse 创建锁行）+ 补建（**不用 `IF NOT EXISTS`**）
  - `claim_sync_run()` RPC（**新增 `p_run_id` 参数**；三层防御：pg_advisory_xact_lock + SELECT FOR UPDATE + 部分唯一索引；lease_duration [30,900]；**V5.4.1: real_write dry_run_run_id 行级验证在 advisory lock + FOR UPDATE 之后、UPDATE/INSERT 之前**；僵尸回收设置 exit_code=2；V5.2: claim 先于 store，claim 失败不产生 artifact）
  - `release_sync_run()` RPC（**V5.3 修订**：读 warehouse_id + v_mode → pg_advisory_xact_lock → SELECT FOR UPDATE → UPDATE sync_run；completed 校验含 plan_drift_count + plan_drift_differences 数组长度 + plan_drift_check 枚举 + exit_code=0 + Dry Run 强制 plan_artifact_hash（与 completed_dry_run_requires_plan_artifact CHECK 双重保障）；failed 校验 error_message + exit_code IN (1,2)；plan_artifact_hash 回填）
  - `heartbeat_sync_run()` RPC（lease_duration [30,900]）
  - `cleanup_expired_sync_runs()` RPC（**V5 统一锁顺序**：按 warehouse_id 排序遍历 → pg_advisory_xact_lock → SELECT FOR UPDATE → CTE UPDATE + 清锁；exit_code=2；返回标记 failed 的运行数）
  - `get_sync_runs()` RPC（直接读 `public.sync_run`；p_limit [1,100]；完全限定 `public.get_user_role()`）
  - `get_sync_run_detail()` RPC（完全限定 `public.get_user_role()`）
  - `sync_log` 表扩展（5 列：`sync_run_id`, `triggered_by`, `triggered_from`, `mode`, `exit_code`；**ALTER TABLE 不用 `IF NOT EXISTS`**）
  - `sync_run` 表 RLS（仅 service_role）
  - `sync_log` 表 RLS 策略更新
  - 所有 RPC 的 REVOKE/GRANT 权限收口

**验收标准**：
- [ ] SQL 语法有效（静态审查）
- [ ] **严格前向一次性 Migration**：`CREATE TABLE` 不用 `IF NOT EXISTS`（冲突时 fail loud，不掩盖结构冲突）；仅函数使用 `CREATE OR REPLACE FUNCTION`；`ALTER TABLE ADD COLUMN` 不用 `IF NOT EXISTS`
- [ ] 新增字段不影响现有 `sync_log` 数据和 RLS 策略
- [ ] 旧数据 `triggered_from` 默认 `'cli'`，`mode` 默认 `'real_write'`
- [ ] `sync_run.id` 无 DEFAULT，由 SyncService 通过 `crypto.randomUUID()` 预生成
- [ ] `claim_sync_run` 接收 `p_run_id` 参数，INSERT 指定 ID
- [ ] `claim_sync_run` 使用 `pg_advisory_xact_lock` + `SELECT FOR UPDATE` + 部分唯一索引三层防御
- [ ] `claim_sync_run` 校验 lease_duration NOT NULL 且 ∈ [30, 900]
- [ ] `claim_sync_run` 校验 warehouse 存在、overseas 类型、is_active
- [ ] `claim_sync_run` 僵尸回收设置 exit_code=2
- [ ] **V5.4.1:** `claim_sync_run` real_write 模式的 dry_run_run_id 行级验证在 pg_advisory_xact_lock + FOR UPDATE 之后、UPDATE/INSERT 之前执行；验证：warehouse 匹配 + mode=dry_run + status=completed + plan_drift_check=PASS + finished_at 在 60 分钟内 + input/plan artifact hashes 匹配；任一条件不满足→RAISE EXCEPTION
- [ ] `release_sync_run` **统一锁顺序**：读 warehouse_id → pg_advisory_xact_lock → SELECT FOR UPDATE → UPDATE sync_run
- [ ] `release_sync_run` 校验 completed 全部必需字段（含 plan_drift_check 枚举、plan_drift_count 非负、plan_drift_differences NOT NULL 且为 JSON array 且长度=plan_drift_count、exit_code=0）
- [ ] `release_sync_run` V5.2: Dry Run completed 强制 p_plan_artifact_hash NOT NULL（通过 v_mode 判断）
- [ ] `release_sync_run` 校验 failed 必需字段（error_message、exit_code IN (1,2)）
- [ ] `release_sync_run` 支持 p_plan_artifact_hash 回填
- [ ] `release_sync_run` 仅在 locked_by = p_run_id 时清锁
- [ ] `heartbeat_sync_run` 校验 lease_duration NOT NULL 且 ∈ [30, 900]
- [ ] `cleanup_expired_sync_runs` **统一锁顺序**：按 warehouse_id 排序遍历 → pg_advisory_xact_lock → SELECT FOR UPDATE → CTE + 清锁
- [ ] `cleanup_expired_sync_runs` 设置 exit_code=2，返回标记 failed 的运行数（非锁行数）
- [ ] `cleanup_expired_sync_runs` 仅在 locked_by = expired.id 时清锁
- [ ] `get_sync_runs()` / `get_sync_run_detail()` 按 Admin/Operator 正确脱敏
- [ ] `get_sync_runs()` 直接读取 `public.sync_run`（不通过 VIEW），所有对象引用使用完全限定名称 `public.xxx`
- [ ] `get_sync_runs()` p_limit 范围 [1, 100]
- [ ] `authenticated` 对 `sync_run` 表直接 SELECT 被拒绝
- [ ] `authenticated` 无任何 VIEW 可 SELECT sync_run 数据
- [ ] 所有 SECURITY DEFINER RPC 有完整 REVOKE/GRANT，search_path = ''
- [ ] 全部 11 个 CHECK 约束正确：`sync_run_time_check` + `real_write_requires_dry_run` + `real_write_requires_artifacts` + `dry_run_requires_input_artifact` + `completed_requires_fields`（含 plan_drift_count + plan_drift_differences + exit_code + finished_at）+ `plan_drift_check_enum` + `plan_drift_count_non_negative` + `failed_requires_fields`（exit_code IN (1,2)）+ `completed_exit_code_zero` + `plan_drift_differences_length` + `completed_dry_run_requires_plan_artifact`
- [ ] `idx_sync_run_one_in_progress` 部分唯一索引正确
- [ ] `sync_warehouse_lock` trigger 和补建 INSERT 正确
- [ ] 索引覆盖常用查询路径
- [ ] **V5.2:** `completed_exit_code_zero` CHECK 正确（status='completed' → exit_code=0）
- [ ] **V5.2:** `failed_requires_fields` CHECK exit_code 从 NOT NULL 强化为 IN (1,2)
- [ ] **V5.2:** `plan_drift_differences_length` CHECK 正确（jsonb_array_length = plan_drift_count）
- [ ] **V5.2:** `release_sync_run` 校验 completed exit_code=0，failed exit_code IN (1,2)
- [ ] **V5.2:** `release_sync_run` 校验 plan_drift_differences 为 JSON array 且长度 = plan_drift_count
- [ ] **V5.2:** `release_sync_run` Dry Run completed 强制 p_plan_artifact_hash NOT NULL（通过 v_mode）
- [ ] **V5.3:** `completed_dry_run_requires_plan_artifact` CHECK 正确（status='completed' AND mode='dry_run' → input_artifact_hash IS NOT NULL AND plan_artifact_hash IS NOT NULL）
- [ ] **V5.3:** 真实 PostgreSQL 约束测试：尝试 INSERT completed Dry Run 无 plan_artifact_hash → CHECK 拒绝
- [ ] **V5.3:** 真实 PostgreSQL 约束测试：尝试 UPDATE 将 completed Dry Run 的 plan_artifact_hash 设为 NULL → CHECK 拒绝

**停止条件**：Migration 文件创建完成，静态审查通过。禁止执行 Migration。

---

#### P5-SY5B — 认证链修复

**产出**：
- `src/lib/auth.ts` 新增 `getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()`

**验收标准**：
- [ ] `getCurrentActiveUser()` 查询 `profiles.is_active`，停用用户返回 null
- [ ] `requireActiveAdmin()` 校验：登录 → admin 角色 → `profiles.is_active = true`
- [ ] `requireActiveAuth()` 校验：登录 → `profiles.is_active = true`
- [ ] 停用用户调用时抛出中文错误 "未登录或账号已停用"
- [ ] 现有 `getCurrentUser()` / `requireAuth()` / `requireAdmin()` 签名和行为不变
- [ ] TypeScript strict，无 `any`

**停止条件**：`auth.ts` 修改完成，编译通过。禁止修改现有 Server Action 的认证调用（留待各模块自行迁移）。

---

#### P5-SY5C — Sync Feature Module 骨架（V5.3 修订）

**产出**：
- `src/features/sync/types.ts` — `SyncRunSummary`, `SyncRunDetail`, `SyncExecuteParams`, `SyncExecuteResult`, `SyncRunnerCapabilities`, `ActionResult`, `Artifact`, `ArtifactType`, `PreparedArtifact`, `ArtifactCandidate`
- `src/features/sync/schema.ts` — Zod schema：`triggerDryRunParams`, `realWriteParams`, `getSyncRunsParams`
- `src/features/sync/repository.ts` — `getRuns()`, `getRunById()`, `claimRun()`, `releaseRun()`, `heartbeatRun()`, `cleanupExpiredRuns()`, `getLatestCompletedDryRun()`, `getLogs()`, `getActiveRunIds()`, `getRecentlyCompletedRunIds(since)`, `getReferencedDryRunIds()`
- `src/features/sync/artifact-provider.ts` — `ArtifactProvider` 接口（含 `prepare()` / `store(PreparedArtifact)` / `get()` / `verify()` / `delete()` / `listCandidates()` / `deleteMany()`）+ `MockArtifactProvider`
- `src/features/sync/actions.ts` — `getSyncRuns()`, `getSyncStatus()`, `triggerDryRun()`, `triggerRealWrite()`, `getSyncRunDetail()`
- `src/features/sync/sync-runner.ts` — `SyncRunner` 接口（含 `inputArtifact`/`boundPlanArtifact` 参数）+ `MockSyncRunner`
- `src/features/sync/sync-service.ts` — `executeDryRun()`, `executeRealWrite()`, `sanitizeForClient()`, GC orchestrator（`runGarbageCollection()`）

**验收标准**：
- [ ] 所有 Server Action 使用 `requireActiveAuth()`（查询类）或 `requireActiveAdmin()`（触发类）
- [ ] 客户端参数经 Zod 校验，禁止接收文件路径
- [ ] Repository 封装所有 Supabase RPC 调用（含 `claim_sync_run`、`release_sync_run`、`get_sync_runs`、`get_sync_run_detail`）
- [ ] Repository 新增 GC 辅助查询：`getActiveRunIds()`、`getRecentlyCompletedRunIds(since)`、`getReferencedDryRunIds()`（V5.4.1 恢复 `getRecentlyCompletedRunIds`——保护 finished_at 在 60 分钟内的 completed Dry Run，覆盖"artifact > 7 天但 Dry Run 刚完成"边界场景）
- [ ] Repository 不解析文件系统路径；artifact 存取通过 ArtifactProvider
- [ ] `ArtifactProvider` 接口含 `prepare()`（唯一序列化点）/ `store(PreparedArtifact)` / `get()` / `verify()` / `delete()` / `listCandidates()` / `deleteMany()` 方法
- [ ] `prepare(content)` 返回 `{ bytes: Uint8Array, hash: string, normalizedContent: JsonValue }`——全系统唯一调用 `JSON.stringify` 的位置；内部流程：validateJsonValue → stringify → SHA-256 → JSON.parse
- [ ] `validateJsonValue(content)` 在 `prepare()` 第一步执行：拒绝 undefined/function/Symbol/BigInt、NaN/Infinity、toJSON、自定义原型、嵌套 undefined 属性值；V5.4.2 增强：WeakSet 循环引用检测、Reflect.ownKeys Symbol 键拒绝、稀疏数组拒绝、数组额外属性拒绝、accessor/getter 拒绝；禁止 any；递归检查数组和对象
- [ ] `store(runId, type, prepared)` 不接受裸 content，仅接受 `PreparedArtifact`；内部验证 SHA-256(bytes) === hash
- [ ] `listCandidates(olderThan)` 返回纯存储层元数据，不查询 sync_run
- [ ] `deleteMany()` 幂等：不存在的 artifact 静默跳过
- [ ] `MockArtifactProvider` 内存存储，用于测试
- [ ] `SyncRunner.execute()` 接受 `inputArtifact` / `boundPlanArtifact` 参数
- [ ] `SyncService` 通过 `prepare()` 唯一序列化后 claim + store；在 release 前存储 plan artifact 并通过 `releaseRun()` 回填 `plan_artifact_hash`
- [ ] `SyncService` GC orchestrator：`listCandidates()` → 从 Repository 获取受保护 runId → 过滤 → `deleteMany()`
- [ ] `sanitizeForClient()` 按 Admin/Operator 正确脱敏
- [ ] `MockSyncRunner` 返回预定义结果（成功 Dry Run / 成功 Real Write / 失败三种）
- [ ] 不包含 `cancelSync` Action
- [ ] TypeScript strict，无 `any`

**停止条件**：编译通过，不包含真实 Runner 实现，不连接 Supabase（测试使用 Mock Repository + Mock ArtifactProvider）。

---

#### P5-SY5D — Sync 页面与客户端组件

**产出**：
- `src/app/dashboard/sync/page.tsx` — Server Component，使用 `requireActiveAuth()`，调用 `getSyncStatus()` 获取初始数据
- `src/app/dashboard/sync/_components/sync-page-content.tsx` — Client Component
- `src/app/dashboard/sync/_components/sync-status-cards.tsx` — 三张状态卡片
- `src/app/dashboard/sync/_components/sync-trigger-buttons.tsx` — Dry Run + 真实写入按钮（Admin 可见）
- `src/app/dashboard/sync/_components/real-write-dialog.tsx` — 二次确认 Dialog（显示绑定的 Dry Run 信息）
- `src/app/dashboard/sync/_components/sync-history-table.tsx` — 运行历史表格
- `src/app/dashboard/sync/_components/sync-detail-dialog.tsx` — 详情 Dialog（调用 `getSyncRunDetail()`，Admin/Operator 已由 RPC 区分）
- `src/app/dashboard/sync/loading.tsx` + `error.tsx`

**验收标准**：
- [ ] 页面 Server Component 使用 `requireActiveAuth()`
- [ ] 状态卡片正确展示最近同步、当前状态、上次结果
- [ ] Dry Run 按钮始终可用（Admin），真实写入按钮始终 `disabled`（含 tooltip 原因）
- [ ] 二次确认 Dialog：令牌输入 + checkbox + 禁用逻辑完整
- [ ] 运行历史表格通过 `getSyncRuns()` 获取数据
- [ ] 详情 Dialog 通过 `getSyncRunDetail()` 获取数据（Admin/Operator 区分由 RPC 完成）
- [ ] 不展示 artifact hashes、fallbackPath、服务端路径、凭据、原始堆栈
- [ ] 不展示取消按钮
- [ ] Dry Run 模式为默认操作
- [ ] 空数据、加载、错误状态处理
- [ ] 移动端响应式（≥1024px）

**停止条件**：编译通过，页面可通过 `npm run dev` 访问，Mock 数据正确展示。禁止执行真实同步。

---

#### P5-SY5E — 侧边栏集成

**产出**：
- `src/app/dashboard/_components/sidebar-nav.tsx` 新增"同步管理"导航项

**验收标准**：
- [ ] 标签"同步管理"，图标 `RefreshCw`
- [ ] Admin 与 Operator 均可见（非 admin-only）
- [ ] phase='5'（实施时改为 '0'）
- [ ] 当前路由高亮正确

**停止条件**：侧边栏修改完成，编译通过。

---

#### P5-SY5F — MockSyncRunner 端到端验证（V5.2 扩展）

**产出**：
- 测试文件 `src/features/sync/__tests__/sync-e2e.test.ts`

**验收标准**：
- [ ] MockSyncRunner 注入 + MockArtifactProvider + Mock Repository
- [ ] **V5 保留: 五个核心场景**：Dry Run 成功（含 plan_artifact_hash 回填）、Real Write 成功（含 artifact 绑定）、Real Write 失败、Dry Run 漂移检测、Dry Run 过期拒绝
- [ ] 完整调用链验证：Server Action → SyncService → 预生成 runId → 序列化 bytes → SHA-256 → claimRPC → (claim 成功后) ArtifactProvider.store → MockSyncRunner → ArtifactProvider.store(plan) → releaseRPC(含 plan_artifact_hash, exit_code=0) → sanitizeForClient
- [ ] Artifact 不可变绑定验证：input_artifact_hash 校验 + plan_artifact_hash 校验（均对存储字节重算 SHA-256）
- [ ] 脱敏验证：Operator 请求不返回技术详情/exitCode/差异列表
- [ ] 脱敏验证：Admin 请求不返回 artifact hashes/fallbackPath/服务端路径/凭据
- [ ] 真实写入绑定验证：dryRunRunId 无效/无 plan_artifact_hash/hash 不匹配/缺失 completed 必需字段时拒绝
- [ ] Dry Run 过期（>60 分钟）时拒绝真实写入
- [ ] 计划漂移时拒绝真实写入
- [ ] **V5.2 新增: claim 返回 NULL 不产生 artifact**：Mock claimRPC 返回 NULL → 验证 ArtifactProvider.store 未被调用 → 验证 ArtifactProvider.delete 未被调用（无 artifact 可清理）
- [ ] **V5.2 新增: claim 成功但 input artifact store 失败**：Mock ArtifactProvider.store('input') 抛出 → 验证 release_sync_run(runId, 'failed', exit_code=1) 被调用 → 验证 ArtifactProvider.delete(runId, 'input') 被调用
- [ ] **V5.2 新增: plan artifact store 成功但 release_sync_run 失败**：Mock releaseRPC 抛出 → 验证 ArtifactProvider.delete(runId, 'plan') 被调用清理
- [ ] **V5.2 新增: input artifact store 后 hash 不一致**：Mock ArtifactProvider.store 返回与 input_artifact_hash 不同的 hash → 验证 release_sync_run(runId, 'failed') + delete(runId, 'input') 被调用
- [ ] **V5.2 新增: ArtifactProvider.get() 内部 hash 校验失败**：存储字节被篡改 → SHA-256 与存储 hash 不匹配 → get() 抛出 → 验证异常传播正确
- [ ] **V5.3 修订: ArtifactProvider.delete() 幂等**：对不存在的 artifact 调用 delete → 静默成功不抛异常
- [ ] **V5.4.1 修订: GC 所有权**：`ArtifactProvider.listCandidates(olderThan)` 返回纯存储层候选（`olderThan` 由 GC orchestrator 固定为 `now() - 7 days`，禁止 `max()`）→ GC orchestrator 从 Repository 获取受保护 runId（`getActiveRunIds` + `getRecentlyCompletedRunIds(now-60min)` + `getReferencedDryRunIds`）→ 过滤 → `ArtifactProvider.deleteMany()` → 验证仅删除孤儿（非 in_progress、非 recently completed、非被 Real Write 引用）
- [ ] **V5.3 新增: GC 不误删 in_progress artifact**：sync_run 为 in_progress → GC → artifact 保留
- [ ] **V5.3 新增: GC 不误删被引用的 Dry Run**：completed Dry Run 被 Real Write 的 dry_run_run_id 引用 → GC → input+plan artifact 保留
- [ ] **V5.4.1 修订: GC 不误删审计保留期内的 artifact**：artifact createdAt < 7 天 → GC cutoff = now() - 7 天 → listCandidates 不返回此 artifact → 保留
- [ ] **V5.4.1 新增: GC 不误删 artifact > 7 天但 Dry Run 刚完成**：artifact createdAt > 7 天前（进入候选列表），但 sync_run.finished_at 在 60 分钟内 → `getRecentlyCompletedRunIds(now-60min)` 保护 → GC 不删除
- [ ] **V5.4.1 新增: GC 不依赖 artifact.createdAt 推导 sync_run.finished_at**：验证 GC orchestrator 分别查询 artifact 时间（listCandidates）和 sync_run 状态（Repository），不使用 createdAt 推断 finished_at
- [ ] **V5.4 新增: GC orchestrator 拒绝过短的 cutoff**：`olderThan > now() - 7 days` → GC orchestrator 抛出错误，拒绝执行
- [ ] **V5.4.1 新增: GC 双层保护验证**：第一层（cutoff 7 天）仅按存储年龄过滤；第二层（getRecentlyCompletedRunIds）保护绑定窗口内的 completed Dry Run。验证两层均正确执行，任一层的保护均能阻止误删
- [ ] **V5.3 新增: prepare() 唯一序列化**：`prepare(content)` → `{ bytes, hash }` → `store(runId, 'input', prepared)` → `get(runId, 'input')` → SHA-256(get 返回的存储字节) === hash → 验证全链路使用同一份 bytes
- [ ] **V5.3 新增: 禁止 store 接受裸 content**：Mock ArtifactProvider.store() 不接受 `content: object`，仅接受 `PreparedArtifact { bytes, hash }`——TypeScript 编译时强制
- [ ] **V5.3 新增: store 验证 hash 一致性**：传入 bytes + 错误 hash → store 抛出（SHA-256(bytes) !== hash）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝 NaN**：`prepare({ value: NaN })` → validateJsonValue 在第 1 步抛出（"number 必须为有限值，收到 NaN"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝 Infinity**：`prepare({ value: Infinity })` → validateJsonValue 抛出（"收到 Infinity"）；`-Infinity` 同理
- [ ] **V5.4.1 新增: validateJsonValue 拒绝嵌套 undefined**：`prepare({ a: { b: undefined } })` → validateJsonValue 抛出（"对象属性值不允许为 undefined: root.a.b"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝 toJSON**：`prepare({ toJSON() { return {}; }, data: 1 })` → validateJsonValue 抛出（"不允许携带 toJSON 方法"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝自定义原型**：`class Custom { x = 1; }` → `prepare(new Custom())` → validateJsonValue 抛出（"不允许自定义原型对象: root (prototype: Custom)"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝函数值**：`prepare({ fn() {} })` → validateJsonValue 抛出（"不允许函数: root.fn"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝 Symbol 值**：`prepare({ key: Symbol('test') })` → validateJsonValue 抛出（"不允许 Symbol: root.key"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝 BigInt 值**：`prepare({ count: 1n })` → validateJsonValue 抛出（"不允许 BigInt: root.count"）
- [ ] **V5.4.1 新增: validateJsonValue 拒绝数组中的非法值**：`prepare([1, undefined, 2])` → validateJsonValue 抛出（"不允许 undefined: root[1]"）
- [ ] **V5.4.1 新增: validateJsonValue 接受合法 JsonValue**：`prepare({ str: "a", num: 1, bool: true, nil: null, arr: [1,2], obj: {k:"v"} })` → validateJsonValue 通过 → stringify → SHA-256 → JSON.parse → round-trip 一致
- [ ] **V5.4.1 新增: validateJsonValue 接受 null**：`prepare(null)` → validateJsonValue 通过 → stringify("null") → 正常
- [ ] **V5.4.2 新增: validateJsonValue 拒绝 Symbol 键（对象）**：`const obj = { [Symbol('key')]: 'value', valid: 1 }; prepare(obj)` → validateJsonValue 抛出（"对象不允许 Symbol 键 (Symbol(key)): root"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝 Symbol 键（数组）**：`const arr = Object.assign([1, 2], { [Symbol('extra')]: 'x' }); prepare(arr)` → validateJsonValue 抛出（"数组不允许 Symbol 键 (Symbol(extra)): root"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝循环引用（对象）**：`const obj: Record<string, unknown> = { a: 1 }; obj.self = obj; prepare(obj)` → validateJsonValue 抛出（"不允许循环引用: root.self"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝循环引用（数组）**：`const arr: unknown[] = []; arr.push(arr); prepare(arr)` → validateJsonValue 抛出（"不允许循环引用: root[0]"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝稀疏数组**：`const arr = [1]; arr[3] = 3; prepare(arr)` → validateJsonValue 抛出（"不允许稀疏数组（索引 1 为空洞）: root"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝数组额外属性**：`const arr = Object.assign([1, 2], { extra: 'value' }); prepare(arr)` → validateJsonValue 抛出（"数组不允许额外属性 (extra): root"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝 getter 属性（对象）**：`const obj = {}; Object.defineProperty(obj, 'computed', { get() { return 1; } }); prepare(obj)` → validateJsonValue 抛出（"对象不允许 getter/setter 属性 (computed): root"）
- [ ] **V5.4.2 新增: validateJsonValue 拒绝 getter 属性（数组）**：`const arr = [1, 2]; Object.defineProperty(arr, 1, { get() { return Math.random(); } }); prepare(arr)` → validateJsonValue 抛出（"数组不允许 getter/setter 属性（索引 1）: root"）
- [ ] **V5.4.3 新增: validateJsonValue 拒绝非规范数组索引 "01"**：`const arr = Object.assign([1, 2], { '01': 'value' }); prepare(arr)` → validateJsonValue 抛出（"数组不允许非规范索引属性 (01): root"）——String(1) !== "01"，拒绝带有前导零的伪数字属性
- [ ] **V5.4.3 新增: validateJsonValue 拒绝非规范数组索引 "4294967295"**：`const arr = Object.assign([1, 2], { '4294967295': 'x' }); prepare(arr)` → validateJsonValue 抛出（"数组不允许非规范索引属性 (4294967295): root"）——索引远超数组长度且可能溢出
- [ ] **V5.4.3 新增: validateJsonValue 拒绝对象不可枚举属性**：`const obj = {}; Object.defineProperty(obj, 'hidden', { value: 1, enumerable: false }); obj.visible = 2; prepare(obj)` → validateJsonValue 抛出（"对象不允许不可枚举属性 (hidden): root"）
- [ ] **V5.4.3 新增: validateJsonValue 拒绝 Array 子类**：`class MyArray extends Array { } prepare(new MyArray(1, 2))` → validateJsonValue 抛出（"不允许 Array 子类或自定义原型数组: root"）——Object.getPrototypeOf !== Array.prototype
- [ ] **V5.4.3 新增: validateJsonValue 拒绝数组自身 toJSON**：`const arr = Object.assign([1, 2], { toJSON() { return []; } }); prepare(arr)` → validateJsonValue 抛出（"数组不允许携带 toJSON 方法: root"）
- [ ] **V5.4.3 新增: validateJsonValue 拒绝数组继承 toJSON**：通过 `class MyArray extends Array { toJSON() { return []; } }` 验证——该子类同时触发 Array 子类拒绝（`Object.getPrototypeOf !== Array.prototype`），`'toJSON' in value` 检查也覆盖继承链；单独标准数组 `Object.defineProperty(arr, 'toJSON', { value: function() {}, enumerable: true })` → validateJsonValue 抛出（"数组不允许携带 toJSON 方法: root"）——enumerable own toJSON 被 `'toJSON' in value` 检测（`in` 操作符覆盖自身和继承链）
- [ ] **V5.4.3 新增: validateJsonValue 共享对象引用通过**：`const shared = { a: 1 }; const obj = { x: shared, y: shared }; prepare(obj)` → validateJsonValue 通过 → stringify → round-trip 一致（shared 第一次访问后通过 `finally { seen.delete(shared) }` 从 WeakSet 移除；第二次访问重新添加并正常验证——共享引用非循环引用，祖先链正确维护）
- [ ] **V5.4.3 新增: validateJsonValue 真正循环引用拒绝（祖先链验证）**：与 V5.4.2 循环引用测试互补——验证 WeakSet 祖先链行为：`const child: Record<string, unknown> = {}; const parent = { child }; child.parent = parent; prepare(parent)` → validateJsonValue 在 `parent → child → parent` 时抛出（parent 仍在 WeakSet 祖先链中），确认循环检测仅拒绝真正循环而非共享引用
- [ ] **V5.3 新增: 非确定性序列化安全**：verify 使用存储字节而非重新序列化 → hash 一致（verify 不重新 JSON.stringify；validateJsonValue 已在源头拒绝 toJSON）
- [ ] **V5.2 新增: completed exit_code 验证**：release_sync_run with status='completed' + exit_code=1 → 验证 RPC 拒绝
- [ ] **V5.2 新增: failed exit_code 验证**：release_sync_run with status='failed' + exit_code=0 → 验证 RPC 拒绝；exit_code=3 → 验证 RPC 拒绝
- [ ] **V5.2 新增: plan_drift_differences 长度验证**：plan_drift_count=3 但 plan_drift_differences=['a'] → 验证 RPC 拒绝
- [ ] 不连接 Supabase（Mock Repository + Mock RPC）

**停止条件**：全部测试通过。禁止执行真实同步。

---

#### P5-SY5G — 并发锁原子 claim 测试（V5 强化）

**产出**：
- 测试文件 `src/features/sync/__tests__/concurrency.test.ts`

**验收标准**（核心变更：**必须真实 PostgreSQL 双事务并发测试，Mock 不算通过**）：
- [ ] 连接真实 Supabase 测试数据库（非生产）
- [ ] 双事务并发 claim：事务 A claim PH → 成功返回 run_id；事务 B（在 A 提交前）claim PH → 阻塞等待，A 提交后 B 发现 in_progress → 返回 NULL
- [ ] 租约过期清理：事务 A claim → 不 release → 等待 lease 过期 → cleanup 标记 A failed + 释放匹配锁行 → 事务 B claim 成功
- [ ] 租约未过期时 cleanup 不误伤：事务 A claim → cleanup 立即执行 → A 不受影响（lease 未过期）
- [ ] heartbeat 续期：事务 A claim → heartbeat 续期 → lease_expires_at 刷新 → 验证续期后时间 > 原始过期时间
- [ ] release 释放：事务 A claim → release_sync_run(completed, ...) → 锁行 locked_by = NULL → 事务 B claim 成功
- [ ] 部分唯一索引兜底：验证 `idx_sync_run_one_in_progress` 阻止同一 warehouse 两条 in_progress 记录的 INSERT
- [ ] **V5 新增: claim-vs-release 死锁验证**：事务 R (release A) 持有 advisory lock → 事务 N (new claim) 阻塞等待 advisory lock → R 提交释放 → N 获取锁成功 → 无 deadlock ✓
- [ ] **V5 新增: claim-vs-cleanup 死锁验证**：cleanup 持有 advisory lock → 新 claim 阻塞等待 → cleanup 提交 → claim 获取锁成功 → 无 deadlock ✓
- [ ] **V5 保留: lease_duration 边界测试**：NULL 拒绝、29 拒绝、30 接受、300 接受、900 接受、901 拒绝
- [ ] **V5.4.1 修订: Real Write claim 原子验证 dry_run_run_id**：验证在 pg_advisory_xact_lock + FOR UPDATE 之后、INSERT 之前执行。Dry Run warehouse 不匹配 → RAISE EXCEPTION；Dry Run mode 非 dry_run → 拒绝；Dry Run status 非 completed → 拒绝；Dry Run plan_drift_check 非 PASS → 拒绝；Dry Run finished_at > 60 分钟 → 拒绝；input_artifact_hash 不匹配 → 拒绝；plan_artifact_hash 不匹配 → 拒绝
- [ ] **V5.4.1 新增: 验证执行顺序测试**：确认 dry_run_run_id 的 PERFORM 查询在 pg_advisory_xact_lock 获取之后、in_progress 检查之前执行。通过日志或调试输出验证 SQL 执行顺序
- [ ] **V5.4.1 修订: TOCTOU 边界测试**：事务 A 持有 advisory lock + FOR UPDATE → 事务 B 尝试修改 Dry Run（release/cleanup）→ B 被 advisory lock 阻塞 → A 的 dry_run_run_id 验证在锁保护区内 → 验证通过后立即 INSERT → 提交 → B 恢复但 Dry Run 已是 completed 终态。验证无 TOCTOU 窗口
- [ ] **V5.4 新增: 时钟边界测试**：finished_at = now() - 59 分 59 秒 → claim 成功；finished_at = now() - 60 分 0 秒 → claim 拒绝（INTERVAL '60 minutes' 边界）
- [ ] **V5.4.1 新增: GC vs claim 临界交叠测试**：Dry Run finished_at 超过 60 分钟但 artifact < 7 天 → claim_sync_run 拒绝（过期）但 GC 保留 artifact（未到审计保留期）；Dry Run finished_at 超过 60 分钟且 artifact > 7 天且未被任何 Real Write 引用 → GC 删除 artifact
- [ ] **V5.4.1 新增: artifact > 7 天但 Dry Run 刚完成的边界**：artifact createdAt > 7 天前（进入 GC 候选），但 sync_run.finished_at 在 60 分钟内 → GC 候选包含此 artifact → getRecentlyCompletedRunIds 保护 → 不删除 → 新 Real Write claim 此 Dry Run 成功（finished_at 在 60 分钟内）
- [ ] **V5.4 新增: GC 与 claim 并发安全**：GC 正在删除 artifact 的同时，新 Real Write 尝试 claim 同一 Dry Run → claim_sync_run 原子验证 finished_at > 60 分钟 → 拒绝（artifact 即使未被 GC 删除，Dry Run 也已过期）；GC 不会删除被 Real Write 引用的 Dry Run artifact（dry_run_run_id 保护）
- [ ] 测试覆盖完整流程：claim → heartbeat → cleanup（无过期）→ release → 重新 claim
- [ ] 测试报告包含实际执行的 SQL 和返回结果
- [ ] 验证 release 的 advisory lock 获取正确（key = `hashtext('sync_run:' || warehouse_id)`）
- [ ] 验证 cleanup 按 warehouse_id 排序获取 advisory lock

**停止条件**：全部并发测试通过。需要本地或 CI 可访问的 Supabase 测试数据库（已执行 Migration 00007）。禁止使用生产数据库。

---

## 14. 设计决策记录

### D1: 运行环境解耦
**决策**：定义 SyncRunner 接口，P5-SY5 使用 Mock 实现，具体运行环境留待 P5-SY6。
**原因**：避免过早绑定 child_process（可能改用 Vercel Cron + 外部队列），降低返工成本。
**V3 变更**：接口增加 `inputArtifact` / `boundPlanArtifact` 参数，artifact 解析从 Runner 移至 SyncService。

### D2: 并发控制使用三层防御 + 真正统一锁获取顺序（V5 强化）
**决策**：`pg_advisory_xact_lock`（第一层）+ `sync_warehouse_lock` SELECT FOR UPDATE（第二层）+ 部分唯一索引（第三层）。**claim / release / cleanup 全部严格按 advisory → lock row → sync_run 的顺序**。
**原因（V5 补充）**：
- V4 仅 claim 使用 advisory lock；release 和 cleanup 未使用，导致 cleanup 与新 claim 存在理论上交错风险
- V5 将 advisory lock 推至 release 和 cleanup，彻底消除交错窗口
- cleanup 按 `ORDER BY warehouse_id` 确定顺序获取 advisory lock，与 claim/release 的单仓库获取一致，无死锁
- lease_duration 范围 [30, 900] 防止极端值导致租约过短（频繁超时）或过长（僵尸长期占用）

### D3: sync_run 与 sync_log 分离
**决策**：`sync_run` 记录所有运行（Dry Run + Real Write），`sync_log` 仅记录已尝试真实写入的 success/failed。
**原因**：`sync_log` 原始职责是记录"真实写入结果"，不应承载 Dry Run 和锁。分离后各表职责清晰。

### D4: 客户端参数净化
**决策**：客户端仅提交 `warehouseId`、`mode`、`dryRunRunId`、`confirmToken`；服务端通过 artifact provider 解析数据。
**原因**：禁止客户端路径注入，路径遍历风险不可接受。

### D5: 确认令牌与 CLI 一致
**决策**：Web 端真实写入使用与 CLI 相同的确认令牌 `P5-SY3B-PH`。
**原因**：统一安全门机制，降低认知成本和维护负担。

### D6: 默认 Dry Run + 不可变 Artifact 绑定（V4 强化）
**决策**：真实写入必须引用有效、无漂移、未过期的 completed Dry Run（含完整字段），且通过 artifact hash 校验完整性。
**原因（V4 补充）**：
- V3 未明确 completed Dry Run 必须具有 `plan_artifact_hash`
- V4 明确 completed Dry Run 的 8 个必需字段，由 `completed_requires_fields` CHECK 约束和 `release_sync_run` RPC 校验双重保障
- `plan_artifact_hash` 通过 `release_sync_run` 的 `p_plan_artifact_hash` 参数回填

### D7: cancelSync 推迟到 P5-SY6
**决策**：P5-SY5 页面和接口不提供取消功能。
**原因**：取消依赖 Sync Runner 的 `AbortSignal` 支持，P5-SY6 评估运行环境后才能确定是否可行。

### D8: is_active 认证闭环
**决策**：P5-SY5B 新增 `getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()`，校验 `profiles.is_active`。
**原因**：保留原有函数不变，新增独立 active 函数一次查询获取 role + is_active。Sync 模块全部使用 Active 系列。

### D9: 数据访问仅通过 SECURITY DEFINER RPC，无 VIEW（V4 修正）
**决策**：`authenticated` 不得直接 SELECT `sync_run` 表或任何 VIEW。所有用户查询通过 `get_sync_runs()` / `get_sync_run_detail()` SECURITY DEFINER RPC。RPC 内部直接读取 `public.sync_run` 并按角色构造安全返回值。
**原因（V4 修正）**：
- V3 仍允许 authenticated SELECT `sync_run_summary` VIEW，存在 VIEW 字段与 RPC 引用不一致的风险（`get_sync_runs` 引用了 VIEW 不存在的字段如 `variants_created`）
- V4 撤回 authenticated 对 VIEW 的访问权限，仅保留两个查询 RPC 作为唯一用户入口
- RPC 内部使用完全限定名称（`public.sync_run`、`public.get_user_role()`），确保 `search_path = ''` 下正确解析
- 漏洞面最小：只有两个 RPC 暴露给 authenticated

### D10: 删除 confirm_token_hash（V3，确认）
**决策**：`sync_run` 表不存储 `confirm_token_hash`。
**原因**：令牌 `P5-SY3B-PH` 为固定值，SHA-256 hash 始终相同，不提供审计价值。

### D11: release_sync_run 独立 RPC + 回填 plan_artifact_hash（V4 强化）
**决策**：`release_sync_run()` 负责状态转换、锁行释放（含 locked_by 匹配）和 plan_artifact_hash 回填。
**原因（V4 补充）**：
- V3 中 Dry Run 的 `plan_artifact_hash` 在 release 时设置但未通过 RPC 参数传入
- V4 新增 `p_plan_artifact_hash` 参数，SyncService 在 Runner 输出计划后存储 artifact 并通过 release RPC 回填
- locked_by 匹配条件防止 cleanup 与 release 交错时误清

### D12: 删除 pending 状态（V4 新增）
**决策**：`status` CHECK 从 4 值（pending, in_progress, completed, failed）缩减为 3 值（in_progress, completed, failed）。
**原因**：pending 无实际创建入口（`claim_sync_run` 直接创建 in_progress），保留未使用状态会导致状态机不明确和实现歧义。

### D13: lease_duration 范围校验（V4 新增）
**决策**：`claim_sync_run` 和 `heartbeat_sync_run` 均要求 `p_lease_duration IS NOT NULL` 且 ∈ [30, 900] 秒。
**原因**：NULL 或过小值（<30s）可能导致租约在心跳间隔内过期；过大值（>900s=15min）导致僵尸长期占用锁。统一范围保证运行安全。

### D14: P5-SY5G 必须真实 PostgreSQL 并发测试（V3，V5 扩展）
**决策**：并发锁测试必须连接真实 PostgreSQL 数据库执行双事务并发，Mock 不算通过。V5 新增 claim-vs-release、claim-vs-cleanup deadlock 验证（要求无 deadlock）。
**原因**：advisory lock、FOR UPDATE 锁行、部分唯一索引的行为只能在真实 PostgreSQL 事务隔离级别下验证。V5 统一锁顺序后，需验证 release/cleanup 的 advisory lock 获取不会与 claim 产生死锁。

### D15: runId 预生成与 artifact 生命周期（V5 新增，V5.3 修订）
**决策（V5.3 修订）**：SyncService 预生成 UUID → `ArtifactProvider.prepare(content)` 唯一序列化 → `claim_sync_run(p_run_id, prepared.hash)` → claim 成功后才 `ArtifactProvider.store(runId, 'input', prepared)`。claim、store、verify 全部使用同一份 bytes。
**原因（V5.3 补充）**：V5.2 中 SyncService 自行序列化算 hash 用于 claim，然后传 content 给 store 再次序列化——两次 JSON.stringify 可能产生不同 bytes。V5.3 引入 prepare() 单一序列化点，bytes 和 hash 绑定传递，彻底消除 hash 分离风险。

### D16: artifact hash 基于存储字节（V5 新增，V5.3 修订）
**决策（V5.3 修订）**：hash = SHA-256（由 `prepare()` 序列化产生的 UTF-8 bytes）。全系统仅 `prepare()` 调用 `JSON.stringify`；`store()` 接收 prepared bytes 并验证 SHA-256(bytes) === hash；verify 对存储字节重算 SHA-256。**禁止自创 canonical JSON**。
**原因（V5.3 补充）**：V5.2 规定 SHA-256 on stored bytes 但未强制单一序列化点，SyncService 和 store 内部分别 JSON.stringify 仍可能产生不同 bytes。V5.3 的 prepare() 确保 bytes 和 hash 来自同一次序列化，不可分离。

### D17: cleanup 返回标记 failed 运行数（V5 新增）
**决策**：`cleanup_expired_sync_runs()` 返回标记为 failed 的 sync_run 行数（非仅清除的锁行数），并设置明确的 exit_code=2。
**原因**：V4 中 cleanup 返回 `GET DIAGNOSTICS v_count = ROW_COUNT` 实际返回的是受影响锁行数，无法区分"清理了 0 个运行"与"有运行但锁行未匹配"。V5 在循环中累积 v_failed_count。

### D18: 严格前向 Migration（V5 新增）
**决策**：P5-SY5A Migration 00007 使用严格前向 Migration —— `CREATE TABLE` 不用 `IF NOT EXISTS`（冲突时 fail loud）；`ALTER TABLE ADD COLUMN` 不用 `IF NOT EXISTS`；仅函数使用 `CREATE OR REPLACE FUNCTION`。
**原因**：`IF NOT EXISTS` 掩盖结构冲突（表已存在但 schema 不同），导致 Migration 表面上成功但实际上未应用变更。Fail loud 强制 DBA 调查冲突原因。

### D19: ArtifactProvider delete/GC 契约（V5.2 新增，V5.3 修订）
**决策（V5.3 修订）**：`ArtifactProvider` 接口含 `delete()`（幂等）+ `listCandidates(olderThan)` + `deleteMany()`。ArtifactProvider **不自行查询 sync_run**——GC 决策由 SyncService orchestrator 完成：`listCandidates()` → 从 Repository 获取受保护 runId → 过滤 → `deleteMany()`。
**原因（V5.3 补充）**：V5.2 的 `gc(olderThan)` 在 ArtifactProvider 内部判断"孤儿"，意味着 Provider 需要查询 sync_run 表——跨层违规。V5.3 将 GC 拆分为存储层原语（listCandidates/deleteMany）和业务决策层（GC orchestrator），Provider 保持纯存储抽象，不感知 sync_run schema。

### D20: completed exit_code=0 / failed exit_code∈{1,2}（V5.2 新增）
**决策**：新增 `completed_exit_code_zero` CHECK（status='completed' → exit_code=0）和 `failed_exit_code_range` CHECK（status='failed' → exit_code IN (1,2)）。release_sync_run RPC 同步校验。
**原因**：
- 终态字段语义应与实际执行结果一致：completed 只有 exit_code=0 是合法的（同步成功完成）；failed 的 exit_code 必须是 1（RPC/审计/参数失败）或 2（sync_log 写入失败或租约过期）
- cleanup 设置 exit_code=2（租约过期→进程崩溃），release_sync_run with p_status='failed' 设置 exit_code=1 或 2

### D21: plan_drift_differences 数组长度 = plan_drift_count（V5.2 新增）
**决策**：新增 `plan_drift_differences_length` CHECK（plan_drift_differences IS NULL OR jsonb_array_length(plan_drift_differences) = plan_drift_count）。release_sync_run RPC 同步校验。
**原因**：plan_drift_count 与 plan_drift_differences 数组长度必须一致。两者由 Runner 同时输出，任一不一致表明 Runner 输出异常或数据传输损坏。

### D22: prepare() 单一序列化点（V5.3 新增）
**决策**：`ArtifactProvider.prepare(content)` 是全系统唯一调用 `JSON.stringify(content)` 的位置。`store()` 接收 `PreparedArtifact { bytes, hash }`——不接受裸 content。claim 用的 hash 与 store 用的 bytes 来自同一次 `prepare()` 调用。
**原因**：V5.2 中 SyncService 序列化算 hash（用于 claim），然后传 content 给 store 再次序列化（可能产生不同 bytes）。两次 `JSON.stringify` 在包含 toJSON 等非确定性场景下可能产生不同输出，导致 claim hash 与存储 hash 分离。prepare() 消除此风险：序列化一次，bytes 和 hash 绑定传递。V5.4.2 明确：toJSON 在 prepare() 第 1 步由 validateJsonValue 拒绝，不会进入 JSON.stringify。

### D23: GC 所有权——ArtifactProvider 不查询 sync_run（V5.3 新增）
**决策**：ArtifactProvider 仅提供存储层原语（`listCandidates()` / `deleteMany()`），不自行判断业务引用。GC 决策（哪些 artifact 可删）由 SyncService 中的 GC orchestrator 完成：从 Repository 获取受保护 runId → 过滤候选 → 调用 `deleteMany()`。
**原因**：ArtifactProvider 是存储抽象层，不应跨层查询 sync_run 或理解业务语义。分离后：ArtifactProvider 可替换存储后端而不影响 GC 逻辑；GC 策略变更（如调整保留期）仅修改 GC orchestrator；测试可独立验证存储层和 GC 决策层。

### D24: completed_dry_run_requires_plan_artifact CHECK（V5.3 新增）
**决策**：新增数据库层 CHECK 约束，completed Dry Run（status='completed' AND mode='dry_run'）必须同时具有 input_artifact_hash 和 plan_artifact_hash。与 `dry_run_requires_input_artifact` CHECK + release_sync_run RPC v_mode 校验形成三重保障。
**原因**：V5.2 中 completed Dry Run 的 plan_artifact_hash 仅由 release_sync_run RPC 强制（通过 v_mode 判断），无数据库层 CHECK 兜底。新增 CHECK 确保即使绕过 RPC 直接 UPDATE，数据库层也会拒绝。对 Real Write 也有约束力——Real Write 必须绑定有完整 artifact 的 completed Dry Run。

### D25: Runner 只执行 normalizedContent（V5.4 新增）
**决策**：Artifact content 类型限制为严格 `JsonValue`（string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }）。`prepare()` 返回 `{ bytes, hash, normalizedContent }`——normalizedContent = `JSON.parse(bytes)`。Runner 从 `SyncExecuteParams.inputArtifact` / `boundPlanArtifact` 接收 `JsonValue`，不得执行原始 object 或自行 JSON.parse。
**原因**：
- 原始 object 可能包含函数、undefined、Symbol、BigInt、自定义原型或 toJSON 方法——JSON.stringify 会静默丢弃或无法处理这些值
- Runner 执行的内容必须与已存储 artifact 的内容完全一致
- normalizedContent（JSON.parse of bytes）是与存储 bytes 一对一对应的反序列化结果——不可能出现 "Runner 执行内容 ≠ 存储 artifact 内容"
- bytes → hash → claim → store → get → JsonValue 形成不可变的完整链路
- prepare() 是唯一序列化 + 反序列化点——toJSON 在序列化前被 validateJsonValue 拒绝（不会进入 JSON.stringify），Runner 收到的是确定性的 JsonValue

### D26: claim_sync_run 原子验证 Real Write 绑定（V5.4 新增）
**决策**：`claim_sync_run` 在 PostgreSQL 事务内（持有 pg_advisory_xact_lock + sync_warehouse_lock FOR UPDATE）原子验证 `dry_run_run_id` 的全部有效性条件：warehouse 匹配、mode='dry_run'、status='completed'、plan_drift_check='PASS'、finished_at 在 60 分钟内、input_artifact_hash 匹配、plan_artifact_hash 匹配。任一条件不满足 → RAISE EXCEPTION 拒绝 INSERT。
**原因**：
- V5.3 中 Server Action 应用层验证和 claim_sync_run 之间存在 TOCTOU 窗口——尽管 completed 是终态不可变，但 finished_at 会随时间自然越过 60 分钟边界
- 在 claim_sync_run 事务内原子验证，使用数据库一致的 `v_now` 时间戳，消除应用层与数据库层之间的时间偏差
- 双重防御：应用层提供即时中文错误（用户体验），数据库层提供原子正确性保证（数据安全）
- `completed` 终态不可变（status、plan_drift_check、hashes 在进入 completed 后不可修改）意味着唯一可能的时间相关失败是 60 分钟过期——这恰好是期望行为

### D27: GC cutoff 固定为审计保留期 + 双层保护（V5.4.1 修正）
**决策**：GC cutoff（`listCandidates(olderThan)` 的 `olderThan` 参数）直接使用 `now() - AUDIT_RETENTION_DAYS`（7 天），禁止使用 `max()` 或其他复合计算。GC orchestrator 在调用 `listCandidates` 前代码层验证 `olderThan ≤ now() - 7 days`。**保留** `getRecentlyCompletedRunIds(now - 60 minutes)` 作为第二层保护。禁止从 `artifact.createdAt` 推导 `sync_run.finished_at`——两者是独立时间戳。
**原因**：
- V5.4 的 `max(now() - 7d, now() - 60min)` 语义错误：两个过去时间点的 `max()` 取更近者，实际 cutoff = `now() - 60min`，7 天审计保留期完全失效
- 双层保护设计：
  - 第一层（存储层）：cutoff = now() - 7 天——按 artifact 存储年龄过滤，减少候选集
  - 第二层（业务层）：getRecentlyCompletedRunIds——保护 finished_at 在 60 分钟内的 completed Dry Run，覆盖"artifact > 7 天但 Dry Run 刚完成"的边界场景
- `artifact.createdAt` 和 `sync_run.finished_at` 是独立时间戳：artifact 可能在 sync_run 完成后任意时间存储（延迟写入、重试），且两者之间无事务保证。GC 必须分别查询，不可从 createdAt 推导 finished_at
- 两层保护共同确保 GC 不会删除可被合法 claim 的 Dry Run artifact

### D28: validateJsonValue 运行时验证（V5.4.3 完善）

**决策**：`prepare()` 在调用 `JSON.stringify` 之前必须先通过 `validateJsonValue(content)` 递归验证所有值。

**拒绝列表（V5.4.3 完整）**：
- undefined、function、Symbol、BigInt 值
- NaN、Infinity（number 必须 `Number.isFinite`）
- toJSON 方法（对象和数组均拒绝；使用 `'toJSON' in value` 而非 `typeof value.toJSON`）
- 自定义原型对象（仅允许 `Object.prototype` 或 `null`）
- Array 子类（`Object.getPrototypeOf(value) !== Array.prototype`）
- 循环引用（WeakSet 仅代表当前递归祖先链；`seen.add(value)` → `try { ... } finally { seen.delete(value) }`）
- Symbol 键（`Reflect.ownKeys` 检测，对象和数组均拒绝）
- 稀疏数组（`!(i in value)` 空洞检测）
- 非规范数组索引（仅接受 `String(index) === key` 且 `Number.isInteger(index)` 且 `index >= 0` 且 `index < length`；拒绝 "01"/"4294967295" 等伪数字额外属性）
- accessor/getter 属性（`Object.getOwnPropertyDescriptor` 检测 `descriptor.get` / `descriptor.set`；对象和数组均拒绝）
- 不可枚举属性（`descriptor.enumerable === false`；可能被 `JSON.stringify` 静默丢弃）

**读取规则（V5.4.3）**：
- 对象属性值通过 `descriptor.value` 读取——禁止因属性访问触发 getter 行为
- 遍历 `Reflect.ownKeys()` 的全部字符串键（而非 `Object.keys()`，后者仅返回可枚举自有属性）

**共享引用 vs 循环引用（V5.4.3）**：
- WeakSet 仅代表当前递归祖先链——递归进入对象/数组时 `seen.add(value)`，递归完成后 `try/finally` 执行 `seen.delete(value)`
- 共享引用（同一对象出现在不同分支，如 `{ a: shared, b: shared }`）通过：第一次访问后 shared 从 WeakSet 中移除，第二次访问重新添加并正常验证
- 真正循环引用（父对象通过子孙引用回自身）必须拒绝：父对象仍在 WeakSet 中（祖先链尚未完成），子对象检测到 `seen.has()` 并抛出

**禁止使用 `any` 类型**——使用 `unknown`、`object`、`Record<string, unknown>` 替代。

**原因**：
- TypeScript 的 `JsonValue` 类型仅在编译期有效——运行时可能传入任意值（如 API 响应、文件读取、用户输入）
- `JSON.stringify` 对非法值的处理不一致且静默：丢弃 undefined 属性值、丢弃 Symbol 键、丢弃函数值、丢弃不可枚举属性、序列化 NaN/Infinity 为 `null`——这些都导致 round-trip 不一致
- `toJSON` 方法、Array 子类和自定义原型可能产生非确定性序列化输出，使 claim hash 与存储 hash 分离
- 循环引用会导致 `JSON.stringify` 抛出 `TypeError`，但错误信息不包含路径——validateJsonValue 提前用 WeakSet 祖先链检测并给出带路径的明确错误
- Symbol 键和不可枚举属性被 `Object.keys()` 静默忽略——使用 `Reflect.ownKeys()` 明确检测并拒绝，防止静默丢数据
- 稀疏数组的空洞被 `JSON.stringify` 序列化为 `null`，round-trip 后变为实际 `null` 值——与原始数据不一致
- 非规范数组索引（"01"→可能被混淆为属性而非索引，"4294967295"→超出数组长度）被 `JSON.stringify` 处理不一致
- accessor/getter 属性可能返回非确定性值（如 `Math.random()`），且通过属性访问（`obj[key]`）会触发 getter 执行——使用 `descriptor.value` 安全读取
- 先验证后序列化：在序列化之前就给出明确错误（含路径），便于调试和审计
- 验证器在 `prepare()` 内部第 1 步执行，不是单独的导出函数——强制所有 artifact 序列化都经过验证

---

## 未决事项（留待 P5-SY6）

- 具体运行环境：child_process vs HTTP callback vs 消息队列 vs Vercel Cron
- Python 环境依赖管理（是否需要服务器预装 Python + Playwright）
- BigSeller 抓取与同步的编排（是否每次同步前自动抓取最新数据）
- 定时任务调度策略
- 多仓库并发同步策略
- 同步执行日志的实时流式展示（SSE / WebSocket）
- `cancelSync` 与 `AbortSignal` 的可行性
- Sync Runner 的 `capabilities()` 动态检测实现
- ArtifactProvider 的真实文件系统实现（`FileSystemArtifactProvider`）
- `heartbeat_sync_run` 的自动调度（cron / setInterval）
- `cleanup_expired_sync_runs` 的自动调度
