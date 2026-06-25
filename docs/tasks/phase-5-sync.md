# Phase 5 — 海外库存同步

目标：稳定获取海外仓真实库存，并保留失败记录和上次成功数据。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P5-SY1 | 明确首个海外仓数据来源与字段映射 | P2-I3 | DONE |
| P5-SY2 | 单仓抓取与解析器 | P5-SY1 | DONE |
| P5-SY3A | Inventory 写入映射与只读 Dry Run | P5-SY2、P1-V1 | DONE |
| P5-SY3B | Inventory 实际写入与新 SKU 创建 | P5-SY3A | DONE |
| P5-SY4A | SyncLog 与失败保留机制设计及任务拆分 | P5-SY3B | DONE |
| P5-SY4B | Migration 00006：事务型海外库存同步 RPC | P5-SY4A | DONE |
| P5-SY4C | Executor 适配 RPC 与 SyncLog 写入 | P5-SY4B | DONE |
| P5-SY4D | 同步失败模式测试覆盖 | P5-SY4C | DONE (独立验收通过) |
| P5-SY4E | CLI 集成与 Dry Run 验证 | P5-SY4D | DONE (独立验收通过) |
| P5-SY5 | 手动同步入口（含子任务） | P5-SY4E | DONE（全部子任务 P5-SY5A~G DONE） |
| P5-SY6 | 定时任务与运行环境评估 | P5-SY5 | DONE（Codex 第三次独立设计验收通过） |
| P5-SY7 | 单仓端到端验收 | P5-SY6 | DONE（Codex 独立复验通过；6 已知差距/0 阻塞项） |
| P5-SY8 | 逐仓扩展（总任务包） | P5-SY7 | DONE（Codex 独立设计复审通过；子任务 P5-SY8A~H 已拆分；Migration 00006/00007/00008 已执行） |
| P5-SY8A | VN 只读抓取与 Dry Run 方案 | P5-SY8 | DONE（Codex 独立验收通过；64 行抓取 + Dry Run 通过） |
| P5-SY8B | VN 真实写入与端到端验收 | P5-SY8A | DONE（Codex 独立验收通过：160/160 测试，npm lint 0 errors，npm build 通过。首次 RPC 提交成功：64 Variants + 64 Inventory；Migration 00009 通用化 RPC；6 处硬编码 PH→WAREHOUSE_COUNTRY；幂等重跑通过。Codex 返工 4 项全部确认：令牌国家绑定 / Migration 00009 静态契约测试 / 执行报告时间戳 / 文档同步） |
| P5-SY8C | TH 只读抓取与 Dry Run 方案 | P5-SY8B | DONE（Codex 独立验收通过。A0 仓库改名 → A1 配置切换 → A2 BigSeller 抓取 72 行 → A3 输入校验 → A4 Dry Run（返工：报告身份 token 派生 + 全新 CLI 执行报告）→ A5 全链路验收。196/196 Python 测试 + 13/13 Migration 00009 契约测试，3 项写入前强制验收项全部满足。报告区分：130900=stored plan baseline / 133500=CLI execution report。未执行真实写入） |
| P5-SY8D | TH 真实写入与端到端验收 | P5-SY8C | DONE（Codex 独立验收通过。RPC 写入成功：72 Variants + 72 Inventory；Phase G/I PASS；sync_log status=success。两轮 Codex 返工通过：令牌—模式安全门 + finished_at 审计语义 + 测试 mock 修复。令牌绑定：P5-SY8C-TH 仅 --dry-run，P5-SY8D-TH 唯一可 --no-dry-run。228/228 Python 测试，compileall 通过，npm lint 0 errors，npm build 通过。） |
| P5-SY8E | MY 只读抓取与 Dry Run 方案 | P5-SY8D | DONE（Codex 独立验收通过。BigSeller 抓取 48 行（warehouse=喜运达MY仓，autoid=warehouse_option_4）。DB 仓库 `马来西亚仓`→`喜运达MY仓` 改名已确认。Stored Plan Baseline `p5-sy3a-dry-run-20260620-232838.json`，CLI Dry Run 报告 `p5-sy8e-my-dry-run-20260620-233129.json`，plan_drift_check=PASS。invalid sidecar: 1 行（空包 0000）。新增 P5-SY8E-MY 令牌（仅 --dry-run）+ test_my_full_chain_country_assertions（execute_plan_v2 真实执行，逐条验证 RPC p_variants/p_inventory country=MY + Phase G country=eq.MY + Phase I wh_expected.country=MY + SyncLog warehouse_id/status）。234/234 Python 测试，compileall 通过，npm lint 0 errors，npm build 通过。未执行真实写入。） |
| P5-SY8F | MY 真实写入与端到端验收 | P5-SY8E | DONE（Codex 独立验收通过。全新抓取 48 行 + invalid sidecar 1 行。首次写入：48 Variants + 48 Inventory + Warehouse 改名；幂等重跑：0 新增/48 unchanged。Phase G/I PASS，SyncLog success。239/239 Python 测试，compileall/lint/build 通过。） |
| P5-SY8G | ID 只读抓取与 Dry Run 方案 | P5-SY8F | DONE（Codex 独立复验通过。BigSeller 抓取 35 行，warehouse=印尼-DEE仓库，autoid=warehouse_option_3。DB 仓库 `印尼仓`→`印尼-DEE仓库` 改名已确认。P5-SY8G-ID 令牌（仅 --dry-run）。Codex 返工 3 项修复通过：1) --no-dry-run 动态提示 P5-SY8H-ID（新增 `_PENDING_WRITE_TOKENS`）；2) `_DRY_RUN_ONLY_TOKENS` 一致性测试改用 ast.parse 完整解析 3 token；3) `_NO_DRY_RUN_EXCLUSIVE_TOKENS` 一致性断言不再被 `except AssertionError: pass` 吞掉。245/245 Python 测试，compileall 通过，npm lint 0 errors，npm build 通过。未执行真实写入。） |
| P5-SY8H | ID 真实写入与端到端验收 | P5-SY8G | DONE（Codex 独立验收通过。首次 RPC 写入 35 Variants (country=ID) + 35 Inventory + Warehouse 改名 "印尼仓"→"印尼-DEE仓库"；Phase G/I PASS，SyncLog success。幂等重跑：0 新增/35 unchanged，plan_drift_check=PASS。Codex 独立验收：代码、报告、真实 DB 只读核查、幂等重跑、质量门均通过。128/128 Python 测试，compileall/lint/build 通过。） |
| P5-SY9 | 海外仓库存同步生产化（批量 Dry Run、审核、批量真实写入、生产 Web 入口） | P5-SY8H | DONE（P5-SY9A~K 全部 DONE。全部5海外仓批量真实写入完成（2026-06-24）：PH=104行/VN=64行/TH=73行/MY=48行/ID=36行，全部 sync_log success。PH/VN/TH 仓库名称在 BigSeller 已变更。返工 P5-SY9K 通过。WEBSYNC_REAL_WRITE_ENABLED=false。） |
| P5-SY10 | 自动 Dry Run 预审与后续自动化分阶段框架 | P5-SY9 全部海外仓批量真实写入完成并验收 | DONE（P5-SY10A~F 全部 DONE。规则引擎设计：11 条规则优先级 R1~R11，冷启动/有基线双路径，session unhealthy / plan_drift / all_zero / consecutive_failures → BLOCK；warehouse_rename / high_new / high_invalid / row_anomaly → WARN；PASS 仍需人工确认 Real Write。首版仅 Phase A，Phase B 自动 Real Write 设计预留。质量门：744/744 TS，lint 0，build pass，253 Python。） |
| P5-SY11 | ProductVariant 软归档与库存视图降噪 | P5-SY10 全部子任务（A~F）DONE | **DONE** — P5-SY11G 语义返工完成。全局 is_archived 迁移为 user_variant_preference 用户级偏好表，所有用户均可归档/恢复，每人独立视图。P5-SY11G 返工（2026-06-25）：修复 3 项阻塞（inventory row.variant_id 过滤、list DB 层分页前过滤、archive/restore 实际变更数）。891/891 TS 测试，build pass。 |
| P5-SY11G | 语义返工：用户级 Variant 归档偏好（user_variant_preference 表） | P5-SY11A~F | **DONE** — 2026-06-25。Migration 00012 + 类型同步 + Repository 重写 + Server Actions (requireActiveAuth) + Inventory 过滤 + UI + 869 TS 测试 pass，lint 0 errors，build pass。 |

