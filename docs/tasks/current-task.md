# Current Task Packet

## Task ID

`P5-SY9` — 海外仓库存同步生产化

## 状态

`IN_PROGRESS` — P5-SY9A~F 均为 DONE（Codex 独立复验通过 P5-SY9E；P5-SY9F AWAITING_REVIEW）；P5-SY9G~I PENDING。

## 背景

P5-SY8A~H 已完成逐仓扩展：VN/TH/MY/ID 均已完成真实写入或 Dry Run 验证。当前阶段确认继续使用 Supabase 作为生产数据库，但必须保留未来迁移到国内 PostgreSQL 兼容数据库的可能性。

本任务目标不是继续零散扩仓，而是把"海外仓库存 + 同步"整块做成可直接日常使用的生产功能。BigSeller 已有库存趋势、预测日销量、预计可售天数等数据，当前任务不新增 `inventory_snapshots` 或大规模历史快照表。

## 任务目标

1. 完善海外仓库存页面，使其可日常使用（仓库筛选、国家筛选、SKU 搜索、同步状态、失败原因）。
2. 完善同步页面，使其能安全执行 Dry Run、查看结果、二次确认后真实写入。
3. 修复 Web 同步上线阻塞项：Dry Run 绑定、自动真实写入、生产 Mock、heartbeat/timeout。
4. 保持 Supabase 可用，但不得把业务层绑死在 Supabase SDK 上。

## 强制架构边界

- 页面、Client Component、Server Component、SyncService、Runner 不得散落 `supabase.from()`。
- Supabase SDK 只允许出现在 Repository / Adapter / `src/lib` 边界。
- Server Actions 只能调用 service / repository wrapper。
- 真实写入只能 Admin 执行；Operator 只能查看。
- `service_role` 不得进入前端、不得进入 client bundle、不得输出到日志。
- 不得重新提交 `.env.local`、`runtime/profile`、浏览器 cookie、抓取产物。

## 上线阻塞项（必须修复）

以下四项全部修复后，Web 真实写入才可上线：

### 1. Dry Run 真实绑定

- Real Write 必须绑定某次已完成、未漂移、未过期的 Dry Run。
- 必须使用该 Dry Run 的 input artifact + plan artifact；不得重新抓取或重新生成新计划绕过绑定。
- 必须校验 `dryRunRunId`、`warehouse_id`、`country`、`input_hash`、`plan_hash`、`plan_drift_check=PASS`。
- 删除 `compare_plans(plan, plan)` 等假比较逻辑（`web_bridge.py` line 156 已知 Bug）。

### 2. 禁止自动真实写入

- Web 流程必须是：Dry Run → 展示摘要/差异/风险 → 用户二次确认 → Real Write。
- 不得点击一次按钮自动写库。
- 批量同步必须有更强确认（勾选 ready 仓库 + 输入确认短语）。
- 修复 `syncWarehouse` 当前自动串联 dry_run → real_write 的行为。

### 3. 移除生产 Mock

- production wiring 不得使用 `MockArtifactProvider`、`MockInputArtifactSource`、`MockSyncRunner`。
- 必须实现真实 `ArtifactProvider` / `InputArtifactSource` / `RealSyncRunner` 组合。
- `wireActions()` 当前默认走 MockSyncRunner，必须改为 production wiring。
- 测试环境可用 Mock，但生产路径必须有结构性测试防止 Mock 混入。

### 4. heartbeat / timeout

- 长任务必须周期性 heartbeat（续租 `sync_run.lease_expires_at`）。
- Python 子进程 / 浏览器必须有 timeout。
- timeout / abort 时必须终止子进程，并 release 为 `failed` 或进入明确 `indeterminate` 状态。
- 防止 lease 过期后同仓任务被误回收或并发重入。

### 5. BigSeller Session 复用不可靠

- `establishBigSellerSession()` 使用 **headed** Chrome（`BS_HEADLESS=0`，`BS_SESSION_ONLY=1`）直接调用 `bigseller_scraper.py`。
- Web 同步（`callPythonBridge` → `web_bridge.py`）使用 **headless** Chrome（`BS_HEADLESS=1`）。
- 两者使用同一 profile 目录（`tools/bigseller-scraper/runtime/profile`），但 headed ↔ headless 之间的 cookie/session 持久化可能不可靠。
- 当前无 `verifyBigSellerSession()` Server Action 或 health check：无法在同步前确认 session 是否有效。
- Web 同步抓取 0 行时，错误提示仅说"登录会话已过期或需要验证码"，无法区分：未登录 / 需要验证码 / profile 不可用 / 页面结构异常 / 表格未加载。
- `session-establish.log` 仅记录 headed 浏览器输出，无法证明 headless 同步可正常复用 profile。
- `establishBigSellerSession()` 使用 `proc.unref()` 不等待结果，Server Action 立即返回 success，但实际登录可能未完成；当前无 API 查询登录是否完成。
- 两条路径（`establishBigSellerSession` 与 `callPythonBridge`→`web_bridge.py`）均已传入 `PYTHONIOENCODING='utf-8'`，编码环境无差异；实际差距在于 headed/headless 模式不同、`proc.unref()` 不等待登录完成、无 `verifyBigSellerSession` 健康检查、0 行错误无法分类。

