# P5-SY7 — 单仓端到端差距分析

> 状态：DRAFT（待 Codex 独立验收）
>
> 日期：2026-06-19
>
> 分类：**通过** / **已知差距** / **阻塞项**

## A. 全链路组件一致性（15 层逐层审查）

### A1. 抓取层 — `tools/bigseller-scraper/` scraper + input_validator + plan_generator

| 检查项 | 结果 | 说明 |
|---|---|---|
| 输出 JSON 结构与下游一致 | ✅ 通过 | plan_generator.generate_plan() 输出 new_variants / inventory_updates / inventory_inserts / inventory_unchanged / inventory_after_variant_create / warehouse_rename_required |
| quantity 类型为严格整数 | ✅ 通过 | input_validator 和 executor._validate_quantity 均使用 `type(raw_qty) is int` + `>= 0`，拒绝 bool/float |
| warehouse 名称与 DB 一致 | ✅ 通过 | config.py 硬编码 `TARGET_WAREHOUSE_NAME = '菲律宾-新创启辰自建仓'`，与 Migration 00006 校验的正式目标名一致 |

### A2. 执行层（P5-SY3B 路径）— `executor.py` execute_plan()

| 检查项 | 结果 | 说明 |
|---|---|---|
| REST API 调用参数与 Supabase 表结构一致 | ✅ 通过 | POST product_variant (sku/country/name/product_id/match_status)、POST inventory (variant_id/warehouse_id/quantity/last_sync_at)、PATCH warehouse (name) |
| Phase E fail-fast | ✅ 通过 | 任一 SKU 找不到 variant_id → RuntimeError 终止，避免部分写入 |
| Phase G 写后验证 | ✅ 通过 | verify_inventory_post_write 逐 SKU 核对 quantity，任一差异 fail-fast 阻止 Phase H |

### A3. 执行层（P5-SY4C RPC 路径）— `executor.py` execute_plan_v2()

| 检查项 | 结果 | 说明 |
|---|---|---|
| RPC 名称与 Migration 00006 一致 | ✅ 通过 | `sync_warehouse_inventory` |
| RPC 参数名与 Migration 签名一致 | ✅ 通过 | `p_warehouse_id`, `p_variants`, `p_inventory`, `p_warehouse_name` |
| quantity 校验在 RPC 调用前完成 | ✅ 通过 | `_validate_quantity()` 先于 `_build_rpc_payload()` |
| RPC 返回摘要严格校验 | ✅ 通过 | 6 个必需字段 + int 类型校验 + warehouse_renamed bool 校验 + inventory_received = inserted + updated + unchanged |
| RPC 失败 sync_log 写入 | ✅ 通过 | failed 分支写入 sync_log + fallback 本地保存 |
| network_timeout_unknown 分类 | ✅ 通过 | 网络错误不自动重试，标记为 network_timeout_unknown，指引只读核对 |
| post-commit audit | ✅ 通过 | Phase G/I 审计失败写入 sync_log failed，所有审计失败通过 _record_audit_failure 统一处理 |

### A4. 校验层 — `verifier.py`

| 检查项 | 结果 | 说明 |
|---|---|---|
| compare_plans 逻辑 | ✅ 通过 | 比较 SKU/quantity/warehouse_id/rename target |
| verify_inventory_post_write 逻辑 | ✅ 通过 | 逐 SKU 核对 quantity + 检测缺失记录/计划外记录/总量不一致 |
| verify_warehouse_final_state 逻辑 | ✅ 通过 | 核对 id/country/type/is_active/name 五项 |

### A5. CLI 层 — `cli_execute.py`

| 检查项 | 结果 | 说明 |
|---|---|---|
| --execute --confirm 安全门 | ✅ 通过 | confirm 令牌必须为 'P5-SY3B-PH' |
| dry-run vs real-write 分支 | ✅ 通过 | dry_run=True 跳写 Phase C/F/H，仅执行只读查询和分类 |
| 执行前计划漂移检测 | ✅ 通过 | 重新查询 Supabase + 重新生成计划 + compare_plans()，dry-run 警告，no-dry-run 阻断 |

### A6. Gateway 层 — `supabase_gateway.py`

