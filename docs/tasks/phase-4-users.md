# Phase 4 — 团队账号

目标：管理员可查看和维护内部用户状态与角色。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P4-U1 | 用户数据层、邮箱字段与权限收口 | P0-F3 | **DONE (2026-06-30)** |
| P4-U2 | 用户列表只读页面 | P4-U1 | BACKLOG |
| P4-U3 | 修改角色 | P4-U2 | BLOCKED |
| P4-U4 | 启用、禁用与认证链校验 | P4-U3 | BLOCKED |
| P4-U5 | 用户模块安全与流程验收 | P4-U4 | BLOCKED |

角色修改与账号启停必须拆分，分别验收防止锁死管理员和禁用绕过。

---

## P4-U1 完成摘要（2026-06-30）

### 修复内容

1. **Email 数据契约**：`UserItem.email` 从 `auth.users.email` 获取，通过 `createServiceClient().auth.admin.listUsers()` / `.getUserById()` 封装。`service_role` 仅在 repository 内部 email helper 中使用。

2. **Repository**：
   - `list(filters)` — profiles + role + email 批量映射，支持分页、roleId、isActive
   - `getById(id)` — 单个用户 + email，PGRST116 → null，DB error → throw `UserError`
   - `getRoleName(roleId)` — 新增
   - `countByRole(roleName)` — 新增（统计活跃用户数）
   - `updateRole` / `toggleActive` 返回 `Promise<void>`（error → throw，不再返回 boolean 混淆 not found 和 DB error）
   - 禁止静默吞 DB error

3. **Server Actions**：
   - 收口到 `requireActiveAuth()` + `roleName !== 'admin'`
   - 新增 `listUsers()` / `getUserById()` 读操作
   - 自保护修正：
     - 不能禁用自己
     - 不能将自己的角色改为非管理员（查询目标 roleId 角色名）
     - 不能移除最后一个管理员

4. **测试**：`src/features/users/p4-u1.test.ts` — 50 项源码级测试

5. **质量门**：2005/2005 tests（53 文件），lint 0 errors，build PASS

### P4-U2 就绪

P4-U1 数据层已就绪。P4-U2（用户列表只读页面）可直接使用 `listUsers()` / `getUserById()` actions 构建页面，无需新增 Migration。