P5-SY8 已完成逐仓端到端闭环。P5-SY9 起进入生产化阶段：允许批量处理全部启用海外仓，但必须先批量 Dry Run、页面审核、二次确认后再逐仓真实写入；禁止普通按钮直接自动真实写入。

## P5-SY9 子任务拆分（生产化）

| Sub-Task ID | 任务 | 依赖 | 类型 |
|---|---|---|---|
| **P5-SY9A** | 现状审查与任务包落地：梳理 Web sync 与 CLI 差距，确认生产化验收标准 | P5-SY8H | DONE（7 维度差距清单已输出，含 BigSeller Session 复用不可靠；P5-SY9B~I 入口文件已明确） |
| **P5-SY9B** | BigSeller Session Health Check：新增 `verifyBigSellerSession()` Server Action，headless 只读检查 profile 可用性，返回中文状态，unhealthy 时禁用 Dry Run | P5-SY9A | DONE（Codex 独立复验通过） |
| **P5-SY9C** | 真实 ArtifactProvider / InputArtifactSource / Production wiring：替换生产 Mock，证明生产路径无 Mock | P5-SY9B | DONE（Codex 独立复验通过） |
| **P5-SY9D** | 单仓 Web Dry Run -> 审核 -> Real Write 绑定：用户无需手填 token/runId/hash，Real Write 绑定已通过 Dry Run | P5-SY9C | DONE（Codex 验收通过） |
| **P5-SY9E** | heartbeat / timeout / 子进程控制：同步期间续租，超时可终止，失败正确落库 | P5-SY9D | DONE（Codex 独立验收通过） |
| **P5-SY9F** | 批量全部海外仓 Dry Run：每仓独立 sync_run，展示审核总览 | P5-SY9E | DONE（Codex 独立复验通过） |
| **P5-SY9G** | 批量审核后真实写入：勾选 ready 仓库，强确认后逐仓写入，单仓失败不影响其他仓 | P5-SY9F | DONE（Codex 独立验收通过） |
| **P5-SY9H** | 页面体验与运营可用性收口：当前库存、同步状态、历史、失败原因、明细展开、权限体验 | P5-SY9G | DONE（Codex 独立验收通过） |
| **P5-SY9I** | 独立验收与生产启用：测试、lint/build、Python tests、Codex 独立审查 | P5-SY9H | DONE（Codex 独立验收通过。含一次返工：拆分 test/test:concurrency。） |
| **P5-SY9J** | 生产启用受控验证：用户授权后 WEBSYNC_REAL_WRITE_ENABLED=true，PH 仓受控 Dry Run → Real Write | P5-SY9I | DONE（生产验证通过。PH sync_log success，new_variants_count=6。） |
| **P5-SY9K** | 返工：禁用旧同步入口 + 修复 Web Real Write summary | P5-SY9J | DONE（syncWarehouse/syncAllWarehouses 永久禁用；web_bridge summary 从 rpc_summary 读取；526/526 TS + 252/252 Python + lint 0 + build pass。） |

