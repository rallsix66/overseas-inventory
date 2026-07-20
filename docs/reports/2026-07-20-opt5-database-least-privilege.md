# OPT-5 数据库最小权限收口报告

## 当前结论

状态：`IMPLEMENTED / FULL POSTCHECK PASS / FINAL REVIEW PENDING`。

2026-07-20 已完成两环境只读权限基线、调用点审计、00049 前向 Migration、静态契约和 PostgreSQL 17 行为测试。Draft PR #8 的 exact-head CI 已全绿；Staging 与 Production 均已完成 00049、canonical history、ACL/RLS、rollback-only 行为探针和 Advisor postcheck。当前只剩项目树/远程门最终复核与指定会话独立审查。

## 范围

- Migration：[00049_database_least_privilege_hardening.sql](../../supabase/migrations/00049_database_least_privilege_hardening.sql)
- 静态契约：`src/features/database/opt5-least-privilege-migration.test.ts`
- PostgreSQL 权限契约：`src/features/database/opt5-least-privilege.postgres.test.ts`
- 00001–00049 连续重放：`src/features/database/migrations-00001-00049-replay.postgres.test.ts`
- Production：`hzlhqyditalumhnxbaim`
- Staging：`hyarhvsjhkjpallbyifn`
- Staging 证据：[2026-07-20-opt5-staging-postcheck.md](evidence/2026-07-20-opt5-staging-postcheck.md)
- Production 证据：[2026-07-20-opt5-production-postcheck.md](evidence/2026-07-20-opt5-production-postcheck.md)
- history-only 规范化脚本：[2026-07-20-opt5-00049-history-normalization.sql](sql/2026-07-20-opt5-00049-history-normalization.sql)

不在本阶段处理：`pg_trgm` extension 迁移、intentional authenticated `SECURITY DEFINER` RPC 批量改写、OPT-6 policy/performance/lint、旧 Migration 修改或重放。Supabase 接口生成的单条 00049 时间戳 history 已用单事务规范为仓库的固定宽度 version/name；这一步只改新行元数据并有独立证据，不构成旧 history repair。

## Staging 结果

- 项目 `ACTIVE_HEALTHY`、PostgreSQL 17.6；即时 preflight 为精确 `00001–00048`、0 个运行中同步任务、18/18 RLS、42 policy、13 trigger。
- Migration 成功执行一次；接口生成的 timestamp history 随后由严格门禁脚本只改为 `00049 / 00049_database_least_privilege_hardening`。最终为 49 rows / 49 unique version/name，statement payload 未变。
- 目标 ACL/search path 全部命中；service_role 无 token-cache 直接表权限但 lease RPC 实际可用。Admin、Operator、Auth trigger、timestamp trigger 与 token lease 的事务回滚探针 PASS，残留 0。
- 除十个预期目标函数外，Staging 与尚未写入的 Production 在 column、constraint、function、index、policy、table/RLS、trigger 七类 canonical count/digest 全部相同。
- Security Advisor 从 22 降至 14（1 INFO / 13 WARN）；Performance WARN 保持 121，新增十项仅为动态 unused-index INFO。

完整数值、摘要和停止门见 [Staging postcheck evidence](evidence/2026-07-20-opt5-staging-postcheck.md)。

## Production 结果

- 即时 preflight 为 `ACTIVE_HEALTHY`、PostgreSQL 17.6、精确 `00001–00048`、0 个运行中同步任务、目标 ACL 与 Advisor 基线无漂移。
- 同一 00049 和同一 history-only 门禁成功；最终两环境均为 49/49、`00001–00049`，version/name digest 相同。
- 两环境全部 75 个函数及 column、constraint、index、policy、table/RLS、trigger 的 canonical count/digest 逐项一致；目标权限矩阵完全相同。
- Production 现有 token-cache 1 行在 Migration 和五类回滚探针后保持同一 secret-safe digest；无 probe 残留。
- Security Advisor 为 14（1 INFO / 13 WARN），与 Staging 相同；Performance 仍为 158（37 INFO / 121 WARN），与 Production preflight 相同。

完整证据见 [Production postcheck evidence](evidence/2026-07-20-opt5-production-postcheck.md)。

## 2026-07-20 只读基线

两环境现场结果逐项一致：

- PostgreSQL 17.6；Migration history 精确为 `00001–00048`。
- 目标 10 个函数的 owner 均为 `postgres`，定义 MD5、SECURITY 模式、search_path 和 ACL 完全一致。
- `get_user_role()` 与 `handle_new_user()` 为 `SECURITY DEFINER`、空 `search_path`，但 PUBLIC/anon/authenticated/service_role 均可直接 EXECUTE。
- `update_updated_at_column()`、`update_shipment_external_updated_at()`、`check_operator_profile_update()`、`update_user_role_protected(...)`、`toggle_user_active_protected(...)` 的 `proconfig` 为空，对应 5 条 mutable search-path Advisor。
- 两个用户管理 RPC 为 `SECURITY INVOKER`，authenticated 可执行，anon 不可执行，service_role 仍有默认 EXECUTE。
- `provider_token_cache` 为 RLS enabled、0 policy；anon/authenticated 无表权限，service_role 有 7 项直接表权限。三个 token lease RPC 已固定空 `search_path` 且仅 postgres/service_role 可执行。
- `src/lib/providers/golucky/token-cache.ts` 只调用三个 lease RPC，没有直接 `.from('provider_token_cache')` 路径。因此移除 service_role 直接表权限不会改变应用调用链，并能强制 lease ownership 规则。
- Production Security Advisor 基线 22 条（1 INFO / 21 WARN）。本阶段目标是消除 5 条 mutable search path 与 `get_user_role()`/`handle_new_user()` 的不必要匿名或直接调用面；不以总数清零替代逐函数语义审计。