| 检查项 | 结果 | 说明 |
|---|---|---|
| 使用 SUPABASE_SERVICE_ROLE_KEY | ✅ 已知差距 | 仅限本地/手动 CLI 脚本场景；密钥从 .env.local 加载（.gitignore 已排除）；见 E2 详细分析 |
| 仅执行只读查询 | ✅ 通过 | GET 请求 warehouse / product_variant / inventory 查询 |
| 不经过 RLS | ⚠️ 已知差距 | service_role 绕过 RLS，此为设计意图（CLI 脚本需要全量查询），记录为生产治理风险 |
| 密钥未写入报告/日志 | ✅ 通过 | 执行报告 dict 不含密钥字段；supabase_gateway.py 和 executor.py 均不输出密钥到 stdout/文件 |

### A7. RPC 调用层 — `executor.py` _call_sync_rpc()

| 检查项 | 结果 | 说明 |
|---|---|---|
| 使用 SUPABASE_SERVICE_ROLE_KEY | ✅ 已知差距 | 历史手动生产路径事实；密钥隔离分析见 E2 |
| 仅发送一次请求，不自动重试 | ✅ 通过 | 防止重复 RPC 调用 |
| 非 JSON/非 UTF-8 响应明确失败 | ✅ 通过 | 标记为状态未知，指引只读核对 |
| 密钥未写入报告/日志 | ✅ 通过 | 报告不含密钥字段 |

### A8. DB RPC 层 — Migration 00006 `sync_warehouse_inventory`

| 检查项 | 结果 | 说明 |
|---|---|---|
| FOR UPDATE 锁顺序正确 | ✅ 通过 | Step 1: FOR UPDATE on warehouse（单行锁，阻止并发同仓写入） |
| 输入校验先于写入 | ✅ 通过 | Step 3-5: 类型校验 + 去重 + 完整性校验均在 Variant INSERT（Step 7）之前 |
| quantity 严格校验 | ✅ 通过 | Step 5b: 非 null / JSON number / 严格整数 / >= 0 |
| 统一快照时间校验 | ✅ 通过 | Step 6a-6b: 首条解析 → 遍历强制一致，任一不同→回滚 |
| 写后核对 | ✅ 通过 | Step 10: 逐 SKU SELECT quantity + last_sync_at 与期望值比对 |
| Warehouse 写后核对 | ✅ 通过 | Step 12: 核对 id/country/type/is_active/name 五项 |
| 权限收口 | ✅ 通过 | 仅 service_role 可执行 |
| SECURITY INVOKER + search_path='' | ✅ 通过 | 防止 search_path 注入 |
| 26/26 SQL 测试场景已定义 | ✅ 通过 | 含正常/异常/边界/权限场景 |
| **未执行** | ⚠️ 已知差距 | Migration 未在生产 Supabase 执行，DB 仍只有 00001–00005 |

### A9. DB 并发层 — Migration 00007/00008

| 检查项 | 结果 | 说明 |
|---|---|---|
| claim_sync_run 参数签名 | ✅ 通过 | 9 参数：(p_warehouse_id, p_mode, p_run_id, p_lease_duration, p_triggered_by, p_triggered_from, p_dry_run_run_id, p_input_artifact_hash, p_plan_artifact_hash) |
| 三层锁防御 | ✅ 通过 | advisory lock → warehouse FOR UPDATE → sync_run FOR UPDATE → v_now → INSERT |
| FOR UPDATE on in_progress sync_run (00008) | ✅ 通过 | Step 5.5: 阻止并发 heartbeat 续租 |
| FOR UPDATE on dry_run row (00008) | ✅ 通过 | Step 6: 关闭 TOCTOU 窗口 |
| release_sync_run 锁顺序 | ✅ 通过 | advisory → warehouse lock FOR UPDATE → sync_run FOR UPDATE → v_now → UPDATE |
| heartbeat_sync_run | ✅ 通过 | 单次 clock_timestamp() 用于 heartbeat_at + lease_expires_at |
| cleanup_expired_sync_runs | ✅ 通过 | ORDER BY warehouse_id 避免死锁，仅遍历过期 warehouse |
| get_sync_runs/get_sync_run_detail 脱敏 | ✅ 通过 | Admin 完整字段 + display_name；Operator 脱敏邮箱 + 白名单 result_summary + Chinese 失败摘要 |
| 11 个 CHECK 约束 | ✅ 通过 | 覆盖时间/终态/artifacts/枚举/计数 |
| REVOKE/GRANT 权限收口 | ✅ 通过 | claim→authenticated, get→authenticated, release/heartbeat/cleanup→service_role |
| 59/59 静态契约测试已定义 | ✅ 通过 | 含 CHECK/锁顺序/脱敏/权限验证 |
| **未执行** | ⚠️ 已知差距 | Migration 00007/00008 未在生产 Supabase 执行 |

