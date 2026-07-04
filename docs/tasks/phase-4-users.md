# Phase 4 — 团队账号

目标：管理员可查看和维护内部用户状态与角色。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P4-U1 | 用户数据层、邮箱字段与权限收口 | P0-F3 | **DONE — 返工完成 (2026-07-01)** |
| P4-U2 | 用户列表只读页面 | P4-U1 | **DONE — 返工完成 (2026-07-01)** |
| P4-U3 | 修改角色 | P4-U2 | **DONE (2026-07-01)** |
| P4-U4 | 启用、禁用与认证链校验 | P4-U3 | **DONE (2026-07-01)** |
| P4-U5 | 用户模块安全与流程验收 | P4-U4 | **DONE — 返工完成 (2026-07-01)** |

角色修改与账号启停必须拆分，分别验收防止锁死管理员和禁用绕过。

---

## P4-U1 完成摘要（2026-06-30，返工 2026-07-01）

### 修复内容

1. **Email 数据契约**：`UserItem.email` 从 `auth.users.email` 获取，通过 `createServiceClient().auth.admin.listUsers()` / `.getUserById()` 封装。`service_role` 仅在 repository 内部 email helper 中使用。

2. **Repository**：
   - `list(filters)` — profiles + role + email 批量映射，支持分页、roleId、isActive
   - `getById(id)` — 单个用户 + email，PGRST116 → null，DB error → throw `UserError`
   - `getRoleName(roleId)` — 新增，区分 PGRST116 与 DB error
   - `countByRole(roleName)` — 两步查询（先查 role 表 roleId → 再 count profiles.role_id），PGRST116 → 0
   - `updateRole` / `toggleActive` 返回 `Promise<void>`，增加 `.select('id').single()` 确认行存在，0 行 → `NOT_FOUND`
   - 禁止静默吞 DB error

3. **Server Actions**：
   - 收口到 `requireActiveAuth()` + `roleName !== 'admin'`
   - 新增 `listUsers()` / `getUserById()` 读操作
   - 自保护修正：不能禁用自己、不能将自己的角色改为非管理员、不能移除最后一个管理员
   - `revalidatePath` 仅在 repository 写操作成功后调用

4. **测试**：`src/features/users/p4-u1.test.ts` — 63 项源码级测试（初始 50 + 返工 13）

5. **质量门**：2018/2019 tests（53 文件，1 预存 live test 失败），lint 0，build PASS

### 返工修复（2026-07-01）

| # | 风险 | 修复 |
|---|---|---|
| 1 | `fetchEmailMap` error 时 `break` 静默返回空 Map | throw `UserError('DB_ERROR', ...)` |
| 2 | `fetchUserEmail` error 时返回 `''` | throw `UserError('DB_ERROR', ...)`；auth user 不存在 → `''` 附注释 |
| 3 | `updateRole`/`toggleActive` 0 行仍返回 success | `.select('id').single()` + PGRST116 → NOT_FOUND |
| 4 | `countByRole` 未 join 的 `.eq('role.name', ...)` | 两步查询：role 表 → roleId → profiles count |
| 5 | `getRoleName` `if (error \|\| !data) return null` 吞 DB error | 区分 PGRST116 vs throw |

---

## P4-U2 完成摘要（2026-07-01）

### 实现内容

1. **页面**：`src/app/dashboard/users/page.tsx` — Server Component。Admin 可访问，Operator 显示"仅管理员可访问用户管理"。数据经 `listUsers`/`listRoles`/`getUserById` Server Actions，页面不直接调用 Supabase。

2. **列表**：邮箱、显示名、角色 Badge（admin=default / operator=secondary）、状态 Badge（启用=green / 禁用=destructive）、创建时间、用户 ID（前 8 位截断）。

3. **筛选与分页**：URL searchParams 驱动。状态筛选（全部/启用/禁用）+ 角色筛选（全部/管理员/运营，通过 `listRoles` action 获取 UUID）。20 条/页，筛选变更自动重置页码。

4. **用户详情**：`UserDetailSheet`（Sheet 组件）。行点击 → 加载 Skeleton → `getUserById` → 只读展示（邮箱、显示名、角色、状态、创建时间、ID）。无修改角色/启用禁用等写操作按钮。

5. **新增 `listRoles`**：`userRepository.listRoles()` + `listRoles()` Server Action（Admin-only）。

6. **测试**：`src/features/users/p4-u2.test.ts` — 42 项测试（架构合规 + 权限 + 只读 + 筛选/Zod + UI 状态 + 详情 Sheet + listRoles + P4-U1 回归）。

7. **质量门**：2060/2060 tests（54 文件，concurrency 与 best live 预存 env 依赖），lint 0 errors / 24 warnings（all pre-existing），build pass，git diff --check pass（LF/CRLF warning only）。

### 返工修复（2026-07-01）

**问题**：`page.tsx` 中 `listRoles` 失败时静默降级为空数组（`rolesResult.success ? (rolesResult.data ?? []) : []`），隐藏 DB error / 权限 error。

