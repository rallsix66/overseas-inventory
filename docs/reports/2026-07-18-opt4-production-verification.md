# OPT-4 Production 验证报告

## 结论

2026-07-18，Production 已严格按“备份复核 → 00048 → 函数验证 → 00001–00040 history repair → 全量复核”的顺序完成写入，Schema 与函数验证通过。指定独立审查随后发现两环境远端 timestamp `version` 与仓库固定宽度 `00001–00048` 前缀不匹配。Staging 已于 2026-07-20 完成 history-only 对齐并通过独立复验；同日 Production 也在完整 preflight 后完成 48/48 history-only 对齐。两环境真实远端 version 现均为 `00001–00048`，非 version payload 与 14 组 canonical catalog 摘要均不变。当前状态为 `PRODUCTION EXECUTED / FULL POSTCHECK PASS / OPT-4 FINAL REVIEW PENDING`；OPT-4 尚未 DONE，禁止进入 OPT-5。

## 2026-07-20 Production History Version 对齐

- 用户已把 OPT-4 剩余 Production history-only 对齐及后续既定路线改为持续授权，但仍要求每阶段完整验证并取得指定审查会话明确 PASS 后才能进入下一阶段。
- 即时 preflight：项目 `hzlhqyditalumhnxbaim` 为 `ACTIVE_HEALTHY`，PostgreSQL 17.6；48 rows / 48 unique versions / 48 unique names；48 timestamp / 0 aligned；version+name digest `06c450dcf0e265c7d20f3cf7b8ed71e1`；name/statements digest `8f08a8dee32cbca3aebe5f5861206699`；运行中同步任务 0。
- Production 专用脚本：[2026-07-20-opt4-production-history-version-realignment.sql](sql/2026-07-20-opt4-production-history-version-realignment.sql)，LF SHA-256 `eb3dfb3e7117504be3249294bb73c53af4c4e78072ecbed853e4e5e78631f420`。
- 一次性 PostgreSQL 17 测试库验证首次 48/48 成功、重复执行按 timestamp 前置门禁原子拒绝；测试实例和 fixture 已删除。
- 首次连接器提交遇到 HTTP transport error。只读歧义核对证明 Production 仍为 48 timestamp，因此未发生写入；随后只提交脚本从开头至 `COMMIT;` 的精确事务正文一次，返回成功。
- 事务只更新 `supabase_migrations.schema_migrations.version`，在独占锁内校验 48 行、唯一名称、完整目标集、Production 专属旧 version/name 摘要、0 运行任务和所有非 version payload 不变；没有执行 Migration SQL，也没有修改 public Schema 或业务数据。
- Postcheck：48 rows / 48 unique versions / 48 unique names / 0 timestamp / 48 aligned；name/statements digest 仍为 `8f08a8dee32cbca3aebe5f5861206699`；ordered history digest `8a9ff2ad685dc8ca0c2633afc293175e`；运行中同步任务 0。
- Production 与 Staging 的 14 组 canonical catalog count/digest 写后再次逐项一致。固定 CLI 2.109.1 在真实远端 version 集合的同构 PostgreSQL history 上得到 48/48 local=remote，`db push --dry-run` 返回 `Remote database is up to date.`；CLI 未直接 link 远端的凭据边界已明确保留。
- 完整 48 行、catalog、CLI、Advisor 与异常处理证据见 [Production history postcheck evidence](evidence/2026-07-20-opt4-production-history-postcheck.md)。

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

## 2026-07-18 独立终审发现的 CLI version 阻塞（历史检查点，已于 2026-07-20 修复）

