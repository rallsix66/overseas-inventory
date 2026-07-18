# OPT-4 Production 验证报告

## 结论

2026-07-18，用户明确批准 OPT-4 Production 维护窗口。Production 已严格按“备份复核 → 00048 → 函数验证 → 00001–00040 history repair → 全量复核”的顺序完成写入，Schema 与函数验证通过。指定独立审查随后给出 `CHANGES_REQUIRED`：两环境远端 history 的 timestamp `version` 与仓库固定宽度 `00001–00048` 前缀 48/48 不匹配，当前不能安全使用 `supabase db push`。用户随后已批准 Staging history-only 返工窗口，但在执行前要求先合并上线并迁移执行环境；当前状态为 `CHANGES REQUIRED / STAGING REALIGNMENT APPROVED / EXECUTION DEFERRED FOR ENVIRONMENT HANDOFF`，00048 无需撤销，本次发布不代表 Staging version 已对齐。

## 恢复点与写入前门禁

- Production project ref：`hzlhqyditalumhnxbaim`（`DIS Project`），状态 `ACTIVE_HEALTHY`，PostgreSQL 17.6。
- 恢复点：`C:\Users\Administrator\Documents\DIS-backups\production\2026-07-18_14-09-53`。
- `roles.sql`、`schema.sql`、`data.sql`、`database.dump` 的 SHA-256 均重新计算并与 `SHA256SUMS.txt` 匹配；`BACKUP_SUCCESS` 存在。
- 写入前 migration history 只有 00041–00047；目标函数不存在；00011 的旧三列、外键和索引均不存在；运行中同步任务为 0。

## 00048 Production 应用

- Migration：`00048_restore_claim_sync_run_system`。
- Production version：`20260718074910`。
- 写入正文：5596 chars，MD5 `0a4a0cb7b1bcae70346efda90333e2f9`，与 Staging `schema_migrations.statements[1]` 一致；仓库文件 SHA-256 为 `0a833a0f407d4d9cc5be6a702662318c6afa6f382fa1689046d945d2dfefd87a`。
- 函数签名：`claim_sync_run_system(uuid,text,uuid,integer,uuid,text,text)`。
- owner 为 `postgres`；`SECURITY DEFINER = true`；`search_path = ''`；ACL 仅为 `postgres=X/postgres`、`service_role=X/postgres`。
- 00011 遗留对象复核：3 个旧列、外键、索引均为 0。

## 事务行为验证

在显式事务中使用真实活跃 Admin 与可用 overseas warehouse 执行：

1. `service_role` 合法 `dry_run` claim 成功并返回指定 run id；
2. `real_write` 被 `P0001` 拒绝；
3. 无效操作者被 `P0001` 拒绝；
4. owner 视角确认事务内恰好插入一条 `sync_run` 并获得对应 warehouse lock；
5. 显式 `ROLLBACK` 后按 run id、input artifact hash、locked_by 查询均为 0。

验证没有创建持久业务数据。

## 00001–00040 历史修复

旧 Migration 没有重放。Windows 环境中的 Supabase CLI 2.109.1 `migration repair` 临时本地格式验证在建立数据库连接前反复等待并达到停止阈值，因此没有用不确定的 CLI 行为直接写 Production。

最终使用一个受控事务只修复 `supabase_migrations.schema_migrations`：

- 来源是 Staging 已登记的 00001–00040 version、name 与 `statements[1]`，分批只读提取；
- 事务前置断言 Production history 严格只有 00041–00048，且 00048 函数已存在；
- 事务只执行 40 条历史行插入，不执行 statements 中的旧 SQL；
- 提交前逐条校验 name、version、statement count、MD5 与 length；
- 提交结果：48 stages、48 unique names、00001–00040 repaired = 40。

## 独立终审发现的 CLI version 阻塞

- 仓库 48 个 Migration 文件的 version 是 `00001–00048`。
- Production 48/48、Staging 48/48 的远端 `schema_migrations.version` 均为 timestamp，全部不等于对应文件前缀。
- 典型映射：00001 为本地 `00001` / 两环境 `20260716021528`；00041 为本地 `00041` / Staging `20260716024654` / Production `20260716013023`；00048 为本地 `00048` / Staging `20260718062455` / Production `20260718074910`。
- Supabase CLI 2.109.1 从文件名数字前缀读取 local version，并以 remote/local version 精确比较；migration name 与正文摘要不能替代 version。返工已在 `package.json` / `package-lock.json` 中把 CLI 精确固定为 `2.109.1`，后续所有 CLI 证据必须使用该仓库版本。
- 因此“48 stages / 48 unique names”只证明显示名称齐全，不证明 `db push` 可用。当前禁止 `db push` 和 `--include-all`，避免 CLI 把旧 Migration 判为待执行。
- 修复必须是 history-only：保持 Production Schema、00048、name 与 statements 不变；先把 Staging version 对齐为 `00001–00048` 并独立复验，再单独批准 Production 对齐。
- Staging 专用维护脚本位于 `docs/reports/sql/2026-07-18-opt4-staging-history-version-realignment.sql`。它只执行受控 `UPDATE schema_migrations SET version = ...`，并在同一事务内断言 48 条 timestamp 基线、00001–00048 完整目标集、48 行更新和所有非 version payload 不变。本机 PostgreSQL 17.10 一次性测试库已验证首次执行成功、第二次执行被前置门禁拒绝；远端尚未执行。

## Production / Staging 最终复核

- canonical catalog 以 column、constraint、index、trigger、function、table_rls、policy 七类对象，在 full 与 known-drift-excluded 两个范围生成 14 组 count/digest；Production 与 Staging 差异为 0。
- 迁移名称均为 00001–00048，共 48 个唯一阶段。
- 00001–00040 与 00048 的历史正文 MD5/长度完全一致。
- 00041–00047 的 Production 原记录比 Staging 各多 2 个尾部空白字符；`rtrim(..., E'\r\n')` 后长度与 MD5 逐条一致。该差异为维护窗口前已存在的 history 文本格式差异，不是 Schema 漂移，也未在本次改写。
- Production Security Advisor：22 条（1 INFO / 21 WARN）；Performance Advisor：158 条（37 INFO / 121 WARN）。没有任何 lint 提及 `claim_sync_run_system`；现有项目分别属于 OPT-5 最小权限与 OPT-6 渐进性能治理。

## 回滚边界

`docs/reports/sql/2026-07-18-opt4-production-rollback.sql` 仍是不可执行的注释模板。00048 与 history 已登记后，禁止直接删除函数或回删历史行。若最终审查发现必须撤销 Schema，必须创建新的 00049+ 前向 Migration，先在 Staging 验证并单独取得 Production 批准。

## 返工与最终审查门禁

- Staging history-only version 对齐窗口已获用户批准，但按用户新指令推迟到当前进度合并上线及执行环境迁移后；执行后必须取得 `migration list` 48 条逐项一致、`db push --dry-run` 为 up to date、name/statements 摘要不变、canonical catalog 不变。
- Staging 独立复验 PASS 后，才可单独请求 Production history-only 窗口并执行同样对齐。
- 两环境完成后更新 Draft PR #6 正文并重新跑最终 head checks，再交指定会话终审。
- 最终 PASS 前保持 `CHANGES REQUIRED`；交接时子状态为 `STAGING REALIGNMENT APPROVED / EXECUTION DEFERRED FOR ENVIRONMENT HANDOFF`，禁止标记 OPT-4 DONE 或进入 OPT-5。
