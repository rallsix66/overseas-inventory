# OPT-4 Staging History Version 对齐报告

> 状态：**PREWRITE BASELINE PASS / USER APPROVED / EXECUTION DEFERRED FOR ENVIRONMENT HANDOFF**
> 指定审查会话：`019f6f71-d3c3-75e0-9a61-8b6942e01823`
> Staging 项目：`hyarhvsjhkjpallbyifn`（DIS Staging）
> 本报告不构成远端写入授权。

## 结论

2026-07-18 17:05（Asia/Shanghai）完成 Staging 只读写入前基线。项目为 `ACTIVE_HEALTHY`，PostgreSQL `17.6`，运行中的同步任务为 0。远端 migration history 为 48 rows / 48 unique versions / 48 unique names；48/48 version 均为 timestamp，0/48 与仓库 `00001–00048` 对齐，但 48 个 name 可无缺口、无重复地映射到目标 version 集合。

用户已明确批准 Staging history-only version 对齐窗口，但随后要求在任何远端 history 写入前先合并上线，以便迁移执行环境。因此当前为 `USER APPROVED / NOT EXECUTED`；本报告、维护脚本和基线证据随代码发布交接，新环境继续执行。

## 写入前 History 基线

只读快照 UTC：`2026-07-18T09:05:47.28919`

| 指标 | 结果 |
|---|---:|
| History rows | 48 |
| Unique versions | 48 |
| Unique names | 48 |
| Timestamp versions | 48 |
| 已对齐 versions | 0 |
| Name 目标集 | 精确等于 `00001–00048` |
| 首个远端 version | `20260716021528` |
| 最后远端 version | `20260718062455` |
| Name/statements digest | `3566222cba075216b6c9a0d3065b7b93` |
| 含旧 version 的 ordered history digest | `6187b714bb85afd48635cc5b275f17cd` |

典型映射：

| Name | 当前远端 version | 目标 version | Statements MD5 |
|---|---|---|---|
| `00001_initial_schema` | `20260716021528` | `00001` | `b9ffd51f5f16c72c95a86a55ab053419` |
| `00041_replenishment_warehouse_params` | `20260716024654` | `00041` | `adf5951cb448754b4a62e259a533eca1` |
| `00048_restore_claim_sync_run_system` | `20260718062455` | `00048` | `0a4a0cb7b1bcae70346efda90333e2f9` |

`schema_migrations` 的非 version 字段为 `statements[]`、`name`、`created_by`、`idempotency_key`、`rollback[]`。维护脚本用 `to_jsonb(row) - 'version'` 对全部非 version payload 做事务前后逐行比较，而不是只抽查 name/statements。

## 写入前 Canonical Catalog 基线

以下 14 组只读摘要必须在写入后逐项保持不变：

| Scope | Kind | Count | Digest |
|---|---|---:|---|
| full | column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| full | constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| full | function | 75 | `4b53ac2a18eac623a0ae9ea7cc4d0f2b` |
| full | index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| full | policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| full | table_rls | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| full | trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |
| known_drift_excluded | column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| known_drift_excluded | constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| known_drift_excluded | function | 74 | `74cfdc467040fa8e462131108002f751` |
| known_drift_excluded | index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| known_drift_excluded | policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| known_drift_excluded | table_rls | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| known_drift_excluded | trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |

## 待执行脚本与本地验证

- 维护脚本：`docs/reports/sql/2026-07-18-opt4-staging-history-version-realignment.sql`
- SHA-256：`89d38b43f0159f65a3795bf4cba84a695df92638dfe7693c25aa29d6f7fbc6ca`
- Supabase CLI：仓库精确固定 `2.109.1`
- 本机 PostgreSQL：`17.10`
- 一次性测试库：首次执行 48/48 更新成功，最终 version 为 `00001–00048`；第二次执行被 timestamp 基线门禁拒绝（exit 3）；测试库已删除。

脚本只在单一事务中更新 `supabase_migrations.schema_migrations.version`。它不会执行任何 Migration SQL，不会改 public Schema，不会使用 `db push` 或 `--include-all`。

## 获批后的验收门禁

1. 执行前再次确认 Staging 项目 ID、健康状态、48 条 timestamp 基线和 0 个运行中同步任务。
2. 执行维护脚本并保存 48 条 postcheck 输出。
3. Name/statements digest 必须仍为 `3566222cba075216b6c9a0d3065b7b93`；所有非 version payload 必须由事务内断言证明不变。
4. 14 组 canonical catalog count/digest 必须与本报告逐项一致。
5. 使用仓库固定的 Supabase CLI `2.109.1` 取得 `migration list` 本地/远端 48 条精确一致和 `db push --dry-run` 为 up to date 的证据。
6. 把完整证据发送到指定审查会话；只有 Staging 复审 PASS 后，才可另行请求 Production history-only 窗口。