## P5-SY10 自动 Dry Run 预审与后续自动化分阶段框架（DONE）

P5-SY10 依赖 P5-SY9 已满足。首版仅做自动 Dry Run、规则预审和人工确认 Real Write，不启用自动真实写入。

### 目标边界

- Phase A：自动 Dry Run + 规则预审 + 人工确认 Real Write。
- Phase B：仅作为设计预留；运行稳定并建立每仓基线后，才评估 PASS 仓库自动 Real Write。
- Cron 或后台任务不得直接调用真实写入入口，不得绕过 Admin 审核、feature gate、Dry Run 绑定和 sync_run/sync_log 审计链。
- 冷启动、新仓、首次同步、仓库改名场景不能按稳定期阈值硬拦；无历史基线时新增 SKU 高比例只 WARN，不直接 BLOCK。
- 连续失败必须纳入阻断规则，避免定时任务反复制造无效 `sync_run` 和日志噪音。

### 规则引擎（11 条规则，优先级 R1→R11）

| # | 规则标识 | 条件 | 决策 | 冷启动行为 |
|---|---------|------|------|-----------|
| R1 | `session_unhealthy` | session health != healthy | **BLOCK** | 同（全局阻断） |
| R2 | `all_zero` | rawRowCount=0 && validSkuCount=0 | **BLOCK** | 同 |
| R3 | `plan_drift` | planDriftCheck != 'PASS' | **BLOCK** | 同 |
| R4 | `dry_run_failed` | Dry Run status = failed | **BLOCK** | 同 |
| R5 | `consecutive_failures` | 同仓连续 ≥3 次失败 | **BLOCK** | 同 |
| R6 | `warehouse_rename` | warehouseRenamePlan.action = rename | **WARN** | 同 |
| R7 | `cold_start_high_new` | !hasBaseline && variantsCreated/validSkuCount > 0.5 | **WARN** | 生效 |
| R8 | `high_invalid_sku` | hasBaseline && invalidSkuCount/rawRowCount > 0.1 | **WARN** | 跳过 |
| R9 | `high_new_variants` | hasBaseline && variantsCreated > max(5, avg*3) | **WARN** | 跳过 |
| R10 | `row_count_anomaly` | hasBaseline && 行数波动 > 50% | **WARN** | 跳过 |
| R11 | `high_invalid_sku_cold` | !hasBaseline && invalidSkuCount > rawRowCount*0.3 | **WARN** | 生效 |

