# Current Project State

> 文档导航：[文档树](README.md) · [当前任务包](tasks/current-task.md) · [项目概览](project-overview.md) · [架构](architecture.md) · [数据库设计](database-design.md)

## Current Phase

Phase 5 — 海外仓库存同步生产化

## Current Task

`P5-SY12` — 特别关注阶段 B 最小闭环（DONE，2026-06-25）

## Completed Tasks

- Task 0.1 — Next.js 项目初始化（create-next-app + TypeScript + Tailwind + shadcn/ui + 13 个 shadcn 组件）
- Task 0.2 — Supabase 项目连接 + Migration 执行 + 数据库初始化 + 类型生成
- Task 0.3 — Auth 登录 + middleware + Dashboard 布局（Sidebar + Header）
- Task 0.4 — 业务模块骨架（5 个业务模块 + dashboard 占位，共 6 个模块）
- Task 0.4 Architecture Audit — 架构审计（2026-06-10，综合评分 9/10，修复 3 个问题）
- Task 1.1 — Product 产品管理 CRUD（2026-06-11，产品列表 + 详情 + 表单 + 数据层收口 + 错误传播修复 + loading/error 状态）
- ProductVariant Mapping 数据层与安全基础（Migration 00003/00004/00005 + RPC 安全收口 + 函数内去重 + 权限收紧）
- Task 2.1 — 国外库存页面 MVP 初版（2026-06-11，统计卡片 + 筛选 + 表格 + 分页）
- `P2-I1` — 海外库存查询与分页正确性（2026-06-12，独立验收通过）
- `P2-I2` — 海外库存页面交互与响应式验收（2026-06-12，独立验收通过）
- `P2-I3` — 海外库存真实数据走查与使用验收（2026-06-12，确认当前无海外库存，数据来源为 BigSeller 页面抓取）
- `P5-SY1` — BigSeller 抓取器只读试跑与首仓字段确认（2026-06-12，独立验收通过）
- `P5-SY3B` — 菲律宾 Inventory 实际写入与新 SKU 创建（2026-06-12，第四次独立验收通过；91 Variants + 91 Inventory + Warehouse 改名，幂等与执行保护验证通过）
- `P5-SY4A` — SyncLog 与失败保留机制设计及任务拆分（2026-06-12，第七次独立设计验收通过）
- `P5-SY4B` — Migration 00006：事务型海外库存同步 RPC（2026-06-13，独立静态验收通过；673 行，26/26 测试，未执行）
- `P5-SY4C` — Executor 适配 RPC 与 SyncLog 写入（2026-06-13，独立验收通过；156/156 测试通过：76 executor + 26 plan + 44 verifier + 10 structural，未执行 Migration，未发生数据库写入）
- `P5-SY4D` — 同步失败模式测试覆盖（2026-06-13，独立验收通过；183/183 测试通过：27 sync_log + 76 executor + 26 plan + 44 verifier + 10 structural，全部通过 CLI 严格验证退出码，compileall/lint/build 通过，未连接 Supabase，未执行 Migration）
- `P5-SY4E` — CLI 集成与 Dry Run 端到端验证（2026-06-13，独立验收通过；修复 plan_drift_check 不再硬编码 PASS，新增 plan_drift_count/differences；193/193 测试通过：10 cli_integration + 27 sync_log + 76 executor + 26 plan + 44 verifier + 10 structural）
- `P5-SY5` — 手动同步入口架构设计与任务拆分（2026-06-14，V5.4.3 第十一次独立设计验收通过；validateJsonValue ~24 场景，P5-SY5F ~46 场景，仅设计文档未实现代码）
- `P5-SY5A` — Migration 00007：sync_run 表与同步运行 RPC（2026-06-14，第五次聚焦返工，独立静态验收通过；59/59 静态契约测试；claim FOR UPDATE 竞态修复 + release NULL exit_code 拒绝）
- `P5-SY5B` — 认证链修复（2026-06-14，独立验收通过；25/25 单元测试；新增 `getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()`，旧函数行为不变）
- `P5-SY5C` — Sync Feature Module 骨架（2026-06-14，独立验收通过；129/129 测试；validateJsonValue V5.4.3 / ArtifactProvider 接口 / GC orchestrator / SyncRunner 契约 / 类型契约 + expectTypeOf 精确断言）
- `P5-SY5C2` — Sync Feature Module 后端实现（2026-06-19，独立验收通过；258/258 测试；types.ts / schema.ts / repository.ts / sync-service.ts / actions.ts / mock-artifact-provider.ts / mock-sync-runner.ts + 7 个测试文件）
- `P5-SY5D` — Sync 页面与客户端组件（2026-06-19，独立验收通过；263/263 测试；查看详情 Sheet + MockArtifactProvider static 存储 + getCurrentActiveUser 认证链；server-actions.ts / page.tsx / sync-page-content.tsx / loading.tsx / error.tsx）
- `P5-SY5E` — 侧边栏集成（2026-06-19，独立验收通过；263/263 测试；sidebar-nav.tsx 新增"数据同步"分组 + RefreshCw 图标 + 库存同步入口，phase 0）
- `P5-SY5F` — Mock E2E 流程验证（2026-06-19，Codex 独立复验通过；281/281 测试；integration.test.ts 18 项集成测试：非确定性序列化 + GC 全管道 + GC 防误删边界 + artifact 生命周期 + 被引用 Dry Run GC 保护 + orphan 反例删除。Repository 接口新增 getActiveRunIds / getRecentlyCompletedRunIds / getReferencedDryRunIds）
- `P5-SY5G` — 并发锁原子 Claim 测试（2026-06-19，Codex 独立复验通过：D2/F2 确定性 FOR UPDATE 行锁断言确认 — D2 A FOR UPDATE 持有 dry_run → B UPDATE lock_timeout → A 释放 B 成功；F2 B FOR UPDATE 持有 in_progress run → A heartbeat lock_timeout → B 释放 heartbeat 成功；无 expect(true).toBe(true) 或"环境差异不强制断言"通过路径；Current Task References 已更新为核心文件。44/44 并发测试（9 静态校验 + 35 双事务并发），281 非并发测试全通过，lint 0 errors，build 通过；未连接生产 Supabase，未执行生产 Migration 00008/00007）
- `P5-SY6` — 定时任务与运行环境评估（2026-06-19，Codex 第三次独立设计验收通过；两次返工：4 项聚焦 + 1 项小修；5 方案 × 10 维度对比，推荐两层架构 Vercel Cron + Worker，架构边界/平台事实/手动路径/验证口径全部修正；未实现代码，未连接生产 Supabase，未执行生产 Migration；评估文档 `docs/tasks/archive/p5-sy6-runtime-design.md`）
- `P5-SY7` — 单仓端到端验收（2026-06-19，Codex 独立复验通过；A~F 全部维度验证通过，6 项已知差距/0 项阻塞项。差距分析文档 `docs/tasks/archive/p5-sy7-gap-analysis.md`。生产 Migration 00006/00007/00008 已执行，P5-SY8 就绪）
- `P5-SY8A` — VN 只读抓取与 Dry Run 方案（2026-06-19，Codex 独立验收通过；64 行抓取 + Dry Run 通过，输出 `bigseller-inventory-20260619-205955.json`）
- `P5-SY8B` — VN 越南青林湾仓库真实写入与端到端验收（2026-06-19 DONE + 2026-06-20 Codex 独立验收通过。首次 RPC 提交 64 Variants (country=VN) + 64 Inventory；幂等重跑通过：0 新增，Phase G/I PASS，sync_log status=success/synced_count=64；修复 6 处硬编码 PH→WAREHOUSE_COUNTRY + Migration 00009 通用化 RPC。执行报告 `p5-sy8b-vn-execute-20260619-215055.json`。Codex 返工 4 项全部通过：令牌国家绑定 / Migration 00009 静态契约测试 13/13 / 执行报告时间戳 / 文档同步。160/160 Python 测试，npm lint 0 errors，npm build 通过）
- `P5-SY8C` — TH 泰国仓（DEE-龙仔厝 ICE 专属）只读抓取与 Dry Run（2026-06-20 DONE，Codex 独立验收通过。A0 仓库改名 + A1 配置切换 + A2 BigSeller 抓取 72 行 + A3 输入校验 + A4 Dry Run（返工：报告身份 token 派生 + Dry Run Phase E 空 DB 兼容）+ A5 全链路国家断言。196/196 Python 测试，13/13 Migration 00009 契约测试，compileall 通过，npm lint 0 errors，npm build 通过。报告区分：130900=stored plan baseline / 133500=CLI execution report。未执行真实写入。）
- `P5-SY8D` — TH 泰国仓（DEE-龙仔厝 ICE 专属）真实写入与端到端验收（2026-06-20 DONE，Codex 独立验收通过。真实 RPC 写入：72 Variants (country=TH) + 72 Inventory；Phase G/I PASS；sync_log status=success。DB 只读核查：72 Variants 全部 country=TH，72 Inventory 全部链接 TH warehouse。新增 P5-SY8D-TH 令牌 + 令牌—模式绑定 + 执行器层安全门 + finished_at 审计语义修复。两轮 Codex 返工全部通过。228/228 Python 测试（25 CLI + 81 executor + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall 通过，npm lint 0 errors，npm build 通过。报告：p5-sy8d-th-dry-run-20260620-140012.json / p5-sy8d-th-execute-20260620-140034.json）
- `P5-SY8E` — MY 马来西亚仓（喜运达MY仓）只读抓取与 Dry Run 方案（2026-06-20 DONE，Codex 独立验收通过。BigSeller 抓取 48 行，warehouse=喜运达MY仓 (autoid=warehouse_option_4)。DB 仓库 `马来西亚仓`→`喜运达MY仓` 改名已确认。Stored Plan Baseline `p5-sy3a-dry-run-20260620-232838.json`，CLI Dry Run 报告 `p5-sy8e-my-dry-run-20260620-233129.json`，plan_drift_check=PASS。invalid sidecar: 1 行被拒绝（空包 0000）。新增 P5-SY8E-MY 令牌（仅 --dry-run）+ test_my_full_chain_country_assertions（execute_plan_v2 真实执行，逐条验证 RPC p_variants/p_inventory country=MY + Phase G country=eq.MY + Phase I wh_expected.country=MY + SyncLog warehouse_id/status）。Codex 返工完成：MY 全链路国家断言 + 文档同步。234/234 Python 测试（29 CLI + 83 executor + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall 通过，npm lint 0 errors，npm build 通过。未执行真实写入。）
- `P5-SY8F` — MY 马来西亚仓（喜运达MY仓）真实写入与端到端验收（2026-06-21 DONE，Codex 独立验收通过。全新 BigSeller 抓取 48 行 + invalid sidecar 1 行（空包 0000）。P5-SY8F-MY 令牌（唯一 MY --no-dry-run 令牌，P5-SY8E-MY 保持仅 --dry-run）；动态错误提示指向正确写入令牌。首次写入：RPC variants_created=48，inventory_inserted=48，warehouse_renamed=true；Phase G PASS（48 SKU 全部一致），Phase I PASS（name=喜运达MY仓，country=MY）；SyncLog status=success。幂等重跑：0 新增 Variant，0 新增 Inventory，48 unchanged；plan_drift_check PASS。写后验证：RPC 摘要内部一致，所有 Variant country=MY，所有 Inventory 关联 MY warehouse_id，started_at/finished_at 非空。239/239 Python 测试（85 executor + 32 CLI + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall 通过，npm lint 0 errors，npm build 通过。执行报告：`p5-sy8f-my-execute-20260621-002507.json`（首次）/ `p5-sy8f-my-execute-20260621-002540.json`（重跑）。）
- `P5-SY8G` — ID 印尼仓（印尼-DEE仓库）只读抓取与 Dry Run 方案（2026-06-21 DONE，Codex 独立复验通过。BigSeller 抓取 35 行 + invalid sidecar 1 行（空包 0000），warehouse=印尼-DEE仓库，autoid=warehouse_option_3。DB 仓库 `印尼仓`→`印尼-DEE仓库` 改名已确认。P5-SY8G-ID 令牌（仅 --dry-run）。Codex 返工 3 项修复通过：1) --no-dry-run 动态提示 P5-SY8H-ID（新增 `_PENDING_WRITE_TOKENS`）；2) `_DRY_RUN_ONLY_TOKENS` 一致性测试改用 ast.parse；3) `_NO_DRY_RUN_EXCLUSIVE_TOKENS` 断言不再被 `except AssertionError: pass` 吞掉。后收口维护：docs/current-state.md 残留状态同步 + Sync GC 测试夹具 finishedAt 时钟控制修复。245/245 Python 测试，256/256 非并发同步测试，compileall/lint/build 通过。未执行真实写入。）
- `P5-SY8H` — ID 印尼仓（印尼-DEE仓库）真实写入与端到端验收（2026-06-21 DONE，Codex 独立验收通过。P5-SY8H-ID 令牌（--no-dry-run 写令牌）。首次写入：RPC variants_created=35 (country=ID)，inventory_inserted=35，warehouse_renamed=true；Phase G PASS（35 SKU 全一致）；Phase I PASS（name=印尼-DEE仓库，country=ID）；SyncLog success。幂等重跑：0 new variants，0 inventory inserted，35 unchanged；plan_drift_check=PASS。Codex 独立验收：代码、报告、真实 DB 只读核查、幂等重跑、质量门均通过。128/128 Python 测试（89 executor + 39 CLI），compileall 通过，npm lint 0 errors，npm build 通过。）
- `P5-SY9B` — BigSeller Session Health Check（2026-06-23 Codex 独立复验通过：新增 health_check.py 只读 headless 健康检查（含 profile_unavailable 真实分类）+ verifyBigSellerSession() Server Action（checked_at → checkedAt 字段转换）+ Sync 页面会话健康状态显示 + syncWarehouse/syncAllWarehouses 服务端 session health guard。7 种状态分类：healthy / need_login / need_verification / profile_unavailable / page_structure_changed / table_not_loaded / unknown_error。27/27 TypeScript 测试 + 15/15 Python 测试，lint 0 errors，build 通过。）
- `P5-SY9C` — 真实 Provider / InputSource / Production wiring（2026-06-23 Codex 独立复验通过。3 项指标：1) server-actions.ts 已移除 MockSyncRunner import + wireActions()，读路径拆为 repository-only，triggerSync 直接返回中文错误不构造 SyncService；2) FileSystemArtifactProvider 支持注入 baseDir（默认 runtime/artifacts），测试使用 os.tmpdir() 隔离；3) production-wiring.test.ts 无 expect(true) placeholder，含源码检查/NODE_ENV=production 拒绝验证/feature gate 拦截测试。98/98 P5-SY9C 测试，15/15 Python，379/379 非并发，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。）