## 00049 实施内容

文件 SHA-256：`0338ad6312bfb2c418da3599ec2cc5bad893ca26dca370b4068a25ec21c277ae`；160 行 / 6411 chars。

1. 为 4 个既有函数用 `ALTER FUNCTION ... SET search_path = ''` 固定路径；只重建 `check_operator_profile_update()`，把内部调用限定为 `public.get_user_role()` 并保持 `SECURITY INVOKER`。
2. `get_user_role()` 保留 authenticated EXECUTE，撤销 PUBLIC/anon/service_role；它仍为 RLS 所需的 `SECURITY DEFINER`。
3. `handle_new_user()` 与三个普通 trigger function 撤销所有 API/system role 的直接 EXECUTE；触发器绑定保持不变。
4. 两个用户管理 RPC 继续为 authenticated-only `SECURITY INVOKER`，撤销 service_role 默认 EXECUTE；`auth.uid()`、活跃 Admin、最后管理员与事务锁逻辑不变。
5. 撤销 service_role 对 `provider_token_cache` 的全部直接表权限；三个 service-role-only `SECURITY DEFINER` lease RPC 保持唯一应用访问路径。
6. 使用 5 秒 lock timeout、30 秒 statement timeout、对象存在前置门禁和 ACL 后置断言；不修改 RLS policy、业务表、业务数据或函数 SECURITY 模式。

## 本地验证

- 静态 00049 契约：7/7 PASS。
- 首轮 PostgreSQL 权限契约：22/23；唯一失败是测试夹具没有模拟远端 `role` 表 UPDATE grant，而历史 `JOIN ... FOR UPDATE` 会锁定 join 中的 role 行。现场只读查询确认两环境均存在该默认 grant；夹具校准为真实 grants 与 RLS 后重跑。
- 校准后 PostgreSQL contract：3 files / 27 tests PASS：
  - 00001–00049 从 Supabase-like 空库连续重放；
  - 00041–00048 既有 replay/RPC/RLS contract；
  - 00049 ACL、触发器、Admin/Operator/disabled/anon/service_role 和 token lease behavior。
- lint：0 errors / 31 warnings；没有新增 warning。
- 默认测试：92 files / 3939 tests PASS。
- Next.js 16.2.9 build 与应用 TypeScript PASS；仅保留已记录的 workspace-root 与 Turbopack NFT trace warning。
- PostgreSQL concurrency：44/44 PASS；最终数据库 contract：3 files / 27 tests PASS。
- `git diff --check` PASS。
- 三个一次性 PostgreSQL 17 cluster 均在各轮验证后停止并删除。

## 安全语义与残余项

- authenticated 直接调用 `get_user_role()` 仍会被 Advisor 标记为 signed-in `SECURITY DEFINER`，但这是 RLS policy 的必要执行权，不应为了消除警告撤销。
- 其他 authenticated definer RPC（同步查询、仓库绑定、喜运达操作）有独立身份/RLS 语义。本次记录定义与 ACL 摘要但不批量改写；必须逐函数另行证明才能收紧。
- `provider_token_cache` 的 0 policy Advisor 是刻意设计：普通用户无表权限，service_role 只能经 definer lease RPC；不应新增 anon/authenticated policy。
- leaked-password protection 是本阶段未处理的 Auth 平台配置 residual。Staging 与 Production 的 00049 已完成，但受控连接器没有 Auth 配置写接口，因此本阶段未改该设置；后续平台配置/OPT-6 需单独评估启用影响并完成登录回归。本阶段未索取或保存任何凭据。
- `update_user_role_protected()` 的历史 `JOIN ... FOR UPDATE` 会同时要求/锁定 role 行；远端 grants 与 RLS 当前支持该行为。本阶段不改变业务函数，后续如优化必须单独证明并发和最后管理员语义。

## 下一停止门

1. 完成默认测试、build、并发与全部 PostgreSQL contract。
2. 提交独立 OPT-5 PR，确认最新 head CI/Vercel Preview 全绿。
3. ✅ Staging 应用 00049，保存 migration、函数/ACL、trigger、RLS/policy、身份矩阵、token lease 与 Advisor postcheck。
4. ✅ 在 Production 应用同一 Migration 与 history 规范化门禁；等价 postcheck 全绿。
5. 两环境证据、项目树索引、secret/orphan 检查与最终 PR/CI 完成后移交指定审查会话。明确 `OPT-5 PASS` 前禁止进入 OPT-6。