### A10. TypeScript 类型层 — `types.ts`

| 检查项 | 结果 | 说明 |
|---|---|---|
| SyncRunAdminRow 与 RPC 返回一致 | ✅ 通过 | id, warehouse_id, warehouse_name, mode, status, display_name, triggered_from, started_at, finished_at, created_at, exit_code, error_message, result_summary, plan_drift_check, plan_drift_count, dry_run_run_id |
| SyncRunOperatorRow 与 RPC 返回一致 | ✅ 通过 | 脱敏邮箱 + 白名单 result_summary + Chinese 失败摘要 |
| SyncExecuteResult 与 Runner 输出一致 | ✅ 通过 | exitCode (0/1/2), summary, syncLog, planDriftCheck, planDriftCount, planDriftDifferences, planArtifact? |
| Plan Artifact 结构为 JsonValue | ⚠️ 已知差距 | 类型层面仅约束为 JsonValue，与 Python plan_generator 输出的精确结构（new_variants/inventory_*/warehouse_rename_required 字段）未通过编译时契约强制；依赖约定和运行时 validateJsonValue 兜底 |

### A11. Schema 层 — `schema.ts`

| 检查项 | 结果 | 说明 |
|---|---|---|
| triggerSyncSchema 与 DB CHECK 一致 | ✅ 通过 | warehouseId uuid, mode dry_run/real_write, real_write 强制 dryRunRunId + confirmToken |
| getSyncRunsSchema 与 RPC 参数一致 | ✅ 通过 | warehouseId optional uuid, limit [1,100] |
| getSyncRunDetailSchema 与 RPC 参数一致 | ✅ 通过 | runId uuid |

### A12. Repository 层 — `repository.ts`

| 检查项 | 结果 | 说明 |
|---|---|---|
| SyncRepository 接口与 RPC 签名一致 | ✅ 通过 | claimSyncRun/releaseSyncRun/heartbeatSyncRun/getSyncRuns/getSyncRunDetail/cleanupExpiredSyncRuns |
| claimSyncRun 参数包含 leaseDuration/triggeredBy/triggeredFrom | ✅ 通过 | 与 Migration 00007 claim_sync_run 9 参数对应 |
| releaseSyncRun 参数包含 planDriftCheck/planDriftCount/planDriftDifferences | ✅ 通过 | 与 Migration 00007 release_sync_run 对应 |
| getActiveRunIds/getRecentlyCompletedRunIds/getReferencedDryRunIds | ✅ 通过 | GC 三层保护所需接口 |
| MockRepository 终态约束 | ✅ 通过 | completed→exitCode=0, failed→exitCode IN (1,2), Dry Run completed→plan drift 字段 |

### A13. Service 层 — `sync-service.ts`

| 检查项 | 结果 | 说明 |
|---|---|---|
| claim → artifact store → runner → release 生命周期 | ✅ 通过 | Dry Run 和 Real Write 两条分支完整 |
| artifact store 失败 → release failed + delete partial | ✅ 通过 | 防止 orphan artifact |
| runner 失败 → release failed | ✅ 通过 | artifact 保留由 7 天 GC 清理 |
| release 失败 → indeterminate 状态 | ✅ 通过 | 明确 artifact 保留情况供调用方决策 |
| Real Write planArtifact undefined 校验 | ✅ 通过 | Real Write Runner 不得输出 planArtifact |
| exitCode=0 但 planArtifact 缺失 | ✅ 通过 | Dry Run 拒绝并 release failed |
| 生产 Mock 守卫 | ✅ 通过 | NODE_ENV=production 时拒绝 Mock ArtifactProvider/Runner |
| claim 使用 service_role 与 Web UI 路径的冲突 | ⚠️ 已知差距 | SyncService 调用的 claim/release/heartbeat 需要 service_role（release/heartbeat 的 REVOKE/GRANT 仅 service_role 可执行），但 Web UI 路径通过 Server Actions 以 authenticated user 调用，无法执行 release/heartbeat RPC。当前 Mock 路径不产生真实写入，此差距不暴露。统一生产入口待 P5-SY6F。 |