- `P5-SY9D` — 单仓 Web Dry Run → 审核 → Real Write 绑定（2026-06-23 DONE。第三次返工通过 Codex 验收：confirmRealWrite 全部绑定校验强制化 — country 校验不再条件跳过 + 查询契约除杂（SyncRunAdminRow 不含 hash）+ 60 分钟边界修复。51/51 P5-SY9D 测试，430/430 非并发同步测试，Python 85/85 通过，lint/build 通过。Web 真实写入入口保持 server-side disabled。）
- `P5-SY9E` — heartbeat / timeout / 子进程控制（2026-06-23 DONE。Codex 独立验收通过。统一 terminate(reason) 管线 + 可注入 heartbeatIntervalMs + prepareRunnerContext 异常清理 + capabilities 抛错 release 失败 → indeterminate + 23 项测试。453/453 非并发同步测试，Python 85/85，lint/build 通过。Web 真实写入入口保持 server-side disabled。未连接生产 Supabase，未执行真实写入。）
- `P5-SY9F` — 批量全部海外仓 Dry Run（2026-06-23 DONE。Codex 独立复验通过（含 7 项返工）。Admin 可触发"批量 Dry Run / 审核总览"；每仓独立 claim/execute/release；单仓失败不影响其他仓；返回 BatchDryRunResult 含 warehouse name/country/runId/status/fetched rows/valid/invalid SKU/new variants/inventory/warehouseRenamePlan/planDriftCheck/failureReason。planDriftCheck !== 'PASS' → status='blocked'（非 ready）。warehouseRenamePlan 包含 action/currentName/targetName/message 详情。页面"批量 Dry Run"按钮调用 triggerBatchDryRun() 而非 syncAllWarehouses()；展示逐仓审核卡片。MockSyncRunner 新增 planDriftCheck/planDriftCount/renamePlan 可配置属性。删除 __debug.test.ts。495/495 非并发同步测试（17 文件），Python 15/15，lint 0 errors / 14 warnings，build 通过。Web 真实写入入口保持 disabled。）
- `P5-SY9G` — 批量审核后真实写入（2026-06-24 DONE，Codex 独立验收通过。Admin 在批量 Dry Run 审核总览中勾选 ready 仓库，输入确认短语「确认写入」后逐仓真实写入。每仓独立 claim/release/sync_log，单仓失败不影响其他仓。confirmRealWrite 签名新增 confirmToken 参数，消除硬编码 P5-SY3B-PH。新增 triggerBatchRealWrite Server Action + 17 项测试。批量写入页面 UI：就绪仓库复选框 + 全选/取消 + 确认短语输入 + 写入结果总览。511/511 非并发同步测试（17 文件），lint 0 errors / 15 warnings，build 通过。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled；Web 真实写入入口保持 server-side disabled。）
- `P5-SY9H` — 页面体验与运营可用性收口（2026-06-24 DONE，Codex 独立验收通过。6 项体验改进：仓库聚合概览卡片 + Operator 失败原因可见 + 客户端分页 + 海外库存同步状态列 + 页间导航 + sync_log 明细。新增 SyncLogRecord/WarehouseSyncStatus 类型 + getSyncLog() repository + getOverseasWarehouseSyncStatus()/getSyncLogDetail() Server Action + 12 项测试 + 清理标记。523/523 非并发同步测试（19 文件），lint 0 errors / 15 warnings，build 通过。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。）
- `P5-SY9I` — 独立验收与生产启用准备（2026-06-24 DONE，Codex 独立验收通过。含一次返工：拆分 `npm run test`/`npm run test:concurrency` 脚本解决 concurrency.test.ts 缺少 PG 环境变量时退出码 1 的问题。最终质量门：523/523 TS 测试（18 文件）+ lint 0 errors / 15 warnings + build 通过 + 242/242 Python 测试（compileall + health_check 15 + plan 26 + verifier 44 + executor 89 + sync_log 29 + cli_integration 39）。架构边界合规审查通过。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled；生产启用待用户明确授权。）
- `P5-SY9J` — 生产启用受控验证（2026-06-24 DONE，用户授权后执行。WEBSYNC_REAL_WRITE_ENABLED=true 已在 .env.local 启用。受控验证选 PH 仓（菲律宾-新创启辰自建仓）：Web Dry Run（104 行 → 6 新 variants + 80 更新 + 18 未变更）→ 审核（plan_drift_check=PASS）→ Real Write 成功（sync_log status=success，new_variants_count=6，库存更新已确认：SKU 7148556251712 数量 100,716→80,481）。修复 web_bridge.py execute_plan_v2 调用签名不匹配（移除已废弃的 warehouse/confirm_token/dry_run_report_path/input_json_path 参数）。已知小问题：execute_plan_v2 返回 summary 全为零（不影响实际写入，sync_log 记录正确），记入技术债务。）
- `P5-SY9K` — 返工：禁用旧同步入口 + 修复 Web Real Write summary（2026-06-24 DONE。两项返工：1) syncWarehouse / syncAllWarehouses 永久禁用，不再执行真实写入，返回中文错误引导用户使用 Dry Run → 审核 → 确认写入流程；sync-page-content.tsx 移除 syncWarehouse import / handleTrigger / 「快速同步」按钮。2) web_bridge.py Real Write summary 从 rpc_result["rpc_summary"] 读取（而非直接从 rpc_result 顶级键读取），修复返回全零问题。新增 TypeScript 测试（production-wiring.test.ts 7 项源码检查 + session-health.test.ts 4 节重写）和 Python 测试（test_web_bridge_summary_reads_from_rpc_summary）。质量门：526/526 TS 测试 + 252/252 Python 测试 + lint 0 errors + build 通过。WEBSYNC_REAL_WRITE_ENABLED=false 已恢复到安全状态。）
- `P5-SY10A` — 规则引擎核心：类型 + 纯函数 + 单元测试（2026-06-24 DONE。新增 `rules-engine.ts`：`evaluateRules(input)` 纯函数，11 条规则 R1~R11，冷启动/有基线双路径，BLOCK > WARN > PASS 决策推导。新增 `evaluateSessionHealth()` 辅助函数。新增 `types.ts` 中 `RuleLevel` / `RuleEvaluation` / `RuleInput` / `RuleVerdict` 类型。60 项测试覆盖每规则命中/不命中/边界 + 组合场景 + 冷启动双路径。质量门：586/586 TS 测试，lint 0 errors，build pass。不涉及 DB/Cron/UI/Real Write。）
- `P5-SY10B` — 历史上下文提供器：基线追踪 + 连续失败检测（2026-06-24 DONE，Codex 返工复验通过。SyncRepository 接口新增 `getWarehouseHistory(warehouseId)`，MockRepository + SupabaseSyncRepository 实现。从 sync_run 推导 hasBaseline / consecutiveFailures（仅 dry_run failed，real_write 屏障）/ lastSuccess / stats（最近 5 次完成均值）。`sync-service.ts` 中 `buildResultSummary()` 将 scraperMeta 字段持久化到 result_summary JSONB。35 项测试覆盖冷启动/有基线/连续失败 1~3/real_write 屏障不穿透/成功重置/跨仓隔离/缺失 result_summary/混合格式。质量门：621/621 TS 测试，lint 0 errors，build pass。不新增 DB 表，不改 Migration。）
- `P5-SY10C` — 自动预审编排 Server Action（2026-06-24 DONE，Codex 独立复验通过。返工完成：① 在 triggerBatchDryRun 之前逐仓预取 getWarehouseHistory 并缓存，确保 cold start 仓库 hasBaseline=false，已有历史仓库 stats 不含当前 run；② history 获取失败 → BLOCK（history_unavailable 规则），含中文原因，不 fallback 冷启动；③ 新增冷启动 R7/R11 路径测试 + 预取历史排他性测试。`runAutoPreReview` Server Action：requireActiveAdmin + session health guard + wireRealActions。30 项测试。质量门：651/651 TS 测试，lint 0 errors，build pass。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。）
- `P5-SY10D` — 预审页面 UI（2026-06-24 DONE，Codex 独立验收通过。Sync 页面新增「自动预审」入口（调用 `runAutoPreReview()`）。BatchReviewCard 扩展：RuleBadge（PASS 绿/WARN 黄/BLOCK 红）+ 可展开规则详情（evaluations[].message）+ WARN 可选带警告 / BLOCK 不可选含阻断原因。统计栏 PASS/WARN/BLOCK 三色计数。保留「批量 Dry Run」按钮（不运行规则引擎）。Operator 只读。`AutoPreReviewItem.dryRun` 补全 `warehouseRenamePlan` 字段。复选框：独立 `autoReviewSelectedItems` Set，PASS/WARN + status=ready 可选（checked 状态可变化），BLOCK/failed/blocked 不可选。清理 unused imports（BatchRealWriteItemResult 等）。30 项新测试（含 8 项复选框行为源码检查 + 1 项 Codex 验收追加）。质量门：681/681 TS 测试（22 文件），lint 0 errors，build pass。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。）
- `P5-SY10E` — 调度机制：Vercel Cron Route Handler + 手动触发入口（2026-06-24 DONE，2026-06-24 返工完成。返工原因：Cron Route 通过 API key 后无 Supabase 用户 session，`claim_sync_run` 要求 `auth.uid()`，Cron 生产路径会失败。返工方案：① Migration 00010 新增 `claim_sync_run_system` RPC（SECURITY DEFINER，service_role only，校验 p_triggered_by 是激活 admin，仅允许 dry_run，复用并发锁/warehouse 校验/lease/僵尸回收逻辑）；② Repository 新增 `claimSyncRunSystem` 方法；③ SyncService 新增 `_systemClaimConfig` 配置项；④ 移除 `actions.ts` 中 `systemTriggeredBy` 绕权参数（`triggerBatchDryRun`/`runAutoPreReview` 始终调用 `requireActiveAdmin`）；⑤ `server-actions.ts` `runScheduledAutoPreReview` 直接构造带 `_systemClaimConfig` 的 SyncService，不经过 `createSyncActions`。新增 Migration 00010 静态测试 + claim_sync_run 未修改验证 + 系统 claim 路径 Mock 测试 + real_write 拒绝测试。744/744 TS 测试（23 文件），lint 0 errors，build pass，253 Python 通过。）
- `P5-SY11-REWORK` (P5-SY11G A~F) — 语义返工：用户级 Variant 归档偏好（2026-06-25 DONE。全局 product_variant.is_archived 迁移为用户级 user_variant_preference。Migration 00012 新建 user_variant_preference 表 + RLS + 移除 operator_select_variant 的 is_archived 全局过滤。variantRepository archive/restore/list/getUnmatched 全部改用 user_variant_preference，每人独立归档。Server Actions 改为 requireActiveAuth，Admin/Operator 均可操作。Inventory 层按当前用户归档偏好过滤。UI 所有登录用户可归档/恢复。P5-SY11G 返工（2026-06-25）：修复 4 项阻塞问题 — 1) inventory repository getOverseasList/getLowStock 从 v.id 改为 row.variant_id 判断归档；2) list() 归档过滤从 JS 后置改为 DB 层 notIn/in 在分页前完成；3) archive/restore 返回实际变更数；4) list() active tab 改用 query.notIn() 替代 query.not('id','in',...)，.not() 期望 PostgREST 原始括号语法而 JS 数组无括号导致过滤失效。质量门：896/896 TS 测试，30 文件，lint 0 errors，build pass。Python：315 passed + 5 collection errors。）
- `P5-SY11G-RUNTIME` — 运行时修复与生产验证（2026-06-25 DONE。两项修复：1) Migration 00012 由用户在 Supabase Dashboard 手动执行（Pooler 不识别 tenant，自动连接不可用），验证 user_variant_preference 表 + 4 条 RLS 策略存在，PostgREST schema cache 已刷新；2) getSyncRuns limit 契约修正：Zod schema max(500).default(200) → max(100).default(100)，server-actions.ts limit:500→100，与 DB RPC get_sync_runs p_limit > 100 强制拒绝一致。人工验收通过：/dashboard/inventory/overseas 正常加载（不再报 schema cache 错误），/dashboard/sync 正常加载，/dashboard/variants 归档/恢复正常，A 归档后 B 视图不受影响，归档是个人偏好非全局。质量门：896/896 TS 测试，lint 0 errors，build pass。）
- `P5-SY12` — 特别关注阶段 B 最小闭环（2026-06-25 DONE + 2026-06-25 返工修复。Migration 00013 扩展 `user_variant_preference.preference_type` CHECK 约束支持 `'favorited'`（不新建表，需用户手动执行）。新增 `src/features/preferences/` 模块：types（PreferenceError / PreferenceResult / FollowedVariantBasic）+ schema（toggleFavoriteSchema）+ repository（getFavoritedVariantIds / isFavorited / favorite / unfavorite / toggleFavorite / getFollowedVariantsBasic）+ actions（toggleFavoriteAction — requireActiveAuth）。海外库存列表每行新增星标按钮（乐观更新 + 失败 toast 回滚 + 成功 router.refresh）。Dashboard 首页新增「关注产品动态」区（空状态 / 表格 + 低库存置顶 + 告警摘要条 / 加载失败错误状态）。阶段 B 告警临时用 `product.safety_stock`。归档与关注可共存（UNIQUE 按 user_id+variant_id+preference_type）。不新增 variant_follows 表、不新增 daily_sales/est_days/lead_time_days、不改 sync RPC / Python。2026-06-25 返工修复：1) 星标按钮失败回滚 + toast；2) 关注查询失败不再静默空列表；3) 清理未使用 imports/warnings。质量门待返工后重新跑。）

## Awaiting Review — P5-SY12 等待 Codex 独立复核

P5-SY12 特别关注阶段 B 代码已完成并通过质量门（979/979 TS 测试，lint 0 errors，build pass）。

**⚠ Migration 00013 需要用户在 Supabase SQL Editor 手动执行并验证**，执行前 P5-SY12 只能算代码完成，不能算生产可用。

P5-SY11-REWORK 已完成并返工修复（P5-SY11G A~F）。P5-SY11G-RUNTIME 两项运行时修复已完成并通过人工验收。所有子任务通过验收。`product_variant.is_archived` 保留为遗留列，不再被业务代码读写。归档已迁移为用户级 `user_variant_preference` 表（个人偏好，A 归档不影响 B）。Migration 00012 由用户在 Supabase Dashboard 手动执行。

P5-SY11G 返工修复内容（2026-06-25）：
1. `inventory/repository.ts`：`getOverseasList`/`getLowStock` 使用 `row.variant_id` 判断归档（不再依赖 variant join 的 `v.id`，join select 不含 id）
2. `variants/repository.ts` `list()`：归档过滤在 DB 层完成（`.notIn('id',archivedArray)` / `.in('id',archivedArray)`），分页前过滤，total 准确
3. `variants/repository.ts` `archive()`/`restore()`：先查询已有偏好，仅插入/删除实际需要变更的记录，返回真实变更数
4. `variants/repository.ts` `list()`：`.not('id','in',archivedArray)` → `.notIn('id',archivedArray)`，前者期望 PostgREST `(id1,id2)` 括号格式但 JS 数组无括号 → PostgREST 拒绝

P5-SY11G-RUNTIME 修复内容（2026-06-25）：
1. Migration 00012 手动执行至生产数据库：`user_variant_preference` 表 + RLS + PostgREST schema cache 刷新
2. `getSyncRuns` limit 契约修正：Zod `max(500).default(200)` → `max(100).default(100)`，与 DB RPC `p_limit > 100` 拒绝一致
3. 验证：海外库存页不再报 schema cache 错误；归档/恢复个人偏好隔离正确

**Current Task**: P5-SY12 特别关注阶段 B（DONE，2026-06-25）。等待用户确认下一任务，不自动进入 P5-SY12 阶段 C。

## Authentication Status

已完成：

- Supabase Auth（邮箱密码登录）
- Session 管理（`@supabase/ssr`）
- `src/middleware.ts` — 路由守卫（未登录 → `/auth/login`）
- `src/lib/auth.ts` — `getCurrentUser()` / `requireAdmin()` / `requireAuth()` / `getCurrentActiveUser()` / `requireActiveAdmin()` / `requireActiveAuth()`
- `/auth/login` — 登录页（自定义 UI，中文错误提示）
- `/auth/callback` — Auth 回调处理
- Dashboard Header — 用户信息 + 角色标签 + 退出按钮
- 角色体系：admin（管理员）/ operator（运营）
- 管理员账号已创建

## Database Status

| 项目 | 状态 |
|---|---|
| Supabase 项目 | `hzlhqyditalumhnxbaim.supabase.co`（Singapore） |
| 数据表 | 13 张（role, profiles, warehouse, product, product_variant, inventory, shipment, shipment_item, tracking_event, sync_log, sync_run, sync_warehouse_lock, user_variant_preference） |
| RLS | 46 条策略，全部启用 |
| 函数 | `get_user_role` / `handle_new_user` / `update_updated_at_column` / `create_shipment_transactional` / `batch_match_variants` / `sync_warehouse_inventory` / `claim_sync_run` / `claim_sync_run_system` / `release_sync_run` / `heartbeat_sync_run` / `cleanup_expired_sync_runs` / `get_sync_runs` / `get_sync_run_detail` / `trg_sync_warehouse_lock_insert` |
| 触发器 | 5 个 updated_at + 1 个 on_auth_user_created |
| Seed 数据 | 2 角色（admin/operator）+ 6 仓库（CN/TH/ID/MY/PH/VN） |
| 类型文件 | `src/types/database.ts`（从 migration DDL 解析生成） |

## Environment Status

