# Current Task Packet

## Task ID

`P4-U4` — 启用/禁用用户账号

## 状态

**DONE**（2026-07-01）

## 依赖

- P4-U3 DONE — 返工完成（修改用户角色）

## 范围

### 1. UI 入口

- 用户详情 Sheet（`UserDetailSheet`）状态行新增"启用"/"禁用"按钮
- 按钮文案根据当前状态切换（启用中显示"禁用"，已禁用显示"启用"）
- 点击后弹出 `UserActiveToggleDialog`（shadcn/ui Dialog）确认对话框
- 区分启用/禁用文案（"禁用后该用户将无法登录系统"/"启用后该用户将恢复系统访问权限"）
- 提交中显示 Loader2 pending 状态，按钮禁用
- 成功后关闭 Sheet + `router.refresh()` 刷新页面列表
- 失败时展示 `toggleUserActive` 返回的中文错误（自禁用、最后管理员保护、权限不足等）
- 不实现仓库分配，不修改权限模型

### 2. 权限与架构

- 写操作只通过 `toggleUserActive` Server Action
- 页面和客户端组件不直接调用 `supabase.from` / `supabase.rpc` / `auth.admin` / `createServiceClient`
- 不新增 service_role 使用点
- 不绕过 P4-U1 的自保护与最后管理员保护逻辑
- Operator 仍不能访问 `/dashboard/users`，也不能触发写操作

### 3. 文件

- `src/features/users/components/user-active-toggle-dialog.tsx` — 新建 Dialog 组件
- `src/features/users/components/user-detail-sheet.tsx` — 新增启用/禁用按钮 + 对话框集成
- `src/features/users/p4-u4.test.ts` — 新建测试文件

### 4. 测试

新增 `src/features/users/p4-u4.test.ts` — 29 项测试：

| 分组 | 测试数 | 内容 |
|---|---|---|
| 架构合规 | 3 | Dialog/Sheet/page/content 不直接访问 supabase/service_role |
| 导入控制 | 4 | Dialog 导入 toggleUserActive；Sheet 不直接导入 toggleUserActive；page/content 不导入 toggleUserActive |
| Dialog 行为 | 6 | 启用/禁用文案区分、pending 状态、错误展示、成功回调、resetAndClose 取消、handleOpenChange 关闭 |
| Sheet 集成 | 5 | 状态切换按钮、按钮文案随 isActive 变化、toggleDialogOpen 状态、router.refresh()、两个 Dialog 共存 |
| 权限控制 | 2 | page.tsx roleName 校验；actions toggleUserActive Admin-only |
| P4-U1 回归 | 3 | 自禁用保护、最后管理员保护、toggleActive .select+single |
| P4-U2 回归 | 3 | getUserById 仍使用、loading/error/cancelled、筛选/分页/空数据 |
| P4-U3 回归 | 3 | 修改角色按钮仍存在、roleDialogOpen 状态、UserRoleChangeDialog resetAndClose |

### 5. 质量门

- `npm run test -- src/features/users/` — **170/170**（63 P4-U1 + 42 P4-U2 + 36 P4-U3 + 29 P4-U4）
- `npm run test` — **2125/2125**（56 文件，concurrency 与 best live 预存 env 依赖）
- `npm run lint` — **0 errors / 24 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **PASS**（LF/CRLF warning only）

## 禁止

- 不做仓库分配
- 不新增 Migration
- 不修改已执行 Migration
- 不引入新权限模型
- 不进入 P4-U5

## 下一步

- **P4-U5**（用户模块安全与流程验收）：已解除阻塞（依赖 P4-U4 DONE）。
- **P3-S5B**（Admin 部分入仓 / Admin 批量入仓，按需拆分）。
- **P3-S1B**：CODE COMPLETE / BLOCKED_EXTERNAL。

## 当前业务口径

Admin 维护在途和入仓、管理用户账号（列表 + 角色变更 + 启用禁用）；Operator 只读查看已分配仓库数据，不可访问用户管理。