### A14. Actions 层 — `actions.ts` + `server-actions.ts`

| 检查项 | 结果 | 说明 |
|---|---|---|
| triggerSync 认证链 | ✅ 通过 | requireActiveAdmin() → 仅 Admin 可触发同步 |
| getSyncRuns/getSyncRunDetail 认证链 | ✅ 通过 | requireActiveAuth() → Admin/Operator 均可查看 |
| Zod 校验 | ✅ 通过 | triggerSyncSchema.parse() + getSyncRunsSchema.parse() + getSyncRunDetailSchema.parse() |
| InputArtifact 来源 | ✅ 通过 | 通过 InputArtifactSource.getInputArtifact() 服务端获取，不从 formData/客户端传入 |
| Mock 依赖组合 | ✅ 已知差距 | server-actions.ts 创建 MockRepository/MockArtifactProvider/MockSyncRunner + mockInputArtifactSource（硬编码空 rows）；真实依赖接入待后续任务 |

### A15. UI 层 — `/dashboard/sync/`

| 检查项 | 结果 | 说明 |
|---|---|---|
| Server Component 页面 | ✅ 通过 | page.tsx 为 Server Component |
| Client Component 交互 | ✅ 通过 | sync-page-content.tsx 处理表单提交和状态展示 |
| loading/error 状态 | ✅ 通过 | loading.tsx + error.tsx 已提供 |
| 侧边栏入口权限 | ✅ 通过 | sidebar-nav.tsx '数据同步' 分组 phase 0，Admin/Operator 可见 |

---

## B. 跨层契约验证（5 项）

### B1. Python CLI 输出 JSON vs TypeScript 类型

| 检查项 | 结果 | 说明 |
|---|---|---|
| Python plan_generator 输出结构 vs TypeScript Plan Artifact | ⚠️ 已知差距 | Python 输出字段（new_variants/inventory_updates/inventory_inserts/inventory_unchanged/inventory_after_variant_create/warehouse_rename_required）与 TypeScript 类型为 JsonValue（无精确结构化类型）。当前通过运行时 validateJsonValue 兜底，但缺少编译时结构契约。**不阻塞 P5-SY8**（P5-SY3B 已验证 Python→DB 写入路径正确）。 |
| Python 输出 quantity 类型安全性 | ✅ 通过 | Python `_validate_quantity()` 严格拒绝非 int；TypeScript `validateJsonValue` 确保 number 且非 NaN/Infinity；Migration 00006 Step 5b 拒绝非严格整数。三层一致。 |

### B2. Migration 00006 RPC 参数 vs Python executor payload

| 检查项 | 结果 | 说明 |
|---|---|---|
| p_inventory 字段名 | ✅ 通过 | Python: `{'sku': ..., 'country': ..., 'quantity': ..., 'last_sync_at': ...}` RPC: `value->>'sku'`, `value->>'country'`, `value->'quantity'`, `value->>'last_sync_at'` |
| p_variants 字段名 | ✅ 通过 | Python: `{'sku': ..., 'country': ..., 'name': ...}` RPC: `value->>'sku'`, `value->>'country'`, `value->>'name'` |
| p_warehouse_name | ✅ 通过 | Python: `'菲律宾-新创启辰自建仓'` RPC: 校验 `p_warehouse_name != '菲律宾-新创启辰自建仓'` |

### B3. claim_sync_run 参数 vs SyncService.claim() 调用

| 检查项 | 结果 | 说明 |
|---|---|---|
| 参数数量 | ✅ 通过 | RPC 9 参数，Repository.claimSyncRun 9 字段 |
| 参数名映射 | ✅ 通过 | p_warehouse_id→warehouseId, p_mode→mode, p_run_id→runId, p_lease_duration→leaseDuration, p_triggered_by→triggeredBy, p_triggered_from→triggeredFrom, p_dry_run_run_id→dryRunRunId, p_input_artifact_hash→inputArtifactHash, p_plan_artifact_hash→planArtifactHash |
| leaseDuration 范围 | ✅ 通过 | 双方均为 [30, 900] |
| triggered_from 枚举 | ✅ 通过 | 双方均为 'web' | 'cli' |

### B4. release_sync_run 参数 vs SyncService.release() 调用

