# Current Task Packet

## Task ID

`P4-U5` — 用户模块安全与流程验收

## 状态

**DONE — 返工完成**（2026-07-01）

## 依赖

- P4-U4 DONE（启用/禁用用户账号）

## 范围

### 1. 文档清理

- 清理 `docs/current-state.md` Current Task References：P5-SY11/P5-SY12/P5-SY9/P5-SY10 → Phase 4 用户模块核心文件 + P4-U5 验收关注点 ✅
- 清理尾部重复旧 Last Updated（仍写 P4-U1 的段落） ✅

### 2. 安全审计

对用户模块执行全链路安全与流程验收：

| 审计项 | 项目 | 结果 |
|---|---|---|
| 访问控制 | `/dashboard/users` page.tsx → `getCurrentActiveUser()` → `roleName !== 'admin'` → 无权限提示 | ✅ |
| 读操作 | `listUsers` / `getUserById` / `listRoles` — `requireActiveAuth()` + Admin-only + Zod safeParse | ✅ |
| 写操作 | `updateUserRole` / `toggleUserActive` — Admin-only + Zod + RPC 原子保护 | ✅ P4-U5 强化 |
| 客户端组件 | `UserDetailSheet` / `UserRoleChangeDialog` / `UserActiveToggleDialog` — 不直接访问 Supabase/service_role/auth.admin | ✅ |
| RLS | role 表 admin_all + operator_select；profiles 表 admin_all + operator_select + operator_update_own + user_read_own | ✅ |
| 错误处理 | 所有 action 捕获 UserError → ActionResult；所有 RPC RAISE EXCEPTION 中文消息 | ✅ |

### 3. 竞态修复（首次）

**发现**：`updateUserRole` 和 `toggleUserActive` 存在 TOCTOU 竞态条件：
- `countByRole('admin')` 检查与数据库写入非原子
- 两个管理员可同时互相禁用/降级 → 均通过 count 检查 → 0 管理员

**修复**：新增 Migration 00024（`update_user_role_protected` / `toggle_user_active_protected` RPC）：
- `pg_advisory_xact_lock(987654321)` 序列化所有 Admin 写操作
- `FOR UPDATE` 锁定目标 profile 行
- SECURITY INVOKER（不绕过 RLS）
- 所有业务规则（自保护 + 最后管理员保护）收口至 RPC 原子执行

### 4. 返工：RPC 权限缺口修复（Migration 00025）

**发现**：00024 RPC 接受 `p_operator_user_id` 参数但未验证调用者身份：
- 未校验 `auth.uid() IS NOT NULL`（未登录也可调用）
- 未校验 `auth.uid() = p_operator_user_id`（可伪造操作者身份）
- 未校验调用者是否为活跃 Admin（Operator 可调用 RPC）
- 未 REVOKE EXECUTE FROM PUBLIC/anon（默认 PUBLIC 有 EXECUTE 权限）
- `operator_update_own_profile` RLS policy 的 WITH CHECK 中 `get_user_role()` 读取已提交行，无法阻止 operator 在 NEW 行中修改 role_id/is_active

**修复**：新增 Migration 00025（不修改 00024，CREATE OR REPLACE 叠加）：

| 加固项 | 实现 |
|---|---|
| 调用者身份绑定 | `auth.uid() IS NOT NULL` → 未登录拒绝「未登录，请先登录」 |
| 操作者一致性 | `auth.uid() = p_operator_user_id` → 不一致拒绝「操作者身份校验失败」 |
| 活跃 Admin 校验 | SELECT profiles JOIN role WHERE id = auth.uid() → 不存在/未启用拒绝「账号未启用或不存在」；非 admin 拒绝「仅管理员可执行此操作」 |
| 执行顺序 | auth.uid() 身份绑定在 `pg_advisory_xact_lock` 之前执行（锁前拦截无权限调用） |
| 权限加固 | REVOKE EXECUTE FROM PUBLIC, anon + GRANT EXECUTE TO authenticated |
| Operator 自升保护 | `check_operator_profile_update` BEFORE UPDATE 触发器：比较 OLD vs NEW role_id / is_active，operator 修改 → RAISE EXCEPTION |

### 5. 测试

`src/features/users/p5-u5-migration.test.ts` — 从 25 → 49 项测试（返工新增 24 项）：

| 分组 | 测试数 | 内容 |
|---|---|---|
| RPC 存在性 | 2 | update_user_role_protected / toggle_user_active_protected 定义 |
| 权限模型 | 2 | SECURITY INVOKER × 4+；不含 SECURITY DEFINER |
| REVOKE/GRANT | 4 | REVOKE FROM PUBLIC, anon × 2 + GRANT TO authenticated × 2 |
| auth.uid() 绑定（update RPC） | 6 | IS NOT NULL / = p_operator_user_id / 活跃 Admin 查询 / NOT FOUND 拒绝 / 非 admin 拒绝 / 锁前执行顺序 |
| auth.uid() 绑定（toggle RPC） | 6 | 同上 6 项 |
| 原子锁 | 2 | pg_advisory_xact_lock × 2；共用同一 lock ID |
| update RPC 业务规则 | 10 | 角色校验、自降级、FOR UPDATE、用户不存在、最后管理员保护、is_active count、原子写入、参数签名 |
| toggle RPC 业务规则 | 8 | 自禁用、FOR UPDATE、用户不存在、最后管理员保护、原子写入、参数签名 |
| operator trigger | 7 | 函数存在、SECURITY INVOKER、仅拦截 operator、禁止改 role_id、禁止改 is_active、BEFORE UPDATE 触发器、admin 不受限 |
| 中文错误 | 1 | 所有 RAISE EXCEPTION ≥ 10 条中文消息 |
| SQL 质量 | 3 | 不硬编码 role ID；不修改表结构；不修改 00024 |

### 6. 质量门

- `npm run test -- src/features/users/` — **219/219**（63 P4-U1 + 42 P4-U2 + 36 P4-U3 + 29 P4-U4 + 49 P4-U5 Migration）
- `npm run test` — **2174/2174**（57 文件，concurrency 与 best live 预存 env 依赖）
- `npm run lint` — **0 errors / 24 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **PASS**（LF/CRLF warning only）

## 禁止

- 不实现仓库分配
- 不新增权限模型
- 不修改 Product/ProductVariant/Inventory 结构
- 不修改已执行 Migration（00001~00024）
- 不新增业务功能

## 下一步

Phase 4 用户管理全模块完成（P4-U1~P4-U5）。后续：
- **P3-S5B**（Admin 部分入仓 / Admin 批量入仓）
- **P3-S1B**：CODE COMPLETE / BLOCKED_EXTERNAL

## 当前业务口径

Admin 维护在途和入仓、管理用户账号（列表 + 角色变更 + 启用禁用）；Operator 只读查看已分配仓库数据，不可访问用户管理。Admin 写操作受数据库层 `pg_advisory_xact_lock` + `auth.uid()` 身份绑定 + REVOKE/GRANT 权限加固 + operator trigger 四层保护。