最终决策 = evaluations 中最严重级别（BLOCK > WARN > PASS）。默认 PASS。

### 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| **P5-SY10A** | 规则引擎核心：类型 + 纯函数 + 单元测试 | 实现 `evaluateRules()` 纯函数，11 条规则 + 冷启动/有基线双路径，60 项测试 | P5-SY9 | **DONE**（2026-06-24。586/586 TS，lint 0，build pass） |
| **P5-SY10B** | 历史上下文提供器：基线追踪 + 连续失败检测 | 实现 `getWarehouseHistory()` 从 sync_run 推导历史基线（仅 dry_run failed，real_write 屏障）；走 Repository 接口 | P5-SY10A | **DONE**（2026-06-24，Codex 返工复验通过。35 项测试。621/621 TS，lint 0 errors，build pass） |
| **P5-SY10C** | 自动预审编排：Server Action 串联 health → 逐仓预取历史 → batch Dry Run → rule eval | **DONE**（2026-06-24，Codex 独立复验通过。预取历史在 Dry Run 之前 + history 失败 → BLOCK。30 项测试。651/651 TS 测试。）| P5-SY10B | DONE |
| **P5-SY10D** | 预审页面 UI：自动预审入口 + 规则决策徽标 + 可展开规则详情 | Sync 页面新增「自动预审」按钮。BatchReviewCard 新增 RuleBadge + 可展开规则详情 + 复选框：独立 `autoReviewSelectedItems` Set，PASS/WARN 可选，BLOCK 不可选。30 项新测试。681/681 TS。Codex 独立验收通过。 | P5-SY10C | DONE |
| **P5-SY10E** | 调度机制：Vercel Cron Route Handler + 手动触发入口 | **REWORK DONE**（2026-06-24 返工。发现 Cron 路径无法使用 claim_sync_run（要求 auth.uid()）。新增 Migration 00010 claim_sync_run_system RPC（service_role only，仅 dry_run，校验系统用户）→ Repository claimSyncRunSystem → SyncService _systemClaimConfig → 移除 actions.ts systemTriggeredBy 绕权 → server-actions.ts 直接构造系统 SyncService。744/744 TS，lint 0，build pass，253 Python。） | P5-SY10D | REWORK DONE |
| **P5-SY10F** | 独立验收与生产就绪 | 全量测试 + lint/build + Codex 独立审查 + 架构合规 | P5-SY10E | **DONE**（2026-06-24。文档收口完成 + Codex 独立验收通过。744/744 TS，lint 0，build pass，253 Python。） |


## P5-SY11 ProductVariant 软归档与库存视图降噪（DONE）

