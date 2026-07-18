# OPT-4 Staging 验证报告

## 当前结论

截至 2026-07-18，OPT-4 的本地代码与 Staging 数据库变更已完成，Production 尚未写入。三轮独立阶段审查最终 PASS；当前状态为 `STAGING REVIEW PASS / REMOTE CI PENDING`。

本阶段新增 `00048_restore_claim_sync_run_system.sql`，没有修改或重放 `00001–00047`。该前向 Migration 同时完成两件事：

1. 用已审计的 00010 定义创建/校准 `claim_sync_run_system(...)`；
2. 在确认无遗留归档数据后，幂等删除 00011 留在 Staging 的 3 列、外键和索引，使最终 Schema 向 Production 的正确用户级偏好语义收敛。

## Production 恢复点

- 项目：`hzlhqyditalumhnxbaim`
- 备份时间：2026-07-18 14:09–14:10（Asia/Shanghai）
- 本机目录：`C:\Users\Administrator\Documents\DIS-backups\production\2026-07-18_14-09-53`
- 产物：`roles.sql`、`schema.sql`、`data.sql`、`database.dump`、归档目录、元数据与 `BACKUP_SUCCESS`
- 校验：全部 SHA-256 一致；`pg_restore --list` 可读取 654 行目录；包含 43 个 public 函数、18 张 public 表与 18 组表数据。

备份日志不包含密码；数据库密码仅以 Windows DPAPI 加密文件保存。Production 在本阶段没有执行 DDL、DML 或 migration history repair。

## Staging 执行前门禁

项目：`hyarhvsjhkjpallbyifn`

在应用 00048 前，对 341 个 `product_variant` 执行只读检查：

| 检查 | 结果 |
|---|---:|
| `is_archived = true` | 0 |
| `archived_at IS NOT NULL` | 0 |
| `archived_by IS NOT NULL` | 0 |

00048 自身还包含动态 SQL 门禁：任何环境只要存在上述有效旧归档数据，就抛错并让整个 Migration 回滚。清理语句不使用 `CASCADE`。

## Staging 应用结果

- Supabase migration version：`20260718062455`
- migration name：`00048_restore_claim_sync_run_system`
- 应用结果：成功
- Staging migration history：00001–00048 共 48 个命名阶段均存在

应用后的目录证据：

| 对象 | 结果 |
|---|---|
| `claim_sync_run_system(uuid,text,uuid,integer,uuid,text,text)` | 存在，返回 uuid |
| owner | `postgres` |
| security | `SECURITY DEFINER`，`search_path=''` |
| EXECUTE | 仅 `postgres` 与 `service_role` |
| authenticated / anon EXECUTE | false / false |
| 00011 遗留列 | 0 |
| `product_variant_archived_by_fkey` | 0 |
| `idx_variant_is_archived` | 0 |

## 行为验证

在显式事务中切换为 `service_role`，使用真实激活 Admin 与无进行中任务的海外仓执行：

- 合法 `dry_run` + 非空输入产物哈希：成功取得请求的 run id，并创建期望的 `in_progress` 行；
- `real_write`：按函数边界拒绝；
- 使用 Operator 作为 `p_triggered_by`：按管理员校验拒绝；
- 事务最终 `ROLLBACK`；复查测试哈希对应记录为 0，目标仓 `in_progress` 为 0。

第一次测试传入空输入哈希，被既有 `dry_run_requires_input_artifact` CHECK 正确拒绝；校正为真实 Cron 契约后完整通过。该失败事务没有留下数据。

## 测试与顾问

- 新增静态安全测试 5/5 PASS：00010/00048 函数语义一致、service-role-only、清理数据门禁、精确无 CASCADE 清理、最终类型不再暴露旧列且 00011 保持不可变。
- 本地默认测试：91 files / 3932 tests PASS。
- lint：0 errors / 31 warnings，符合既有 warning budget。
- Next.js 16.2.9 build 与 TypeScript：PASS；仅保留已记录的 Turbopack NFT trace warning。
- PostgreSQL 17 契约套件本地 14/14 PASS：除旧对象收敛、ACL、合法 Dry Run、Real Write/Operator/authenticated 拒绝外，还会先写入有效旧归档状态，验证真实 00048 抛错，并断言前置函数 DDL 与三列/FK/索引整笔回滚；清理测试数据后才再次执行同一 00048。远程 GitHub CI 运行证据仍待 PR。
- Staging Security Advisor 未对 `claim_sync_run_system` 产生新告警；现有告警均属于 OPT-5 已规划基线。
- Staging Performance Advisor 可读取，未出现指向 00048 新函数或已删除索引的新问题；现有 RLS/initplan、多 permissive policy、旧索引等属于 OPT-6/后续治理基线。

## 回滚材料

- Production 回滚模板：`docs/reports/sql/2026-07-18-opt4-production-rollback.sql`。文件全部为注释，禁止直接执行；00048 登记后如需撤销，必须新建并独立审查 00049+ 前向回滚 Migration，避免 Schema 与 history 分裂。
- Staging 清理回滚模板：`docs/reports/sql/2026-07-18-opt4-staging-cleanup-rollback.sql`。直接恢复兼容对象会形成刻意 drift，因此模板不可直接执行；优先重建 Staging，否则必须用新的前向 Migration 恢复并再通过前向 Migration 或环境重建收敛。任何方案都不恢复旧全局归档 RLS 语义。

## 进入 Production 前的停止条件

1. 当前 diff、全量测试、lint、build 与远程 PostgreSQL 17 CI 通过；
2. 指定独立审查会话给出 PASS；
3. 用户单独批准 Production 维护窗口；
4. 维护窗口中先应用 00048 并验证函数，再执行 00001–00040 受控 history repair；严禁重放旧 SQL；
5. 最后重新核对 Production/Staging migration history、canonical catalog、Cron Dry Run 与数据库顾问。
