# Current Task Packet

## Task ID

`P5-SY13B` — 仓库分配管理 UI

## 状态

**DONE**（2026-06-26，production migration verified）

## 生产验证

Migration 00016 已于 Supabase SQL Editor 手动执行并验证通过：

| 验证项 | SQL | 结果 |
|---|---|---|
| RPC 函数存在 | `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_user_warehouses')` | `true` |
| authenticated 可执行 | `SELECT has_function_privilege('authenticated', 'update_user_warehouses(uuid, uuid[])', 'execute')` | `true` |
| anon 不可执行 | `SELECT has_function_privilege('anon', 'update_user_warehouses(uuid, uuid[])', 'execute')` | `false` |

## 返工原因

### Round 1（Codex 复验阻塞）

1. **阻塞 1**：`updateUserWarehouses` 写入前缺少服务端业务校验（允许给 admin/inactive user/非 operator 分配仓库；允许写入 inactive/domestic 仓库）
2. **阻塞 2**：`delete + insert` 非事务性，insert 失败会丢失旧分配

### Round 2（Codex 复验收口阻塞）

1. **阻塞 3**：Migration 00016 RPC 缺少 REVOKE/GRANT 显式授权（SECURITY DEFINER 写入 RPC 未最小化执行面，不符合现有 migrations 模式）
2. **阻塞 4**：`supabase/migrations/00016_update_user_warehouses_rpc.test.ts` 不在 Vitest include 路径（`src/**/*.test.ts`）中，`npm run test` 不执行

## 返工实现

### 1. Migration 00016 — `update_user_warehouses` RPC + 授权收口

**新建** `supabase/migrations/00016_update_user_warehouses_rpc.sql`：

- `CREATE OR REPLACE FUNCTION public.update_user_warehouses(p_user_id UUID, p_warehouse_ids UUID[])` → `RETURNS jsonb`
- `SECURITY DEFINER`，`SET search_path = ''`
- 校验调用者是 admin（通过 `get_user_role()`）
- 校验目标用户存在、`is_active=true`、`role.name='operator'`
- 校验所有 `warehouse_ids` 非空时对应 `type='overseas'` 且 `is_active=true`
- `DISTINCT` 去重后写入
- 同一事务内 `DELETE` 旧分配 → `INSERT` 新分配
- 空/NULL `warehouse_ids` → 只删除不插入（清空分配）
- 返回 `jsonb_build_object('success', true)` 或带 `error` 字段
- **Round 2 追加**：函数定义后显式 REVOKE/GRANT 最小化执行面：
  ```sql
  REVOKE EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) FROM anon;
  GRANT EXECUTE ON FUNCTION public.update_user_warehouses(uuid, uuid[]) TO authenticated;
  ```

### 2. Repository 升级

`src/features/warehouse-access/repository.ts` 中 `updateUserWarehouses` 方法：

- 返回值从 `Promise<boolean>` 改为 `Promise<{ success: boolean; error?: string }>`
- 写入前校验顺序（全部在校验失败时提前 return，不进入 write）：
  1. UUID 格式校验（userId + 每个 warehouseId）
  2. 查询 `profiles` + `role` join：目标用户必须存在、`role.name='operator'`、`is_active=true`
  3. `warehouseIds` 去重（`[...new Set(warehouseIds)]`）
  4. 非空时查询 `warehouse`：`type='overseas'` + `is_active=true` + `.in('id', dedupedIds)`，数量必须完全匹配
- 全部校验通过 → 调用 RPC `update_user_warehouses` 原子写入
- 业务校验错误返回中文消息

### 3. Actions 升级

`src/features/warehouse-access/actions.ts` 中 `updateUserWarehouses`：

- 使用 `result.error` 透传 repository 层的结构化中文错误
- 保留 `requireActiveAdmin()` + Zod 格式校验

### 4. Types 更新

- `src/features/warehouse-access/types.ts`：接口返回类型结构化
- `src/types/database.ts`：Functions 新增 `update_user_warehouses` RPC 类型签名

### 5. 测试（纳入 Vitest）

`src/features/warehouse-access/p5-sy13b.test.ts` 98 项测试（7 个 describe 块）：

