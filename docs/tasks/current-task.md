# Current Task Packet

## Task ID

`PERF-G-IDX-INVENTORY-LOW-STOCK-EVALUATION` — 评估 `idx_inventory_low_stock` 是否可删除

## 状态

**DONE**（2026-07-07）。纯静态评估，未执行 Migration 删除。

### 背景

Migration 00001 创建了两个 quantity 部分索引：

```sql
CREATE INDEX idx_inventory_quantity  ON inventory(quantity) WHERE quantity = 0;
CREATE INDEX idx_inventory_low_stock ON inventory(quantity) WHERE quantity <= 500;
```

需要评估这两个索引是否仍被真实查询路径使用，避免维护无用索引。

### 评估方法

1. 搜索 `supabase/migrations/` 中索引定义位置
2. 全覆盖分析所有 `inventory` 表查询路径（PostgREST + RPC + RLS）
3. 判断每个查询路径是否能在 planner 层命中部分索引

### 查询路径全覆盖分析

| # | 查询路径 | 方式 | quantity 条件 | 命中? |
|---|---------|------|--------------|-------|
| 1 | `getOverseasList()` → `get_overseas_inventory` RPC | RPC | `quantity <= COALESCE(p.safety_stock, 0)` 动态 | ❌ |
| 2 | `getLowStock()` → `get_low_stock` RPC | RPC | `quantity <= COALESCE(p.safety_stock, 0)` 动态 | ❌ |
| 3 | `getOverseasStats()` → `get_overseas_stats` RPC | RPC | `quantity <= COALESCE(safety_stock, 0)` 动态 | ❌ |
| 4 | `list()` | PostgREST | 无 `WHERE quantity`，仅 `ORDER BY quantity ASC` | ❌ |
| 5 | `getByProductId()` | PostgREST | 无 `WHERE quantity`，仅 `.eq('variant.product_id', id)` | ❌ |
| 6 | `getFollowedVariantsBasic()` (preferences) | PostgREST | 无 `WHERE quantity`，仅 `.in('variant_id', [...])` | ❌ |
| 7 | `canAccessVariant()` (warehouse-access) | PostgREST | 无 `WHERE quantity`，仅 `.eq('variant_id', ...)` | ❌ |
| 8 | `getById()` (products) | PostgREST | 无 `WHERE quantity`，仅 `.eq('variant.product_id', id)` | ❌ |
| 9 | `updateQuantity()` | PostgREST | `.eq('id', inventoryId)` — 按主键更新 | ❌ |
| 10 | `sync_warehouse_inventory` RPC (00006/00009/00014) | RPC | JOIN `variant_id + warehouse_id` | ❌ |
| 11 | `warehouse_shipment_transactional` RPC (00023) | RPC | `ON CONFLICT (variant_id, warehouse_id)` | ❌ |
| 12 | RLS policies (46 条) | RLS | `user_id / role / warehouse_id` 过滤 | ❌ |

### 关键发现

- 所有低库存/海外库存查询已由 PERF-S1（Migration 00027/00028）迁移至 RPC
- RPC 使用 `COALESCE(p.safety_stock, 0)` 动态参数，PostgreSQL planner 无法在计划时证明参数值 ≤ 500，因此不会选择 `idx_inventory_low_stock` partial index
- `idx_inventory_quantity WHERE quantity = 0` 的潜在使用者是 `get_overseas_inventory` RPC 中的 `p_stock_status = 'out_of_stock' AND i.quantity = 0` 分支。虽然也是参数化条件，但 `out_of_stock` 是海外库存页三个主要筛选状态之一，业务流量较高，静态分析不能完全排除 planner 在特定参数下选择该 partial index 的可能
- 剩余 PostgREST 查询均不按 `quantity` 过滤
- `list()` 的 `ORDER BY quantity ASC` 需要全量排序，而 partial index 只覆盖 `quantity <= 500` 的行，无法用于排序

### 结论

- **`idx_inventory_low_stock`：建议删除**。静态证据充分 — 所有低库存查询均使用 `COALESCE(safety_stock, 0)` 动态参数，planner 无法证明 ≤500，因此不会命中该 partial index。
- **`idx_inventory_quantity`：候选删除，删除前需运行时验证**。`get_overseas_inventory` out_of_stock 分支仍有 `p_stock_status = 'out_of_stock' AND i.quantity = 0` 条件，且该筛选为海外库存页高频使用场景，静态分析不能完全排除 planner 命中可能。

### 建议 Migration 草案（本轮不实施）

```sql
-- idx_inventory_low_stock: 静态证据充分，建议删除
--   低库存条件 quantity <= COALESCE(safety_stock, 0) 为动态参数，planner 无法证明 ≤500
DROP INDEX IF EXISTS public.idx_inventory_low_stock;

-- idx_inventory_quantity: 候选删除，需运行时验证
--   get_overseas_inventory out_of_stock 分支仍有 quantity = 0 条件，
--   需通过 pg_stat_user_indexes + EXPLAIN 确认未被使用后再纳入删除
-- DROP INDEX IF EXISTS public.idx_inventory_quantity;
```

### 运行时验证（删除前置条件）

在 Supabase SQL Editor 执行：

```sql
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname IN ('idx_inventory_low_stock', 'idx_inventory_quantity');
```

**注意**：`idx_scan = 0` 只能说明当前统计窗口内未观察到使用，不能排除过往使用或未来 planner 选择变更。建议结合最近业务流量（尤其是海外库存页 `out_of_stock` 筛选和低库存查询的使用频率）和 `EXPLAIN` 综合判断。

### 限制

- 纯静态评估，未连接 Supabase 数据库
- 未执行 `EXPLAIN` 或查询 `pg_stat_user_indexes`
- 未执行 Migration 删除
- `idx_inventory_quantity` 的最终删除决定依赖运行时验证结果

### 禁止事项（已遵守）

- 不修改 `supabase/migrations/*`
- 不新增删除索引 Migration
- 不改业务代码
- 不改 RLS / RPC / Repository
- 不修改 `.claude/context-status.json`
- 不处理 P3-S1B

### 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test`（全量非并发） | 2948/2948 通过（72 文件）✅ |
| `npm run build` | Turbopack ✓ 通过 ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有）✅ |
| `git diff --check` | 通过 ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `docs/current-state.md` | 更新 Phase + Task + 性能优化项 + Last Updated |
| 2 | `docs/tasks/current-task.md` | 本文件（完整评估记录）|

### 下一步

PERF-G 静态评估完成。建议先在 Supabase SQL Editor 执行 `pg_stat_user_indexes` 查询确认两个索引的实际使用情况：
- 如 `idx_inventory_low_stock` 确认无使用 → 可直接新增 Migration 删除
- 如 `idx_inventory_quantity` 确认无使用 → 可纳入同一 Migration 删除；如观察到使用 → 保留该索引
- 运行时验证完成后，再决定是否实施 Migration。

其他方向：推进 P3-S1B 恢复（百世 API，BLOCKED_EXTERNAL）、或开始新 Phase。