| 变量 | 位置 | 状态 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | ✅ 已配置 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | ✅ 已配置 |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` | ✅ 已配置 |
| 模板 | `.env.example` | ✅ 已创建（仅变量名，无真实值） |

限制：

- `service_role` 禁止前端使用（`createServiceClient()` 含 throw guard）
- `.env.local` 在 `.gitignore` 中，不提交

## Pending Modules

| 模块 | 预计实现 | 当前状态 |
|---|---|---|
| Products CRUD 页面 | Phase 1 | ✅ 已完成（列表 + 详情 + Sheet 表单 + 启停确认） |
| Variants 页面 | Phase 1 | ✅ 已完成（P5-SY11E：列表 + 搜索 + 归档/恢复 + unmatched） |
| Dashboard 首页 | Phase 2 | ✅ 已实现（库存概览 + 海外库存入口 + 快捷操作） |
| Overseas Inventory 页面 | Phase 2 | ✅ 查询、交互与响应式已验收；正在确认真实数据可用性 |
| Domestic Inventory 页面 | Phase 2 | 仅骨架，无页面 |
| In-Transit Inventory 页面 | Phase 2 | 仅骨架，无页面 |
| Shipments 页面 | Phase 3 | 仅骨架，无页面 |
| Users 页面 | Phase 4 | 仅骨架，无页面 |
| Sync 脚本 + 页面 | Phase 5 | ✅ P5-SY3B 完成：91 Variants + 91 Inventory + Warehouse 改名，幂等 3 次重跑验证 |

## Deferred Items

以下事项已记录但暂不处理：

- ~~ProductVariant 页面开发（`/dashboard/variants`、`/dashboard/variants/unmatched`）~~ — ✅ 已完成（P5-SY11E）
- 8 个现有 lint warnings — 不影响功能，在最终验收时批量修复
- `middleware.ts` 迁移至 `proxy.ts` — Next.js 16 弃用警告，当前 middleware 仍正常工作
- `profiles.is_active` 认证函数已新增（P5-SY5B），旧调用方逐步迁移
- P5-SY5C 已完成（types / validateJsonValue / ArtifactProvider 接口 / GC orchestrator / SyncRunner 接口 / contract.test.ts）。P5-SY5C2 独立验收通过。
- 库存历史快照（`inventory_snapshots` 表）— P5-SY9 暂不新增；BigSeller 已提供趋势/预测数据，后续如需自有趋势再单独评估
- 自动同步与部署 — 手动执行同步，无 CI/CD
- 当前使用 Vercel/Next.js 与 Supabase 快速开发；正式部署平台、免费方案和公司内部使用条款待上线前评估

## Current Implementation Limits

- Variants、Domestic Inventory、In-Transit Inventory、Shipments、Users 页面仍为占位实现
- Dashboard 首页数据功能尚未实现
- 侧边栏产品列表和海外库存已启用（Phase 0），SKU 管理与待处理 SKU 仍灰显（Phase 1）
- 海外库存查询为 MVP 临时实现（全量加载 → JS 筛选 → 分页），数据量增大后改为 RPC
- 库存状态规则：quantity=0→缺货，已匹配+0<qty≤safetyStock→低库存，已匹配+qty>safetyStock→正常，未匹配+qty>0→未匹配
- 海外库存查询为 MVP 临时实现：全量加载海外库存数据后在 JS 层执行搜索和 stockStatus 筛选，筛选完成后再分页。数据量增大后需改为数据库 RPC 函数。
- 海外库存搜索不再使用跨表 `.or()` 查询，改为 JS 层 case-insensitive 字符串匹配。
- 海外库存 `stockStatus` 筛选在 JS 层完成（需跨表比较 `quantity <= safety_stock`），筛选完成后 `total` 为真实数量。

## Technical Debt

### 已修复（2026-06-10 Audit）

- ~~Shipment 创建非事务性~~ → 新增 `create_shipment_transactional` PostgreSQL 函数 + migration `00002`
- ~~Inventory 分页 count 不准确~~ → country/warehouseType 过滤下推到 Supabase 查询层
- ~~Supabase join 嵌套类型转换重复 9+ 次~~ → 提取 `lib/supabase/helpers.ts` 的 `unwrapJoin()` 工具函数

### 现存技术债务

- `inventory` 仍为当前库存覆盖更新；库存趋势优先复用 BigSeller 可抓取数据，暂不把 `inventory_snapshots` 作为 P5-SY9 范围
- `stockStatus` 筛选在海外库存中已改为 JS 层全量筛选后分页（MVP 临时方案，数据量大后需数据库 RPC）。其他库存页面待实现时统一处理。
- `getLowStock()` / `getUnmatched()` 无分页，数据量大时需补
- ProductVariant 匹配仍依赖人工（`product_variant.match_status = 'unmatched'`）
- `sync_log` 仅仓库级别，不记录每条 SKU 变更
- Shipment 状态为手动推进，无自动化（`advanceStatus` 中 warehoused 更新为 N+1 循环）
- `database.ts` 从 migration DDL 解析生成，非 `supabase gen types`（缺少 `SUPABASE_ACCESS_TOKEN`）
- `userRepository` email 字段硬编码为空字符串（Phase 4 解决）
- 预览/生产环境尚未建立
- 正式部署平台尚未确定；上线前需评估平台条款、免费额度、Next.js/Supabase 兼容性和迁移成本
- 云供应商轻量隔离已确认为强制架构规则：当前允许 Supabase 与 Vercel/Next.js 生态快速开发，供应商调用集中在 Repository、Service 与 `src/lib/`，不为未来迁移提前建设复杂抽象

## Recent Changes

| 日期 | 变更 |
|---|---|
| 2026-06-25 | **P5-SY11G 返工 DONE。4 项阻塞修复：(1) inventory repo getOverseasList/getLowStock 过滤改用 row.variant_id（variant join select 不含 id，v.id 始终 undefined 导致所有行被过滤）；(2) variants repo list() 归档过滤从 JS 后置改为 DB 层 notIn/in 在分页前完成，total 准确；(3) archive/restore 先查询已有偏好再操作，返回实际新增/恢复数；(4) list() active tab 改用 query.notIn() 替代 query.not('id','in',...)，not() 期望 PostgREST 原始语法 `(id1,id2)` 而 JS 数组直接字符串化无括号导致过滤失效。补 5 项行为测试（含 notIn URL 生成 not.in.(...) 括号语法 vs .not() 无括号对比）。质量门：896/896 TS（30 文件），lint 0 errors/24 warnings（pre-existing），build pass。Python：315 passed + 5 collection errors（pre-existing）。WEBSYNC_REAL_WRITE_ENABLED=false。** |
| 2026-06-25 | **P5-SY11-REWORK DONE。语义返工完成：归档从全局 product_variant.is_archived 迁移为用户级 user_variant_preference。Migration 00012 新建表 + RLS；operator_select_variant 移除 is_archived 全局过滤。variantRepository 全部改用 user_variant_preference；archiveVariants/restoreVariants 改为 requireActiveAuth；Inventory 层按当前用户偏好过滤；UI 所有用户可归档/恢复。869/869 TS 测试 pass，lint 0 errors，build pass。is_archived 列保留为遗留列。** |
| 2026-06-24 | **P5-SY9J 生产启用受控验证通过。P5-SY9 全子任务（A~J）DONE。** WEBSYNC_REAL_WRITE_ENABLED=true 已在 .env.local 启用。受控验证：PH 仓 Web Dry Run（104 行 → 6 新 + 80 更新 + 18 未变）→ 审核通过 → Real Write 成功（sync_log status=success，new_variants_count=6，库存验证通过）。修复 web_bridge.py execute_plan_v2 签名不匹配。已知小问题：RPC summary 返回全零（仅显示，sync_log 正确）。 |
| 2026-06-24 | **P5-SY9I Codex 独立验收通过，标记 DONE。P5-SY9 全子任务（A~I）完成。** 质量门确认：523/523 TS + 242/242 Python，lint 0 errors，build 通过，架构合规。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。下一步：用户授权后生产启用。 |
| 2026-06-24 | P5-SY9H Codex 独立验收通过，标记 DONE。P5-SY9I IN_PROGRESS。 |
| 2026-06-24 | P5-SY9H 实现完成（AWAITING_REVIEW）：6 项页面体验改进 + 12 项测试 + lint 清理。523/523 TS 测试通过。 |
| 2026-06-24 | P5-SY9G Codex 独立验收通过，标记 DONE。P5-SY9H IN_PROGRESS：页面体验与运营可用性收口。 |
| 2026-06-23 | P5-SY9G 实现完成（AWAITING_REVIEW）：批量审核后真实写入 — Admin 勾选 ready 仓库 + 输入确认短语后逐仓真实写入。confirmRealWrite 签名新增 confirmToken 参数消除硬编码。新增 triggerBatchRealWrite Server Action + BatchRealWriteResult 类型 + 17 项测试。页面批量审核总览新增复选框/全选/确认短语/批量写入按钮/写入结果展示。511/511 非并发同步测试（17 文件），lint 0 errors / 15 warnings，build 通过。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。 |
| 2026-06-23 | P5-SY9F Codex 独立复验通过，标记 DONE。P5-SY9G IN_PROGRESS：批量审核后真实写入。 |
| 2026-06-23 | P5-SY9F 实现完成（AWAITING_REVIEW）：Admin 批量全部海外仓 Dry Run + 每仓独立 claim/execute/release + 单仓失败不影响其他 + 批量审核总览类型 + triggerBatchDryRun Server Action + session health guard。31 项 actions 测试 + 22 项 P5-SY9F 专项测试。486/486 非并发同步测试，Python 85/85，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9E Codex 独立验收通过，标记 DONE。P5-SY9F IN_PROGRESS：批量全部海外仓 Dry Run。 | — (1) python-bridge.ts 统一 terminate(reason) 管线：timeout 和 AbortSignal 均走 SIGTERM → 5s grace → SIGKILL（settled 标志幂等）；close/error 时清理所有 timers + abort listener；返回中文错误；不再使用 proc.killed 判断；(2) SyncServiceDeps 新增 heartbeatIntervalMs 可注入参数（生产默认 LEASE_DURATION/3 ≈ 100s），测试设 20ms 实现真实 heartbeat 触发断言；(3) prepareRunnerContext 异常时清理 heartbeat + release failed，dry_run/real_write 双路径覆盖；(4) MockSyncRunner 新增 shouldThrowCapabilities。新增 5 项测试：注入 20ms 间隔 → heartbeat 真实触发 ≥1 次 + heartbeat 抛错仍完成 + SIGTERM→SIGKILL mock spawn + abort→SIGTERM→SIGKILL + terminate 幂等 + capabilities 抛错清理 dry_run/real_write。20/20 P5-SY9E 测试，450/450 非并发同步测试，Python 85/85，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9E 实现完成（AWAITING_REVIEW，等待 Codex 独立验收）：(1) python-bridge.ts 新增 timeoutMs 参数 — 超时后 SIGTERM → 5s grace → SIGKILL；(2) sync-service.ts 新增 heartbeat 续租循环（间隔 LEASE_DURATION/3 ≈ 100s），executeDryRun/executeRealWrite 均启动 heartbeat；新增 prepareRunnerContext — 根据 Runner capabilities.maxTimeoutMs 创建 AbortSignal.timeout；(3) real-sync-runner.ts 传递 capabilities.maxTimeoutMs 到 callPythonBridge；(4) MockSyncRunner 新增 delayMs + signal 检测 + _setCapabilities 用于 timeout/abort 测试；(5) 新增 15 项 P5-SY9E 测试（heartbeat 调用/失败不中断/claim 前不触发 + timeout 创建/不创建 + abort 预触发 + lease 过期回收/heartbeat 续租后不可抢占/invalid heartbeat 拒绝 + schema 边界 + capabilities 类型检查）。445/445 非并发同步测试，Python 85/85 通过，lint 0 errors/10 warnings，build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9D Codex 验收通过，标记 DONE。P5-SY9E IN_PROGRESS：heartbeat / timeout / abort / 子进程控制 / 失败落库 / 并发锁测试。 |
| 2026-06-23 | P5-SY9D rework 第三次返工完成（AWAITING_REVIEW，等待 Codex 独立验收）：3 项修复 — (1) confirmRealWrite country 校验强制化：plan artifact 缺少 country / country 非字符串 / country 空字符串 / 不一致全部阻断；(2) 查询契约除杂：SyncRunAdminRow 移除 input_artifact_hash / plan_artifact_hash，MockRepository getSyncRuns/getSyncRunDetail admin 视图不再返回此二字段；(3) 60 分钟边界修复：ageMs >= DRY_RUN_EXPIRY_MS。新增 6 项测试（country 缺失/非字符串/空字符串阻断 + getSyncRuns/getSyncRunDetail 不含 hash + 恰好 60 分钟阻断）。51/51 P5-SY9D 测试，430/430 非并发同步测试，Python 85/85 通过，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9D rework 第二次返工完成（AWAITING_REVIEW，等待 Codex 独立验收）：修复 confirmRealWrite 应用层 hash 校验在生产路径被跳过的问题 — (1) 新增 SyncRepository.getDryRunBindingMetadata(runId) 方法，返回 DryRunBindingMetadata（id/warehouse_id/mode/status/finished_at/plan_drift_check/input_artifact_hash/plan_artifact_hash）；(2) SupabaseSyncRepository 使用 serviceClient 直查 public.sync_run 绕过 get_sync_run_detail RPC 脱敏；(3) MockRepository 同步实现该方法；(4) confirmRealWrite 全部绑定校验改为从 getDryRunBindingMetadata 取值，移除旧的 `adminDetail.input_artifact_hash &&` 条件跳过逻辑；(5) hash 强制校验：input/plan hash 缺失则阻断，不再"字段存在才校验"；(6) 新增 14 项测试（input hash 缺失阻断、plan hash 缺失阻断、metadata 全部字段有效/hash 一致 happy path、metadata 缺失/warehouse/mode/status/drift/finished_at 各字段不一致阻断）；(7) plan hash 不一致测试 hash 注入修复（必须通过 input hash 校验才能到达 plan hash 路径）；(8) re-scrape 禁止测试 hash 注入修复。保留 DB claim_sync_run 二次防御，不修改已执行 migration。45/45 P5-SY9D 测试，424/424 非并发同步测试，Python 测试（26 plan + 44 verifier + 15 health_check = 85），compileall 通过，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。不提交 runtime/artifacts、__pycache__。 |
| 2026-06-23 | P5-SY9D rework 完成（AWAITING_REVIEW，等待 Codex 独立验收）：修复 3 项关键缺陷 — (1) Dry Run plan artifact 修复：web_bridge.py 新增 result['plan'] = plan_summary 暴露完整 plan（含元数据 country/generated_at/warehouse_id + 结构字段 new_variants/inventory_inserts/inventory_updates/inventory_unchanged/warehouse_rename_required），python-bridge.ts 新增 plan 字段，real-sync-runner.ts 使用 bridgeResult.plan（非 summary）作为 planArtifact；(2) Real Write 禁止重新抓取：confirmRealWrite 改为从 ArtifactProvider 加载绑定 Dry Run input + plan artifact，不再调用 inputArtifactSource.getInputArtifact(…, 'real_write')；(3) 应用层绑定校验新增 5 项：Dry Run 未过期（finished_at + 24h 窗口）、country 一致（plan 元数据 vs warehouse country）、input hash 一致（repo 存储 vs artifact 当前 hash）、plan hash 一致、input/plan artifact 加载失败阻断。新增 6 项失败测试（过期阻断、缺少 finished_at 阻断、country 不匹配阻断、input hash 不匹配阻断、plan hash 不匹配阻断、plan artifact 结构性验证）+ 2 项正确性测试（re-scrape 禁止验证、完整 plan 非 summary 验证）+ mock repository 新增 input_artifact_hash/plan_artifact_hash 到 admin 视图。SyncActionsDeps 新增 artifactProvider 依赖。35/35 P5-SY9D 测试，414/414 非并发同步测试，15/15 非 concurrency 文件，Python compileall 通过，lint 0 errors/3 warnings，build 通过。未连接生产 Supabase，未执行真实写入。不提交 runtime/artifacts、__pycache__、bound-plan-*.json。 |
| 2026-06-23 | P5-SY9D 实现完成（AWAITING_REVIEW，等待 Codex 独立验收）：(1) web_bridge.py 修复 compare_plans(plan, plan) 自比较→真实 stored_plan 漂移比较 + --prior-dry-run-path；(2) TS pipeline 线 priorDryRunPath 传递；(3) actions.ts triggerDryRun + confirmRealWrite 拆分（含 dryRunRunId/warehouse_id/status/plan_drift_check 绑定校验）；(4) server-actions.ts 新增 Server Actions + feature gate；(5) sync page UI Dry Run 审核摘要 + 确认写入 Dialog；(6) MockRepository._injectRunDetail 测试辅助；(7) 27 项 P5-SY9D 测试；(8) 文档同步。406/406 TS 测试，15/15 Python，lint 0 errors，build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9C Codex 独立复验通过（DONE）。3 项返工全部通过：MockSyncRunner 移除 + baseDir 注入 + production-wiring 补强。P5-SY9D 启动（IN_PROGRESS）：单仓 Web Dry Run → 审核 → Real Write 绑定设计与实现。Web 真实写入入口 WEBSYNC_REAL_WRITE_ENABLED 保持 disabled。 |
| 2026-06-23 | P5-SY9C 返工完成（AWAITING_REVIEW，等待 Codex 再验收）：(1) 移除 server-actions.ts 中 MockSyncRunner import + wireActions() 函数，getSyncRuns/getSyncRunDetail 改为 repository-only 读路径，triggerSync 直接返回中文错误不构造 SyncService；(2) FileSystemArtifactProvider 支持注入 baseDir（默认仍为 runtime/artifacts），新增 getBaseDir() 方法，测试使用 os.tmpdir() 隔离，afterEach 只删除测试目录；(3) production-wiring.test.ts 移除所有 expect(true) placeholder，新增：server-actions.ts 源码不含 Mock import、NODE_ENV=production createSyncService 拒绝 Mock 组合/接受真实组合、sync 页面源码不含 supabase.from()、feature gate 默认 false 且拦截 healthy session；(4) session-health.test.ts 新增 syncWarehouse/syncAllWarehouses feature gate 拦截测试（healthy session + gate disabled → gate error）。98/98 P5-SY9C 测试，15/15 Python 测试，lint 0 errors/10 warnings，build 通过，379/379 非并发测试。未连接生产 Supabase，未执行真实写入，未删除真实 runtime/artifacts。 |
| 2026-06-23 | P5-SY9C 实现完成（AWAITING_REVIEW）：(1) 新增 `FileSystemArtifactProvider` — 文件系统持久化 ArtifactProvider，替代 MockArtifactProvider；(2) 新增 `WebInputArtifactSource` — 通过 Python bridge 真实抓取的 InputArtifactSource，替代 hardcoded mockInputArtifactSource；(3) `server-actions.ts` 生产 wiring 重连：`wireRealActions` 使用 FileSystemArtifactProvider + RealSyncRunner + WebInputArtifactSource，`wireActions` 使用 FileSystemArtifactProvider；(4) 新增 `WEBSYNC_REAL_WRITE_ENABLED` feature gate，默认 disabled；(5) 新增 53 项测试（25 FileSystemArtifactProvider + 28 production wiring 结构性测试）。361/361 TypeScript 测试，15/15 Python 测试，lint 0 errors，build 通过。P5-SY9B 移入 Completed Tasks（Codex 独立复验通过）。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-23 | P5-SY9B Codex 独立复验通过：session health guard 回归测试（27/27）+ Python 健康检查测试（15/15）+ lint/build 全部通过。P5-SY9B 移入 Completed Tasks。 |
| 2026-06-23 | P5-SY9B 返工完成（AWAITING_REVIEW）：(1) syncWarehouse/syncAllWarehouses 加入服务端 session health guard，非 healthy 拒绝进入 wireRealActions；(2) verifyBigSellerSession 内 checked_at→checkedAt 字段转换；(3) health_check.py 实现 profile_unavailable 真实分类（profile 目录/coffee 文件缺失时在启动浏览器前返回）；(4) docs/tasks/current-task.md 停止条件更新为 P5-SY9B 范围；(5) .codex/hooks.json 已从暂存区移除。未执行真实写入，未连接生产 Supabase。 |
| 2026-06-23 | P5-SY9A 第二轮返工（Session 差距补充）：新增 CRITICAL 差距 — BigSeller Session 复用不可靠。`establishBigSellerSession()` headed Chrome 登录成功不等于 `web_bridge.py` headless Chrome 可复用同一 profile。当前无 `verifyBigSellerSession()` 健康检查；0 行时无法区分未登录/验证码/profile 不可用/页面结构异常/表格未加载。新增 P5-SY9B 子任务（BigSeller Session Health Check），原 P5-SY9B~H 重编号为 P5-SY9C~I。Session Health Check 必须早于真实 Provider / Web Dry Run 生产化。仅文档修订，未修改代码。 |
| 2026-06-21 | P5-SY9A 现状审查完成：27 个核心文件逐行审查（TypeScript sync feature 11 文件 + sync page/component + python-bridge + auth + Python sync 7 文件），输出 6 维度差距清单。CRITICAL: (1) `web_bridge.py` L156 `compare_plans(plan, plan)` 假比较；(2) `syncWarehouse`/`syncAllWarehouses` 自动串联 dry_run→real_write 无审核；(3) `wireRealActions` 仍使用 `MockArtifactProvider` + `mockInputArtifactSource`。HIGH: (4) Python bridge 无 timeout/heartbeat/abort。MEDIUM: (5) `getOverseasWarehouses` 在 server-actions.ts 中直接调用 `supabase.from()`。PASS: (6) Admin/Operator 权限链正确。仅审查未修改代码。 |
| 2026-06-21 | P5-SY8H DONE — Codex 独立验收通过：ID 印尼仓（印尼-DEE仓库）真实写入与端到端验收完成。P5-SY8H-ID 令牌（--no-dry-run 写令牌）。首次 RPC 写入：35 Variants (country=ID) + 35 Inventory + Warehouse 改名（"印尼仓"→"印尼-DEE仓库"）。Phase G/I PASS，SyncLog success。幂等重跑：0 新增/35 unchanged，plan_drift_check=PASS。Codex 独立验收：代码、报告、真实 DB 只读核查、幂等重跑、质量门均通过。128/128 Python 测试（89 executor + 39 CLI），compileall/lint/build 通过。逐仓 P5-SY8A~H 全部完成，随后进入 P5-SY9 生产化任务包。 |
| 2026-06-21 | P5-SY8G DONE — Codex 独立复验通过：ID 印尼仓只读抓取与 Dry Run 方案完成。BigSeller 抓取 35 行（warehouse=印尼-DEE仓库，autoid=warehouse_option_3）+ invalid sidecar 1 行（空包 0000）。DB 仓库 `印尼仓`→`印尼-DEE仓库` 改名已确认。P5-SY8G-ID 令牌（仅 --dry-run）。Codex 返工 3 项修复通过 + 后收口维护（docs 残留同步 + GC 测试夹具）。Stored Plan Baseline `p5-sy3a-dry-run-20260621-005154.json`，CLI Dry Run 报告 `p5-sy8g-id-dry-run-20260621-005202.json`，plan_drift_check=PASS。245/245 Python 测试，256/256 非并发同步测试，compileall/lint/build 通过。未执行真实写入，P5-SY8H 保持 PENDING。 |
| 2026-06-21 | P5-SY8F DONE — Codex 独立验收通过：MY 马来西亚仓首次真实写入 — 48 Variants (country=MY) + 48 Inventory + Warehouse 改名（"马来西亚仓"→"喜运达MY仓"）。P5-SY8F-MY 令牌（唯一 MY --no-dry-run 令牌，P5-SY8E-MY 保持仅 --dry-run）。CAPTCHA 检测修复（仅可见元素触发）。全新抓取 48 行 + invalid sidecar 1 行。Stored Plan `p5-sy3a-dry-run-20260621-002437.json`，Dry Run `p5-sy8f-my-dry-run-20260621-002458.json`，首次写入 `p5-sy8f-my-execute-20260621-002507.json`。幂等重跑：0 新增/48 unchanged，`p5-sy8f-my-execute-20260621-002540.json`。Phase G/I PASS，SyncLog success。239/239 Python 测试（85 exec + 32 CLI + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall/lint/build 通过。 |
| 2026-06-20 | P5-SY8E DONE — Codex 独立验收通过：MY 马来西亚仓只读抓取与 Dry Run 方案完成。48 行抓取 + Dry Run PASS + MY 全链路国家断言（test_my_full_chain_country_assertions，execute_plan_v2 真实执行，逐条验证 RPC p_variants/p_inventory country=MY + Phase G country=eq.MY + Phase I wh_expected.country=MY + SyncLog warehouse_id/status）。invalid sidecar: 1 行（空包 0000）。P5-SY8E-MY 令牌（仅 --dry-run）。234/234 Python 测试，compileall/lint/build 通过。文档收口完成。未执行真实写入，P5-SY8F 保持 PENDING。 |
| 2026-06-20 | P5-SY8E Codex 返工完成（AWAITING_REVIEW 阶段）：新增 MY 全链路国家断言 + invalid sidecar 文档 + 测试基线 233→234。保持 AWAITING_REVIEW，未执行真实写入。以下是返工前的首次执行摘要。 |
| 2026-06-20 | P5-SY8E 首次执行完成：MY 马来西亚仓只读抓取与 Dry Run。BigSeller 抓取 48 行（warehouse=喜运达MY仓，autoid=warehouse_option_4）。config.py/bigseller_scraper.py 切换至 MY。新增 P5-SY8E-MY 令牌（仅 --dry-run，--no-dry-run 在 I/O 前拒绝）。Stored Plan Baseline `p5-sy3a-dry-run-20260620-232838.json`，CLI Dry Run 报告 `p5-sy8e-my-dry-run-20260620-233129.json`（plan_drift_check=PASS）。DB 仓库名 `马来西亚仓`→`喜运达MY仓` 改名已确认。233/233 Python 测试（28 CLI + 83 executor + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall 通过，npm lint 0 errors，npm build 通过。未执行真实写入，P5-SY8F 保持 PENDING。 |
| 2026-06-20 | P5-SY8D DONE — Codex 独立验收通过：两轮返工全部通过（Fix 1 令牌—模式安全门 + Fix 2 finished_at 审计语义 + Fix 3 测试 mock 修复）。executor.py 新增 _DRY_RUN_ONLY_TOKENS 安全门（P5-SY8C-TH 仅 dry_run=True）、finished_at 移至 Phase G/I 通过后、审计失败路径设 result.finished_at。228/228 Python 测试（25 CLI + 81 executor + 26 plan + 29 sync_log + 44 verifier + 10 structural + 13 Migration 00009），compileall 通过，npm lint 0 errors（8 个既有 warnings），npm build 通过。P5-SY8E 保持 PENDING。 |
| 2026-06-20 | P5-SY8C Codex 独立验收通过：全部 A0–A5 子任务确认，A4 返工（报告身份 token 派生 + Dry Run Phase E 空 DB 兼容）确认。196/196 Python 测试，13/13 Migration 00009 契约测试，compileall/lint/build 通过。报告路径：130900=stored plan baseline / 133500=CLI execution report。P5-SY8C 标记 DONE。P5-SY8D 保持 PENDING/BLOCKED，等待用户明确授权 TH 真实写入。 |
| 2026-06-20 | P5-SY8C A4 独立验收返工完成：(1) 修复 `cli_execute.py` 报告身份 — `report.task` 和文件名前缀从 confirm token 派生，不再硬编码 'P5-SY3B'/'p5-sy3b'/'p5-sy4c'；(2) 修复 `executor.py` Dry Run Phase E 对空 DB 的兼容；(3) 新增 3 项 report identity 测试（PH/VN/TH）；(4) 重新执行 CLI Dry Run — 新报告 `p5-sy8c-th-dry-run-20260620-133500.json`（与 stored plan baseline 130900 明确区分）。196/196 Python 测试，13/13 Migration 00009 契约测试，compileall/lint/build 通过。未执行真实写入，未开始 P5-SY8D。保持 AWAITING_REVIEW，等待 Codex 独立验收。 |
| 2026-06-20 | P5-SY8C DONE：TH 泰国仓只读抓取与 Dry Run 全部完成（A0 仓库改名 → A1 配置切换 → A2 BigSeller 抓取 72 行 → A3 输入校验 → A4 Dry Run PASS → A5 全链路验收）。新增 2 项测试：TH full-chain 国家断言 + _TOKEN_COUNTRY_MAP 一致性。193/193 Python 测试（+2 增量），npm lint 0 errors，npm build 通过。3 项写入前强制验收项全部满足。未执行真实写入，未开始 P5-SY8D。停止等待 Codex 独立验收。 |
| 2026-06-20 | P5-SY8B Codex 独立验收通过：4 项返工全部确认 — 令牌国家绑定 / Migration 00009 静态契约测试 13/13 / 执行报告时间戳 / 文档同步。160/160 Python 测试，npm lint 0 errors，npm build 通过。P5-SY8C 任务包已创建（TH 泰国仓只读抓取与 Dry Run 方案，PENDING 待用户确认目标仓）。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-20 | P5-SY8B Codex 独立验收返工完成：4 项修复 — (1) 令牌国家绑定：`cli_execute.py` / `executor.py` 中确认令牌绑定目标国家（P5-SY3B-PH→PH, P5-SY8B-VN→VN），不匹配则 fail-fast 在任何 I/O 前；(2) Migration 00009 静态契约测试：新建 `supabase/tests/test_migration_00009_contract.py`（13/13 通过）；(3) 执行报告时间戳：`cli_execute.py` 从 `result_v2` 透传 `started_at`/`finished_at` 到最终 report，新增 1 项测试；(4) 文档同步。160/160 Python 测试（16 cli_integration + 26 plan + 76 executor + 29 sync_log + 13 migration_00009_contract），npm lint 0 errors，npm build 通过。未连接生产 Supabase，未执行真实写入。 |
| 2026-06-19 | P5-SY8B DONE：VN 真实写入与端到端验收通过。(1) 首次 RPC 提交 64 Variants (country=VN) + 64 Inventory (warehouse_id=c0b661fa...) 成功，但 Phase G 审计因硬编码 `country=eq.PH` 失败 → executor.py 3 处 URL 修复为 `WAREHOUSE_COUNTRY`；(2) Migration 00009 通用化 RPC（移除 4 处硬编码 PH 检查）；(3) 幂等重跑：plan_drift_check=PASS (0 diffs)，0 新增 Variant/Inventory，64 unchanged，Phase G/I PASS，sync_log status=success/synced_count=64；(4) executor.py 另 3 处硬编码 PH（Phase I expected country + variant country 默认值）修复为 `WAREHOUSE_COUNTRY`。`current-task.md` / `current-state.md` / `phase-5-sync.md` 已同步。停止等待 Codex 独立验收，不进入 P5-SY8C。 |
| 2026-06-19 | P5-SY8B 写入前准备完成：(1) A1 仓库改名已执行 — Supabase `warehouse.name` 从 `越南仓` 改为 `越南青林湾仓库`；(2) `P5-SY8B-VN` 确认令牌已实现 — `cli_execute.py` / `executor.py` 均接受，测试 41/41 通过；(3) 新 P5-SY8B prewrite 基线报告已生成 — `p5-sy8b-vn-prewrite-dry-run-20260619-213335.json`（warehouse_rename_required.action=none, 64/64/0）；(4) plan_drift_check PASS（0 diffs，使用新基线报告）。`current-task.md` / `current-state.md` / `phase-5-sync.md` 已同步。**未执行真实写入。** |
| 2026-06-19 | P5-SY8A Codex 独立验收通过。P5-SY8A 标记 DONE。`current-task.md` 重写为 P5-SY8B（VN 真实写入与端到端验收，PENDING/BLOCKED，两个阻断决策待用户确认）。`current-state.md` Current Task → P5-SY8B，Next Step 更新。`phase-5-sync.md` P5-SY8A → DONE（Codex 验收通过）。未实现功能代码，未执行真实写入，未开始 P5-SY8B。 |
| 2026-06-19 | P5-SY8A 执行完成：VN 越南青林湾仓库只读抓取 64 行 + Dry Run 报告生成。BigSeller 显示 `越南青林湾仓库`（autoid=warehouse_option_7），Supabase 存储 `越南仓`（名称不一致已记录）。64/64 行公式验证通过，0 无效 SKU，0 拒绝行。全仓选项清单已记录（8 个 autoid，供后续逐仓扩展）。config.py / bigseller_scraper.py / supabase_gateway.py / cli.py / cli_execute.py 已切换至 VN 仓。Python 测试 183/183 通过。未执行真实写入。 |
| 2026-06-19 | P5-SY8 第一次 Codex 独立设计审查未通过 → 文档返工完成：修正 GAP-01→GAP-05 编号、修正"等待 SyncService 真实实现"表述为"等待真实 adapter 接入"并明确 SyncService 已存在不重写、拆分 P5-SY8A~H 子任务（每仓两步：只读 Dry Run → 真实写入与验收）、补充 11 项验收标准（7 通用 + 4 架构边界）、补充 P5-SY8A 第一子任务启动条件（VN 越南青林湾仓库，含 6 项启动前确认 + 3 项不执行声明）。`current-task.md`/`current-state.md`/`phase-5-sync.md` 已同步。未实现功能代码，未连接 Supabase，未触发真实写入，未开始 VN 实现。 |
| 2026-06-19 | P5-SY8 逐仓扩展任务包创建：P5-SY7 → P5-SY8 状态文档收口。`current-task.md` 重写为 P5-SY8 任务包（PENDING，待 Codex 审查）。`current-state.md` Current Task / References / Blockers / Next Step 全部对齐 P5-SY8。数据库供应商隔离约束写入所有相关文档。未实现功能代码，未连接 Supabase，未触发真实写入。 |
| 2026-06-19 | 生产 Migration 00006/00007/00008 执行完成（通过 Supabase Dashboard SQL Editor）：新增 2 张表（sync_run/sync_warehouse_lock）、sync_log 扩展 5 列、7 个 RPC 函数（sync_warehouse_inventory/claim_sync_run/release_sync_run/heartbeat_sync_run/cleanup_expired_sync_runs/get_sync_runs/get_sync_run_detail）+ trigger 函数。sync_warehouse_lock 补建 5 行（5 个活跃海外仓）。REST API 只读验证全部通过。新增数据库供应商隔离约束（DB Vendor Isolation）。P5-SY8 就绪。 |
| 2026-06-19 | P5-SY7 Codex 独立复验通过：2 项文档返工修正已确认（B5 Python json.dumps NaN/Infinity 表述 + 未来约束；F4 移除 .claude/rules/security.md 引用）。差距分析 6 已知差距/0 阻塞项不变。P5-SY7 标记 DONE。 |
| 2026-06-19 | P5-SY6 Codex 第三次独立设计验收通过：全部返工项确认（架构边界/平台事实/手动路径/验证口径/架构安全表述）。评估文档 `docs/tasks/archive/p5-sy6-runtime-design.md`。未实现代码，未连接生产 Supabase，未执行生产 Migration。Current Task → P5-SY7。 |
| 2026-06-19 | P5-SY6 第二次返工完成（Codex 第二次设计复验差 1 项小修）：修正架构安全表述 — Python CLI 经 executor → Supabase gateway → RPC → DB 约束，不经过 Next.js Server Actions/SyncService；Web UI Mock 经 Server Actions → SyncService → Mock* 组件，不产生真实写入。综合对比表"手动 (CLI)"列"经过 Server Actions/SyncService 编排"从 ✅ 修正为 ❌ 不经过。两条路径当前不是同一条生产架构边界，统一生产入口待 P5-SY6F。评估文档 `docs/tasks/archive/p5-sy6-runtime-design.md`。等待 Codex 第三次独立设计验收。 |
| 2026-06-19 | P5-SY5G Codex 独立复验通过：D2/F2 确定性 FOR UPDATE 行锁断言确认，无 expect(true).toBe(true) 或"环境差异不强制断言"通过路径。281 非并发测试全通过，lint 0 errors（8 pre-existing warnings），build 通过。未连接生产 Supabase，未执行生产 Migration 00007/00008。Current Task → P5-SY6。 |
| 2026-06-19 | P5-SY5F Codex 独立复验通过：返工修复经 Codex 独立复验确认通过。GC 防误删三层保护完整（active ∪ recent ∪ referenced），integration.test.ts 18 项集成测试（含被 Real Write 引用的 Dry Run GC 保护 + orphan 反例删除）。281/281 测试，lint 0 errors，build 通过。下一步 P5-SY5G。 |
| 2026-06-19 | P5-SY5F 独立验收通过：新增 integration.test.ts（16 项集成测试）— 非确定性序列化安全（5）+ GC 全管道（3）+ GC 防误删边界（4）+ artifact 生命周期（4）。279/279 测试，lint 0 errors，build 通过。Codex 指出 GC 防误删缺一项，已返工修复。 |
| 2026-06-19 | P5-SY5E 独立验收通过：侧边栏新增"数据同步"分组 + RefreshCw 图标 + 库存同步入口（phase 0，Admin/Operator 可见）。263/263 测试，lint 0 errors，build 通过。 |
| 2026-06-19 | P5-SY5D 独立验收通过：聚焦返工已通过 Codex 独立代码复验。263/263 测试，lint 0 errors，build 通过。 |
| 2026-06-19 | P5-SY5D 实现完成：顶层 `'use server'` Actions（server-actions.ts）+ Server Component 页面（page.tsx）+ 客户端交互（sync-page-content.tsx）+ loading.tsx / error.tsx。258/258 测试通过，lint 0 errors，build 通过。待独立验收。 |
| 2026-06-19 | P5-SY5C2 独立验收通过：types.ts / schema.ts / repository.ts / sync-service.ts / actions.ts / mock-artifact-provider.ts / mock-sync-runner.ts + 7 个测试文件（contract / schema / repository / sync-service / actions / mock-artifact-provider / mock-sync-runner）。258/258 测试通过，lint 0 errors，build 通过。 |
| 2026-06-19 | P5-SY5C2 任务包第五次修订完成（第四次复审未通过 → 4 项修正）：(1) 统一 triggerSync 返回映射 success=(status==='completed')；(2) 统一失败 Artifact 保留规则消除 delete/保留矛盾；(3) Plan Artifact rejected_rows.row 改为 Record<string, JsonValue>；(4) 日期同步。仅修订设计文档，未实现代码。 |
| 2026-06-19 | P5-SY5C2 任务包第四次修订完成（第三次复审未通过 → 7 项修正）：(1) SyncServiceResult 类型；(2) release 失败 indeterminate 状态；(3) Artifact 保留规则修正；(4) inputArtifact 改为必需；(5) Plan Artifact 精确对齐 plan_generator 实际输出；(6) createSyncActions 仅为工厂；(7) 新增强化测试。仅修订设计文档，未实现代码。 |
| 2026-06-14 | P5-SY5 V5.4.1 第九次修订完成：第八次独立设计验收聚焦返工未通过，V5.4.1 覆盖全部 3 项返工要求 — (1) 调整 claim_sync_run 验证顺序：dry_run_run_id PERFORM 验证移至 advisory lock + FOR UPDATE 之后、任何 UPDATE/INSERT 之前，锁保护区内消除 TOCTOU 窗口，更新 SQL 草案和 P5-SY5G 测试；(2) 修复 GC 时间模型：cutoff 直接使用 `now - 7 days`（移除错误的 max()），恢复 getRecentlyCompletedRunIds(now-60min) 双层保护（Layer 1: 7 天存储截止 + Layer 2: 60 分钟业务保护），禁止 artifact.createdAt 推导 sync_run.finished_at（独立时间戳）；(3) 定义 JsonValue 运行时验证器：validateJsonValue() 递归拒绝 undefined/function/Symbol/BigInt/NaN/Infinity/toJSON/自定义原型，prepare() 先验证再 stringify，新增 ~12 项 validateJsonValue 测试和 GC 防误删边界测试。修订 D27 为"GC cutoff 固定为审计保留期 + 双层保护"，新增 D28（validateJsonValue 运行时验证）。仅修改设计和状态文档，未实现代码。等待第九次独立设计验收。 |
| 2026-06-14 | P5-SY5A Migration 00007 第二次聚焦返工完成：修复 8 项缺陷 — (1) claim_sync_run IS DISTINCT FROM 'admin' 拒绝 NULL role + triggered_by 绑定 auth.uid()；(2) 查询 RPC 脱敏矩阵：禁止 input_artifact_hash/plan_artifact_hash/lease_expires_at/heartbeat_at/原始 triggered_by UUID，Admin 返回 display_name，Operator 返回脱敏邮箱 + controlled result_summary + Chinese 失败摘要；(3) failed_requires_fields 增加 finished_at IS NOT NULL；(4) cleanup 仅遍历过期 in_progress warehouse；(5) sync_log.exit_code 移除 DEFAULT 1 + CHECK (IS NULL OR IN (0,1,2))；(6) release v_pre_wh_id/v_post_wh_id 独立变量 + warehouse lock 行存在校验；(7) get_sync_runs p_limit 显式拒绝 + jsonb_agg ORDER BY；(8) 强化契约测试 32→47 项。未执行 Migration，未连接 Supabase。等待 P5-SY5A 独立静态验收。 |
| 2026-06-14 | P5-SY5A Migration 00007 第一次聚焦返工完成：补齐 sync_run 5 列（triggered_by/triggered_from/heartbeat_at/result_summary/created_at）；release_sync_run 锁后 SELECT sync_run FOR UPDATE + 终态重校验；get_sync_runs CTE ORDER BY + LIMIT before jsonb_agg；claim_sync_run 全部锁后 clock_timestamp()；sync_log FK/CHECK/DEFAULT 约束；修复 dry_run_run_id SELECT INTO 重复写入。静态 SQL 契约测试 32/32 通过。等待独立静态验收。 |
| 2026-06-14 | P5-SY5A Migration 00007 第四次聚焦返工完成：修复 5 项缺陷 — (1) release_sync_run 删除 p_finished_at 参数；(2) 全部锁后单次 v_now := clock_timestamp()；(3) completed/failed 统一使用 v_now 写入 finished_at；(4) claim_sync_run dry_run 过期判断 <= 60 分钟（恰好 60 分钟拒绝）；(5) REVOKE/GRANT 签名更新 10→9 参数。强化契约测试 51→54 项。未执行 Migration，未连接 Supabase。等待 P5-SY5A 独立静态验收。 |
| 2026-06-14 | P5-SY5A Migration 00007 第三次聚焦返工完成：修复 7 项缺陷 — (1) 查询 RPC 邮箱来源 profiles→auth.users（profiles 无 email 字段）；(2) Operator get_sync_run_detail 删除 plan_drift_differences；(3) Operator result_summary 白名单仅含 variantsCreated + inventoryUpdated；(4) get_sync_runs/get_sync_run_detail 新增 warehouse_name (LEFT JOIN warehouse)；(5) heartbeat_sync_run 单次 clock_timestamp() 用于 heartbeat_at + lease_expires_at；(6) 契约测试强化 47→51 项（auth.users.email、branch-level 分支验证、warehouse_name、白名单、heartbeat v_now）；(7) 文档同步。未执行 Migration，未连接 Supabase。等待 P5-SY5A 独立静态验收。 |
| 2026-06-14 | P5-SY5 V5.4.3 第十一次修订完成：第十次独立设计验收聚焦返工未通过，V5.4.3 覆盖全部 4 项返工要求 — (1) 修复数组验证：仅接受规范数组索引（String(index)===key, index<length）拒绝 "01"/"4294967295"、Object.getPrototypeOf(array) === Array.prototype 拒绝子类、'toJSON' in value 拒绝数组 toJSON；(2) 修复对象验证：Reflect.ownKeys 遍历全部字符串键 + 拒绝不可枚举属性（enumerable===false）+ 使用 descriptor.value 读取值；(3) 修复循环检测：WeakSet try/finally 删除（仅代表递归祖先链），共享引用通过、真正循环拒绝；(4) 新增 ~8 项聚焦测试（非规范索引/不可枚举/Array 子类/数组 toJSON/共享引用/循环祖先链），validateJsonValue ~16→~24 场景，P5-SY5F ~38→~46 场景。仅修改设计和状态文档，未实现代码。等待第十一次独立设计验收。 |
| 2026-06-14 | P5-SY5 V5.4.2 第十次修订完成：第九次独立设计验收聚焦返工未通过，V5.4.2 覆盖全部 2 项返工要求 — (1) 完善 validateJsonValue 草案：WeakSet 循环引用检测（含路径）、Reflect.ownKeys 明确拒绝 Symbol 键（对象和数组）、拒绝稀疏数组（`!(i in value)` 空洞检测）、拒绝数组额外属性（非数字索引字符串键）、拒绝 accessor/getter 属性（Object.getOwnPropertyDescriptor 检测 descriptor.get/set）、全面禁止 any 类型（使用 unknown/object/Record<string, unknown>）；(2) 清理冲突文档：删除 current-task.md 验收标准中 V5.4 旧 GC 单层截止项和"取代旧安全性证明"引用；修正 p5-sy5-design.md D22 非确定性描述（移除 replacer/Date 仅保留 toJSON，明确 toJSON 在 prepare() 第 1 步由 validateJsonValue 拒绝）；全文检查并删除与 V5.4.1/V5.4.2 冲突的现行结论。仅修改设计和状态文档，未实现代码。等待第十次独立设计验收。 |
| 2026-06-14 | P5-SY5 V5.4 第八次修订完成：第七次独立设计验收聚焦返工未通过，V5.4 覆盖全部 4 项返工要求 — (1) 绑定 Runner 执行内容：Artifact content 类型限制为严格 JsonValue，prepare() 返回 `{ bytes, hash, normalizedContent }`（normalizedContent = JSON.parse(bytes)），Runner 只能执行 normalizedContent（JsonValue），不得执行原始 object；(2) 原子验证 Real Write 绑定：claim_sync_run 在同一事务内原子验证 dry_run_run_id（warehouse 匹配 + mode=dry_run + status=completed + plan_drift_check=PASS + finished_at < 60 min + hashes 匹配），消除 TOCTOU 窗口；(3) 收紧 GC：GC cutoff 强制 ≥ 审计保留期（7 天），安全性证明（7 天 ≫ 60 分钟），删除 getRecentlyCompletedRunIds；(4) 删除旧 store(content) 契约，同步全部状态文档。新增 D25/D26/D27 设计决策。仅修改设计和状态文档，未实现代码。等待第八次独立设计验收。 |
| 2026-06-14 | P5-SY5 V5.3 第七次修订完成：第六次独立设计验收聚焦返工未通过，V5.3 覆盖全部 4 项返工要求 — (1) 重做 ArtifactProvider bytes 契约：引入 `prepare(content) → { bytes, hash }` 唯一序列化点，`store()` 改为接受 `PreparedArtifact`，claim/store/verify 使用同一份 bytes；(2) 重做 GC 所有权：ArtifactProvider 不查询 sync_run，`gc()` 替换为 `listCandidates()` + GC orchestrator + `deleteMany()`；(3) 新增 `completed_dry_run_requires_plan_artifact` CHECK，共 11 个 CHECK；(4) 清理支持文档。仅修改设计和状态文档，未实现代码。等待第七次独立设计验收。 |
| 2026-06-14 | P5-SY5 V5.1 内部修订：修复 cleanup_expired_sync_runs 的 v_failed_count 计数逻辑（从 fragile error_message 文本匹配+时间窗口改为从 expired CTE 直接 `SELECT count(*) INTO v_batch_count`）；修正 P5-SY5A 验收 CHECK 约束计数（6→7）。仅修改设计文档，未实现代码。等待第五次独立设计验收。 |
| 2026-06-13 | P5-SY5 V5 第五次修订完成：第四次独立设计验收未通过，V5 覆盖全部 4 项返工要求 — 真正统一 claim/release/cleanup 锁顺序（全部按 advisory → FOR UPDATE → sync_run，重写 release/cleanup SQL 草案，删除不符合 PG 可见性的 cleanup 分步交错描述，P5-SY5G 增加 claim-vs-release/claim-vs-cleanup deadlock 验证要求无 deadlock）、修复 artifact 与 runId 生命周期（SyncService 预生成 UUID，`claim_sync_run` 接收 `p_run_id`，hash 基于 canonical JSON 规范化内容，claim 后 store 失败 release 为 failed）、落实终态字段约束（新增 `plan_drift_check_enum`/`plan_drift_count_non_negative`/`failed_requires_fields` CHECK，`completed_requires_fields` 扩展至含 plan_drift_count+plan_drift_differences，release RPC 校验 plan_drift_check 枚举+plan_drift_count 非负，cleanup 设置 exit_code=2 + 返回标记 failed 运行数）、修正文档（删除残留"143"、CLAUDE.md→AGENTS.md、P5-SY5A 严格前向 Migration 不用 IF NOT EXISTS）。`docs/tasks/archive/p5-sy5-design.md`（第五次修订）、`current-task.md`、`phase-5-sync.md` 已同步更新。未实现代码。等待第五次独立设计验收。 |
| 2026-06-13 | P5-SY5 V4 第四次修订完成：第三次独立设计验收未通过，V4 覆盖全部 5 项返工要求。`docs/tasks/archive/p5-sy5-design.md`（第四次修订）、`current-task.md`、`phase-5-sync.md` 已同步更新。未实现代码。等待第四次独立设计验收。 |
| 2026-06-13 | P5-SY5 V3 第三次修订完成：第二次独立设计验收未通过，V3 覆盖全部 6 项返工要求。`docs/tasks/archive/p5-sy5-design.md`（第三次修订，约 950 行）、`current-task.md`、`phase-5-sync.md` 已同步更新。未实现代码。等待第三次独立设计验收。 |
| 2026-06-13 | P5-SY5 V2 第二次修订完成：第一次独立设计验收未通过，V2 覆盖全部 10 项返工要求。`docs/tasks/archive/p5-sy5-design.md`（第二次修订，约 650 行）。未实现代码。等待第二次独立设计验收。 |
| 2026-06-13 | P5-SY5 架构设计完成：`docs/tasks/archive/p5-sy5-design.md` 覆盖 10 项设计要点（用户/权限/调用链/凭据隔离/SyncRunner 接口/并发锁/确认流程/sync_log 展示），拆分 P5-SY5A~F 共 6 个子任务。未实现代码。等待独立设计验收。 |
| 2026-06-13 | P5-SY4E 独立验收通过。P5-SY5 开始：手动同步入口架构设计与任务拆分。暂不实现代码。 |
| 2026-06-13 | P5-SY4E 第一次返工完成：修复 plan_drift_check 不再硬编码 PASS — diffs 为空→PASS，非空→DRIFT_DETECTED；新增 plan_drift_count 和 plan_drift_differences 字段；新增 2 项漂移真实性测试。193/193 测试通过（10 cli_integration + 27 sync_log + 76 executor + 26 plan + 44 verifier + 10 structural），compileall/lint/build 通过。真实 Dry Run 报告路径 `tools/bigseller-scraper/runtime/p5-sy3b-dry-run-20260613-145329.json`，plan_drift_check=DRIFT_DETECTED，plan_drift_count=6。 |
| 2026-06-13 | P5-SY4E 完成：CLI --dry-run/--no-dry-run 互斥组 + 报告 sync_log 摘要 + 8 项聚焦测试 + 真实只读 Dry Run exit 0 无写入。191/191 测试通过（8 cli_integration + 27 sync_log + 76 executor + 26 plan + 44 verifier + 10 structural），compileall/lint/build 通过。报告路径 `tools/bigseller-scraper/runtime/p5-sy3b-dry-run-20260613-143813.json`，sync_log.enabled=True, written=False, reason="Dry Run 模式下不执行实际写入"。等待独立验收。 |
| 2026-06-13 | P5-SY4D 独立验收通过。P5-SY4E 开始：CLI 显式 --dry-run 标志 + sync_log 报告摘要 + 真实只读 Dry Run 端到端验证 + 聚焦测试。 |
| 2026-06-13 | P5-SY4D 最终收尾完成：场景 17 新增文件 I/O（os.path.isfile/builtins.open/json.load）和 Supabase 网关（fetch_ph_warehouse/fetch_ph_variants/fetch_inventory_by_warehouse）NOT-called 断言，完整验证拒绝发生在参数解析后、所有外部依赖调用前。183/183 测试通过，compileall/lint/build 通过。未连接 Supabase，未执行 Migration。 |
| 2026-06-13 | P5-SY4D 第二次返工完成：场景 17 使用完整 Mock 链 + stdout 捕获严格断言禁止消息 + 所有后续操作均未调用；场景 18 Dry Run Mock 链新增 RPC/Phase G/Phase I/SyncLog/fallback mocks 并严格断言均未调用。27/27 测试通过 + 全部现有测试通过（183/183 total），compileall 通过，lint 0 errors 8 warnings，build 通过。未连接 Supabase，未执行 Migration。等待独立验收。 |
| 2026-06-13 | P5-SY4D 第一次返工完成：全部 27 场景重写为通过 `cli_execute.main()` 严格验证退出码 0/1/2。s18 完整 Mock Dry Run CLI 流程 → SystemExit.code == 0，删除 `except Exception: pass`。s02–s12/s16/s19/s23/s24 断言 RPC 恰好 1 次 + Phase G/I 审计未调用 + failed SyncLog + fallback 未调用。s14 CLI exit 2，s15 CLI exit 1。s21/s22 断言 RPC/审计/SyncLog/fallback 均未调用。183/183 测试通过，compileall/lint/build 通过。未连接 Supabase，未执行 Migration。等待独立验收。 |
| 2026-06-13 | P5-SY4D 开始：P5-SY4C 独立验收通过。新建 test_sync_log.py Mock 覆盖 24 场景。禁止连接 Supabase 或执行 Migration。 |
| 2026-06-13 | P5-SY4C 第六次返工完成：4 项修复 — (1) _write_sync_log 成功响应身份校验增强：warehouse_id 必须严格等于请求 warehouse_id；id/status/warehouse_id 必须为非空字符串（拒绝数字/布尔）；list 响应必须恰好包含 1 条记录；非法响应重试 1 次后进入 fallback/exit 路径 (2) 新增 4 项聚焦测试（warehouse_id 不匹配、id 为数字、warehouse_id 为数字、list 多条记录） (3) 修复 2 项旧测试断言适配新校验消息。156/156 测试通过（76 executor + 26 plan + 44 verifier + 10 structural），compileall 通过，lint 0 errors 8 warnings，build 通过。禁止执行 Migration 或数据库写入。等待独立验收。 |
| 2026-06-13 | P5-SY4C 第五次返工完成：7 项修复 — (1) RPC/摘要校验/审计失败时若 sync_log+fallback 双失败，向 stderr 输出明确警告（含 sync_log 错误和 fallback 错误原因），保持原始业务错误为主错误 (2) _write_sync_log 成功响应严格校验：拒绝对空 dict {}/[{}]、要求非空 id/status/warehouse_id、status 必须与请求 status 一致 (3) 新增 7 项聚焦测试（{} 拒绝、[{}] 拒绝、status 不匹配、缺 id、缺 warehouse_id、RPC 失败双失败 stderr 捕获、审计失败双失败 stderr 捕获）。152/152 测试通过（72 executor + 26 plan + 44 verifier + 10 structural），compileall 通过，lint 0 errors 8 warnings，build 通过。禁止执行 Migration 或数据库写入。等待独立验收。 |
| 2026-06-13 | P5-SY4C 第四次返工完成：5 项修复 — (1) _write_sync_log 严格拒绝 list 首元素非 dict（[null]/[string]/[number]） (2) _save_fallback_log 自身异常保护：4 个调用点全部 try/except，原始 RPC/审计主错误不丢失，CLI exit 2 不再依赖 fallback_path (3) 新增 6 项聚焦测试 (4) eslint globalIgnores 加入 .pytest_cache (5) 文档同步。145/145 测试通过（65 executor + 26 plan + 44 verifier + 10 structural），compileall 通过，lint 0 errors，build 通过。禁止执行 Migration 或数据库写入。等待独立验收。 |
| 2026-06-13 | P5-SY4B 独立静态验收通过：Migration 00006（673 行）`quantity` 严格校验移至步骤 5b + 测试场景 1 前置条件修正 + 新增场景 16b。26/26 测试通过，未执行 Migration。 |
| 2026-06-12 | P5-SY4B 返工完成：`quantity` 严格校验（4 层：非 null / JSON number / 严格整数 / >= 0）移至步骤 5b（所有 Variant/Inventory/Warehouse 写入前），步骤 8 复用已校验 quantity；SQL 注释测试场景 1 修正 WM0074 前置条件（已有 Inventory qty=21289 → UNCHANGED），可实际验算 inserted=1 / updated=1 / unchanged=1；新增场景 16b（5 子场景覆盖非严格整数）。673 行，26/26 测试通过。未执行 Migration，未发生数据库写入。等待独立验收。 |
| 2026-06-12 | P5-SY4B 第一次独立验收未通过：`quantity` 严格校验仍位于 Variant INSERT 之后，不符合关键输入校验先于全部业务写入的验收条件；SQL 注释测试场景 1 的前置条件实际产生 2 个 Inventory INSERT，与预期 `inserted=1 / unchanged=1` 冲突。26/26 纯函数测试通过；未执行 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4B Migration 00006 创建完成：`supabase/migrations/00006_sync_warehouse_inventory.sql`（642 行）— 完整 13 步事务 RPC（统一快照时间解析与全量一致性校验在所有业务写入前完成）+ SECURITY INVOKER + SET search_path = '' + 所有对象 public. 限定 + REVOKE/GRANT 权限收口 + 23 个注释形式 SQL 测试场景。26/26 纯函数测试通过。未执行 Migration，未发生数据库写入。等待独立验收。 |
| 2026-06-12 | P5-SY4A 第七次独立设计验收通过：SQL 草案执行顺序已调整为统一快照时间解析与全量一致性校验先于所有业务写入；26/26 纯函数测试通过；未创建 00006 Migration，未发生数据库写入。完整设计归档至 `docs/tasks/archive/p5-sy4a-design-review.md`，当前任务切换至 P5-SY4B。 |
| 2026-06-12 | P5-SY4A 第六次返工完成：SQL 执行顺序修正确保统一快照时间校验在所有业务写入之前。步骤 6a/6b（解析统一快照时间 + 全量一致性校验）移至步骤 7（Variant INSERT）之前；步骤 8（Inventory 写入）/ 步骤 10（写后核对）/ 步骤 11（Warehouse 改名）/ 步骤 12（Warehouse 写后核对）/ 步骤 13（返回摘要）同步重编号。流程描述、P5-SY4B 验收要求（22 项更新）、验收清单（17 项）已同步修正。未创建 00006 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4A 第六次独立验收未通过：CLI 空快照拒绝与 26/26 纯函数测试通过，统一 v_sync_at 已用于 Inventory 三向写入和写后核对；但 SQL 步骤 6 先执行 Variant INSERT，步骤 7a/7b 才校验统一快照时间，与”任何业务写入前完成校验”的要求不一致。未创建 00006 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4A 第五次返工完成：修复 2 项设计与真实实现不一致 — (1) 真实 `validate_json()` 新增 `len(rows)==0` → ValidationError，新增纯函数测试验证空 rows 被拒绝；(2) SQL 步骤 7a/7b/7c 重写：在任何业务写入前解析首条 last_sync_at 为统一 v_sync_at，遍历全部条目强制一致（任一条不同→回滚），全部 INSERT/UPDATE/UNCHANGED 和写后核对使用统一 v_sync_at。P5-SY4B 必须包含从 21 项扩展至 22 项，SQL 测试方案从 16+ 扩展至 17+ 场景，测试矩阵从 23 扩展至 24 场景。 |
| 2026-06-12 | P5-SY4A 第五次独立验收未通过：真实 `validate_json()` 仍接受空 rows，与文档描述不一致；SQL 草案逐条接受不同 `last_sync_at`，未落实同一快照统一同步时间约束。 |
| 2026-06-12 | P5-SY4A 第四次返工完成：修复 2 项可信度阻塞 — (1) RPC 步骤 3 新增 `jsonb_array_length(p_inventory) = 0` → RAISE EXCEPTION，CLI 同步拒绝空快照，防止抓取异常误记 success；(2) UNCHANGED 分支改为 metadata-only UPDATE 刷新 `inventory.last_sync_at`，新增 last_sync_at 非空/可解析校验，写后核对同时验证 quantity 与 last_sync_at。测试矩阵从 21 扩展至 23 场景，P5-SY4B 必须包含从 19 项扩展至 21 项，SQL 测试方案从 14+ 扩展至 16+ 场景。 |
| 2026-06-12 | P5-SY4A 第三次返工完成：修复 2 项正常业务缺口 + 1 项文档修正 — (1) p_inventory 为本次来源完整库存快照（合并全部四类），RPC 内三向分类写入（INSERT/UPDATE/UNCHANGED），返回摘要区分 inventory_received/inserted/updated/unchanged；(2) 新增步骤 4c：每个 p_variants 的 (sku,country) 必须存在于 p_inventory，缺失则 RAISE EXCEPTION；(3) 修正 service_role key 安全描述。测试矩阵从 19 扩展至 21 场景，P5-SY4B 必须包含从 17 项扩展至 19 项，SQL 测试方案从 12+ 扩展至 14+ 场景。 |
| 2026-06-12 | P5-SY4A 第二次返工完成：修复 4 项细节阻塞 — (1) 去重从 `jsonb_agg(DISTINCT value)` 改为 `GROUP BY (sku,country) HAVING COUNT(*)>1`；(2) 新增 Warehouse country='PH' 校验 + 名称白名单 + 逐条 Variant/Inventory country 一致性校验；(3) 新增事务内写后逐 SKU SELECT 核对 + Warehouse 写后 SELECT 核对；(4) 新增显式 `GRANT ... TO service_role`。测试矩阵从 11 扩展至 19 场景，P5-SY4B 必须包含从 12 项扩展至 17 项，SQL 测试方案从 8+ 扩展至 12+ 场景。 |
| 2026-06-12 | P5-SY4A 第二次独立验收未通过：SQL 草案使用整段 JSON 去重而非 `(sku,country)` 业务键；未限制 Inventory/Variant country 与 Warehouse country 一致；未验证允许的 Warehouse 名称及写后逐项状态；REVOKE 后缺少显式 `GRANT ... TO service_role`。 |
| 2026-06-12 | P5-SY4A 返工完成：修复 4 项阻塞 — RPC 输入改用 sku+country+quantity、事务内解析 variant_id、全部关键验证在事务内提交前、SELECT FOR UPDATE 串行化、SECURITY INVOKER + search_path='' + REVOKE 权限收口、SyncLog 规则统一（仅记录已尝试写入的运行、--no-sync-log 仅 Dry Run 可用、success 写入失败 → sys.exit(2)）、新增 network_timeout_unknown 分类与恢复策略。任务拆分 P5-SY4B/C/D/E 已更新，测试矩阵扩展至 11 场景。 |
| 2026-06-12 | P5-SY4A 设计审查完成：确认 4 处部分写入风险位置，判定当前 REST-only 架构无法满足"失败保留上次成功数据"，设计事务 RPC 方案、sync_log 写入时机与自保机制，拆分 P5-SY4B/C/D/E 四个子任务，产出 9 场景测试矩阵。未发生数据库写入。 |
| 2026-06-12 | P5-SY3B 第四次独立验收通过：确认 Phase E fail-fast、Phase I Warehouse 最终状态验证及真实模式计划漂移阻断；83 项 Python 测试、语法检查、lint 与 build 独立通过。切换至 P5-SY4。 |
| 2026-06-12 | P5-SY3B 菲律宾首次真实录入完成：91 ProductVariants 创建（product_id=null, match_status=unmatched）+ 91 Inventory UPSERT（quantity=available_quantity）+ Warehouse 改名（"菲律宾仓"→"菲律宾-新创启辰自建仓"）。幂等验证：3 次连续重跑，0 重复 Variant，91→91→91 核对一致。14 项 executor 测试通过。|
| 2026-06-12 | P5-SY3A 独立验收返工完成：新增 inventory_after_variant_create（91 条）、未知 Warehouse 必须失败、严格 int 校验（拒绝 bool/float 1.0）、product_name 非空、逐行 warehouse 校验、25 项测试、分离分类与动作计数核对 |
| 2026-06-12 | P5-SY3A 菲律宾库存写入映射 Dry Run 完成：sync/ 模块搭建（Supabase 只读网关 + 输入校验 + 计划生成 + CLI）+ 17 项测试 + Dry Run 报告（91→91 全部新 SKU + warehouse rename 计划）|
| 2026-06-12 | P5-SY2 测试与文档收尾：FakePage 测试覆盖 VXE 容器绑定失败和容器标记丢失（10/10 通过）+ README 删除旧回退/跳过/column_mismatch 描述，改为 fail-fast + data 属性绑定 |
| 2026-06-12 | P5-SY2 第二次独立验收返工完成：删除所有 table 回退 + VXE 容器 data 属性绑定 + 列数不匹配/容器绑定失败均明确失败 + 纯函数提取 + 8 项结构保护测试 + 统计公式修正 |
| 2026-06-12 | P5-SY1 独立验收通过并切换至 P5-SY2；发现抓取器会过滤 available=0 且 transit=0 的真正缺货 SKU，正式写入前必须修复 |
| 2026-06-12 | P5-SY2 菲律宾单仓抓取加固完成：91条（98原始-1组合-6无SKU-0重复），零库存13条全保留，表头适配新版13列，遮罩仅处理已知引导层 |
| 2026-06-12 | P5-SY1 BigSeller 只读试跑完成：5仓182条（PH 79/VN 62/TH 19/MY 17/ID 5），available=cur-locked，autoid 仍有效，需处理 language_switch_guide_mask 遮罩；首仓确认为菲律宾 |
| 2026-06-12 | 确认当前无海外库存数据，数据来源为 BigSeller 页面抓取；旧抓取器以只读 JSON 试跑方式归档到 `tools/bigseller-scraper/`，切换至 P5-SY1 |
| 2026-06-12 | P2-I2 独立验收通过：筛选与分页 URL 行为正确，移动端表格可横向滚动，loading 布局一致；切换至 P2-I3 |
| 2026-06-12 | P2-I2 交互与响应式验收完成：搜索输入 key 强制重新挂载、表格 overflow-x-auto、loading 骨架布局对齐 |
| 2026-06-12 | P2-I1 独立验收通过：国家/仓库/搜索/状态筛选在分页前完成，错误页不泄露数据库文本；切换至 P2-I2 |
| 2026-06-12 | P2-I1 返工完成：国家筛选从 DB 层 .eq() 移至 JS 层过滤 + 错误页改为固定中文提示 |
| 2026-06-12 | P2-I1 独立验收未通过：国家筛选关联未使用 inner，可能混入其他国家主记录；错误页直接展示数据库错误文本 |
| 2026-06-12 | P2-I1 海外库存查询与分页正确性 — lint 0 errors + build 通过，等待独立验收 |
| 2026-06-12 | 撤销正式免费部署平台指定：当前仅使用 Vercel/Next.js + Supabase 快速开发，正式部署方案待上线前评估 |
| 2026-06-12 | 明确云服务原则：当前使用 Supabase 与 Vercel/Next.js 生态快速开发，但供应商依赖必须集中封装，页面与核心业务不得深度绑定 |
| 2026-06-12 | 新增强制架构规则：数据库、认证、存储、同步与部署能力必须通过轻量封装使用，为迁移其他平台保留替换空间 |
| 2026-06-11 | 国外库存 MVP 功能修正：重构海外库存查询（全量加载 + JS 筛选分页 + 搜索去 .or() + stockStatus 筛选后分页 + 未匹配状态规则 + loading.tsx/error.tsx） + Dashboard 首页入口 |
| 2026-06-11 | 开发优先级调整：ProductVariant 页面延期，优先交付国外库存看板 MVP |
| 2026-06-11 | ProductVariant Mapping 数据层：Migration 00003/00004/00005 最终修复 + 已执行通过验收（RPC 安全收口 + 函数内去重 + p_items 校验 + public. schema） |
| 2026-06-11 | Task 1.1 — 最终验收修复：关联查询全部 throw ProductError、getByCode DB_ERROR 不静默、eslint exit 0、database.ts 生成类型忽略 |
| 2026-06-11 | Task 1.1 — Product CRUD 验收修复：Repository ProductError 精确错误传播、23505 唯一约束识别、toggleActive 行存在性检测、编辑模式 code 修复、关联 SKU 列名修正、loading.tsx + error.tsx |
| 2026-06-11 | Task 1.1 — Product CRUD 完成：产品列表页 + 详情页 + Sheet 表单 + 数据层收口（UUID 校验/错误日志/code 重复检测/库存关联） |
| 2026-06-11 | 文档与 Claude 配置治理 — 建立按路径 rules、项目文档树并清理冲突规则 |
| 2026-06-10 | Task 0.4 Architecture Audit — 综合评分 9/10，修复 3 个架构问题 |
| 2026-06-10 | Fix — Shipment 创建事务化（新增 migration 00002 + PostgreSQL 函数 + RPC 调用） |
| 2026-06-10 | Fix — Inventory country/warehouseType 过滤下推到 Supabase 查询层 |
| 2026-06-10 | Fix — 提取 `unwrapJoin()` 工具函数，消除 9 处重复类型转换 |
| 2026-06-10 | Task 0.4 完成 — 建立 6 个 feature 模块骨架（30 个文件） |
| 2026-06-10 | Zod v4 `.errors` → `.issues` 修复（3 个文件） |
| 2026-06-10 | Zod v4 `z.enum` `errorMap` → `error` 修复 |
| 2026-06-10 | `common.ts` `ReactNode` import 修复 |
| 2026-06-10 | Task 0.3 完成 — Auth + Dashboard 布局 |
| 2026-06-10 | Task 0.2 完成 — Migration 执行 + 类型生成 |
| 2026-06-10 | Task 0.1 完成 — 项目初始化 |

## Current Build Status

✅ P5-SY11G-RUNTIME 质量门全部通过（2026-06-25）：896/896 TypeScript 测试（30 文件），lint 0 errors / 24 warnings（pre-existing），build 通过。Python 测试：315 passed + 5 collection errors（pre-existing，需 PG 环境变量）。

## Known Limitations

- `profiles.is_active` 认证函数已新增（P5-SY5B）— 旧调用方不受影响，后续任务逐步迁移。
- `middleware.ts` 尚未迁移为 Next.js 16 的 `proxy.ts`

## Current Database Migration

- `supabase/migrations/00001_initial_schema.sql` — 初始 schema（10 表 + 42 RLS）✅ 已执行
- `supabase/migrations/00002_create_shipment_transaction.sql` — Shipment 创建事务函数 ✅ 已执行
- `supabase/migrations/00003_tighten_variant_rls.sql` — 删除 operator_update_variant_match 策略，收紧 ProductVariant RLS ✅ 已执行
- `supabase/migrations/00004_batch_match_variants.sql` — SECURITY INVOKER + admin 校验 + 函数内去重 + FOR UPDATE + count 验证 + REVOKE/GRANT ✅ 已执行
- `supabase/migrations/00005_fix_shipment_rpc.sql` — DROP 旧版 10 参数函数 + SECURITY INVOKER + 角色校验 + p_items 输入校验 + auth.uid() + REVOKE/GRANT ✅ 已执行
- `supabase/migrations/00006_sync_warehouse_inventory.sql` — 事务型海外库存同步 RPC（674 行，SECURITY INVOKER + search_path='' + REVOKE/GRANT）✅ 已执行（2026-06-19）
- `supabase/migrations/00007_sync_run.sql` — sync_run 表 + sync_warehouse_lock 表 + sync_log 扩展 5 列 + 6 个 SECURITY DEFINER RPC + 11 CHECK + 补建 + 权限收口（1392 行）✅ 已执行（2026-06-19）
- `supabase/migrations/00008_sync_run_for_update_dry_run.sql` — claim_sync_run Step 6 FOR UPDATE on dry_run 行，关闭 TOCTOU 窗口（244 行）✅ 已执行（2026-06-19）
- `supabase/migrations/00009_generalize_sync_warehouse_country.sql` — CREATE OR REPLACE sync_warehouse_inventory RPC，移除 4 处硬编码 PH 检查，改为动态校验（~500 行）✅ 已执行（2026-06-19）

## Database Vendor Isolation（新增约束）

用户确认后续可能切换国内数据库厂商。当前 Supabase/PostgreSQL 为落地层，但业务层不得新增 Supabase 直接绑定：

- **允许**：Migration 使用 Supabase/PostgreSQL 专用语法（属于落地层）
- **禁止**：P5-SY8 及后续业务代码新增页面/组件/业务逻辑直接依赖 Supabase SDK
- **边界**：UI / Server Actions / SyncService 只依赖接口；数据库实现藏在 Repository / adapter 层
- **命名**：若需要新增真实数据库访问实现，命名为 Supabase/Postgres adapter（如 `SupabaseSyncRepository`），而不是把 Supabase 调用写进通用 SyncService
- **未来切换**：替换 adapter/migration 层，业务层契约不变
- **Python CLI 现状**：现有 `SUPABASE_SERVICE_ROLE_KEY` + Supabase REST 路径继续作为已知差距（GAP-01），不在本次扩散

## Current Blockers

无阻塞。P5-SY12 特别关注阶段 B 最小闭环实施中（2026-06-25 启动）。

## Next Step

P5-SY12 特别关注阶段 B 最小闭环已完成（2026-06-25）。Migration 00013 扩展 `preference_type` CHECK 约束支持 `'favorited'`；新增 `src/features/preferences/` 模块；库存列表星标按钮正常；Dashboard"关注产品动态"区正常。阶段 B 告警使用 `product.safety_stock` 临时规则。质量门：979/979 TS 测试，lint 0 errors，build pass。等待用户确认下一任务，不自动进入 P5-SY12 阶段 C/D。P5-SY10 Phase B 自动 Real Write 设计预留，当前不启用。WEBSYNC_REAL_WRITE_ENABLED 仍 disabled。

## P5-SY3A Dry Run 结果摘要（返工后）

| 指标 | 值 |
|------|-----|
| 输入行数 | 91 |
| Warehouse 改名计划 | `rename`: "菲律宾仓" → "菲律宾-新创启辰自建仓"（复用 ID adc5ec45） |
| 新 SKU (new_variants) | 91 |
| Inventory 新增 (inserts) | 0（现有 variant 无库存记录的场景，当前 DB 无 variant） |
| Inventory 更新 (updates) | 0 |
| Inventory 不变 (unchanged) | 0 |
| Inventory 后建 (after_variant_create) | **91**（P5-SY3B 创建 Variant 后必须执行的 Inventory INSERT） |
| 拒绝行 | 0 |
| **输入行分类总计** | **91 == 91** ✓ |
| **Inventory 动作总计** | **91 == 91** ✓ |
| 数据库 PH variants | 0（首次同步） |
| 数据库仓库名 | "菲律宾仓"（旧名） |

### 返工修复项

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 显式 Inventory 写入动作 | 新增 `inventory_after_variant_create`，每条含 sku/warehouse_id/new_quantity/depends_on，明确 P5-SY3B 创建 Variant 后必须 INSERT Inventory |
| 2 | 分离计数核对 | 输入行分类总计（91）与 Inventory 动作总计（91）分别核验 |
| 3 | 未知 Warehouse 必须失败 | `_plan_warehouse_rename()` 对旧名/正式名外的任何名称抛出 RuntimeError，不再自动规划改名 |
| 4 | 严格 int 校验 | `type(available) is not int` 拒绝 bool（int 子类）和 float（含 1.0） |
| 5 | product_name 非空 | 逐行校验 product_name 必须非空（product_variant.name 为 NOT NULL） |
| 6 | 逐行 warehouse 校验 | 每行 warehouse 必须精确等于 "菲律宾-新创启辰自建仓" |

### sync/ 模块结构

```text
tools/bigseller-scraper/sync/
├── __init__.py          # 模块标识
├── config.py            # 常量（仓库名、国家代码、新 SKU 默认值）
├── supabase_gateway.py  # Supabase REST API 只读网关（urllib，无额外依赖）
├── input_validator.py   # 输入校验纯函数（仓库名、计数、SKU 唯一性、数量合法性）
├── plan_generator.py    # 写入计划生成纯函数（供应商无关）
├── cli.py               # CLI 入口（argparse --json，显式路径，分离分类计数与 Inventory 动作计数）
└── test_plan.py         # 25 项不依赖 Supabase 的测试
```

### 验证状态

- P5-SY2 结构保护测试: 10/10 PASS
- P5-SY3A 计划生成测试: **25/25 PASS**（含 8 项新增：float 1.0 / bool / 空 product_name / 逐行 warehouse / 未知 warehouse 失败 / inventory_after_variant_create / 动作计数分离 / 混合场景核对）
- ESLint: 0 errors (8 pre-existing warnings)
- `npm run build`: PASS
- Dry Run 报告: `tools/bigseller-scraper/runtime/p5-sy3a-dry-run-*.json`
- 无数据库写入

## P5-SY3B 执行结果（2026-06-12）

### 写入摘要

| 指标 | 值 |
|------|-----|
| 执行批次 | 3 次（首次创建 + 2 次幂等重跑） |
| Warehouse ID | `adc5ec45-cd98-42a8-a1d1-26600e80d481` |
| Warehouse 改名 | "菲律宾仓" → "菲律宾-新创启辰自建仓" |
| 首次 Variant 创建 | 91 |
| 首次 Inventory UPSERT | 91 |
| 第 2 次: Variant 重复创建 | 0（91 跳过） |
| 第 2 次: Inventory 更新 | 91 |
| 第 3 次: Variant 重复创建 | 0（91 跳过） |
| 第 3 次: Inventory 更新 | 91 |
| 幂等验证 | ✅ 3/3 重跑一致，无重复数据 |

### 执行报告

- `tools/bigseller-scraper/runtime/p5-sy3b-execute-20260612-141445.json`（第 2 次 — 完成改名）
- `tools/bigseller-scraper/runtime/p5-sy3b-execute-20260612-143059.json`（第 3 次 — 幂等验证）

### sync/ 模块结构（更新后）

```text
tools/bigseller-scraper/sync/
├── __init__.py          # 模块标识
├── config.py            # 常量（仓库名、国家代码、新 SKU 默认值）
├── supabase_gateway.py  # Supabase REST API 只读网关（urllib，无额外依赖）
├── input_validator.py   # 输入校验纯函数
├── plan_generator.py    # 写入计划生成纯函数（供应商无关）
├── executor.py          # P5-SY3B 执行器（幂等 Variant INSERT + Inventory INSERT/UPDATE + Warehouse 改名，含重试 + Phase G 完整逐项验证）
├── verifier.py          # P5-SY3B 验证器（compare_plans 计划漂移比较 + verify_inventory_post_write 写后逐项验证）
├── cli.py               # P5-SY3A CLI（Dry Run 模式）
├── cli_execute.py       # P5-SY3B CLI（--input-json + --dry-run-report + --execute --confirm P5-SY3B-PH 安全门 + 执行前计划漂移检测）
├── test_plan.py         # 25 项计划生成/校验测试
├── test_executor.py     # 14 项执行器纯函数测试
└── test_verifier.py     # 24 项验证器纯函数测试（15 compare_plans + 9 verify_inventory_post_write）
```

### 约束遵守

- [x] 必须 --execute --confirm P5-SY3B-PH 安全门
- [x] 禁止覆盖已匹配 Variant 的 product_id / match_status
- [x] 复用原 Warehouse ID adc5ec45，不创建新 Warehouse
- [x] Inventory 核验通过后改名 Warehouse
- [x] 幂等可重跑：3 次连续执行无重复数据
- [x] 执行报告不含密钥（supabase_url/service_role_key）
- [x] 不写 sync_log
- [x] 不开始 P5-SY4

### 独立验收返工（2026-06-12）

返工修复项：

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 完整写后逐项验证 | Phase G 逐 SKU 验证 quantity、检测缺记录/计划外记录/总量不一致，任一差异 fail-fast 阻止 Warehouse 改名 |
| 2 | CLI 显式接收输入 JSON | `--input-json` 与 `--dry-run-report` 均为必需参数 |
| 3 | 执行前计划漂移检测 | 重新查询 Supabase + 从输入 JSON 重新生成计划 + `compare_plans()` 逐项比较 SKU/quantity/Warehouse ID/改名目标 |
| 4 | 漂移检测分级处理 | Dry-run 模式漂移仅警告继续；`--no-dry-run` 模式漂移立即 fail-fast |
| 5 | 补充验证测试 | `test_verifier.py`: 15 项 compare_plans + 9 项 verify_inventory_post_write = 24 项纯函数测试 |

新增/修改文件：

| 文件 | 说明 |
|------|------|
| `sync/verifier.py` | 纯函数验证器：`compare_plans()` 计划漂移比较 + `verify_inventory_post_write()` 写后逐项验证 |
| `sync/executor.py` | Phase G 替换为完整逐项验证，fail-fast 阻止 Phase H；移除弱校验 `_validate_execution()` |
| `sync/cli_execute.py` | 新增 `--input-json` 必需参数；执行前计划漂移检测（dry-run 警告，no-dry-run 阻止） |
| `sync/test_verifier.py` | 24 项纯函数测试（15 compare + 9 verify） |

测试结果：

- `test_plan.py`: 25/25 PASS
- `test_executor.py`: 14/14 PASS
- `test_verifier.py`: 24/24 PASS
- **总计: 63/63 PASS**
- Python 语法: 全部通过
- ESLint: 0 errors (8 pre-existing warnings)
- `npm run build`: PASS

只读验证 CLI 运行结果：

- 计划漂移检测: 6 项差异（预期 — DB 已写入数据，与原始 Dry Run 报告状态不同）
- Dry-run 执行: 91 variants 已存在全部跳过，91 inventory UPDATE 核对一致
- 写后核对: Inventory 计划 91 == 实际 91 [OK]
- Warehouse: 已是目标名称 "菲律宾-新创启辰自建仓"

### P5-SY3A Dry Run 结果摘要（返工后）

（见上方 P5-SY3A 相关章节）

## P5-SY2 加固成果（首次）

### 关键修复

| 修复项 | 变更 |
|--------|------|
| 仓库范围 | 5仓 → 菲律宾单仓（名称过滤 + 反选非目标仓） |
| 零库存保留 | 删除 `available=0 && transit=0` 过滤，13条零库存全部保留 |
| 表头校验 | 新增 `_validate_headers()`，全文档搜索 thead th + VXE 回退，13列按关键词校验 |
| 遮罩处理 | 仅处理 `.language_switch_guide_mask`，不通用删除 `.ant-modal-mask` |
| 统计输出 | 原始行数→非目标仓→组合SKU→无效SKU→去重→最终行数，全链可解释 |

### 表头适配

BigSeller 表头已从旧版更新，`EXPECTED_HEADERS` 同时兼容新旧两套关键词：

| 列 | 旧关键词 | 新关键词 |
|----|----------|----------|
| 3 | 当前库存 | **现有库存** |
| 4 | 锁定库存 | **订单已锁** |
| 5 | 可用库存 | **整仓可用** |
| 6 | 在途库存 | **在途中** |
| 8 | 预警库存 | **警戒库存** |
| 9 | 日均销量 | **预测日销量** |

### 数据概况

| 指标 | 值 |
|------|-----|
| 抓取时间 | 2026-06-12 10:31 CST |
| 原始行数 | 98 |
| 非目标仓库 | 0 |
| 组合SKU排除 | 1 |
| 无效SKU | 6 |
| 去重去除 | 0 |
| **最终行数** | **91** |
| 零可用库存 | 13（含12条纯零库存） |
| 页数 | 2 |

### 字段关系验证

- `cur_stock - locked == available` 91/91 ✅
- SKU 提取成功率: 85/91 (93.4%，6条无SKU码)
- 仓库唯一性: 仅菲律宾-新创启辰自建仓 ✅

## P5-SY2 独立验收返工（2026-06-12 10:46 CST）

### 验收未通过原因

1. 6 条无效 SKU 被 `invalid_sku_count += 1` 后静默丢弃，无法追溯具体内容
2. 仓库选择仍以硬编码 `warehouse_option_6` 为主要定位方式，未真正实现名称优先
3. 表头与表体从分离的 `<table>` 元素独立获取，未绑定同一 VXE 容器；`tds.length < 7` 允许后半字段静默缺失

### 返工修复

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 无效 SKU 可追溯 | `invalid_sku_rows` 列表收集完整字段（sku_info/warehouse/cur_stock/locked/available/transit），保存到 `runtime/debug/invalid_sku_rows.json` 和 `runtime/output/invalid-sku-rows-*.json` |
| 2 | 仓库名称优先 | 打开下拉后枚举所有 `label.ant-checkbox-wrapper` 的 autoid + text，严格按 `TARGET_WAREHOUSE_NAME` 精确文字匹配；名称匹配失败时回退 `warehouse_option_6` 并验证其文字一致，不一致则抛出 RuntimeError |
| 3 | 表头表体绑定 | `_validate_headers()` 优先在 `.vxe-table` 容器内同时定位 `.vxe-table--header table` 和 `.vxe-table--body table`，通过 xid 返回绑定信息；行提取时 `tds.length === header_count` 严格校验（不再 `< 7`），列数不匹配行单独计数并跳过 |

### 返工后数据概况

| 指标 | 首次 (10:31) | 返工后 (10:46) |
|------|-------------|---------------|
| 原始行数 | 98 | 98 |
| 列数不匹配 | N/A（未校验） | **0** |
| 非目标仓库 | 0 | 0 |
| 组合SKU排除 | 1 | 1 |
| 无效SKU | 6 | 6（**已保存完整记录**） |
| 去重去除 | 0 | 0 |
| **最终行数** | **91** | **91** |
| 零可用库存 | 13 | 13 |
| 表头来源 | N/A | vxe-container（thead th） |

### 无效 SKU 记录（6 条）

| sku_info | 可用库存 | 在途 | 日销 | 原因 |
|----------|---------|------|------|------|
| 硅胶刷头-暗紫色 Brush-darkpurple | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶按摩刷头-绿色 Brush-Green | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶刷头-粉色 Brush-Pink | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶刷头-紫色 Brush-Purple | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶美容刷（菲律宾）--颜色随机 Brush | 0 | 0 | 0.03 | 无 SKU 码 |
| 清洁刷 clean brush | 10,531 | 0 | 17.09 | 无 SKU 码 |

## P5-SY2 第二次独立验收（2026-06-12）

数据结果核对通过：91 条正式结果、6 条无效 SKU 可追溯、13 条零可用库存保留、仓库唯一、91/91 库存关系成立、未发现 Supabase 写入。

第二次验收仍未通过：

1. `_validate_headers()` 仍可回退到任意表头，行提取最终仍可回退到任意含数据行的表格，无法保证同一 VXE 容器绑定。
2. `column_mismatch` 当前只跳过异常行并继续输出，页面结构变化时可能生成不完整 JSON。
3. `raw_row_count` 已排除异常行，但统计公式再次减去 `column_mismatch_count`，异常场景统计不可核对。

## P5-SY2 第二次独立验收返工（2026-06-12 11:07 CST）

### 返工内容

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 删除所有 table 回退 | `_validate_headers()` 仅通过 `.vxe-table` 容器 + `table.vxe-table--header` / `table.vxe-table--body` 定位，无 thead th 全文档搜索、无 `.vxe-cell--title` 回退。行提取仅通过 `data-bigseller-scraper` 标记属性定位，无任意 VXE 容器搜索、无任意 table 回退 |
| 2 | VXE 绑定失败明确失败 | 无法找到同时含 header/body table 的 VXE 容器时抛出 RuntimeError；行提取时标记属性未找到时抛出 RuntimeError。无静默降级 |
| 3 | 列数不匹配明确失败 | `_extract_page_rows()` 内任意一行 `tds.length !== header_count` 立即抛出 RuntimeError，不生成 JSON。异常详情包含行号、实际列数、期望列数和预览数据 |
| 4 | 修复统计公式 | 删除 `column_mismatch_count`（fail-fast 下始终为 0），公式简化为 `raw - other_wh - combo - invalid - dup = final` |
| 5 | 纯函数提取 | `_validate_header_keywords(headers)` 和 `_parse_cell_rows(cell_rows, header_count)` 提取为纯函数，供测试直接调用 |
| 6 | 最小结构保护测试 | `test_structural_protection.py`：8 项测试，不依赖 BigSeller 登录 — 正常表头通过/关键词失败/列数不足失败/正常数据解析/12列失败/14列失败/混合列失败/字段映射正确 |

### VXE 容器绑定机制

BigSeller 实际 VXE 结构：
```html
<div class="vxe-table">
  <div class="vxe-table--header-wrapper">
    <table class="vxe-table--header"><thead><tr><th>...</th></tr></thead></table>
  </div>
  <div class="vxe-table--body-wrapper">
    <table class="vxe-table--body"><tbody><tr><td>...</td></tr></tbody></table>
  </div>
