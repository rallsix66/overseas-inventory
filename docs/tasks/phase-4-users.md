# Phase 4 — 团队账号

目标：管理员可查看和维护内部用户状态与角色。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P4-U1 | 用户数据层、邮箱字段与权限收口 | P0-F3 | **DONE — 返工完成 (2026-07-01)** |
| P4-U2 | 用户列表只读页面 | P4-U1 | **DONE — 返工完成 (2026-07-01)** |
| P4-U3 | 修改角色 | P4-U2 | BACKLOG |
| P4-U4 | 启用、禁用与认证链校验 | P4-U3 | BLOCKED |
| P4-U5 | 用户模块安全与流程验收 | P4-U4 | BLOCKED |

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

P4-U2 只读列表已完成。P4-U3（修改角色）可直接复用 `updateUserRole` action + P4-U2 页面上的角色 Badge 交互。
