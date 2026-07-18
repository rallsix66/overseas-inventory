# Production Migration 基线只读审计（OPT-3）

## 结论

截至 2026-07-18，本次只读审计确认：Production 与从空库连续重放 `00001–00047` 的 Staging 在 public Schema 的表/RLS、Policy、Trigger，以及除两组已知对象外的列、约束、索引和函数上相同。Production 的 Migration 历史表只登记 `00041–00047`，不能直接启用 `supabase db push`。

唯一必须补齐的当前能力是 Migration 00010 的 `claim_sync_run_system(...)`。Migration 00011 的三列、外键和索引只存在于 Staging，但其全局归档语义已被 00012 的用户级偏好完整替代，不应为了显示一致而补到 Production。

本报告没有执行任何 Production 写入、旧 Migration 重放、`migration repair` 或 `db push`。OPT-4 仍须等待：

1. 本报告通过独立审查并由用户确认；
2. 用户在 Supabase 控制台确认可用的 Production 备份/恢复点；
3. 另行批准 OPT-4 的历史修复与前向 Migration。

## 审计对象与恢复边界

| 环境 | Supabase project | PostgreSQL | 只读快照时间（UTC） | WAL LSN |
|---|---|---:|---|---|
| Production | `DIS Project` / `hzlhqyditalumhnxbaim` | 17.6 | `2026-07-18 02:52:58.505728` | `3/6F000000` |
| Staging | `DIS Staging` / `hyarhvsjhkjpallbyifn` | 17.6 | `2026-07-18 02:53:08.912378` | `0/5E000000` |

WAL LSN 只是本次目录快照标识，不是可恢复备份。当前只读数据库接口无法读取 Supabase 控制面的备份/PITR 状态，因此本报告明确记录为：**Production 恢复点尚未由用户在控制台确认，OPT-4 不得开始**。

两边扩展及版本一致：`pg_stat_statements 1.11`、`pg_trgm 1.6`、`pgcrypto 1.3`、`plpgsql 1.0`、`supabase_vault 0.3.1`、`uuid-ossp 1.1`。

## Migration 历史证据

- Production：7 条，仅 `00041_replenishment_warehouse_params` 至 `00047_dashboard_warehouse_health_overview`。
- Staging：47 条，严格包含 `00001_initial_schema` 至 `00047_dashboard_warehouse_health_overview`。
- 仓库：47 个 SQL Migration，文件未在本阶段修改。

因此 Production 的 `00001–00040` 是“对象大多存在、历史登记缺失”，不是“40 个 Migration 都未执行”。禁止直接重放旧 SQL。

## 全量目录对比

以下为同一套只读 canonical catalog 查询结果。对象定义包含必要的类型、默认值、约束定义、索引定义、Trigger 启用状态、函数签名/返回类型/owner/ACL/config/定义、RLS 和 Policy 表达式。

| 对象类型 | Production | Staging | 结论 |
|---|---:|---:|---|
| Column | 161 | 164 | Staging 多 00011 的 3 个遗留列 |
| Constraint | 96 | 97 | Staging 多 `product_variant_archived_by_fkey` |
| Function | 74 | 75 | Staging 多 `claim_sync_run_system(...)` |
| Index | 88 | 89 | Staging 多 `idx_variant_is_archived` |
| Policy | 42 | 42 | 数量与 canonical digest 完全一致 |
| Table/RLS | 18 | 18 | 数量与 canonical digest 完全一致 |
| Trigger | 13 | 13 | 数量与 canonical digest 完全一致 |

为排除“已知差异与未知差异数量相抵”的可能，审计 SQL 还会按精确对象键排除 00010/00011 的 6 个已知对象，再对剩余目录重新计数和计算 canonical digest。第二轮只读查询结果如下；两环境每一类的数量和 digest 都完全一致：

| 对象类型 | 排除已知差异后的数量 | Production/Staging digest |
|---|---:|---|
| Column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| Constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| Function | 74 | `74cfdc467040fa8e462131108002f751` |
| Index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| Policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| Table/RLS | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| Trigger（含 `tgenabled`） | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |

因此，在排除明确列出的 00010/00011 对象后，剩余差异为 0。函数分桶查询也得到相同结论：除函数名首字母 `c` 的桶外，所有非扩展自定义函数桶在两边的数量和 definition/owner/ACL/config digest 均一致；`c` 桶唯一差异为下面这一项。

## 精确差异与影响

### 1. `claim_sync_run_system(...)` — `MISSING_REQUIRED`

- 来源：`00010_claim_sync_run_system.sql`。
- Staging：存在签名 `claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text)`，返回 `uuid`，owner `postgres`，`SECURITY DEFINER`，空 `search_path`，仅 `postgres` 与 `service_role` 有 EXECUTE。
- Production：不存在。
- 当前调用证据：`src/features/sync/supabase-repository.ts` 的 Cron/system claim 路径调用此 RPC；缺失时每天自动 Dry Run 会在数据库调用阶段失败。
- 风险：定时同步不可用；不能只修历史表，因为历史登记不会创建函数。
- 建议：OPT-4 新建 `00048` 前向 Migration，以 00010 的已审计定义创建/校准该函数，再在 Staging 和 Production 分阶段验证；禁止重放 00010。
- 回滚：新的前向 Migration 必须附带显式 `DROP FUNCTION` 回滚 SQL；回滚后 Cron 恢复为不可用但不影响人工用户 session 路径。