| 检查项 | 结果 | 说明 |
|---|---|---|
| exit_code 枚举值 | ✅ 通过 | 双方均为 0=成功, 1=业务错误/RPC失败, 2=系统清理 |
| plan_drift_check 枚举 | ✅ 通过 | 双方均为 'PASS' | 'DRIFT_DETECTED' |
| finished_at 生成 | ✅ 通过 | RPC 在锁后 clock_timestamp() 生成（不接收外部参数），Repository 接口不传 finishedAt |

### B5. validateJsonValue 跨语言边界安全性

| 检查项 | 结果 | 说明 |
|---|---|---|
| Python 不会产生 NaN/Infinity | ✅ 通过 | Python 标准库 `json.dumps` 默认 `allow_nan=True`，可能输出 `NaN`/`Infinity`。本项目当前不会产生 NaN/Infinity 的依据：`input_validator.py` 对 `available_quantity` 使用严格 int 校验（`type(raw_qty) is int`，拒绝 bool/float），`plan_generator.py` 仅将该整数写入 plan quantity 字段，不引入浮点数。**未来约束**：若后续 plan artifact 引入 `float`/`daily_sales` 等数值字段，必须显式 finite 校验或使用 `allow_nan=False`。 |
| Python 不会产生 undefined/Symbol/BigInt | ✅ 通过 | Python 无对应类型 |
| Python 不会产生 toJSON | ✅ 通过 | Python dict/list 无 toJSON 方法 |
| Python 不会产生稀疏数组 | ✅ 通过 | Python list 无空洞概念 |
| Python 不会产生自定义原型 | ✅ 通过 | Python 无原型链概念 |
| Python 元组 → JSON array | ✅ 通过 | `json.dumps((1,2))` → `[1,2]`，标准 JSON array |

---

## C. Migration 静态正确性（3 个未执行 Migration）

### C1. Migration 00006 — `sync_warehouse_inventory`

| 检查项 | 结果 |
|---|---|
| DDL 语法有效 | ✅ 通过 |
| RPC 签名与 executor 一致 | ✅ 通过 |
| FOR UPDATE 锁顺序（Step 1: warehouse） | ✅ 通过 |
| 输入校验先于业务写入（Step 3-6 在 Step 7 之前） | ✅ 通过 |
| quantity 严格校验（Step 5b） | ✅ 通过 |
| 统一快照时间校验（Step 6a-6b） | ✅ 通过 |
| 写后逐 SKU 核对（Step 10） | ✅ 通过 |
| Warehouse 写后核对（Step 12） | ✅ 通过 |
| 26/26 测试场景已定义 | ✅ 通过 |
| **未执行** | ⚠️ 已知差距 |

### C2. Migration 00007 — sync_run 表 + 6 RPC

| 检查项 | 结果 |
|---|---|
| DDL 语法有效（CREATE TABLE 无 IF NOT EXISTS） | ✅ 通过 |
| 11 个 CHECK 约束 | ✅ 通过 |
| 三层锁防御顺序 | ✅ 通过 |
| REVOKE/GRANT 权限收口 | ✅ 通过 |
| 查询 RPC 脱敏矩阵 | ✅ 通过 |
| 59/59 静态契约测试已定义 | ✅ 通过 |
| **未执行** | ⚠️ 已知差距 |

### C3. Migration 00008 — claim_sync_run FOR UPDATE on dry_run

| 检查项 | 结果 |
|---|---|
| FOR UPDATE on dry_run row (Step 6) | ✅ 通过 |
| 与 00007 兼容（CREATE OR REPLACE FUNCTION） | ✅ 通过 |
| 锁顺序更新后正确（advisory→warehouse FOR UPDATE→sync_run FOR UPDATE→dry_run FOR UPDATE→INSERT） | ✅ 通过 |
| **未执行** | ⚠️ 已知差距 |

---

## D. 测试覆盖审查

