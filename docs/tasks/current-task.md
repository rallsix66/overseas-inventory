# Current Task Packet

## Task ID

`P4-U1` — 用户数据层、邮箱字段与权限收口

## 状态

**DONE**（2026-06-30）

## 背景

Phase 3 内部路径（S2A~S6）已全部完成，进入 Phase 4 用户管理。P3-S6 已完成在途模块权限/RLS/端到端验收。

`src/features/users` 已有旧骨架，存在以下问题：
1. `userRepository.list/getById` 的 `email` 始终为空字符串
2. `actions.ts` 使用旧 `requireAdmin`/`getCurrentUser`，未收口到 `requireActiveAuth`/`roleName`
3. `updateUserRole` 自降级保护不可靠（通过 `targetUser.roleName` 判断而非目标 `roleId` 对应角色）
4. 缺少最后管理员保护、list/get Server Actions、DB 错误静默吞掉

## 依赖

- P5-SY13A DONE（仓库分配权限：user_warehouses 表 + get_assigned_warehouse_ids()）

## 范围

### 1. 邮箱数据契约修复

- `UserItem.email` 从 `auth.users.email` 获取，通过 `createServiceClient().auth.admin.listUsers()` / `.getUserById()` 封装
- `service_role` 仅在 repository 内部 email helper 中使用，不暴露到 actions 或前端

### 2. Repository 修复

- `list(filters)` — profiles + role + email（`fetchEmailMap` 批量映射），支持分页、roleId、isActive
- `getById(id)` — 单个用户 + email（`fetchUserEmail`），PGRST116 → null，DB error → throw `UserError`
- `getRoleName(roleId)` — 新增，查询角色名用于自保护校验
- `countByRole(roleName)` — 新增，统计活跃用户数用于最后管理员检查
- `updateRole` / `toggleActive` — 返回 `Promise<void>`，DB error → throw `UserError`
- 禁止静默吞掉 DB 错误（不再返回空 data/boolean false 掩盖错误）

### 3. Server Actions 权限收口

- 使用 `requireActiveAuth()` 替代旧 `requireAdmin`/`getCurrentUser`
- Admin-only 统一判断 `user.roleName !== 'admin'`
- 新增 `listUsers(filters)` / `getUserById(id)` 读操作（Admin-only）
- 保留并修正自保护逻辑：
  - 不能禁用自己
  - 不能将自己的角色改为非管理员（查询目标 `roleId` 对应角色名，而非当前 `roleName`）
  - 不能移除最后一个管理员（降级/禁用均拦截）
- 所有外部参数走 Zod

### 4. Schema / Types

- 补全 `listFiltersSchema` / `userIdSchema` / `updateRoleSchema` / `toggleActiveSchema`
- 新增 `UserError` class（DB_ERROR / NOT_FOUND / FORBIDDEN / LAST_ADMIN）
- 禁止 `any`

### 5. 测试

新增 `src/features/users/p4-u1.test.ts` — 50 项源码级测试：

| 分组 | 测试数 | 内容 |
|---|---|---|
| Repository | 17 | email 链路（createServiceClient + auth.admin.listUsers/getUserById）、DB error 传播（throw UserError 非静默吞）、PGRST116 → null、countByRole/getRoleName、updateRole/toggleActive 返回 void |
| Actions | 20 | requireActiveAuth 全量覆盖、非 admin 拒绝（含中文消息）、Zod 全量、自保护（自我降级/禁用/最后管理员）、UserError 捕获 |
| Schema & Types | 5 | UserError class / listFiltersSchema / userIdSchema / 禁止 any |
| Service Role 隔离 | 4 | actions 不导入 createServiceClient / SUPABASE_SERVICE_ROLE_KEY、page 无 supabase 直访、repository 内 createServiceClient 仅 email helper 使用 |
| 权限行为 mock | 2 | 自降级/自禁用检查在最后管理员检查之前；targetRoleName 查询而非 targetUser.roleName 比较 |
| 旧问题修复确认 | 2 | email 不再空字符串、actions 不再导入 requireAdmin、updateRole/toggleActive 不再返回 boolean |

### 6. 质量门

- `npm run test` — **2005/2005**（53 文件，+50 P4-U1）
- `npm run lint` — **0 errors / 25 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **pass**

## 禁止

- 不做完整用户列表页面 UI
- 不做仓库分配管理（已有 `/dashboard/users/warehouses`）
- 不新增 Migration（email 通过 API，自保护通过应用逻辑）
- 不修改已执行 migration
- 不绕过 Repository / Server Action / RLS 边界

## 输出

### Email 获取方案

`auth.users` 表位于 Supabase `auth` schema，不可通过 PostgREST `from('auth.users')` 直接查询。使用 `createServiceClient()`（service_role）调用 Auth Admin API：

- `list()`: `auth.admin.listUsers({ page, perPage })` → 循环拉取覆盖全部目标 ID → `emailMap`
- `getById()`: `auth.admin.getUserById(id)` → `data.user.email`

`createServiceClient` 仅在 repository 的 `fetchEmailMap` / `fetchUserEmail` 内部 helper 中使用（共 2 次调用），不穿透到 actions 或页面。

### 修复的权限/数据层问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | email 始终 `''` | repository 通过 service_role admin API 获取 auth.users.email |
| 2 | DB error 静默吞掉（返回 `{ data: [] }` 或 `false`） | Repository 全部 throw `UserError('DB_ERROR', ...)` |
| 3 | actions 使用旧 `requireAdmin`/`getCurrentUser` | 收口到 `requireActiveAuth` + `roleName !== 'admin'` |
| 4 | `updateUserRole` 自降级检查 `targetUser.roleName`（当前角色） | 改为 `getRoleName(roleId)` 查询目标角色名 |
| 5 | 无最后管理员保护 | `countByRole('admin') <= 1` 拦截降级/禁用 |
| 6 | 无 `listUsers` / `getUserById` actions | 新增，Admin-only + Zod + 中文错误 |
| 7 | `updateRole`/`toggleActive` 返回 `boolean`（无法区分 DB error 和 not found） | 改为 `Promise<void>`，error → throw |

### P4-U2 可否开始

**可以。** P4-U1 数据层和权限链已就绪：
- 所有 4 个 Server Actions 可用（listUsers / getUserById / updateUserRole / toggleUserActive）
- 权限自保护完整（自我降级、自我禁用、最后管理员）
- Email 通过 service_role auth admin API 获取
- 页面通过 Server Action → Repository → RLS 链路访问数据，前端零 service_role

P4-U2（用户列表只读页面）可直接使用 `listUsers()` / `getUserById()` actions 构建页面。

## 下一步

- **P4-U2**（用户列表只读页面）— 已解除阻塞
- P3-S5B（Admin 部分入仓 / Admin 批量入仓，按需拆分）
- P3-S1B 恢复（百世 API 授权后）
- Phase 6（国内库存）

## 当前业务口径

Admin 维护在途和入仓，Operator 只读查看已分配仓库数据。除非用户后续明确重新开放 Operator 写权限，否则不将 Operator 写操作作为默认选项。
