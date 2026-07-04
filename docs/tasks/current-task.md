# Current Task Packet

## Task ID

`LOW-STOCK-PAGINATION` — `getLowStock()` RPC 分页补齐

## 状态

**DONE**（2026-07-04，2026-07-04 RPC 返修完成，2026-07-04 runtime smoke test 通过）。`inventoryRepository.getLowStock()` 已从 JS 全量过滤改为调用 Migration 00028 `get_low_stock` RPC。SQL 层完成归档排除、仓库隔离、`quantity <= safety_stock` 过滤、gap 计算、`ORDER BY gap DESC, quantity ASC`、`LIMIT p_limit`，确保 limit 只作用在"当前用户可见、未归档、真实低库存"的结果集之后。Migration 00028 已在 Supabase SQL Editor 手动执行并验证（`is_security_definer=false`、`authenticated EXECUTE=true`、`anon EXECUTE=false`）。Dashboard 首页低库存汇总区正常渲染，无 function not found / schema cache 错误。

### 背景

`getLowStock()` 原为全量查询 + JS 层过滤（`quantity <= safetyStock`、归档排除、仓库隔离）。初版实现错误地将 `.limit(limit)` 放在 JS 过滤之前，会漏报高 gap 低库存项。返修通过新增 Migration 00028 RPC 在 SQL 层正确完成所有过滤和排序。

### 实现（DONE + 返修）

**Migration 00028（`supabase/migrations/00028_low_stock_rpc.sql`）：**
- 新增 `get_low_stock(p_user_id uuid, p_limit integer DEFAULT 50)` RPC
- `RETURNS jsonb`，返回 `{ "data": [...] }`
- SECURITY INVOKER + `SET search_path = ''`
- 身份绑定：`auth.uid() IS NOT NULL` + `p_user_id = auth.uid()`
- 参数防御：`COALESCE(p_limit, 50)` + clamp `[1, 200]`
- SQL 层过滤：`match_status = 'matched'` + `quantity > 0` + `quantity <= COALESCE(p.safety_stock, 0)`
- 归档排除：`LEFT JOIN user_variant_preference uvp_arch ... WHERE uvp_arch.variant_id IS NULL`
- 仓库隔离：`get_user_role() = 'admin' OR warehouse_id IN (SELECT get_assigned_warehouse_ids())`
- gap 计算：`COALESCE(p.safety_stock, 0) - i.quantity AS gap`
- 排序：`ORDER BY gap DESC, quantity ASC`
- 分页：`LIMIT p_limit`
- 权限收口：`REVOKE FROM PUBLIC, anon` + `GRANT TO authenticated`
- 所有 RAISE EXCEPTION 为中文

**repository.ts 修改：**
- `getLowStock()` 改为调用 `supabase.rpc('get_low_stock', { p_user_id: userId, p_limit: limit })`
- 使用 `mapOverseasRow` 映射 RPC 返回行
- 移除 `getUserArchivedVariantIds` 辅助函数（归档已下沉 RPC）
- 移除 `warehouseAccessRepository` 导入（仓库隔离已下沉 RPC）
- 签名保持 `{ userId, limit }` 对象参数，返回 `Promise<InventoryItem[]>`

**database.ts：**
- 新增 `get_low_stock` 函数类型定义

**page.tsx：**
- Dashboard 调用方使用 `getLowStock({ userId: user.id })`（不变）

**测试：**
- 新增 `src/features/inventory/low-stock-pagination-migration.test.ts`：25 项迁移静态契约测试
- 更新 `src/features/inventory/p2-d2-low-stock-summary.test.ts`：10 项 RPC 调用断言
- 适配 `p5-sy11g-d-inventory.test.ts`（3 项 → RPC 检查）
- 适配 `p5-sy12-non-regression.test.ts`（1 项 → RPC 检查）
- 适配 `p5-sy13a.test.ts`（3 项 → RPC 仓库隔离检查）

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2754/2754**（65 文件）✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| git diff --check | 通过 ✅ |
| Migration 00028 新增 get_low_stock RPC | ✅ |
| RPC SQL 层归档/仓库/低库存过滤正确 | ✅ |
| RPC ORDER BY gap DESC, quantity ASC | ✅ |
| RPC LIMIT p_limit（默认 50，上限 200） | ✅ |
| Repository 调用 supabase.rpc | ✅ |
| JS 层过滤全部移除 | ✅ |
| Dashboard 调用方不变 | ✅ |
| 返回类型仍为 Promise<InventoryItem[]> | ✅ |
| Migration 00028 手动执行并验证（runtime smoke test 通过） | ✅ |
| Dashboard 首页低库存汇总区正常渲染，无 function not found 错误 | ✅ |

### 禁止事项（已遵守）

- 不进入 P2-I4 Domestic Inventory ✅
- 不清理 smoke-test-00025.ts 旧 lint ✅
- 不修改 Product/ProductVariant/Inventory 关系 ✅
- 不修改 RLS / 权限模型 ✅
- 不修改 .claude/context-status.json ✅

## 下一步

LOW-STOCK-PAGINATION 完成（RPC 返修）。UNMATCHED-PAGINATION、LOW-STOCK-PAGINATION 均已完成。PERF-S1 全系列、P4-UX、P2-D2、SIDEBAR-ENABLE 均已完成。P3-S1B 仍 BLOCKED_EXTERNAL（百世 API 授权未恢复）。可推进其他未阻塞任务（P2-I4 Domestic Inventory 或其他小修）。
