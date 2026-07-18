# Current Task Packet

## Task ID

**OPT-2-TEST-COVERAGE — CODE COMPLETE / PR CI PASS / STAGE REVIEW PENDING**

路线图：[system-optimization-roadmap-2026-07-17.md](system-optimization-roadmap-2026-07-17.md)

上一阶段：OPT-1 已通过独立终审，PR #3 已合并；`master` GitHub Actions run `29626065160` 的质量与 PostgreSQL 并发 job 均通过。

## 目标

保留现有静态架构护栏，同时把 P1、P7、首页和仓库权限的关键结论升级为隔离 PostgreSQL 中的真实 Migration、RPC 与 RLS 行为验证。

## 依赖与事实

- 仓库固定包含 00001–00047，共 47 个已执行 SQL Migration；本 Task 不修改任何 Migration SQL。
- OPT-1 已提供 PostgreSQL 17 GitHub Actions service，现有并发套件为 44/44。
- 00013/00014 的两个测试此前未被 `vitest.config.mts` 扫描。
- 本机没有可用 Docker/PostgreSQL；数据库行为结果已由 PR #4 run `29626976756` 的隔离 PostgreSQL job 给出，不允许改连 Production/Staging。
- Supabase 官方测试建议覆盖不同角色、负向权限和实际返回数据，并在 CI 中运行。

## 允许修改范围

- `vitest.config.mts`
- `package.json`
- `.github/workflows/ci.yml`
- `supabase/migrations/00013_extend_user_variant_preference_favorited.test.ts`
- `supabase/migrations/00014_dynamic_alert_fields.test.ts`
- `src/features/database/*.postgres.test.ts`
- 与本 Task 状态直接相关的文档

## 实施要求

1. 把 00013/00014 两个测试显式纳入默认 Vitest；测试必须匹配真实 Migration 契约，禁止为了通过而修改已执行 SQL。
2. 在隔离 PostgreSQL 17 中按顺序执行仓库原文件 00041–00047，不复制函数正文到测试替身。
3. 验证 00041/00042 Schema effect、00043–00047 函数存在性、`SECURITY INVOKER` 和 anon/authenticated ACL。
4. 对 `forecast_stockout`、P1 补货/在途、P7 列表/详情、首页健康度执行真实 RPC 查询。
5. 身份矩阵至少覆盖活跃 Admin、仅分配单仓的活跃 Operator、disabled user、anon、跨仓访问；权限断言必须检查返回行集或明确拒绝。
6. PostgreSQL 测试与现有并发测试串行运行，避免共享 `public` schema 竞争。
7. 保留已有页面不直连 Supabase、客户端无 `service_role`、Repository/Server Action 边界与 Migration 不回改等静态护栏。

## 非目标

- 不修改 00001–00047 的 Migration SQL、RPC 或 RLS。
- 不连接或写入 Supabase Production/Staging。
- 不执行 `supabase migration repair`、`supabase db push` 或 Vercel deploy/promote。
- 不进入 OPT-3 Production Migration 基线审计。
- 不清理现有 31 个 lint warning。
- 不提交 `.claude/context-status.json`、同步脚本、运行产物或用户已有未提交文件。

## 验收标准

- 默认测试包含 00013/00014，且全部通过。
- PostgreSQL job 明确显示现有 44 项并发测试与新增 Migration/RPC/RLS 行为步骤。
- 00041–00047 真实 SQL 在 PostgreSQL 17 顺序执行成功。
- Admin 可见全部测试仓；Operator 只看分配仓；disabled 与 anon 无数据或被拒绝；跨仓详情被拒绝。
- P1、P7、首页断言检查真实 JSON 返回行集及关键边界，不仅匹配源码文本。
- lint 为 0 error / 31 warning，build 与 `git diff --check` 通过。
- 变更集不混入排除文件。
- 指定独立审查会话给出 PASS；PR 合并且 `master` CI 通过后才可标记 OPT-2 DONE。

## 实施与远程结果（2026-07-18）

- 默认测试：90 files / 3926 tests PASS。
- lint：0 error / 31 warning；build / TypeScript PASS；`git diff --check` PASS。
- PostgreSQL job：现有并发测试 44/44 PASS；新增 Migration replay / RPC / RLS 行为测试 10/10 PASS。
- GitHub Actions run：`29626976756`；质量 job 与 PostgreSQL job 均 PASS。
- Vercel Git 集成 Preview PASS；未执行手动 deploy/promote。
- 未连接 Production/Staging，未修改 00001–00047 Migration SQL。

## 验证命令

```bash
npm run test
npm run lint -- --max-warnings 31
npm run build
npm run test:concurrency
npm run test:database-contract
git diff --check
git status --short
```

数据库命令只允许指向本地或 GitHub Actions 临时 PostgreSQL。

## 停止条件

完成代码、本地可运行质量门、PR 隔离 PostgreSQL 验证和阶段独立审查后停止。未取得审查 PASS、PR merge 与 `master` CI PASS 前，不得切换 OPT-3。