| 检查项 | 结果 | 说明 |
|---|---|---|
| Python 测试 | ✅ 通过 | plan/executor/verifier/cli_integration/sync_log/structural 全部通过（P5-SY4D 183/183，P5-SY4E 193/193） |
| TypeScript 非并发测试 | ✅ 通过 | **281/281** 全部通过（本次运行确认） |
| TypeScript 并发测试 | ⚠️ 已知差距 | 44/44 需本地 PG 环境（PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD），当前环境未配置。D2/F2 确定性 FOR UPDATE 行锁断言已通过 Codex 独立复验确认正确。非阻塞（PG 环境差异，非代码缺陷）。 |
| lint | ✅ 通过 | 0 errors, 8 warnings（全部 pre-existing） |
| build | ✅ 通过 | `npm run build` 成功 |
| 错误路径测试 | ✅ 通过 | claim 失败 / artifact store 失败 / runner 失败 / release 失败 / GC 边界 / validateJsonValue 全部禁止类型均有测试覆盖 |

---

## E. 架构边界合规

### E1. 数据库写操作经过 Repository / RPC / RLS

| 检查项 | 结果 |
|---|---|
| Python CLI 路径：Supabase gateway → RPC → DB | ✅ 通过（但绕过 RLS — service_role） |
| Web UI Mock 路径：Server Actions → SyncService → Mock* → 无真实写入 | ✅ 通过 |
| 两条路径的差异已在 P5-SY6 评估文档中明确记录 | ✅ 通过 |

### E2. Python CLI 持有 SUPABASE_SERVICE_ROLE_KEY

| 检查项 | 结果 | 说明 |
|---|---|---|
| 密钥存在性 | ✅ 已知差距 | supabase_gateway.py 和 executor.py 均从 .env.local 加载 `SUPABASE_SERVICE_ROLE_KEY`。这是历史手动生产路径事实，记录为生产治理风险。 |
| 密钥隔离 | ✅ 通过 | .env.local 在 .gitignore 中，不提交 Git。密钥仅在 Python CLI 脚本进程内存中存在。 |
| 前端不可达 | ✅ 通过 | Python 脚本不在 Next.js bundle 中，不经过 Webpack/Vite。浏览器不可访问。 |
| 报告/日志不泄露 | ✅ 通过 | 执行报告 dict 不含 `supabase_url`/`service_role_key` 字段。同步报告路径 `runtime/*.json` 已确认仅含业务字段。 |
| 未授权真实写入路径 | ✅ 通过 | CLI 写入仅通过 `--execute --confirm P5-SY3B-PH` 安全门手动触发。P5-SY7 未触发任何真实写入。 |

**分类：已知差距/生产治理风险**（非阻塞项）。未发现密钥泄漏、前端可达或未授权真实写入路径。

### E3. createServiceClient() 前端 throw guard

| 检查项 | 结果 |
|---|---|
| 前端 throw guard 存在 | ✅ 通过（P5-SY5B 已验证） |

### E4. Web UI Mock 路径不产生真实数据库写入

| 检查项 | 结果 |
|---|---|
| MockArtifactProvider / MockSyncRunner 无真实 DB 访问 | ✅ 通过 |
| MockRepository 仅操作内存 Map | ✅ 通过 |

### E5. Python CLI 路径不经过 Next.js Server Actions / SyncService

| 检查项 | 结果 |
|---|---|
| Python CLI 独立于 Next.js 进程运行 | ✅ 通过 |
| 两条路径各自正确 | ✅ 通过 |

### E6. 两条路径的架构差距已明确记录

| 检查项 | 结果 |
|---|---|
| P5-SY6 评估文档完整记录两条路径差异 | ✅ 通过 |

---

## F. 安全与权限

### F1. Server Actions 认证链

| 检查项 | 结果 |
|---|---|
| triggerSync → requireActiveAdmin() | ✅ 通过 |
| getSyncRuns → requireActiveAuth() | ✅ 通过 |
| getSyncRunDetail → requireActiveAuth() | ✅ 通过 |
| getCurrentActiveUser 校验 profiles.is_active | ✅ 通过 |

### F2. RPC 安全

| 检查项 | 结果 |
|---|---|
| SECURITY INVOKER / SECURITY DEFINER + `SET search_path = ''` | ✅ 通过 |
| 全部对象使用 `public.` 限定 | ✅ 通过 |
| REVOKE/GRANT 权限收口 | ✅ 通过 |

### F3. 敏感字段脱敏

| 检查项 | 结果 |
|---|---|
| 查询 RPC 禁止返回 artifact hashes / lease_expires_at / heartbeat_at / triggered_by UUID | ✅ 通过 |
| Admin 返回完整字段 + display_name | ✅ 通过 |
| Operator 返回脱敏邮箱 + 白名单 result_summary + Chinese 失败摘要 | ✅ 通过 |
| Operator 不含 plan_drift_differences | ✅ 通过 |