</div>
```

绑定流程：
1. `_validate_headers()` 在 `.vxe-table` 容器内同时定位 `table.vxe-table--header` 和 `table.vxe-table--body`，在容器上设置 `data-bigseller-scraper="target"` 标记
2. `_extract_page_rows()` 仅通过 `[data-bigseller-scraper="target"]` 定位同一容器，无回退
3. 翻页时 VXE 容器 DOM 复用，标记属性保持有效

### 结构保护测试结果

```
10/10 通过 (0 失败):
  PASS: 正常 13 列表头通过校验
  PASS: 正常 13 列数据行通过解析
  PASS: 表头关键词不匹配时抛出 RuntimeError
  PASS: 表头列数不足时抛出 RuntimeError
  PASS: 任意行少于表头列数(12列)时抛出 RuntimeError
  PASS: 任意行超过表头列数(14列)时抛出 RuntimeError
  PASS: 混合行(13列+12列)中任意一行不匹配即抛出 RuntimeError
  PASS: 解析后的字段映射正确
  PASS: _validate_headers() VXE_CONTAINER_NOT_FOUND 时抛出 RuntimeError
  PASS: _extract_page_rows() CONTAINER_NOT_FOUND 时抛出 RuntimeError
```

## P5-SY2 第三次独立验收（2026-06-12）

生产实现与最新抓取结果通过：任意表格回退已删除，VXE 同容器绑定和列数异常均 fail-fast；最新输出 91 条，统计一致，未发现 Supabase 写入。

## P5-SY2 测试与文档收尾（2026-06-12）

已完成：

1. **FakePage 测试**：新增 2 项测试覆盖 VXE 容器绑定失败和容器标记丢失场景。通过 FakePage 类模拟 `page.evaluate()` 返回值，验证 `_validate_headers()` 在 VXE_CONTAINER_NOT_FOUND 时抛出 RuntimeError，`_extract_page_rows()` 在 CONTAINER_NOT_FOUND 时抛出 RuntimeError。总测试数 10/10 通过。
2. **README 修正**：删除 `column_mismatch_count` 元数据字段、`column_mismatch` 统计项、xid 回退描述、"列数不匹配跳过"描述；改为 `data-bigseller-scraper` 标记属性绑定同一 VXE 容器 + fail-fast + 不生成正式 JSON。

### 返工后数据概况（2026-06-12 11:07 CST）

| 指标 | 值 |
|------|-----|
| 原始行数（全部通过列数校验） | 98 |
| VXE 容器绑定 | ✅ `data-bigseller-scraper` 标记 |
| 表头来源 | `table.vxe-table--header` (VXE 容器内) |
| 非目标仓库 | 0 |
| 组合SKU排除 | 1 |
| 无效SKU | 6（已保存完整记录） |
| 去重去除 | 0 |
| **最终行数** | **91** |
| 零可用库存 | 13 |
| 统计公式 | `98 - 0 - 1 - 6 - 0 = 91` |

> 6 条无效 SKU 均无标准 SKU 码（非 WM/ICEWM/条码格式）。其中 `clean brush` 库存 10,531 为真实库存但无法匹配到 product_variant.sku，后续 P5-SY3 需处理。

## P5-SY1 试跑发现

### 数据概况

| 仓库 | 国家 | 行数 | 可用库存总量 |
|------|------|------|-------------|
| 菲律宾-新创启辰自建仓 | PH | 79 | 806,626 |
| 越南青林湾仓库 | VN | 62 | 348,010 |
| DEE-龙仔厝（ICE专属） | TH | 19 | 565,199 |
| 喜运达MY仓 | MY | 17 | 95,194 |
| 印尼-DEE仓库 | ID | 5 | 74,766 |

### 字段验证

- `cur_stock - locked == available` 全部 182 条成立
- `available_quantity` 已由业务确认作为 `inventory.quantity`
- SKU 提取成功率 100%，产品名称提取 0 缺失
- 182/182 条有日销字段，其中 172 条大于 0
- 现有抓取结果不能证明缺货 SKU 完整：页面读取阶段会过滤 `available=0 && transit=0` 的行

### 选择器状态

| 选择器 | 状态 |
|--------|------|
| `warehouse_option_0/3/4/6/7` (5 仓 autoid) | ✅ 全部有效 |
| `.inp_box` (仓库下拉) | ✅ 有效 |
| `.ant-pagination-next` (翻页) | ✅ 有效 |
| `[autoid="single_sku"]` (单个SKU筛选) | ✅ 有效 |
| `.language_switch_guide_mask` (新增遮罩) | ⚠️ 需在操作前移除（脚本已添加 JS 层关闭逻辑） |

### 首仓推荐

**菲律宾-新创启辰自建仓 (PH)** — 数据量最大（79 条），日销数据完整，包含零库存边界，建议作为首个单仓闭环目标。

## Current Task References

P5-SY11-REWORK（P5-SY11G）已完成。P5-SY11G-RUNTIME 已完成 2 项运行时修复 + 人工验收。

**P5-SY12 特别关注阶段 B 核心文件（IN_PROGRESS）：**

| 文件 | 说明 |
|---|---|
| `supabase/migrations/00013_extend_user_variant_preference_favorited.sql` | 扩展 CHECK 约束支持 `'favorited'`（不新建表） |
| `src/types/database.ts` | `user_variant_preference.preference_type` 扩展为 `'archived' \| 'favorited'` |
| `src/features/preferences/types.ts` | `PreferenceError` / `PreferenceResult<T>` / `FollowedVariantBasic` |
| `src/features/preferences/schema.ts` | `toggleFavoriteSchema`（variantId UUID） |
| `src/features/preferences/repository.ts` | `getFavoritedVariantIds()` / `isFavorited()` / `favorite()` / `unfavorite()` / `toggleFavorite()` / `getFollowedVariantsBasic()` |
| `src/features/preferences/actions.ts` | `toggleFavoriteAction()` — `requireActiveAuth()` + Zod + revalidatePath |
| `src/features/inventory/types.ts` | `InventoryItem` 新增 `isFavorited` 字段 |
| `src/features/inventory/repository.ts` | `getOverseasList()` 同时加载 `favoritedVariantIds` |
| `src/features/inventory/actions.ts` | `getOverseasInventory()` 返回 `favoritedVariantIds` |
| `src/app/dashboard/inventory/overseas/page.tsx` | 传递 `favoritedVariantIds` 到客户端 |
| `src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx` | 每行新增星标按钮（⭐） |
| `src/app/dashboard/page.tsx` | 新增「关注产品动态」区（空状态 / 列表 + 低库存置顶） |

**遗留列声明**：`product_variant.is_archived`、`archived_at`、`archived_by` 保留在 DB 中，业务代码已全部停止读写。Migration 00011 不修改（约束：不修改已执行 Migration）。

**P5-SY11G 最终核心文件（DONE）：**

| 文件 | 说明 |
|---|---|
| `supabase/migrations/00012_user_variant_preference.sql` | 新建 `user_variant_preference` 表 + RLS（4 策略）+ UNIQUE + 索引；移除 `operator_select_variant` 的 `is_archived` 全局过滤 |
| `src/types/database.ts` | 新增 `user_variant_preference` 表的 Row/Insert/Update 类型；`product_variant.is_archived`/`archived_at`/`archived_by` 标记 `@deprecated` |
| `src/features/variants/types.ts` | `VariantFilters.archiveStatus` 语义调整为当前用户偏好过滤 |
| `src/features/variants/schema.ts` | `archiveVariantsSchema`/`restoreVariantsSchema`：移除 `archivedBy`，改为从 session 获取 userId |
| `src/features/variants/repository.ts` | 全部归档操作改用 `user_variant_preference`（`getUserArchivedVariantIds()`/`archive()`/`restore()`/`list()` LEFT JOIN 当前用户偏好）；不再读写 `product_variant.is_archived` |
| `src/features/variants/actions.ts` | `archiveVariants()`/`restoreVariants()` 使用 `requireActiveAuth()`（所有登录用户均可操作），从 session 获取 userId |
| `src/features/inventory/repository.ts` | `getOverseasList()`/`getLowStock()`/`getOverseasStats()` 按当前用户 `user_variant_preference` 过滤（使用 `row.variant_id` 判断）；`getByProductId()` 不过滤 |
| `src/features/sync/schema.ts` | `getSyncRunsSchema.limit`：`max(500).default(200)` → `max(100).default(100)`（与 DB RPC `p_limit > 100` 强制拒绝一致） |
| `src/features/sync/server-actions.ts` | `getOverseasWarehouseSyncStatus()` limit: 500 → 100 |
| `src/features/variants/components/archive-controls.tsx` | 所有已登录用户可见（移除 Admin 专属限制） |
| `src/app/dashboard/variants/_components/variant-page-content.tsx` | 归档/恢复对所有用户开放 |
| `src/app/dashboard/variants/page.tsx` | `requireActiveAuth()`；所有用户可操作归档筛选标签 |
| `src/app/dashboard/variants/unmatched/page.tsx` | 按当前用户偏好排除已归档 Variant |
| `src/features/sync/schema.test.ts` | limit 测试断言更新：默认 100 / 拒绝 > 100 |

**遗留列声明**：`product_variant.is_archived`、`archived_at`、`archived_by` 保留在 DB 中，业务代码已全部停止读写。Migration 00011 不修改（约束：不修改已执行 Migration）。

**P5-SY9 核心文件（已完成）：**
- `src/features/sync/server-actions.ts`：`verifyBigSellerSession()` / `triggerDryRun()` / `confirmRealWrite()` / `triggerBatchDryRun()` / `triggerBatchRealWrite()` / `getOverseasWarehouseSyncStatus()` / `getSyncLogDetail()`
- `src/features/sync/actions.ts`：`createSyncActions()` — `triggerBatchDryRun()` / `confirmRealWrite()`（13 项绑定校验）/ `triggerBatchRealWrite()`
- `src/features/sync/types.ts`：`SessionHealthStatus` / `BatchDryRunResult` / `BatchRealWriteResult` / `DryRunBindingMetadata` / `SyncLogRecord` / `WarehouseSyncStatus`
- `src/features/sync/repository.ts`：`SyncRepository` 接口（含 `getDryRunBindingMetadata()` / `getSyncLog()`）
- `src/features/sync/supabase-repository.ts`：`SupabaseSyncRepository`
- `src/features/sync/sync-service.ts`：heartbeat 续租 + timeout/abort 信号
- `src/features/sync/real-sync-runner.ts`：Python bridge 调用
- `src/app/dashboard/sync/_components/sync-page-content.tsx`：批量 Dry Run 审核总览 / 批量 Real Write / 仓库概览卡片 / 分页 / sync_log 明细
- `tools/bigseller-scraper/sync/health_check.py`：BigSeller 会话健康检查
- `tools/bigseller-scraper/sync/web_bridge.py`：Web sync 桥接（Real Write summary 从 rpc_summary 读取）

**P5-SY10 核心方向：**
- 规则引擎为纯 TypeScript 函数，11 条规则按优先级 R1→R11 评估，输出 PASS/WARN/BLOCK。
- 冷启动（无历史基线）场景：R8/R9/R10（需要基线）自动跳过，R7/R11 使用放宽阈值且仅 WARN。
- 自动 Dry Run 调度通过 Vercel Cron Route Handler + API key 认证实现（参考 P5-SY6 推荐架构）。
- 手动「自动预审」按钮同时提供，调用 `runAutoPreReview()` Server Action。
- PASS 仓库仍需 Admin 勾选 + 输入「确认写入」后才执行 Real Write，不自动写库。
- 保留 P5-SY9 全部安全边界：feature gate、Admin 审核、Dry Run 绑定、sync_run/sync_log 审计链。
- 不新增数据库表（Phase A 从 sync_run + sync_log 推导历史基线）。

## Last Updated

2026-06-25 — P5-SY12 DONE。特别关注阶段 B 最小闭环完成：Migration 00013（扩展 `preference_type` CHECK 支持 `'favorited'`）+ `src/features/preferences/` 模块（types / schema / repository / actions）+ 海外库存列表星标按钮 + Dashboard"关注产品动态"区 + 83 项新测试。阶段 B 告警临时用 `product.safety_stock`。不新增 variant_follows 表、不新增 daily_sales/est_days/lead_time_days、不改 sync RPC / Python。质量门：979/979 TS 测试（34 文件），lint 0 errors / 28 pre-existing warnings，build pass。`product_variant.is_archived` 为遗留列，业务代码不再读写。等待用户确认下一任务，不自动进入 P5-SY12 阶段 C/D。