### 2. `product_variant` 旧全局归档对象 — `OBSOLETE_SUPERSEDED`

Staging 比 Production 多：

- `is_archived boolean NOT NULL DEFAULT false`
- `archived_at timestamptz NULL`
- `archived_by uuid NULL`
- `product_variant_archived_by_fkey` → `profiles(id)`
- `idx_variant_is_archived`，仅索引 `is_archived = true`

这些对象来自 00011。00012 已把归档改为 `user_variant_preference` 的用户级语义，并明确业务代码停止读写这些全局列；当前两边 42 条 Policy 完全一致，证明 00011 加入的 Operator 全局过滤也已被 00012/00015 的最终策略替换。

- 风险：把旧列补进 Production 会恢复无业务消费者的遗留模型，增加双重事实源。
- 建议：不要在 Production 补这些对象。OPT-4 的 00048 应在 Staging 对这些遗留对象执行幂等清理，使全链最终状态向 Production 的正确语义收敛。
- 回滚：清理前确认三列无有效业务数据；如需回滚，可由 00048 附带的逆向 SQL 重建空列/外键/索引，但不得恢复旧全局 RLS 语义。

## 00001–00040 逐条分类

分类按“当前链最终应保留的有效 Schema effect”判断。若某 Migration 只定义了后来被前向 Migration 重建的同名函数，则标为 `OBSOLETE_SUPERSEDED`；若仍有其他有效对象保留且最终目录与 Staging 一致，则标为 `EXACT_PRESENT`。

| Migration | 主要预期 effect | 分类 | 证据/建议 |
|---|---|---|---|
| 00001 | 18 张基础表、基础索引/约束、RLS/Policy、通用函数/Trigger | `EXACT_PRESENT` | 最终基础目录与 Staging 一致；00033 删除的旧索引按前向链处理 |
| 00002 | 初版 `create_shipment_transactional` | `OBSOLETE_SUPERSEDED` | 00005/00018/00020 重建签名和安全语义 |
| 00003 | 移除 Operator 对 variant 的 UPDATE Policy | `EXACT_PRESENT` | 当前 42 条 Policy 与 Staging 完全一致 |
| 00004 | `batch_match_variants` RPC + ACL | `EXACT_PRESENT` | 函数定义/owner/ACL/config 一致 |
| 00005 | 安全版 9 参数 shipment RPC | `OBSOLETE_SUPERSEDED` | 00018/00020 扩展为最终签名 |
| 00006 | 初版 `sync_warehouse_inventory` | `OBSOLETE_SUPERSEDED` | 00009 泛化、00014 加动态告警字段 |
| 00007 | `sync_run`/锁表/日志扩展、RLS、6 个同步 RPC | `EXACT_PRESENT` | 表/约束/索引/函数最终目录一致 |
| 00008 | `claim_sync_run` Dry Run 行锁加固 | `EXACT_PRESENT` | 当前定义一致 |
| 00009 | 多国家版库存同步 RPC | `OBSOLETE_SUPERSEDED` | 00014 最终重建同签名函数 |
| 00010 | `claim_sync_run_system` + service_role ACL | `MISSING_REQUIRED` | Production 唯一缺失的当前必需函数；用 00048 前向补齐 |
| 00011 | variant 全局软归档列/FK/索引/Policy | `OBSOLETE_SUPERSEDED` | 00012 改为用户级偏好；不要补旧对象 |
| 00012 | `user_variant_preference`、索引、RLS/Policy | `EXACT_PRESENT` | 表、约束、索引、Policy 一致 |
| 00013 | preference CHECK 增加 `favorited` | `EXACT_PRESENT` | 约束一致 |
| 00014 | daily_sales/estimated_days/lead_time_days + 最终同步 RPC | `EXACT_PRESENT` | 三列及函数定义一致 |
| 00015 | `user_warehouses`、仓库隔离 Policy/RPC | `EXACT_PRESENT` | 表/RLS/Policy/函数一致 |
| 00016 | `update_user_warehouses` RPC | `EXACT_PRESENT` | 函数与 ACL 一致 |
| 00017 | 外部物流三表及基础约束/RLS | `EXACT_PRESENT` | 最终对象与 Staging 一致，后续由 00038/39 扩展 |
| 00018 | `shipment_no`、唯一约束/索引、shipment RPC | `EXACT_PRESENT` | 持久列/约束存在；RPC 后由 00020 正向扩展 |
| 00019 | 初版状态变更 RPC | `OBSOLETE_SUPERSEDED` | 00021/00022 收紧并加入状态流 |
| 00020 | `purchase_order_no` + 最终 shipment 创建 RPC | `EXACT_PRESENT` | 列和最终函数一致 |
| 00021 | Admin-only 状态变更 RPC | `OBSOLETE_SUPERSEDED` | 00022 保留权限并加入状态流校验 |
| 00022 | 最终状态流转 RPC | `EXACT_PRESENT` | 函数/ACL 一致 |
| 00023 | 全量确认入仓 RPC | `EXACT_PRESENT` | 函数/ACL 一致 |
| 00024 | 初版原子用户管理保护 RPC | `OBSOLETE_SUPERSEDED` | 00025 重建两函数并绑定调用者身份 |
| 00025 | 用户管理 RPC 身份绑定、Profile Trigger | `EXACT_PRESENT` | 函数、Trigger、Policy/ACL 一致 |
| 00026 | `bigseller_absorbed_at` + 部分入仓 RPC | `EXACT_PRESENT` | 列与函数一致 |
| 00027 | 海外库存/统计/在途聚合 RPC | `EXACT_PRESENT` | 统计和在途函数保留；列表函数由 00034–37 正向增强 |
| 00028 | 初版低库存 RPC | `OBSOLETE_SUPERSEDED` | 00034 重建并加入 variant_name |
| 00029 | 初版分页同步运行 RPC | `OBSOLETE_SUPERSEDED` | 00030 修复 Operator 仓库隔离 |
| 00030 | 最终分页同步运行 RPC | `EXACT_PRESENT` | 函数/ACL 一致 |
| 00031 | 高频路径 7 个索引 | `EXACT_PRESENT` | 索引目录除 00011 遗留索引外一致 |
| 00032 | 同步仓库概览 RPC | `EXACT_PRESENT` | 函数/ACL 一致 |
| 00033 | 删除两个废弃 quantity 部分索引 | `EXACT_PRESENT` | 两边均不存在目标索引 |
| 00034 | variant_name 字段语义 RPC | `EXACT_PRESENT` | 低库存函数保留；列表函数后由 00035/37 增强 |
| 00035 | 分词搜索版海外库存 RPC | `OBSOLETE_SUPERSEDED` | 00037 在其基础上加入 in_transit 状态 |
| 00036 | `pg_trgm` 与 8 个搜索索引 | `EXACT_PRESENT` | 扩展版本和索引定义一致 |
| 00037 | 最终 in_transit 海外库存 RPC | `EXACT_PRESENT` | 函数定义/ACL 一致 |
| 00038 | Golucky Schema、约束、索引、2 个 Trigger | `EXACT_PRESENT` | 列/约束/索引/Trigger 一致 |
| 00039 | Golucky 仓库 RLS、3 RPC、换仓 Trigger | `EXACT_PRESENT` | Policy、函数和 Trigger 一致 |
| 00040 | Token Cache 表、RLS、3 个 service_role RPC | `EXACT_PRESENT` | 表/RLS、函数与 ACL 一致 |

