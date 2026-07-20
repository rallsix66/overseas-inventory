# OPT-4 Staging History Version 对齐报告

> 状态：**STAGING INDEPENDENT REVIEW PASS / PRODUCTION SUBSEQUENTLY EXECUTED**
> 指定审查会话：`019f6f71-d3c3-75e0-9a61-8b6942e01823`
> Staging 项目：`hyarhvsjhkjpallbyifn`（DIS Staging）
> 本报告只覆盖 Staging 子阶段；Production 后续执行与终审证据以 Production 专用报告为准。

## 结论

2026-07-18 17:05（Asia/Shanghai）完成 Staging 只读写入前基线。项目为 `ACTIVE_HEALTHY`，PostgreSQL `17.6`，运行中的同步任务为 0。远端 migration history 为 48 rows / 48 unique versions / 48 unique names；48/48 version 均为 timestamp，0/48 与仓库 `00001–00048` 对齐，但 48 个 name 可无缺口、无重复地映射到目标 version 集合。

用户已明确批准 Staging history-only version 对齐窗口。当前进度合并上线并迁移执行环境后，2026-07-20 09:31（Asia/Shanghai）在项目 `hyarhvsjhkjpallbyifn` 执行了已验证的维护脚本。脚本在单一事务中只更新 `supabase_migrations.schema_migrations.version`，48/48 从 timestamp 对齐为 `00001–00048`；没有执行 Migration SQL，也没有改动 public Schema。

写入后远端 history 为 48 rows / 48 unique versions / 48 unique names，timestamp versions 为 0，aligned versions 为 48；name/statements digest 仍为 `3566222cba075216b6c9a0d3065b7b93`，14 组 canonical catalog count/digest 与写入前逐项一致，运行中的同步任务仍为 0。该时点只完成 Staging，指定审查会话 PASS 也不构成 Production 写入授权；用户随后另行给出剩余既定路线的持续授权，Production 的独立执行与证据记录在 [OPT-4 Production 验证报告](2026-07-18-opt4-production-verification.md)。

指定审查会话于 2026-07-20 完成两轮独立复验并给出 PASS：真实 Staging 48 行、两套 history digest、逐行 statement 证据、0 个运行中任务与 14 组 catalog 摘要均现场复算命中；固定 CLI 同构 history 证据足以覆盖本次窄版本比较问题。该 PASS 只覆盖 Staging，不构成 Production 写入授权。

## 2026-07-20 执行与 Postcheck

| 门禁 | 结果 |
|---|---|
| 项目健康 | `DIS Staging` / `ACTIVE_HEALTHY` / PostgreSQL `17.6` |
| 写入前快照 UTC | `2026-07-20 01:28:36.586837` |
| 写入前 history | 48 rows；48 timestamp；0 aligned；目标集精确为 `00001–00048` |
| 写入前运行中任务 | 0 |
| 脚本正文 | LF 规范化 SHA-256 `89d38b43f0159f65a3795bf4cba84a695df92638dfe7693c25aa29d6f7fbc6ca`；Windows checkout 的 CRLF 原始字节 SHA-256 为 `5d6203b6621baa10516d0a362055822a20519247b6263a7103189acee1b77beb` |
| 事务结果 | 48/48 更新并提交；事务内非 version payload 逐行不变断言通过 |
| 写入后快照 UTC | `2026-07-20 01:31:28.643294` |
| 写入后 history | 48 rows；48 unique versions；48 unique names；0 timestamp；48 aligned；`00001–00048` 精确完整 |
| Name/statements digest | `3566222cba075216b6c9a0d3065b7b93`（不变） |
| Ordered history digest | `726c033e6386ad7e759c0545a467b8d9` |
| 写入后运行中任务 | 0 |
| Canonical catalog | 14/14 count 与 digest 和写入前逐项一致 |

完整 48 行 version/name/statement count/statement chars/MD5 见 [Staging postcheck 证据](evidence/2026-07-20-opt4-staging-history-postcheck.md)。

### 固定 CLI 验证边界

- 仓库固定 CLI 实测版本：`2.109.1`。
- Supabase 官方连接器从真实 Staging 直接返回 48 条远端 migration，version 精确为 `00001–00048`，与仓库文件前缀一一对应。
- 新环境没有 Supabase CLI platform access token，直接 `supabase link` 明确返回 `LegacyPlatformAuthRequiredError`；没有把 token 或数据库密码写入仓库，也没有为了验证额外重置 Staging 密码。
- 为验证固定 CLI 的实际比较与 dry-run 行为，使用 PostgreSQL `17.10` 创建一次性 history 镜像，写入官方连接器刚返回的远端 version 集合。`supabase migration list --db-url ...` 输出 48/48 local=remote；`PGSSLMODE=disable supabase db push --dry-run --db-url ...` 返回 `Remote database is up to date.`。临时数据库随后已停止并删除。
- 这证明 CLI `2.109.1` 对当前 48 个 version 的判断为完全对齐，同时如实保留“CLI 未直接连接远端”的证据边界，交由指定独立审查决定是否需要额外凭据门禁。

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

## 已执行脚本与本地验证

- 维护脚本：`docs/reports/sql/2026-07-18-opt4-staging-history-version-realignment.sql`
- SHA-256：`89d38b43f0159f65a3795bf4cba84a695df92638dfe7693c25aa29d6f7fbc6ca`
- Supabase CLI：仓库精确固定 `2.109.1`
- 本机 PostgreSQL：`17.10`
- 一次性测试库：首次执行 48/48 更新成功，最终 version 为 `00001–00048`；第二次执行被 timestamp 基线门禁拒绝（exit 3）；测试库已删除。

脚本只在单一事务中更新 `supabase_migrations.schema_migrations.version`。它不会执行任何 Migration SQL，不会改 public Schema，不会使用 `db push` 或 `--include-all`。

## 验收门禁结果

1. ✅ 执行前确认 Staging 项目 ID、健康状态、48 条 timestamp 基线和 0 个运行中同步任务。
2. ✅ 执行维护脚本并保存 48 条 postcheck 输出。
3. ✅ Name/statements digest 仍为 `3566222cba075216b6c9a0d3065b7b93`；所有非 version payload 由事务内断言证明不变。
4. ✅ 14 组 canonical catalog count/digest 与写入前逐项一致。
5. ⚠️ 固定 CLI `2.109.1` 已对真实远端 version 集合的同构镜像取得 48 条精确一致和 `Remote database is up to date.`；真实 Staging 由官方连接器直接证明 48 条 version 精确一致，但本机 CLI 因缺少 platform access token 未直接连接远端。
6. ✅ 指定审查会话已独立复验 PASS；本项只证明 Staging 子阶段。Production 后续执行仍由其专用 preflight、脚本、postcheck 与最终独立审查负责。
