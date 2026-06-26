# Current Task Packet

## Task ID

`P5-SY13A` — 仓库分配权限：权限基础与读路径收紧

## 状态

**REWORK DONE**（2026-06-26，等待 Codex 复验）

## 返工修复（3 项阻塞）

Codex 独立验收发现 3 项阻塞问题，已全部修复：

### 1. 修复 get_assigned_warehouse_ids() 权限问题
- **文件**：`supabase/migrations/00015_user_warehouses.sql`
- **问题**：末尾 `REVOKE EXECUTE FROM authenticated` 导致 operator 查询时报 permission denied for function
- **修复**：改为 `GRANT EXECUTE ON FUNCTION public.get_assigned_warehouse_ids() TO authenticated`
- **安全性**：函数仅返回 `auth.uid()` 自己的 `user_warehouses`，允许执行是安全的

### 2. 修复空分配集合误放行为
- **文件**：`src/features/inventory/repository.ts`（3 处）、`src/features/preferences/repository.ts`（1 处）、`src/features/sync/server-actions.ts`（1 处）
- **问题**：多处使用 `accessibleWhIds.size > 0` 才过滤，operator 无任何仓库分配时看到全量数据
- **修复**：移除所有 `size > 0` 守卫，`userId` 存在时始终按 `accessibleWhIds` 过滤；`size === 0` 时返回空结果

### 3. 修复 getSyncLogDetail() 绕过 RLS
- **文件**：`src/features/sync/server-actions.ts`
- **问题**：`getSyncLogDetail()` 使用 `serviceClient` 直查 `sync_log`，绕过 00015 的 sync_log RLS
- **修复**：Server Action 层补强 — 先查 `sync_log`（serviceClient），再通过 `warehouseAccessRepository.canAccessWarehouse(user.id, log.warehouseId)` 校验，无权返回 `null`

### 4. 测试补充与迁移测试纳入 vitest
- **更新** `src/features/warehouse-access/p5-sy13a.test.ts`：新增 getSyncLogDetail 权限检查（4 项）+ 空分配集合契约（4 项）+ `size > 0` 禁止断言
- **迁移** `supabase/migrations/00015_user_warehouses.test.ts` → `src/features/warehouse-access/00015-user-warehouses-migration.test.ts`（纳入 vitest 执行）
- **修复** 迁移测试中 USING/WITH CHECK 嵌套括号正则匹配 + ALTER TABLE 注释行过滤

## 修改文件清单

| 操作 | 文件 |
|---|---|
| 修改 | `supabase/migrations/00015_user_warehouses.sql` |
| 删除 | `supabase/migrations/00015_user_warehouses.test.ts` |
| 新建 | `src/features/warehouse-access/00015-user-warehouses-migration.test.ts` |
| 修改 | `src/features/inventory/repository.ts` |
| 修改 | `src/features/preferences/repository.ts` |
| 修改 | `src/features/sync/server-actions.ts` |
| 修改 | `src/features/warehouse-access/p5-sy13a.test.ts` |
| 修改 | `docs/current-state.md` |
| 修改 | `docs/tasks/current-task.md` |
| 修改 | `docs/tasks/phase-5-sync.md` |

## 强制架构边界

- ✅ 页面和客户端组件不直接调用 `supabase.from()`
- ✅ 数据获取通过 Repository → Server Component → Client Component props
- ✅ Migration 00015 仅新增，不修改 00001~00014
- ❌ 不做 Product 自动生成、不做 SKU 自动匹配
- ❌ 不启用 P5-SY10 自动 Real Write
- ❌ 不做管理 UI（P5-SY13B）

## 质量门

| 门 | 结果 |
|---|---|
| `npm run test` | 1101/1101 pass（37 files，+53 测试） |
| `npm run lint` | 0 errors, 24 warnings（all pre-existing） |
| `npm run build` | ✓ Compiled successfully |

## 依赖

- P5-SY12D DONE — Dashboard 关注产品动态运营可用性收口
- Migration 00001~00014 已在生产数据库执行
- P5-SY13B 为后续：Admin 仓库分配 UI

## 停止条件

**P5-SY13A REWORK DONE。等待 Codex 复验。** 不自动进入 P5-SY13B。
