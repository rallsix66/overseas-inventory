# Current Task Packet

## Task ID

**OPT-3-PRODUCTION-MIGRATION-BASELINE — STAGE REVIEW PASS / USER CONFIRMATION PENDING**

路线图：[system-optimization-roadmap-2026-07-17.md](system-optimization-roadmap-2026-07-17.md)

上一阶段：OPT-2 已通过独立终审，PR #4 已合并；`master` GitHub Actions run `29627444830` 的质量、44/44 并发测试和 10/10 数据库行为测试全部通过。

## 目标

在不写 Production 的前提下，对 `00001–00040` 的历史与实际对象做可复核基线审计，为后续受控 history repair 和 00048+ 前向 Migration 提供唯一事实源。

## 允许范围

- 对 Supabase Production/Staging 执行 SELECT-only 目录查询。
- 新增只读审计 SQL 和审计报告。
- 更新当前状态、路线图和任务导航。
- 不修改任何 `supabase/migrations/*.sql`。

## 已完成事实

- Production 历史仅登记 00041–00047；Staging 登记 00001–00047。
- public Schema 的 Policy 42/42、Table/RLS 18/18、Trigger 13/13 完全一致。
- 精确差异只有：
  - Production 缺少 00010 的 `claim_sync_run_system(...)`，属于 `MISSING_REQUIRED`；
  - Production 没有 00011 的三列/FK/索引，属于已被 00012 替代的 `OBSOLETE_SUPERSEDED`。
- 00001–00040 汇总：28 `EXACT_PRESENT`、11 `OBSOLETE_SUPERSEDED`、1 `MISSING_REQUIRED`、0 `PRESENT_DIVERGENT`。
- Production 备份/PITR 为控制面信息，本次只读接口无法确认；这是进入 OPT-4 前的明确人工门槛。

详细证据：[2026-07-18-production-migration-baseline-audit.md](../reports/2026-07-18-production-migration-baseline-audit.md)

## 硬性边界

- 禁止 Production DDL/DML。
- 禁止 `supabase migration repair`、`supabase db push`。
- 禁止重放 00001–00040。
- 禁止修改 00001–00047。
- 禁止开始 OPT-4，直到独立审查 PASS、用户确认报告并在 Supabase 控制台确认恢复点。

## 验收标准

- 只读 SQL 不包含 DDL/DML/repair/push。
- 报告包含 Production/Staging 身份、时间、Migration 历史、对象级证据、排除已知差异后的零差异证明、00001–00040 逐条分类、风险、回滚和后续建议。
- Trigger canonical digest 包含 `pg_trigger.tgenabled`，不能把 disabled/replica/always 状态误判为一致。
- 缺失必需对象与废弃对象不混淆：00010 必须前向补齐，00011 不得在 Production 复活。
- `git diff --check` 通过，变更集不包含用户既有同步脚本、`.claude` 状态或项目总结。
- 指定独立审查会话给出 PASS。

## 停止条件

阶段审查 PASS 后停止并等待用户确认报告与 Production 备份/PITR。不得自行提交 Production 变更或进入 OPT-4。
