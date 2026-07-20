# Current Task Packet

## Task ID

**OPT-5-DATABASE-LEAST-PRIVILEGE-HARDENING — STAGING POSTCHECK PASS / PRODUCTION PENDING**

## 依赖与历史检查点

- OPT-4 已在 base `ed203f1fadd8ef485fa2e86d29c020a7449d753a`、head `1a914bd0948975e3de3eb929a9220d90a2203dd7` 获指定审查会话 `OPT-4 FINAL PASS`。
- Draft PR #7 的 CI run `29714460569` 中 quality 与 PostgreSQL job 全绿；Vercel Preview `dpl_FfeeXgiXMkE2eVYUjyjseQkhZHjK` 为 READY 且绑定同一 head。
- Production 与 Staging 的 Migration history 均为精确 `00001–00048`；本任务只能新增 00049+ 前向 Migration，不修改或重放 00001–00048。
- 用户已对 OPT-5/OPT-6 既定路线给出持续授权；每阶段仍必须完整验证并由指定审查会话明确 PASS 后才能进入下一阶段。

OPT-4 详细证据：[Production 主报告](../reports/2026-07-18-opt4-production-verification.md)；[Production postcheck](../reports/evidence/2026-07-20-opt4-production-history-postcheck.md)；[Staging history 对齐报告](../reports/2026-07-18-opt4-staging-history-version-realignment.md)

## 目标

通过最小、前向、可验证的权限变更消除高信号数据库安全告警，同时保持现有 Admin/Operator/RLS、Auth trigger、系统同步与 provider token lease 行为不变。

## 已确认只读基线

- `get_user_role()` 为 `SECURITY DEFINER` 且已固定空 `search_path`；RLS 依赖 authenticated 执行，但 anon/PUBLIC 直接执行没有业务必要。
- `handle_new_user()` 为 Auth 用户创建 trigger 的 `SECURITY DEFINER` 函数且已固定空 `search_path`；普通 API 角色无需直接执行。
- `update_updated_at_column()`、`update_shipment_external_updated_at()`、`check_operator_profile_update()`、`update_user_role_protected(...)`、`toggle_user_active_protected(...)` 尚未固定 `search_path`。
- `check_operator_profile_update()` 内部存在未限定的 `get_user_role()` 调用，固定空 `search_path` 时必须同步改成 `public.get_user_role()`。
- 两个用户管理 RPC 为 `SECURITY INVOKER`，应用通过 authenticated 会话调用，必须保留 authenticated EXECUTE 与 `auth.uid()` 身份绑定，不得切换为 `SECURITY DEFINER`。
- `provider_token_cache` 已启用 RLS、无 anon/authenticated policy；服务端实现只调用三个 service-role-only `SECURITY DEFINER` lease RPC，没有直接表访问调用点。需验证后撤销不必要的直接表权限，不新增普通用户 policy。
- Production Security Advisor 基线为 22 条（1 INFO / 21 WARN）：5 条 mutable search path、2 条匿名可执行 definer、既有 intentional authenticated definer、`pg_trgm` public extension 与 leaked-password protection disabled 等。不得以“清零告警”为理由改变正确的 RLS/RPC 语义。

## 当前允许范围

- 逐函数记录 owner、SECURITY 模式、search_path、EXECUTE grantee、调用角色、内部提权、RLS 依赖和真实调用点。
- 新增一个 00049+ 前向 Migration，固定安全 `search_path`、限定对象 schema、收紧不必要的 PUBLIC/anon/authenticated/service_role EXECUTE 与 `provider_token_cache` 直接表权限。
- 新增/更新静态与 PostgreSQL 17 契约测试，覆盖匿名、未登录、活跃 Admin、活跃 Operator、disabled user、跨仓 Operator、service_role/系统触发器。
- 先在 Staging 应用并完成 postcheck；确认行为、ACL、RLS、Advisor 与 Migration history 正确后，再在 Production 应用同一 Migration 并复核。
- 评估 leaked-password protection 的兼容性和平台配置边界；若无法从受控工具安全配置，则记录为明确残余项，不索取或保存密码/token。
- 更新 `docs/current-state.md`、数据库设计、路线图、主报告、evidence 与所有必要索引。

