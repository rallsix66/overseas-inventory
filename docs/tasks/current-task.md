# Current Task Packet

## Task ID

`P4-U2` — 用户列表只读页面

## 状态

**DONE — 返工完成**（2026-07-01）

## 依赖

- P4-U1 DONE — 返工完成（用户数据层、邮箱字段与权限收口）

## 范围

### 1. 页面改造

- `src/app/dashboard/users/page.tsx` — Server Component 替换占位页
- Admin 可访问并查看用户列表；Operator 显示无权限提示
- 数据走 Server Action 链路：`page → listUsers/listRoles → repository → Supabase/RLS`
- 页面不直接调用 `supabase.from` / `supabase.rpc` / `auth.admin` / `createServiceClient`

### 2. 列表内容

| 列 | 说明 |
|---|---|
| 邮箱 | `user.email`，截断显示 |
| 显示名 | `user.displayName` |
| 角色 | Badge（管理员 = default / 运营 = secondary） |
| 状态 | Badge（启用 = green outline / 禁用 = destructive） |
| 创建时间 | `toLocaleDateString('zh-CN')` |
| 用户 ID | 前 8 位 + `…`，monospace |

### 3. 筛选与分页

- 状态筛选：全部 / 启用 / 禁用 → searchParams `?status=active\|disabled`
- 角色筛选：全部 / 管理员 / 运营 → searchParams `?role=<uuid>\|all`（UUID 通过 `listRoles` action 获取）
- 分页：20 条/页，searchParams `?page=N`
- 筛选变更时自动重置页码
- 筛选/分页通过 URL searchParams 实现，避免复杂客户端状态

### 4. 用户详情只读

- 行点击 → `UserDetailSheet`（shadcn/ui Sheet）
- 调用 `getUserById(id)` Server Action 获取详情
- 加载中：Skeleton
- 错误：中文提示
- 只读显示：邮箱、显示名、角色 Badge、状态 Badge、创建时间、用户 ID
- 无写操作按钮（不出现"修改角色""启用""禁用"等文案和 `updateUserRole`/`toggleUserActive` 调用）

### 5. UI/体验

- 复用 shadcn/ui：Table、Badge、Select、Button、Sheet、Skeleton
- 遵循项目设计规则（表格紧凑、hover 浅灰、空数据居中提示、桌面端 1024px+）
- 状态处理：loading（error.tsx 边界）、空数据（"暂无匹配的用户"）、无权限（"仅管理员可访问用户管理"）

### 6. 新增 listRoles

- `userRepository.listRoles()` → `from('role').select('id, name').order('name')`，DB error → throw `UserError`
- `listRoles` Server Action：Admin-only + `requireActiveAuth` + `UserError` 捕获

### 7. 测试

新增 `src/features/users/p4-u2.test.ts` — 42 项测试：

| 分组 | 测试数 | 内容 |
|---|---|---|
| 页面架构合规 | 9 | 无 supabase.from/rpc、无 auth.admin、无 createServiceClient；通过 listUsers/listRoles actions 获取数据；getCurrentActiveUser 校验；listRoles 失败 throw error 不静默降级 |
| 权限控制 | 2 | roleName !== 'admin' 检查 + 无权限提示；先权限检查再调用 listUsers |
| 只读保证 | 5 | page/content 不导入 updateUserRole/toggleActive；Sheet 只用 getUserById；无写操作按钮文案；无 supabase |
| 筛选与 Zod 链路 | 6 | searchParams 读取 status/role/page；status→isActive 映射；role→roleId 转换；pageSize: 20；listFiltersSchema.safeParse；schema default 值 |
| UI 状态 | 7 | 空数据提示；分页控件 + 禁用逻辑；筛选重置页码；列表列名；角色/状态 Badge 样式 |
| 详情 Sheet | 5 | getUserById 调用；Skeleton 加载；error 处理；字段展示；cancelled cleanup |
| listRoles | 3 | repository 方法存在 + error 传播；actions Admin-only |
| P4-U1 回归 | 6 | 所有方法/actions 仍存在；关键修复（fetchEmailMap error throw、updateRole .select+single、countByRole 两步查询）未回退 |

### 8. 返工修复（2026-07-01）

**问题**：`page.tsx` 中 `listRoles` 失败时静默降级为空数组（`rolesResult.success ? (rolesResult.data ?? []) : []`），隐藏 DB error / 权限 error。

**修复**：
```typescript
// Before（静默降级）
const roles = rolesResult.success ? (rolesResult.data ?? []) : [];

// After（错误传播）
if (!rolesResult.success) {
  throw new Error(rolesResult.error ?? '加载角色列表失败');
}
const roles = rolesResult.data ?? [];
```

新增 1 项测试（页面架构合规 → 9 项）。

### 9. 质量门

- `npm run test -- src/features/users/` — **105/105**（63 P4-U1 + 42 P4-U2）
- `npm run test` — **2060/2060**（54 文件，concurrency 与 best live 预存 env 依赖）
- `npm run lint` — **0 errors / 24 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **PASS**（LF/CRLF warning only）

## 禁止

- 不实现角色修改、启用/禁用、仓库分配
- 不新增 Migration
- 不让页面或客户端组件直接触碰 Supabase 或 service_role

## 下一步

- **P4-U3**（修改角色）：已解除阻塞。可复用 `updateUserRole` action + P4-U2 页面。
- **P4-U4**（启用/禁用）：依赖 P4-U3，BLOCKED。
- **P3-S5B**（Admin 部分入仓 / Admin 批量入仓，按需拆分）。
- **P3-S1B**：CODE COMPLETE / BLOCKED_EXTERNAL。

## 当前业务口径

Admin 维护在途和入仓、管理用户账号；Operator 只读查看已分配仓库数据，不可访问用户管理。