**修复**：`if (!rolesResult.success) throw new Error(rolesResult.error ?? '加载角色列表失败')`，失败时交给 error boundary 处理。

新增 1 项测试覆盖（页面架构合规 7→9 项，总 41→42 项）。

### P4-U3 就绪

~~P4-U2 只读列表已完成。P4-U3（修改角色）可直接复用 `updateUserRole` action + P4-U2 页面上的角色 Badge 交互。~~

---

## P4-U3 完成摘要（2026-07-01）

### 实现内容

1. **UI 入口**：`UserDetailSheet` 详情 Sheet 角色行新增"修改角色"按钮。点击后弹出 `UserRoleChangeDialog`（shadcn/ui Dialog）：选择新角色（过滤当前角色避免重复提交）+ 确认修改 + Loader2 pending 状态 + 失败展示中文错误。**P4-UX（2026-07-03）覆盖**：原实现成功后关闭 Sheet + `router.refresh()` 刷新页面列表；P4-UX 后改为 `getUserById` 局部刷新 Sheet 详情 + `onUserChanged` 通知父组件，不再关闭 Sheet、不整页刷新。

2. **权限链路**：写操作通过 `updateUserRole` Server Action（Admin-only + 自降级保护 + 最后管理员保护）。Dialog 组件直接调用 action，页面/Sheet/Content 不直接写数据库。不新增 service_role 使用点。

3. **文件**：
   - 新建 `src/features/users/components/user-role-change-dialog.tsx`
   - 修改 `src/features/users/components/user-detail-sheet.tsx`（新增 roles prop + 修改角色按钮 + Dialog 集成；P4-UX 后 router.refresh 已移除）
   - 修改 `src/app/dashboard/users/_components/users-page-content.tsx`（透传 roles prop）

4. **测试**：`src/features/users/p4-u3.test.ts` — 36 项测试（架构合规 + 导入控制 + Dialog 行为 + Sheet 集成 + 透传 + 权限 + P4-U1/P4-U2 回归）

5. **质量门**：2096/2096 tests（55 文件，concurrency 与 best live 预存 env 依赖），lint 0 errors / 24 warnings（all pre-existing），build pass，git diff --check pass

### P4-U4 就绪

~~P4-U4（启用/禁用）已解除阻塞，可复用 `toggleUserActive` action + P4-U3 页面模式。~~

---

## P4-U4 完成摘要（2026-07-01）

### 实现内容

1. **UI 入口**：`UserDetailSheet` 详情 Sheet 状态行新增"启用"/"禁用"按钮（按钮文案根据 `isActive` 切换）。点击后弹出 `UserActiveToggleDialog`（shadcn/ui Dialog）：区分启用/禁用说明文案 + 确认操作 + Loader2 pending 状态 + 失败展示中文错误。**P4-UX（2026-07-03）覆盖**：原实现成功后关闭 Sheet + `router.refresh()` 刷新页面列表；P4-UX 后改为 `getUserById` 局部刷新 Sheet 详情 + `onUserChanged` 通知父组件，不再关闭 Sheet、不整页刷新。

2. **权限链路**：写操作通过 `toggleUserActive` Server Action（Admin-only + 自禁用保护 + 最后管理员保护）。Dialog 组件直接调用 action，页面/Sheet/Content 不直接写数据库。不新增 service_role 使用点。`UserActiveToggleDialog` 使用 `resetAndClose` 统一关闭模式（与 P4-U3 返工保持一致）。

3. **文件**：
   - 新建 `src/features/users/components/user-active-toggle-dialog.tsx`
   - 修改 `src/features/users/components/user-detail-sheet.tsx`（新增启用/禁用按钮 + Dialog 集成）

4. **测试**：`src/features/users/p4-u4.test.ts` — 29 项测试（架构合规 + 导入控制 + Dialog 行为 + Sheet 集成 + 权限 + P4-U1/P4-U2/P4-U3 回归）

5. **质量门**：2125/2125 tests（56 文件，concurrency 与 best live 预存 env 依赖），lint 0 errors / 24 warnings（all pre-existing），build pass，git diff --check pass

### P4-U5 就绪

~~P4-U5（用户模块安全与流程验收）已解除阻塞。~~

---

## P4-U5 完成摘要（2026-07-01，返工 2026-07-01）

### 安全审计发现

**TOCTOU 竞态条件**：`updateUserRole` 和 `toggleUserActive` 中的「最后活跃管理员保护」存在检查-使用竞态窗口。`countByRole('admin')` 检查与数据库写入非原子，两个管理员可同时互相禁用/降级，均通过 count 检查，导致系统失去所有活跃管理员。

### 首次修复（Migration 00024）

**Migration 00024** 新增两个 SECURITY INVOKER RPC：

| RPC | 功能 |
|---|---|
| `update_user_role_protected(p_target_user_id, p_new_role_id, p_operator_user_id)` | 原子化角色变更：自降级保护 + 最后管理员保护 + 写入 |
| `toggle_user_active_protected(p_target_user_id, p_is_active, p_operator_user_id)` | 原子化状态切换：自禁用保护 + 最后管理员保护 + 写入 |