## 页面功能要求

### 海外仓库存页面（`/dashboard/inventory`）

- 当前库存可用。
- 支持仓库筛选、国家筛选、SKU 搜索。
- 显示最近同步时间。
- 显示同步状态：成功 / 失败 / 进行中 / 未同步。
- 显示失败原因摘要。
- 当前不做 `inventory_snapshots`，只展示最新库存。

### 同步页面（`/dashboard/sync`）

- 显示所有海外仓。
- 每个仓显示：最近 Dry Run、最近 Real Write、最后成功时间、最后失败原因。
- Admin 可触发 Dry Run（单仓或全部海外仓）。
- Admin 在 Dry Run PASS 后可二次确认真实写入。
- Operator 只能查看历史和详情。
- 支持查看 `sync_run` / `sync_log` 详情。
- 失败提示必须中文可读。

#### 批量 Dry Run 审核总览

Admin 点击"同步全部海外仓"后，展示审核总览，每个仓库包含：

- warehouse name
- country
- fetched rows
- valid SKU count
- invalid SKU count
- new variants
- inventory inserted / updated / unchanged
- warehouse rename plan
- `plan_drift_check`
- status: `ready` / `blocked` / `failed`
- failure reason

#### 批量真实写入

1. Admin 勾选 `ready` 仓库。
2. Admin 输入确认短语。
3. 系统内部根据所选 dry run runId 自动绑定 Real Write。
4. 每仓独立 claim / release / sync_log，不使用跨仓大事务。
5. 单仓失败不影响其他仓继续执行。
6. 最终展示总报告：成功 / 失败 / 跳过 / 每仓写入数量 / 失败原因。

## 权限要求

- Admin 可触发 Dry Run 和 Real Write。
- Operator 只能查看库存、Dry Run 结果、同步历史、失败原因。
- 未登录、停用账号、非 Admin 写入必须被 Server Action 拒绝。
- 权限不能只靠前端隐藏按钮。
- Server Action、Repository、RPC/RLS 权限链必须一致。

## 数据与日志要求

- 每仓必须独立 `sync_run`。
- 每仓真实写入必须写 `sync_log`。
- `sync_run` 必须记录：触发人、来源、模式、状态、退出码、错误信息、结果摘要。
- 不新增 `inventory_snapshots`。
- 不把大 JSON 长期塞数据库；artifact/report 可继续文件化。
- 不提交 `.env.local`、`runtime/profile`、浏览器 cookie、抓取产物。

## 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| P5-SY9A | 现状审查与任务包落地 | 梳理 Web sync 与 CLI 差距，标记 Web real_write 为生产化待修复，确认验收标准 | P5-SY8H | DONE（7 维度差距已标记：4 CRITICAL / 1 HIGH / 1 MEDIUM / 1 PASS；含 BigSeller Session 复用不可靠） |
| P5-SY9B | BigSeller Session Health Check | 新增 `verifyBigSellerSession()` Server Action + `health_check.py` + `profile_unavailable` 真实分类 + `checked_at→checkedAt` 转换 + syncWarehouse/syncAllWarehouses 服务端 session health guard | P5-SY9A | DONE（Codex 独立复验通过） |
| P5-SY9C | 真实 Provider / InputSource / Production wiring | 替换生产 Mock，建立真实 artifact 存取和生产 wiring 测试 | P5-SY9B | DONE（Codex 独立复验通过） |
| P5-SY9D | 单仓 Web Dry Run → 审核 → Real Write 绑定 | 用户无需输入 token/runId/hash；系统内部绑定 Dry Run；plan drift 阻断。已实现 Dry Run→Real Write 绑定逻辑，但 Web 真实写入入口必须保持 server-side disabled / feature gated，直到 P5-SY9E heartbeat/timeout 完成且 P5-SY9I 独立验收通过后才允许启用。 | P5-SY9C | DONE（Codex 验收通过） |
| P5-SY9E | heartbeat / timeout / 子进程控制 | 实现 heartbeat、timeout、abort、失败落库和并发锁测试 | P5-SY9D | DONE（Codex 独立验收通过） |
| P5-SY9F | 批量全部海外仓 Dry Run | 一键为全部启用海外仓生成独立 Dry Run，并展示审核总览 | P5-SY9E | AWAITING_REVIEW |
| P5-SY9G | 批量审核后真实写入 | 勾选 ready 仓库，强确认后逐仓写入；单仓失败不影响其他仓 | P5-SY9F | PENDING |
| P5-SY9H | 页面体验与运营可用性收口 | 当前库存、同步状态、历史、失败原因、明细展开、权限体验 | P5-SY9G | PENDING |
| P5-SY9I | 独立验收与生产启用 | 全量测试、lint/build、Python 测试、Codex 独立审查 | P5-SY9H | PENDING |