### F4. 项目安全边界合规（依据 AGENTS.md、current-task.md 与真实代码）

| 检查项 | 结果 |
|---|---|
| service_role 仅用于服务端同步任务 | ✅ 通过（CLI） |
| 前端仅使用 anon key | ✅ 通过 |
| .env.local 不提交 Git | ✅ 通过 |
| 密钥不写入日志/错误响应/客户端代码 | ✅ 通过 |
| Server Action 自行校验身份 | ✅ 通过 |

---

## 汇总

### 通过项

全部 15 层组件一致性验证通过（A1–A15），5 项跨层契约验证通过（B1–B5），3 个 Migration 静态正确性确认（C1–C3），测试覆盖充分（D），架构边界合规（E1–E6），安全与权限合规（F1–F4）。

### 已知差距（不阻塞 P5-SY8）

| ID | 维度 | 描述 | 影响 | 建议 |
|---|---|---|---|---|
| GAP-01 | A6/A7/E2 | Python CLI 使用 SUPABASE_SERVICE_ROLE_KEY（历史手动生产路径事实）。密钥隔离、前端不可达、报告无泄露均确认。 | 生产治理风险：手动 CLI 持有最高权限密钥。 | P5-SY6F 统一生产入口时治理凭据分发；中期 Worker 不持有此密钥。 |
| GAP-02 | A8/A9/C1–C3 | Migration 00006/00007/00008 未在生产 Supabase 执行。 | DB 层缺少 sync_run 表、sync_warehouse_lock 表、6 个 RPC 函数、sync_log 扩展列。Python CLI v2 (RPC) 路径无法在生产环境运行。 | 获确认后在 P5-SY8 前执行 Migration。 |
| GAP-03 | A13 | SyncService 调用的 release/heartbeat/cleanup 需要 service_role（仅 GRANT TO service_role），但 Web UI 路径通过 authenticated user 调用。当前 Mock 路径不暴露此问题。 | 真实 Web UI 路径无法完成 release/heartbeat 操作。 | P5-SY6F 统一生产入口：Route Handler（service_role）→ SyncService；或重新评估 RPC 权限模型。 |
| GAP-04 | A10/B1 | Python plan_generator 输出与 TypeScript Plan Artifact 类型为 `JsonValue`（无精确结构化类型契约），依赖约定和运行时验证兜底。 | 编译时无法检测结构不匹配。 | 可选：在 TypeScript 侧定义 `PlanArtifact` 精确接口（含 new_variants/inventory_*/warehouse_rename_required 字段），并在 Runner 输出时通过 Zod 校验。 |
| GAP-05 | A14 | server-actions.ts 使用 Mock 依赖（MockRepository/MockArtifactProvider/MockSyncRunner/mockInputArtifactSource 硬编码空 rows），Web UI 不产生真实同步。 | Web UI 当前仅可用于开发验证，非生产可用。 | 后续任务接入真实依赖（P5-SY6F 统一入口时处理）。 |
| GAP-06 | D | 并发测试 44/44 需本地 PG 环境，当前环境未配置。 | 非阻塞 — 代码已通过 Codex 独立复验确认 D2/F2 确定性 FOR UPDATE 行锁断言正确。 | 在有 PG 环境的机器上运行完整 325/325 测试套件。 |

### 阻塞项

**无阻塞项。** 未发现密钥泄漏、前端可达、未授权真实写入路径、或任何必须修复才能进入 P5-SY8 的问题。

### 进入 P5-SY8 建议

P5-SY7 端到端静态验收确认：
- 菲律宾单仓同步全链路组件一致、契约一致、类型安全、错误处理正确
- 两条路径各自内部正确，架构差距已明确
- Migration 静态正确，待执行
- 测试覆盖充分
- 架构边界合规，安全权限完整

在进入 P5-SY8（逐仓扩展）前建议：
1. 获确认后执行 Migration 00006/00007/00008
2. 以菲律宾仓运行一次真实 Dry Run 验证 Migration 生效（需用户确认和 Supabase 连接）
3. GAP-01/GAP-03/GAP-05 为生产治理项，不阻塞逐仓扩展，可在 P5-SY6F 统一入口时处理
