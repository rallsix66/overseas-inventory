# Current Task Packet

## Task ID

`PHASE-E` — 索引优化

## 状态

**DONE + REVISED + EXECUTED**（2026-07-07 返工修正并执行 00031）。

### 背景

Phase D（同步页服务端分页）完成后，对真实查询路径做了系统性审查，发现多处高频查询依赖单列索引 bitmap 合并、全量排序或 seq scan。需要补建针对性复合索引。

### 返工修正（2026-07-07）

独立审查发现 00031 初版中两个索引冗余、一个索引覆盖不精确：

1. **删除 `idx_inventory_variant_id ON inventory(variant_id)`**：Migration 00001 已有 `inventory_variant_warehouse_unique UNIQUE (variant_id, warehouse_id)`，自动生成的唯一索引 `variant_id` 前导列已覆盖单列 `variant_id` 查询，无需额外索引。

2. **删除 `idx_sync_run_warehouse_status ON sync_run(warehouse_id, status)`**：Migration 00007 已有 `CREATE UNIQUE INDEX idx_sync_run_one_in_progress ON sync_run(warehouse_id) WHERE status='in_progress'`（部分唯一索引），精确覆盖 `claim_sync_run` 的 `warehouse_id + status='in_progress'` FOR UPDATE 查询。`cleanup_expired_sync_runs` 的 `status='in_progress' + lease_expires_at < now()` 由 `idx_sync_run_status_lease` 覆盖。

3. **`idx_shipment_status_created` → `idx_shipment_active_created`**：原 `(status, created_at DESC)` 对 `status='customs'` 等值查询有效，但无法完整覆盖 `shipmentRepository.list()` 的 `.neq('status','warehoused').order('created_at',{ascending:false})`（不等值全局排序）。改为部分索引 `ON shipment(created_at DESC) WHERE status <> 'warehoused'` 精确匹配在途列表主查询。

### 实现

**审查范围**：
- `get_sync_runs_paginated` / `get_sync_runs` / `claim_sync_run` / `cleanup_expired_sync_runs` / `getWarehouseHistory`
- `get_overseas_inventory` / `get_overseas_stats` / `get_low_stock`
- `get_in_transit_confirmed_aggregate`
- `shipmentRepository.list()` / `listEligibleForBatchWarehousing()` / `getInTransitDetailsByVariantAndWarehouse()`
- `shipmentRepository.getById()` → tracking_event 时间线
- `user_variant_preference` LEFT JOIN 反连接

**Migration 00031** — `00031_phase_e_index_optimization.sql`（仅索引，7 个）：

| # | 索引名称 | 表 | 列 | 目标查询 |
|---|---------|----|-----|---------|
| 1 | `idx_sync_run_warehouse_started` | sync_run | `(warehouse_id, started_at DESC)` | 分页/历史排序 |
| 2 | `idx_sync_run_status_lease` | sync_run | `(status, lease_expires_at)` | cleanup 租约扫描 |
| 3 | `idx_shipment_warehouse_status` | shipment | `(warehouse_id, status)` | 在途明细/聚合过滤 |
| 4 | `idx_shipment_active_created` | shipment | `(created_at DESC) WHERE status <> 'warehoused'` | 在途列表主查询 / 批量入仓排序 |
| 5 | `idx_shipment_item_shipment_variant` | shipment_item | `(shipment_id, variant_id)` | 在途明细双列过滤 |
| 6 | `idx_uvp_variant_user_type` | user_variant_preference | `(variant_id, user_id, preference_type)` | 海外库存反连接 |
| 7 | `idx_tracking_event_shipment_occurred` | tracking_event | `(shipment_id, occurred_at)` | 轨迹时间线排序 |

所有索引均使用 `IF NOT EXISTS` 保证幂等。

**与已建索引的关系**：
- `idx_sync_run_warehouse_started`：补充 `idx_sync_run_warehouse_id`（00007），添加 `started_at DESC` 消除排序
- `idx_sync_run_status_lease`：补充 `idx_sync_run_status`（00007），添加 `lease_expires_at` 覆盖 cleanup 扫描
- `idx_shipment_warehouse_status`：合并 `idx_shipment_warehouse_id` + `idx_shipment_status`（均为 00001）的双列 bitmap 合并
- `idx_shipment_active_created`：全新 — `created_at` 此前无任何索引
- `idx_shipment_item_shipment_variant`：合并 `idx_shipment_item_shipment_id` + `idx_shipment_item_variant_id`（均为 00001）的双列 bitmap 合并
- `idx_uvp_variant_user_type`：补充现有唯一索引 `(user_id, variant_id, preference_type)`（00001），提供 `variant_id` 前导列
- `idx_tracking_event_shipment_occurred`：补充 `idx_tracking_event_shipment_id`（00001），添加 `occurred_at` 消除排序

**phase-e-indexes.test.ts**：35 项静态契约测试（仅索引变更 / 7 索引命名 / 目标表列 / schema 不破坏 / 幂等 / 文件元数据）。

### 禁止事项（已遵守）

- 不修改已执行 Migration 00001~00030
- 不改 Product/ProductVariant/Inventory 模型
- 不改 RLS、不放宽权限、不绕过 Repository / Server Action
- 不做无关重构、不改 UI
- 不修改 `.claude/`

### 验收

| 检查项 | 结果 |
|--------|------|
| `phase-e-indexes.test.ts` | **35/35** 通过 ✅ |
| `npm run test`（全量非并发） | **2905/2905** 通过（69 文件）✅ |
| `npm run build` | ✓ Compiled + TypeScript ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有，非本轮新增）✅ |
| `git diff --check` | 通过 ✅ |
| 不修改已执行 Migration | ✅ |
| 不修改 RLS/权限/RPC | ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `supabase/migrations/00031_phase_e_index_optimization.sql` | 返工修正：9→7 索引，删除 2 个冗余，1 个改为部分索引 |
| 2 | `src/features/sync/phase-e-indexes.test.ts` | 同步更新：35 项测试（7 索引 × 参数化） |
| 3 | `docs/current-state.md` | 返工状态同步 |
| 4 | `docs/tasks/current-task.md` | 返工 Task 记录（本文件） |

### 生产启用

Migration 00031 已在 Supabase SQL Editor 手动执行成功（2026-07-07，Success. No rows returned）。

### 残余风险

- 索引在低数据量（<1000 行）下收益不可感知，随数据增长逐步显现
- `lease_expires_at` 索引对 cleanup_expired_sync_runs 的加速效果依赖 in_progress 行数
- `idx_shipment_active_created` 部分索引仅覆盖 `status <> 'warehoused'` 行；`warehoused` 行的 `created_at` 排序无索引（已入仓查询通常不按时间排序）

### 下一步

Phase E 返工完成且 Migration 00031 已执行。可选择推进新 Phase 或 P3-S1B 恢复（百世 API 权限，仍 BLOCKED_EXTERNAL）。
