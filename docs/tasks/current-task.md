# Current Task Packet

## Task ID

**OPT-4-MIGRATION-HISTORY-REPAIR — STAGING INDEPENDENT REVIEW PASS / PRODUCTION APPROVAL PENDING**

路线图：[system-optimization-roadmap-2026-07-17.md](system-optimization-roadmap-2026-07-17.md)

## 目标

通过新的 00048 前向 Migration 补齐 Production 缺失的 `claim_sync_run_system(...)`，清理 Staging 已被 00012 替代的 00011 遗留对象，并在对象证据成立后受控修复 Production 的 00001–00040 migration history。禁止重放或修改旧 Migration。

## 已完成

- OPT-3 报告已经独立审查 PASS，用户确认继续。
- Production 数据库密码已重置并仅用 Windows DPAPI 加密保存，明文剪贴板已清空。
- Production 完整逻辑备份已生成并验证：角色、Schema、数据、custom archive、SHA-256 与可读归档目录全部通过。
- 新增 `00048_restore_claim_sync_run_system.sql`；函数定义与 00010 的已审计语义一致，清理前带旧归档数据拒绝门禁，不使用 `CASCADE`。该 Migration 已在 Staging 登记，后续返工不修改 00048。
- Staging 清理前 341 个 Variant 中旧归档有效数据为 0。
- Staging 已成功应用 00048；函数 owner/ACL/search_path 正确，旧 3 列、FK、索引均已移除。
- Staging 事务内 service_role Dry Run、Real Write 拒绝、Operator 拒绝均通过，测试事务已回滚且无残留记录。
- 聚焦静态测试 5/5 PASS；PostgreSQL 契约套件已扩展覆盖 00048 的成功路径、service_role Schema USAGE 与有效旧数据触发整文件原子回滚的失败路径。
- 本地默认测试 3932/3932（91 files）、PostgreSQL 17 契约测试 14/14、lint 0 errors / 31 warnings、Next.js build/TypeScript PASS。
- 三轮独立阶段审查最终 PASS；00048 与 Staging `schema_migrations.statements[1]` 的 5778 bytes / 5596 chars / SHA-256 `0a833a0f407d4d9cc5be6a702662318c6afa6f382fa1689046d945d2dfefd87a` 逐字一致。
- Draft PR #6 已创建；GitHub Actions run `29635961807` 的 quality job 与 PostgreSQL concurrency/contract job 全部 PASS，Vercel Preview PASS。
- 用户已明确批准 2026-07-18 Production 维护窗口。写入前再次确认项目 `hzlhqyditalumhnxbaim` 为 `ACTIVE_HEALTHY`、PostgreSQL 17.6、完整备份 4 个核心文件 SHA-256 全部匹配、运行中同步任务为 0。
- Production 已应用与 Staging 正文完全一致的 00048，登记版本为 `20260718074910`；语句长度 5596、MD5 `0a4a0cb7b1bcae70346efda90333e2f9`。函数为 `postgres` owner、`SECURITY DEFINER`、空 `search_path`，ACL 仅保留 `postgres` 与 `service_role`。
- Production 事务验证通过：合法 service-role Dry Run 成功，Real Write 与无效操作者均被拒绝；事务回滚后 run、artifact hash 与 warehouse lock 残留均为 0。
- 00001–00040 已在单一事务中仅修复 `supabase_migrations.schema_migrations`，未执行任何旧 SQL。事务前要求现有历史严格等于 00041–00048，提交前逐条校验从 Staging 只读取得的版本、名称、语句 MD5 与长度；最终为 48 stages / 48 unique names。
- Production 与 Staging canonical catalog 的列、约束、索引、触发器、函数、Table/RLS 与 Policy 共 14 组摘要完全一致。00041–00047 历史正文仅有既有尾部换行差异，去除尾部空白后 7 条 MD5 全部一致。
- Production 顾问复核完成：Security 22（1 INFO / 21 WARN）、Performance 158（37 INFO / 121 WARN），均为 OPT-5/OPT-6 的既有基线；`claim_sync_run_system` 没有新增告警。
- 指定独立审查结论为 `CHANGES_REQUIRED`：本地 migration version 为 `00001–00048`，Production 与 Staging 远端 48/48 均使用 timestamp version，CLI 以 version 精确比较且不会用 name/正文摘要替代。当前 48 个唯一名称不等于 CLI history 已收敛，禁止执行 `db push` 或 `--include-all`。
- `package.json` 与 `package-lock.json` 已把 Supabase CLI 精确固定为 `2.109.1`；本次返工的 `migration list`、`db push --dry-run` 与帮助检查必须使用仓库固定版本，禁止临时漂移到其他 CLI 版本。
- Staging history-only 维护脚本已准备在 `docs/reports/sql/2026-07-18-opt4-staging-history-version-realignment.sql`：仅更新 `schema_migrations.version`，带 48 行/唯一名称/目标版本/旧 timestamp 基线断言、独占锁、单事务和所有非 version 字段逐项不变校验。本机 PostgreSQL 17.10 一次性测试库验证 48/48 成功，重复执行按预期拒绝（exit 3），测试库已删除。
- Staging 远端只读 preflight 已通过：项目 `ACTIVE_HEALTHY`、PostgreSQL 17.6、运行中同步任务 0；48 条 history 全为 timestamp、0 条已对齐、name 目标集精确等于 `00001–00048`。写入前 name/statements digest 为 `3566222cba075216b6c9a0d3065b7b93`，14 组 canonical catalog 摘要已固化，详见 [Staging History Version 对齐报告](../reports/2026-07-18-opt4-staging-history-version-realignment.md)。
- 2026-07-20 在已获批窗口执行 Staging history-only 维护脚本：48/48 version 从 timestamp 对齐为 `00001–00048`，事务内仅更新 `schema_migrations.version`，所有非 version payload 逐行不变断言通过。写入后 name/statements digest 仍为 `3566222cba075216b6c9a0d3065b7b93`，14 组 canonical catalog 摘要逐项不变，运行中同步任务仍为 0。
- Supabase 官方连接器直接返回真实 Staging 48 条 migration version 精确为 `00001–00048`。仓库固定 CLI `2.109.1` 因新环境缺少 platform access token 未直接连接远端；它在由该真实远端 version 集合构造的一次性 PostgreSQL 17.10 history 镜像上输出 48/48 local=remote，`db push --dry-run` 返回 `Remote database is up to date.`，临时数据库已停止并删除。该证据边界已明确提交独立审查。
- 指定审查会话已独立复算真实 Staging 48 行、两套 history digest、逐行 statement 证据、0 个运行中任务、14 组 catalog 摘要与脚本 CRLF/LF 哈希，并于 2026-07-20 给出 Staging 子阶段 PASS。该 PASS 不覆盖 Production。