P5-SY11A~F 按全局 ProductVariant 状态实现软归档（技术实现完成）。P5-SY11G 语义返工将归档从全局 `is_archived` 迁移为用户级 `user_variant_preference` 偏好表。所有用户均可归档/恢复，每人独立视图，A 的归档不影响 B。`product_variant.is_archived` 列保留为遗留列，不再被业务代码读写。

### P5-SY11G 语义返工（2026-06-25 DONE）

### 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| **P5-SY11A** | Migration 00011：`is_archived` 列 + 审计字段 + 索引 + RLS | 新增 migration，含 `is_archived`（默认 false）+ `archived_at` + `archived_by`（FK→profiles）+ 部分索引 + RLS 收紧（Operator SELECT `AND is_archived=false`） | — | **DONE**（2026-06-24。18/18 静态契约测试。DDL 幂等：IF NOT EXISTS / DROP POLICY IF EXISTS。） |
| **P5-SY11B** | 类型同步 + Repository：archive/restore/filter | 更新 database.ts 类型；variantRepository 新增 archive/restore；list/getUnmatched 增加 `archiveStatus` 过滤（默认 active）；match/unmatch/batchMatch 阻止已归档操作 | P5-SY11A | **DONE**（2026-06-24。31/31 测试，lint 0 errors，build pass） |
| **P5-SY11C** | Server Actions：archiveVariants / restoreVariants | `requireActiveAdmin()`，Zod 校验 + revalidatePath | P5-SY11B | **DONE**（2026-06-25。Codex 独立验收通过。） |
| **P5-SY11D** | Inventory 层过滤：默认视图隐藏已归档 | getOverseasList/getLowStock/getOverseasStats 过滤已归档；getByProductId 不过滤 | P5-SY11A | **DONE**（2026-06-25。设计包通过，Codex 独立验收通过。） |
| **P5-SY11E** | Variant 列表页面 + 归档/恢复 UI | 实现 variants/page.tsx（表格 + 归档筛选标签 + Admin 批量归档/恢复）+ unmatched/page.tsx（仅活跃）；Operator 只读 | P5-SY11C, P5-SY11D | **DONE**（2026-06-25。Codex 独立复验通过。） |
| **P5-SY11F** | 同步非回归 + 质量门 + 文档收口 | 全量测试 + lint/build + Python + Codex 独立审查 | P5-SY11E | **DONE**（2026-06-25。22 项非回归测试。914/914 TS + lint 0 + build pass + Python 271。） |
| **P5-SY11G** | **语义返工：用户级 Variant 归档偏好** | 新建 `user_variant_preference` 表（Migration 00012），废弃全局 `is_archived`；所有用户均可归档/恢复；每人独立视图；预留"特别关注"扩展 | P5-SY11F | **DONE**（2026-06-25。Migration 00012 + 类型同步 + Repository 重写 + Server Actions (requireActiveAuth) + Inventory 过滤 + UI + 869 TS 测试 pass。） |

### P5-SY11G 语义返工目标边界（DONE — 2026-06-25）

- 废弃 `product_variant.is_archived` 全局列（不删除 Migration 00011，仅停止业务代码读写）。
- 新建 `user_variant_preference` 表：`user_id` + `variant_id` + `preference_type`（`'archived'`，后续可扩展 `'favorited'`）。
- 每个登录用户（Admin + Operator）均可归档/恢复自己的 Variant。
- A 的归档完全不影响 B 的视图（`WHERE user_id = auth.uid()` RLS 隔离）。
- Inventory 视图按当前用户归档偏好过滤。
- 后续"特别关注"功能复用同一偏好表，但本次不实现关注功能。
- 详细规格、验收标准和停止条件见 `docs/tasks/current-task.md`。

目标边界（P5-SY11G 新语义，已实现）：

- 不删除 `product_variant`，不改变 `Product -> ProductVariant -> Inventory` 模型。
- 归档通过 `user_variant_preference` 表（user_id + variant_id + preference_type='archived'）。
- 每个用户独立归档偏好，A 的归档不影响 B。
- 所有登录用户（Admin + Operator）均可归档/恢复。
- `product_variant.is_archived` 列为遗留列，业务代码停止读写。
- 归档 Variant 的 `inventory` 仍允许被同步链路更新。
- 预留"特别关注"扩展（preference_type 可新增 'favorited'），本次不实现。