原子保护机制：
- `pg_advisory_xact_lock(987654321)` 序列化所有 Admin 写操作（两个 RPC 共用同一锁 ID 互斥）
- `FOR UPDATE` 锁定目标 profile 行
- SECURITY INVOKER（不绕过 RLS，仅 Admin 可执行）
- 所有 RAISE EXCEPTION 使用中文错误消息

### 返工修复（Migration 00025）

**权限缺口**：00024 RPC 接受 `p_operator_user_id` 参数但未验证调用者身份：
- 未校验 `auth.uid() IS NOT NULL`（未登录也可调用）
- 未校验 `auth.uid() = p_operator_user_id`（可伪造操作者身份）
- 未校验调用者是否为活跃 Admin（Operator 可调用 RPC）
- 未 REVOKE EXECUTE FROM PUBLIC/anon（默认 PUBLIC 有 EXECUTE 权限）
- `operator_update_own_profile` RLS policy 的 WITH CHECK 中 `get_user_role()` 读取已提交行，无法阻止 operator 在 NEW 行中修改 role_id/is_active

**加固项**：

| 加固项 | 实现 |
|---|---|
| 调用者身份绑定 | `auth.uid() IS NOT NULL` →「未登录，请先登录」 |
| 操作者一致性 | `auth.uid() = p_operator_user_id` →「操作者身份校验失败」 |
| 活跃 Admin 校验 | SELECT profiles JOIN role WHERE id = auth.uid() →「账号未启用或不存在」/「仅管理员可执行此操作」 |
| 执行顺序 | auth.uid() 身份绑定在 `pg_advisory_xact_lock` 之前（锁前拦截） |
| 权限加固 | REVOKE EXECUTE FROM PUBLIC, anon + GRANT EXECUTE TO authenticated |
| Operator 自升保护 | `check_operator_profile_update` BEFORE UPDATE 触发器：比较 OLD vs NEW role_id / is_active →「不允许修改自己的角色」/「不允许修改自己的启用状态」 |

### 代码变更

| 文件 | 变更 |
|---|---|
| `supabase/migrations/00024_atomic_user_admin_guard.sql` | 首次修复（不修改） |
| `supabase/migrations/00025_rpc_caller_identity_binding.sql` | 新建：CREATE OR REPLACE 两个 RPC（叠加 auth.uid() 校验）+ REVOKE/GRANT + trigger |
| `src/features/users/repository.ts` | `updateRole()` / `toggleActive()` 改为调用 RPC（新增 `operatorId` 参数） |
| `src/features/users/actions.ts` | 简化为 Auth + Zod + RPC 调用（移除冗余业务规则检查，已收口至 RPC） |
| `src/features/users/p4-u1.test.ts` | 更新 7 项 migration 引用：00024 → 00025 |
| `src/features/users/p3-u3.test.ts` | 更新 3 项 migration 引用：00024 → 00025 |
| `src/features/users/p4-u4.test.ts` | 更新 2 项 migration 引用：00024 → 00025 |
| `src/features/users/p5-u5-migration.test.ts` | 重写：25 → 49 项测试（新增 auth.uid 绑定 / REVOKE/GRANT / trigger） |
| `docs/current-state.md` | 更新 Current Task / Completed Tasks / Current Task References / Last Updated |
| `docs/tasks/current-task.md` | 重写：完整返工描述 |
| `docs/tasks/phase-4-users.md` | 更新 P4-U5 摘要

### 访问控制矩阵

| 操作 | Admin | Operator |
|---|---|---|
| 访问 `/dashboard/users` | ✅ | ❌ 显示无权限 |
| `listUsers` | ✅ 全部用户 | ❌ |
| `getUserById` | ✅ | ❌ |
| `listRoles` | ✅ | ❌ |
| `updateUserRole` | ✅ RPC 原子保护 + auth.uid() 绑定 | ❌ |
| `toggleUserActive` | ✅ RPC 原子保护 + auth.uid() 绑定 | ❌ |
| 直接 UPDATE profiles.role_id | ✅ admin_all_profiles | ❌ trigger 拦截 |
| 直接 UPDATE profiles.is_active | ✅ admin_all_profiles | ❌ trigger 拦截 |
| 调用 update_user_role_protected | ✅ authenticated + RPC 内部 Admin 校验 | ❌ RPC 内部 Admin 校验拒绝 |
| 调用 toggle_user_active_protected | ✅ authenticated + RPC 内部 Admin 校验 | ❌ RPC 内部 Admin 校验拒绝 |

### 质量门

2174/2174 tests（57 文件），lint 0 errors / 24 warnings（all pre-existing），build pass，git diff --check pass

### Phase 4 完成

Phase 4 用户管理全模块完成（P4-U1~P4-U5）。Admin 可管理用户列表、角色变更、启用禁用；所有写操作受数据库层四层保护：`pg_advisory_xact_lock` + `auth.uid()` 身份绑定 + REVOKE/GRANT 权限加固 + `check_operator_profile_update` 触发器。
