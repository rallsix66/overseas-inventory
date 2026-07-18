# Current Task Packet

## Task ID

**OPT-4-MIGRATION-HISTORY-REPAIR — STAGING REVIEW PASS / REMOTE CI PENDING**

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

详细证据：[OPT-4 Staging 验证报告](../reports/2026-07-18-opt4-staging-verification.md)

## 当前允许范围

- 完成本地全量 test、lint、build 与 diff 检查。
- 更新 OPT-4 报告、回滚 SQL、当前状态和路线图。
- 发布独立 OPT-4 分支/PR，以取得 GitHub PostgreSQL 17 远程 CI 证据。
- 提交指定独立审查会话复验。

## 当前禁止范围

- 未经独立审查 PASS 与用户单独批准，不得写 Production Schema 或 migration history。
- 禁止在 Production 重放 `00001–00040`。
- 禁止修改 `00001–00047`。
- 禁止通过伪造对象状态换取 migration 列表一致。
- 禁止进入 OPT-5。
- 禁止直接执行回滚模板；00048 登记后的撤销必须使用新的 00049+ 前向 Migration 并单独审查。
- 禁止触碰用户既有同步脚本、`.claude` 状态与项目总结。

## 剩余步骤

1. 独立分支/PR 的 GitHub quality 与 PostgreSQL 17 套件通过。
2. 用户单独批准 Production 维护窗口。
3. 先应用 00048 并验证，再对 00001–00040 执行受控 history repair。
4. 复核 Production/Staging history、canonical catalog、Cron Dry Run 与数据库顾问，重新提交最终阶段审查。

## 验收标准

- 00048 在缺列/有旧空列两种起点均安全收敛；存在旧归档数据时拒绝执行。
- `claim_sync_run_system` 仅 `service_role` 可执行，且 Admin/Dry Run/锁/租约语义与 00010 一致。
- 00011 遗留对象不进入 Production，Staging 最终状态与正确业务语义一致。
- Production 操作严格遵守“备份 → 00048 → 验证 → history repair → 全量复核”顺序。
- 远程 PostgreSQL 17 契约测试、默认测试、lint、build 与 `git diff --check` 全部通过。
- 指定独立审查会话给出 PASS。