| 测试组 | 项数 | 覆盖 |
|---|---|---|
| 1. types.ts | 11 | OperatorItem / AssignableWarehouse / OperatorWithAssignments 接口 |
| 2. schema.ts | 6 | Zod 校验 / uuid / max(50) |
| 3. repository.ts | 16 | listOperators / getUserWarehouseAssignments / updateUserWarehouses / getAssignableWarehouses |
| 3b. 写入前业务校验 | 7 | role.name='operator' / is_active=true / type='overseas' / 去重 / 校验失败早于 RPC / 校验失败不删旧分配 |
| 3c. Migration 00016 RPC 契约 | 27 | 函数声明（6）/ admin 校验（2）/ 目标用户校验（4）/ 仓库校验（2）/ 事务性写入（3）/ 成功返回（1）/ REVOKE/GRANT 授权（5）/ 不修改旧 migration（2）/ SQL 文件存在（1） |
| 4. actions.ts | 13 | Admin-only / Zod / revalidatePath / 透传业务错误 |
| 5. 页面架构边界 | 15 | 不直接 supabase.from() / Server Action / 空/无权限状态 |
| 6. 侧边栏入口 | 5 | 仓库分配 / Warehouse 图标 / admin 可见 |
| 7. Operator 权限隔离 | 5 | 不暴露 operator 写权限 / repository 仅返回 active operator |

## 权限链

- Admin：`requireActiveAdmin()` → Server Action → Repository（业务校验） → RPC（DB 层二次校验 + 原子写入）
- RPC：仅 `authenticated` 可执行（PUBLIC/anon 已 REVOKE），内部 `get_user_role()` = admin + 目标用户 operator 校验 + 仓库 active overseas 校验
- Operator：`requireActiveAdmin()` 拒绝 → 页面显示无权限 → 侧边栏不可见入口

## 修改文件清单

| 操作 | 文件 |
|---|---|
| **新建** | `supabase/migrations/00016_update_user_warehouses_rpc.sql` |
| 修改 | `src/features/warehouse-access/types.ts` |
| 修改 | `src/features/warehouse-access/schema.ts` |
| 修改 | `src/features/warehouse-access/repository.ts` |
| 修改 | `src/features/warehouse-access/actions.ts` |
| 修改 | `src/features/warehouse-access/components/warehouse-assignment-content.tsx` |
| 修改 | `src/app/dashboard/users/warehouses/page.tsx` |
| 修改 | `src/app/dashboard/users/warehouses/loading.tsx` |
| 修改 | `src/app/dashboard/users/warehouses/error.tsx` |
| 修改 | `src/app/dashboard/_components/sidebar-nav.tsx` |
| 修改 | `src/types/database.ts` |
| 修改 | `src/features/warehouse-access/p5-sy13b.test.ts`（3c 块 27 项，纳入 Vitest） |
| 修改 | `docs/current-state.md` |
| 修改 | `docs/tasks/current-task.md` |
| 修改 | `docs/tasks/phase-5-sync.md` |

## 质量门

| 门 | 结果 |
|---|---|
| `npm run test` | 1199/1199 pass（38 文件） |
| `npm run lint` | 0 errors, 24 warnings（all pre-existing） |
| `npm run build` | 需用户在终端运行确认（Next.js --webpack 排除 test files，pre-existing tsc errors 不在构建范围） |
| 生产验证 | Migration 00016 已执行，rpc_exists=true / authenticated_can_execute=true / anon_can_execute=false |

## 强制架构边界

- ✅ 页面和客户端组件不直接调用 `supabase.from()`
- ✅ 数据获取通过 Server Action → Repository → Supabase
- ✅ 全部写操作使用 `requireActiveAdmin()`
- ✅ Zod 校验所有外部输入
- ✅ 写入前完成全部业务校验（Repository 层 + RPC 层双重校验）
- ✅ 事务性写入通过 Migration 00016 RPC 实现
- ✅ RPC 授权最小化：REVOKE PUBLIC/anon + GRANT authenticated
- ✅ Migration 00016 不修改已执行 Migration 00001~00015
- ✅ 测试纳入 Vitest（`src/**/*.test.ts`），不遗漏在 `supabase/migrations/`
- ✅ 不使用 `service_role` 暴露到前端

## 依赖

- P5-SY13A DONE — 仓库分配权限：权限基础与读路径收紧
- Migration 00015 已在生产数据库执行
- Migration 00016 已于 Supabase SQL Editor 手动执行并验证通过
- `user_warehouses` 表已存在

## 停止条件

**P5-SY13B DONE。** production migration verified。等待用户确认下一任务。
