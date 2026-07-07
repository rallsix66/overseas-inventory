# Current Task Packet

## Task ID

`PERF-H-DROP-UNUSED-INVENTORY-QUANTITY-INDEXES` — 新增 Migration 00033 删除两个未使用的 inventory quantity 部分索引

## 状态

**DONE**（2026-07-07）。Migration 00033 已在 Supabase SQL Editor 手动执行成功。执行后验证查询 `pg_stat_user_indexes` 返回 No rows returned（两个索引已删除确认）。

### 背景

PERF-G 已完成静态查询路径分析（12 条路径全覆盖）+ `pg_stat_user_indexes` 运行时验证：

| 索引 | WHERE 条件 | idx_scan | idx_tup_read | idx_tup_fetch | index_size |
|------|-----------|----------|-------------|--------------|------------|
| `idx_inventory_low_stock` | `quantity <= 500` | 0 | 0 | 0 | 16 kB |
| `idx_inventory_quantity` | `quantity = 0` | 0 | 0 | 0 | 16 kB |

两个索引在 pg_stat_user_indexes 统计窗口内均未观察到任何使用。

### 删除依据

**静态分析（PERF-G）**：
- 所有低库存/海外库存查询已由 PERF-S1（Migration 00027/00028）迁移至 RPC，使用 `COALESCE(safety_stock, 0)` 动态参数
- PostgreSQL planner 无法在计划时证明动态参数 `≤ 500`，不会选择 `idx_inventory_low_stock` partial index
- `idx_inventory_quantity WHERE quantity = 0` 的潜在使用者 `get_overseas_inventory` out_of_stock 分支虽在静态分析中不能排除可能，但运行时统计确认未使用

**运行时验证（pg_stat_user_indexes）**：
- 两个索引均 `idx_scan=0` / `idx_tup_read=0` / `idx_tup_fetch=0` / `index_size=16 kB`
- 综合静态分析 + 运行时统计，判断两个索引均可安全删除

**注意**：`idx_scan=0` 仅代表当前统计窗口内未观察到使用，不代表从未使用。本次删除基于静态查询路径分析 + 当前运行时统计共同判断。

### Migration 00033

```sql
-- ============================================
-- Migration 00033: PERF-H — 删除未使用的 inventory quantity 部分索引
-- ============================================
DROP INDEX IF EXISTS public.idx_inventory_low_stock;
DROP INDEX IF EXISTS public.idx_inventory_quantity;
```

`DROP INDEX IF EXISTS` 保证幂等：即使索引已在 Supabase SQL Editor 手动删除后再执行此 Migration，也不会失败。

### 新增测试

`src/features/inventory/perf-h-drop-indexes-migration.test.ts` — 14 项静态契约测试：

| # | 测试 | 类别 |
|---|------|------|
| 1 | 文件编号为 00033，存在且内容非空 | 文件存在 |
| 2 | 注释声明 PERF-H | 标识 |
| 3 | DROP INDEX IF EXISTS public.idx_inventory_low_stock | 目标索引 |
| 4 | DROP INDEX IF EXISTS public.idx_inventory_quantity | 目标索引 |
| 5 | 恰好包含两行 DROP INDEX IF EXISTS（排除 SQL 注释行） | 精确 DROP |
| 6 | 不包含 CREATE INDEX（排除 SQL 注释行） | 无模式变更 |
| 7 | 不包含 ALTER TABLE | 无模式变更 |
| 8 | 不包含 INSERT / UPDATE / DELETE | 无数据变更 |
| 9 | 不包含 CREATE OR REPLACE FUNCTION / RPC | 无 RPC |
| 10 | 不包含 REVOKE / GRANT | 无权限变更 |
| 11 | 00001 migration 未被修改（idx_inventory_low_stock 仍存在） | 不修改旧 migration |
| 12 | 00001 migration 未被修改（idx_inventory_quantity 仍存在） | 不修改旧 migration |
| 13 | 不删除 idx_inventory_warehouse_id | 不触及非目标索引 |
| 14 | 不匹配其他 inventory 索引 | 精确索引名 |

### 禁止事项（已遵守）

- 不修改 `supabase/migrations/00001` 已执行 migration ✅
- 不修改 RPC / RLS / Repository / 业务代码 ✅
- 不修改 `.claude/context-status.json` ✅
- 不处理 P3-S1B ✅

### 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test`（全量非并发） | 2962/2963 通过（75 文件中 73 通过，2 预存失败：concurrency / best live 缺 env）✅ |
| `npm run build` | Turbopack ✓ 通过 ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有）✅ |
| `git diff --check` | 通过（仅 LF/CRLF warning）✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `supabase/migrations/00033_drop_unused_inventory_quantity_indexes.sql` | 新增：DROP INDEX IF EXISTS 两个索引 |
| 2 | `src/features/inventory/perf-h-drop-indexes-migration.test.ts` | 新增：14 项静态契约测试 |
| 3 | `docs/current-state.md` | 更新 Phase + Task + Database Status + Recent Changes + Migration 列表 + Last Updated |
| 4 | `docs/tasks/current-task.md` | 本文件（PERF-H 任务包） |

### 执行确认

**Migration 00033 已在 Supabase SQL Editor 手动执行成功（2026-07-07）。**

执行后验证查询：
```sql
SELECT schemaname, relname AS table_name, indexrelname AS index_name
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname IN ('idx_inventory_low_stock', 'idx_inventory_quantity');
```

结果：**Success. No rows returned** — 确认两个索引已删除。

### 下一步

可选择推进新 Phase 或 P3-S1B 恢复（百世 API，仍在 BLOCKED_EXTERNAL 状态）。
