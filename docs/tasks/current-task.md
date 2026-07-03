# Current Task Packet

## Task ID

`P4-UX` — 用户管理页局部刷新收口

## 状态

**DONE**（2026-07-03）。P4-UX 完成：用户管理模块移除最后一处 `router.refresh()`。

### 背景

P4-U3（修改角色）和 P4-U4（启用/禁用）原实现中，操作成功后关闭 Sheet 并 `router.refresh()` 整页刷新。P4-UX 参照 PERF-S1D 的 `onSuccess` 回调模式，改为 `getUserById` + `listUsers` Server Actions 局部刷新，消除 `UserDetailSheet` 中的 `useRouter` / `router.refresh()`。

### P4-UX 实现（DONE）

**UserDetailSheet（`src/features/users/components/user-detail-sheet.tsx`）：**
- 移除 `useRouter` import + `router.refresh()` 调用
- 新增 `onUserChanged?: () => void` prop（可选，向后兼容）
- `handleRoleChangeSuccess` / `handleToggleSuccess` 改为 async：
  1. 关闭子 Dialog（`setRoleDialogOpen(false)` / `setToggleDialogOpen(false)`）
  2. `getUserById(userId)` 重新获取最新用户数据 → `setUser(result.data)` 局部刷新 Sheet
  3. `onUserChanged?.()` 通知父组件
- **不再关闭 Sheet**（操作后 Sheet 保持打开，显示最新数据）

**UsersPageContent（`src/app/dashboard/users/_components/users-page-content.tsx`）：**
- 新增 `useEffect` import
- `users` / `localTotal` 本地 state（初始值来自 `data` / `initialTotal` props）
- `useEffect(() => { setUsers(data); setLocalTotal(initialTotal); }, [data, initialTotal])` — 筛选/分页导航后服务端 props 变更时覆盖本地 state
- `handleUserChanged` callback（`useCallback`）：调用 `listUsers` 重新获取当前筛选/分页条件的数据 → 更新本地 `users` / `localTotal`
- `UserDetailSheet` 传入 `onUserChanged={handleUserChanged}`
- 保留 `useRouter` 仅用于筛选/分页 `router.push` 导航，不使用 `router.refresh()`

**测试（`src/features/users/p4-u2.test.ts`）：**
- 新增 8 项 P4-UX 断言（describe `P4-UX 局部刷新收口`）：
  - `UsersPageContent` 导入 `useEffect`
  - `useEffect` 将 `data`/`initialTotal` 同步到 `setUsers`/`setLocalTotal`，依赖 `[data, initialTotal]`
  - `UserDetailSheet` 不导入 `useRouter`、不调用 `router.refresh()`
  - `UserDetailSheet` 导入 `getUserById` 用于局部刷新
  - `UserDetailSheet` 定义 `onUserChanged?: () => void` 并在成功后调用 `onUserChanged?.()`
  - `UsersPageContent` 仅导入 `listUsers`（不导入 `getUserById` / `updateUserRole` / `toggleUserActive`）
  - `UsersPageContent` 包含 `handleUserChanged` / `useCallback` / `listUsers`
  - `UsersPageContent` 保留 `useRouter` 仅用于 `router.push` 导航，不调用 `router.refresh()`

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2660/2660**（63 文件）✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| git diff --check | 通过 ✅ |
| `rg "router.refresh\|useRouter" src/features/users` | 仅测试断言（无业务代码使用）✅ |
| `rg "router.refresh\|useRouter" src/app/dashboard/users` | 仅 `users-page-content.tsx` 筛选/分页导航 ✅ |
| `UserDetailSheet` 无 `useRouter` / `router.refresh` | ✅ |
| `UsersPageContent` `useEffect` 同步 `data`/`initialTotal` props | ✅ |

### 禁止事项（已遵守）

- 不修改 Server Actions、Repository、Migration、RLS、权限模型 ✅
- 不回退 PERF-S1 改动 ✅
- 不引入新技术栈 ✅
- 不在页面或客户端组件直接调用 Supabase ✅

### P4-U3 / P4-U4 历史描述覆盖

P4-U3 和 P4-U4 原始实现成功后会关闭 Sheet 并 `router.refresh()` 刷新页面列表。P4-UX 后改为 `getUserById` 局部刷新 Sheet 详情 + `onUserChanged` 通知父组件，不再关闭 Sheet、不整页刷新。相关测试已更新。详见 `docs/current-state.md` 中两条目的 P4-UX 覆盖说明。

## 下一步

PERF-S1 全系列 + P4-UX 均已完成。Phase 3 主线 P3-S1B 等待百世 API 授权恢复，或推进其他未阻塞任务。
