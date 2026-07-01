# Current Task Packet

## Task ID

`P4-U3` — 修改用户角色

## 状态

**DONE**（2026-07-01）

## 依赖

- P4-U2 DONE — 返工完成（用户列表只读页面）

## 范围

### 1. UI 入口

- 用户详情 Sheet（`UserDetailSheet`）角色行新增"修改角色"按钮
- 点击后弹出 `UserRoleChangeDialog`（shadcn/ui Dialog）确认对话框
- 当前角色不可重复提交（过滤掉相同 roleId）
- 提交中显示 Loader2 pending 状态，按钮禁用
- 成功后关闭 Sheet + `router.refresh()` 刷新页面列表
- 失败时展示 `updateUserRole` 返回的中文错误（自降级、最后管理员保护、角色不存在、权限不足等）
- 不加入 toggleUserActive，不实现启用/禁用

### 2. 权限与架构

- 写操作只通过 `updateUserRole` Server Action
- 页面和客户端组件不直接调用 `supabase.from` / `supabase.rpc` / `auth.admin` / `createServiceClient`
- 不新增 service_role 使用点
- 不绕过 P4-U1 的自保护与最后管理员保护逻辑
- Operator 仍不能访问 `/dashboard/users`，也不能触发写操作

### 3. 文件

- `src/features/users/components/user-role-change-dialog.tsx` — 新建 Dialog 组件
- `src/features/users/components/user-detail-sheet.tsx` — 新增角色修改按钮 + 对话框集成
- `src/app/dashboard/users/_components/users-page-content.tsx` — 透传 roles prop 给 Sheet

### 4. 测试

新增 `src/features/users/p4-u3.test.ts` — 35 项测试：

| 分组 | 测试数 | 内容 |
|---|---|---|
| 架构合规 | 6 | 所有新增/修改文件不直接访问 supabase/service_role |
| 导入控制 | 4 | Sheet/Dialog 不导入 toggleUserActive；page/content 不导入 updateUserRole/toggleUserActive |
| Dialog 行为 | 6 | 过滤当前角色、确认按钮禁用、pending 状态、错误展示、成功回调、关闭重置 |
| Sheet 集成 | 5 | 接受 roles prop、"修改角色"按钮、roleDialogOpen 状态、router.refresh()、无启用/禁用按钮 |
| 透传 | 2 | UsersPageContent 传递 roles；不导入写操作 actions |
| 权限控制 | 2 | page.tsx roleName 校验；actions updateUserRole Admin-only |
| P4-U1 回归 | 4 | 自降级保护、最后管理员保护、toggleUserActive 未变、updateRole .select+single |
| P4-U2 回归 | 7 | listUsers/listRoles 仍存在、listRoles throw、筛选栏、分页、空数据、getUserById、loading/error/cancelled |

### 5. 质量门

- `npm run test -- src/features/users/` — **140/140**（63 P4-U1 + 42 P4-U2 + 35 P4-U3）
- `npm run test` — **2095/2095**（55 文件，concurrency 与 best live 预存 env 依赖）
- `npm run lint` — **0 errors / 24 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **PASS**（LF/CRLF warning only）

## 禁止

- 不做账号启用/禁用
- 不做仓库分配
- 不新增 Migration
- 不修改已执行 Migration
- 不引入新权限模型
- 不进入 P4-U4

## 下一步

- **P4-U4**（启用/禁用）：已解除阻塞。可复用 `toggleUserActive` action + P4-U3 页面模式。
- **P3-S5B**（Admin 部分入仓 / Admin 批量入仓，按需拆分）。
- **P3-S1B**：CODE COMPLETE / BLOCKED_EXTERNAL。

## 当前业务口径

Admin 维护在途和入仓、管理用户账号；Operator 只读查看已分配仓库数据，不可访问用户管理。