汇总：`EXACT_PRESENT` 28 条、`OBSOLETE_SUPERSEDED` 11 条、`MISSING_REQUIRED` 1 条、`PRESENT_DIVERGENT` 0 条。

## OPT-4 建议动作（未授权、未执行）

1. 用户先确认 Supabase Production 的可用备份或 PITR 恢复点，并记录控制台时间。
2. 新建 00048 前向 Migration：创建/校准 `claim_sync_run_system`；幂等移除 Staging 的 00011 遗留索引、外键和三列。
3. 在临时 PostgreSQL 从 00001 连续重放至 00048，执行现有 PostgreSQL 行为套件。
4. 先部署 Staging，复核全量 canonical catalog、Cron dry-run、Admin/Operator/disabled/anon/跨仓矩阵与回滚脚本。
5. 对 28 条 `EXACT_PRESENT`，在对象证据复核后标记 applied。对 11 条 `OBSOLETE_SUPERSEDED`，只有在逐条证明后续 Migration 已完整替代、当前最终状态正确后才标记 applied；这是为阻止 CLI 重放旧 SQL，不代表旧 SQL 被再次执行。00010 必须先由 00048 补齐并验证，再将旧 00010 标记 applied。
6. 取得单独 Production 维护窗口批准后，才执行历史 repair 与 00048；执行后再次只读核对 Production/Staging 均登记 `00001–00048`（48/48）并复核全量对象 digest。

## 可复核材料

- 只读 SQL：[sql/2026-07-18-production-migration-baseline-audit.sql](sql/2026-07-18-production-migration-baseline-audit.sql)
- 系统优化路线图：`docs/tasks/system-optimization-roadmap-2026-07-17.md`
- 当前任务包：`docs/tasks/current-task.md`
- Staging 从空库重放和 Preview 验收历史：`docs/reports/2026-07-17-sequential-roadmap-and-staging-smoke.md`

所有数据库证据均来自 SELECT 或目录读取。本阶段未修改任何 `supabase/migrations/*.sql`。