## 当前禁止范围

- 禁止修改、删除或重放 00001–00048；禁止 history repair、`--include-all` 或伪造对象状态。
- 禁止关闭 RLS、扩大 anon/authenticated/service_role 权限或把现有 invoker RPC 批量切为 definer。
- 禁止为消除 Advisor 警告而破坏经验证的 authenticated RPC、仓库隔离、Auth trigger、同步原子性或 Token lease 模型。
- 禁止移动 `pg_trgm`、批量重构全部 `SECURITY DEFINER` 函数或处理 OPT-6 的 policy/performance/lint 范围。
- 禁止触碰用户既有同步脚本、`.claude` 状态与项目总结。
- 禁止进入 OPT-6，直至 OPT-5 完整证据提交指定审查会话并得到明确 PASS。

## 执行顺序

1. ✅ 完成 Production/Staging 只读权限矩阵、调用点、Advisor 与对象摘要基线。
2. ✅ 编写 00049 Migration 与静态/PostgreSQL 契约测试；一次性 PostgreSQL 17 连续重放 00001–00049，合并 contract 27/27 PASS。
3. ✅ 默认测试 3939/3939、lint 0/31、TypeScript/build、PostgreSQL concurrency 44/44、contract 27/27 已通过；提交前继续复核 `git diff --check`、链接/索引/secret/orphan。
4. ✅ 提交并推送独立 OPT-5 分支；Draft PR #8 exact-head CI/Vercel Preview 全绿。
5. ✅ 在 Staging 应用相同 Migration，保存 before/after ACL、function、RLS、身份矩阵、Advisor 与 history evidence。
6. Staging 全绿后在 Production 应用同一 Migration并保存等价 postcheck；若出现行为或摘要漂移立即停止，不进入下一环境/阶段。
7. 把实际变更、时间/环境、命令类别、PR/commit/CI/deployment/远端证据、停止门与残余风险写入项目树并建立索引。
8. 正式移交指定审查会话；CHANGES_REQUIRED 时只在 OPT-5 范围返工，明确 PASS 前不进入 OPT-6。

实施记录：[OPT-5 数据库最小权限收口报告](../reports/2026-07-20-opt5-database-least-privilege.md)；[Staging postcheck evidence](../reports/evidence/2026-07-20-opt5-staging-postcheck.md)

## 验收标准

- 所有目标函数固定安全 `search_path`，函数体中的非系统对象均显式限定 schema。
- Auth trigger 与普通触发器继续正常执行，但无法被不需要的 API 角色直接调用。
- `get_user_role()` 保持 RLS 所需 authenticated 行为，anon/PUBLIC 不可执行；disabled/未登录返回空权限语义不变。
- 用户管理 RPC 仍为 invoker，仅 authenticated 可调用，身份绑定、最后管理员保护和 RLS 行为不变。
- `provider_token_cache` 无 anon/authenticated policy 且普通角色无表权限；service_role 只能通过已审计 lease RPC 完成系统调用。
- Admin/Operator/disabled/cross-warehouse/service_role 身份矩阵通过，18/18 public tables RLS enabled 与既有 policy/trigger 语义不变。
- 新 Migration 可从空库按顺序重放，并在 Staging、Production 只应用一次；两环境 history、Schema/ACL 摘要与目标证据一致。
- 默认测试、lint、build/TypeScript、PostgreSQL concurrency/contract、PR/CI、Vercel Preview、`git diff --check`、文档链接/索引、secret/orphan 检查全部通过。
- 指定审查会话明确给出 `OPT-5 PASS`；在此之前不得标记 DONE 或进入 OPT-6。