## 验收标准

- 批量 Dry Run 不发生真实写入。
- Real Write 必须绑定对应 Dry Run（含 hash 校验和 plan_drift_check=PASS）。
- 用户无需手填 token、runId、hash、路径或 CLI 参数。
- Web 真实写入必须二次确认。
- `blocked` / `failed` 仓库无法写入。
- 单仓失败不影响其他仓。
- 每仓都有独立 `sync_run` 和 `sync_log`。
- 页面能展示总览、明细、失败原因和最终结果。
- Admin / Operator 权限正确。
- 生产路径无 Mock。
- heartbeat / timeout 正常。
- Web 真实写入入口必须在 P5-SY9E heartbeat/timeout 完成且 P5-SY9I 独立验收通过后，通过 server-side feature gate 启用；在此之前必须保持 disabled。
- `verifyBigSellerSession()` 健康检查必须在 P5-SY9B 完成；Sync 页面 session unhealthy 时禁止触发任何同步操作。
- BigSeller 抓取 0 行时必须区分失败原因并返回中文可读提示。
- `npm run test` 通过。
- `npm run lint` 0 errors。
- `npm run build` 通过。
- Python tests 全部通过。
- 不重新提交 `.env.local`、`runtime/profile`、cookie、抓取产物。

## 测试要求

- Dry Run artifact 与 Real Write 绑定测试。
- plan drift 阻断真实写入测试。
- Web 二次确认测试。
- production wiring 不含 Mock 测试。
- heartbeat / timeout 测试。
- Admin / Operator 权限测试。
- Repository 边界测试，防止页面/组件直接调用 Supabase。
- Python CLI 现有测试不得退化。
- `npm run test` 必须通过。
- `npm run lint` 0 errors。
- `npm run build` 通过。
- Python 测试全部通过。

## 文档同步要求

- `docs/current-state.md`：Current Task 改为 P5-SY9，说明当前为任务包设计/待审查阶段。
- `docs/tasks/phase-5-sync.md`：新增或更新 P5-SY9 状态。
- 明确记录：Supabase 是当前生产数据库，但保留数据库供应商隔离，未来切国内数据库时替换 Repository/Adapter。
- 明确记录：当前不新增 `inventory_snapshots`，趋势数据优先复用 BigSeller 可抓取数据。

## 停止条件

- 本轮已完成 P5-SY9E 返工：(1) python-bridge.ts 统一 terminate(reason) 管线（timeout/abort → SIGTERM → 5s grace → SIGKILL，settled 标志幂等，close/error 清理，中文错误）；(2) SyncServiceDeps 可注入 heartbeatIntervalMs，测试 20ms 间隔真实触发 heartbeat ≥1 次；(3) prepareRunnerContext 异常清理 heartbeat + release failed，dry_run/real_write 双路径；(4) MockSyncRunner shouldThrowCapabilities + 新增 child_process spawn mock SIGTERM→SIGKILL 测试。20/20 P5-SY9E 测试，450/450 非并发同步测试，Python 85/85，lint/build 通过。
- 不连接生产 Supabase。
- 不执行真实写入。
- 不提交 runtime/artifacts、__pycache__、bound-plan-*.json、.env.local、profile、cookie、抓取产物。
- 不开始 P5-SY9E。
- 不修改已执行 migration。
- 保留 DB claim_sync_run 二次防御。
- 完成后 P5-SY9D 保持 AWAITING_REVIEW，等待 Codex 独立复验。

## 依赖

- P5-SY8A~H（DONE）
- Migration 00006/00007/00008/00009（已执行）
- P5-SY5 Sync Feature Module（DONE）
- Supabase 当前生产数据库配置