## P5-SY5 子任务拆分（V5.4 修订）

| Sub-Task ID | 任务 | 依赖 | 类型 |
|---|---|---|---|
| **P5-SY5A** | Migration 00007（第五次聚焦返工完成，59/59 静态契约测试，独立静态验收通过）| P5-SY5 | DONE |
| **P5-SY5B** | 认证链修复：`getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()` | P5-SY5A | DONE（独立验收通过，25/25） |
| **P5-SY5C** | Sync Feature Module 骨架（含 ArtifactProvider 接口：`prepare()` 先 validateJsonValue 后 stringify，返回 `{ bytes, hash, normalizedContent }` + `store(PreparedArtifact)` + `listCandidates()` + `deleteMany()`；validateJsonValue 运行时验证器递归拒绝 undefined/function/Symbol/BigInt/NaN/Infinity/toJSON/自定义原型 + V5.4.2 增强：WeakSet 循环引用检测、Reflect.ownKeys 拒绝 Symbol 键、拒绝稀疏数组/数组额外属性/accessor-getter、禁止 any + V5.4.3 增强：仅接受规范数组索引（String(index)===key, index<length）拒绝伪数字 "01"/"4294967295"、拒绝 Array 子类（prototype !== Array.prototype）、拒绝数组 toJSON、拒绝不可枚举属性（enumerable===false）、使用 descriptor.value 读取值、WeakSet try/finally 删除（祖先链—共享引用通过/真循环拒绝）；GC orchestrator 直接 cutoff `now - 7 days` + 恢复 getRecentlyCompletedRunIds(now-60min) 双层保护；更新后的 SyncRunner 接口（inputArtifact/boundPlanArtifact 类型 JsonValue）+ 预生成 runId + 先 claim 后 store 生命周期） | P5-SY5A, P5-SY5B | DONE（独立验收通过，129/129） |
| **P5-SY5C2** | 类型补全 + Schema + Repository + SyncService + 依赖工厂 + Server Actions + Mock Provider/Runner | P5-SY5C | DONE（独立验收通过，258/258） |
| **P5-SY5D** | Sync 页面与客户端组件 | P5-SY5C2 | DONE（独立验收通过，263/263） |
| **P5-SY5E** | 侧边栏集成 | P5-SY5D | DONE（独立验收通过，263/263） |
| **P5-SY5F** | MockSyncRunner + MockArtifactProvider + 端到端流程验证（含 validateJsonValue ~24 场景：V5.4.1 基础 ~12 场景 NaN/Infinity/嵌套 undefined/toJSON/自定义原型/函数/Symbol/BigInt/正常值 round-trip + V5.4.2 新增 ~4 场景 Symbol 键/循环引用/稀疏数组/getter 属性 + V5.4.3 新增 ~8 场景 非规范索引"01"/"4294967295"/不可枚举属性/Array 子类/数组自身 toJSON/数组继承 toJSON/共享对象引用通过/真正循环祖先链拒绝；prepare() normalizedContent round-trip + store hash 一致性 + 非确定性序列化安全 + claim 失败无 artifact + store 失败 release failed + GC orchestrator 双层保护（7 天 cutoff + getRecentlyCompletedRunIds 60 分钟保护）+ 防误删 in_progress/被引用 artifact + GC 防误删"artifact 超 7 天但 Dry Run 刚完成"边界测试 + 被 Real Write 引用的 Dry Run artifact GC 保护 + 未被引用 orphan 反例删除 + 终态 exit_code 约束 + Runner JsonValue 类型验证；Repository 接口新增 getActiveRunIds / getRecentlyCompletedRunIds / getReferencedDryRunIds，共 ~46+2 场景） | P5-SY5D | DONE（Codex 独立复验通过，281/281） |
| **P5-SY5G** | 并发锁原子 claim 测试（Codex 独立复验通过：D2/F2 确定性 FOR UPDATE 行锁断言确认，无弱断言通过路径；281 非并发测试全通过，lint 0 errors，build 通过；未连接生产 Supabase，未执行生产 Migration 00008/00007） | P5-SY5A, P5-SY5F | DONE（Codex 独立复验通过） |