详细证据：[OPT-4 Staging 验证报告](../reports/2026-07-18-opt4-staging-verification.md)；[OPT-4 Production 验证报告](../reports/2026-07-18-opt4-production-verification.md)

## 当前允许范围

- 更新 OPT-4 Production 报告、当前状态、路线图与 history-only 返工计划。
- 固定并验证 Supabase CLI `2.109.1`，不改变应用运行时依赖语义。
- Staging history-only version 对齐已经执行并通过本地 postcheck；当前只允许整理证据、修复审查意见并等待指定会话结论。
- Staging 独立复验 PASS 后，只可整理并申请 Production history-only 维护窗口；必须取得用户对 Production 的单独明确批准后才可写入。

## 当前禁止范围

- 禁止对已完成的 Production 00048 与 history repair 做未审查追加写入。
- 在取得用户对 Production history-only 维护窗口的单独明确批准前，禁止写 Production migration history；Staging 复验 PASS 本身不构成 Production 写入授权。
- 禁止 `supabase db push`、`--include-all` 或通过重放旧 Migration 规避 version mismatch。
- 禁止在 Production 重放 `00001–00040`。
- 禁止修改 `00001–00047`。
- 禁止通过伪造对象状态换取 migration 列表一致。
- 禁止进入 OPT-5。
- 禁止直接执行回滚模板；00048 登记后的撤销必须使用新的 00049+ 前向 Migration 并单独审查。
- 禁止触碰用户既有同步脚本、`.claude` 状态与项目总结。

## 剩余步骤

1. ✅ 合并并上线代码、维护脚本与只读基线证据。
2. ✅ 在已获批窗口把 Staging 48 条 history version 受控对齐为仓库 `00001–00048`，保持 name/statements 摘要与 canonical catalog 不变，并保存 48 行 postcheck。
3. ✅ 指定审查会话已完成 Staging 独立复验并给出 PASS。
4. ⏳ 整理并申请 Production history-only 维护窗口；取得用户对 Production 的单独明确批准后才执行对齐，再完成两环境 CLI/catalog 复核和 OPT-4 最终审查。OPT-4 最终 PASS 前禁止进入 OPT-5。

## 验收标准

- 00048 在缺列/有旧空列两种起点均安全收敛；存在旧归档数据时拒绝执行。
- `claim_sync_run_system` 仅 `service_role` 可执行，且 Admin/Dry Run/锁/租约语义与 00010 一致。
- 00011 遗留对象不进入 Production，Staging 最终状态与正确业务语义一致。
- Production 操作严格遵守“备份 → 00048 → 验证 → history repair → 全量复核”顺序。
- 远程 PostgreSQL 17 契约测试、默认测试、lint、build 与 `git diff --check` 全部通过。
- 指定独立审查会话给出 PASS。