- 仓库 48 个 Migration 文件的 version 是 `00001–00048`。
- Production 48/48、Staging 48/48 的远端 `schema_migrations.version` 均为 timestamp，全部不等于对应文件前缀。
- 典型映射：00001 为本地 `00001` / 两环境 `20260716021528`；00041 为本地 `00041` / Staging `20260716024654` / Production `20260716013023`；00048 为本地 `00048` / Staging `20260718062455` / Production `20260718074910`。
- Supabase CLI 2.109.1 从文件名数字前缀读取 local version，并以 remote/local version 精确比较；migration name 与正文摘要不能替代 version。返工已在 `package.json` / `package-lock.json` 中把 CLI 精确固定为 `2.109.1`，后续所有 CLI 证据必须使用该仓库版本。
- 因此当时“48 stages / 48 unique names”只证明显示名称齐全，不证明 `db push` 可用；当时禁止 `db push` 和 `--include-all`，避免 CLI 把旧 Migration 判为待执行。
- 修复路线为 history-only：保持 Production Schema、00048、name 与 statements 不变；先把 Staging version 对齐为 `00001–00048` 并独立复验，再处理 Production。该路线已于 2026-07-20 执行完成。
- Staging 与 Production 分别使用项目专用维护脚本，只执行受控 `UPDATE schema_migrations SET version = ...`，并在同一事务内断言 48 条基线、00001–00048 完整目标集、48 行更新和所有非 version 字段逐项不变。两环境远端现均已对齐。

## Production / Staging 最终复核

- canonical catalog 以 column、constraint、index、trigger、function、table_rls、policy 七类对象，在 full 与 known-drift-excluded 两个范围生成 14 组 count/digest；Production 与 Staging 差异为 0。
- 迁移名称均为 00001–00048，共 48 个唯一阶段。
- 00001–00040 与 00048 的历史正文 MD5/长度完全一致。
- 00041–00047 的 Production 原记录比 Staging 各多 2 个尾部空白字符；`rtrim(..., E'\r\n')` 后长度与 MD5 逐条一致。该差异为维护窗口前已存在的 history 文本格式差异，不是 Schema 漂移，也未在本次改写。
- Production Security Advisor：22 条（1 INFO / 21 WARN）；Performance Advisor：158 条（37 INFO / 121 WARN）。没有任何 lint 提及 `claim_sync_run_system`；现有项目分别属于 OPT-5 最小权限与 OPT-6 渐进性能治理。

## 回滚边界

`docs/reports/sql/2026-07-18-opt4-production-rollback.sql` 仍是不可执行的注释模板。00048 与 history 已登记后，禁止直接删除函数或回删历史行。若最终审查发现必须撤销 Schema，必须创建新的 00049+ 前向 Migration，先在 Staging 验证并单独取得 Production 批准。

## 最终审查门禁

- Staging history-only 对齐已通过指定审查会话独立复验；Production history-only 对齐已完成本地与远端 postcheck。
- 项目树与本地质量门已完成：相对链接 PASS、无孤儿 evidence/SQL、敏感信息扫描无命中；默认测试 3932/3932，lint 0 errors / 31 warnings，Next.js build 与应用 TypeScript PASS，PostgreSQL concurrency 44/44，migration contract 14/14，`git diff --check` PASS。
- migration contract 在 Windows 临时 PostgreSQL 的中文 `lc_messages` 下首次为 12/14，两个失败均为正确权限拒绝但错误文本不是英文；切换为与 CI 同构的 `lc_messages=C` 并重建测试库后原命令 14/14 PASS。临时实例已删除。
- `npm audit --omit=dev` 报告 Next.js 内嵌 PostCSS 的 2 个 moderate advisory，npm 明确显示当前依赖树无可用修复；本轮 history-only 范围不改依赖，作为 OPT-6/依赖治理残余风险提交终审。
- 当前仍须提交/推送 Production 证据、取得 PR #7 最新 head 的 GitHub Actions 结果与最终远端复核，再正式移交指定审查会话。
- 指定审查会话明确 PASS 前，状态保持 `OPT-4 FINAL REVIEW PENDING`，不得标记 OPT-4 DONE 或进入 OPT-5。
- 若终审要求回退 Schema 或 materially different 的远端操作，必须停止；禁止删除历史、直接回滚、重放旧 Migration 或用 `--include-all` 绕过 history。
