# Current Task Packet

## Task ID

`P4-U5` — 用户模块安全与流程验收

## 状态

**DONE**（2026-07-01）

## 依赖

- P4-U4 DONE（启用/禁用用户账号）

## 范围

### 1. 文档清理

- 清理 `docs/current-state.md` Current Task References：P5-SY11/P5-SY12/P5-SY9/P5-SY10 → Phase 4 用户模块核心文件 + P4-U5 验收关注点
- 清理尾部重复旧 Last Updated（仍写 P4-U1 的段落）

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

### 3. 竞态修复

**发现**：`updateUserRole` 和 `toggleUserActive` 存在 TOCTOU 竞态条件：
- `countByRole('admin')` 检查与数据库写入非原子
- 两个管理员可同时互相禁用/降级 → 均通过 count 检查 → 0 管理员

**修复**：新增 Migration 00024（`update_user_role_protected` / `toggle_user_active_protected` RPC）：
- `pg_advisory_xact_lock(987654321)` 序列化所有 Admin 写操作
- `FOR UPDATE` 锁定目标 profile 行
- SECURITY INVOKER（不绕过 RLS）
- 所有业务规则（自保护 + 最后管理员保护）收口至 RPC 原子执行

**代码变更**：
- `repository.ts`：`updateRole()` / `toggleActive()` 改为调用 RPC（新增 `operatorId` 参数）
- `actions.ts`：简化为 Auth + Zod + RPC 调用（移除冗余的业务规则检查）
- 现有测试全部更新（P4-U1/P4-U2/P4-U3/P4-U4 回归通过）

### 4. 测试

新增 `src/features/users/p5-u5-migration.test.ts` — 25 项测试：

| 分组 | 测试数 | 内容 |
|---|---|---|
| RPC 存在性 | 2 | update_user_role_protected / toggle_user_active_protected 定义 |
| 权限模型 | 2 | SECURITY INVOKER × 2；不含 SECURITY DEFINER |
| 原子锁 | 2 | pg_advisory_xact_lock 存在；两个 RPC 共用同一 lock ID |
| update RPC 规则 | 10 | 角色校验、自降级、FOR UPDATE、用户不存在、最后管理员保护（降级+count+is_active）、原子写入、参数签名 |
| toggle RPC 规则 | 8 | 自禁用、FOR UPDATE、用户不存在、最后管理员保护（禁用+count）、原子写入、参数签名 |
| 中文错误 | 1 | 所有 RAISE EXCEPTION 中文消息 |
| SQL 质量 | 2 | 不硬编码 role ID；不修改表结构 |

### 5. 质量门

- `npm run test -- src/features/users/` — **195/195**（63 P4-U1 + 42 P4-U2 + 36 P4-U3 + 29 P4-U4 + 25 P4-U5 Migration）
- `npm run test` — **2150/2150**（57 文件，concurrency 与 best live 预存 env 依赖）
- `npm run lint` — **0 errors / 24 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **PASS**（LF/CRLF warning only）

## 禁止

- 不实现仓库分配
- 不新增权限模型
- 不修改 Product/ProductVariant/Inventory 结构
- 不修改已执行 Migration（00001~00023）
- 不新增业务功能

## 下一步

Phase 4 用户管理全模块完成（P4-U1~P4-U5）。后续：
- **P3-S5B**（Admin 部分入仓 / Admin 批量入仓）
- **P3-S1B**：CODE COMPLETE / BLOCKED_EXTERNAL

## 当前业务口径

Admin 维护在途和入仓、管理用户账号（列表 + 角色变更 + 启用禁用）；Operator 只读查看已分配仓库数据，不可访问用户管理。Admin 写操作受数据库层 `pg_advisory_xact_lock` 原子保护。
