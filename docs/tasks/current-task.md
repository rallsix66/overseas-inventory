# Current Task Packet

## Task ID

`PERF-S1D` — 关键按钮局部更新，减少 router.refresh()

## 状态

**DONE**（2026-07-03）。PERF-S1A/B/C 全部完成。PERF-S1D 已完成关键按钮局部更新：
- **关注按钮**：移除 `router.refresh()`，仅乐观更新（`useOptimistic`），关注状态不改变库存数量/统计
- **确认到仓**：`PartialWarehouseDialog` → `PartialWarehouseEntry` → `ShipmentDetailClient` 通过 `onSuccess` 回调链触发局部 `getShipmentDetail()` 刷新
- **BigSeller 吸收**：本地 `absorbed` 状态隐藏按钮 + `onSuccess` 回调触发 `ShipmentDetailClient` 局部刷新
- **批量入仓页**：已在 PERF-S1B 使用 `loadPage()` 局部刷新，无需修改
- 新增 `ShipmentDetailClient` Client Component：管理在途详情页交互区（header + action buttons + items table）本地状态
全量 2639/2639（63 文件），build pass，lint 5 errors / 25 warnings（all pre-existing），git diff --check pass。
下一步：**PERF-S1E**（质量门/文档收口/性能验收）。

## 依赖

- PERF-S1A DONE（Migration 00027 三个 RPC + 79 项静态契约测试）
- P3-S5B0~B5 全部 DONE

## 范围（已完成）

### 1. Repository 改造

| 方法 | 改动 | 目标 RPC |
|---|---|---|
| `getOverseasList` | 移除 JS 全量过滤/排序/分页，改为调用 RPC + snake_case→camelCase 映射 | `get_overseas_inventory` |
| `getOverseasStats` | 移除 JS 循环聚合，基础统计改为调用 RPC，在途统计保留在调用方计算 | `get_overseas_stats` |
| `getInTransitConfirmedAggregate`（新增） | 单次 RPC 返回所有仓库的 (warehouse_id, variant_id, in_transit_quantity, confirmed_quantity) 四元组 | `get_in_transit_confirmed_aggregate` |

### 2. Actions 改造

- `getOverseasInventory`:
  - 移除 `shipmentRepository.getInTransitByVariantAndWarehouse()` 调用
  - 移除 `uniqueWarehouseIds.map(whId => getConfirmedWarehousedByWarehouse(whId))` N+1 循环
  - 改为单次 `inventoryRepository.getInTransitConfirmedAggregate(userId)` 调用
  - 从聚合结果构建 `whInTransitMap` / `variantTotalMap` / `confirmedMap`
- `updateInventoryQuantity` 未修改
- `shipmentRepository` import 已移除

### 3. 类型更新

- `database.ts` 新增三个 RPC 函数签名（`get_overseas_inventory` / `get_overseas_stats` / `get_in_transit_confirmed_aggregate`）
- `repository.ts` 新增 `RawOverseasInventoryRow` / `RawAggregateRow` 内部类型 + `mapOverseasRow` 映射函数

### 4. 安全合规

- `getOverseasInventory` 继续使用 `requireAuth()` → Zod `safeParse` → Repository → RPC
- RPC 内部 `auth.uid()` 绑定 `p_user_id`（SECURITY INVOKER）
- Admin/Operator 仓库隔离由 RPC SQL 层完成（`get_user_role()` / `get_assigned_warehouse_ids()`）
- 页面/组件不直接调用 `supabase.from()` 或 `supabase.rpc()`

### 5. 测试

更新 13 项现有测试（p5-sy11g-d-inventory / p3-s5b5-behavior / p5-sy13a / p5-sy12-dashboard / p3-s5b4-batch-warehouse），从旧 JS 过滤/N+1 模式断言改为 RPC 接入模式断言。

### 6. 不实现

- 不修改 Migration 00027 内容
- 不再次执行 Migration（00027 已于 2026-07-03 在 Supabase 执行并通过数据库侧 smoke 验证）
- 不修改页面 UI / Client Component
- 不改变 inventory.quantity 业务口径
- 不让 DIS 入仓流程写 inventory.quantity
- 不绕过 Repository / Server Action / Zod / RLS

## 下一步

**PERF-S1D**：关键按钮局部更新，减少 `router.refresh()`（关注/入仓等按钮去整页刷新，改为局部状态更新）。PERF-S1C 的聚合内容（合并在途 + 已确认到仓聚合、消除按仓循环查询）已并入 PERF-S1B 完成。不引入 `revalidateTag` 除非先设计缓存边界。

## 质量门

PERF-S1B 通过（2026-07-03）：
- 修改 `repository.ts`（~290 行）+ `actions.ts`（精简 ~40 行）+ `database.ts`（+3 个 RPC 签名）
- 全量 2639/2639（63 文件）
- build pass
- lint 5 errors / 26 warnings（all pre-existing）
- git diff --check pass

## 当前业务口径

inventory.quantity 唯一事实来源是 BigSeller。DIS 确认到仓仅更新 shipment_item.warehoused_quantity + shipment.status + tracking_event。`bigseller_absorbed_at` 由 Admin 手动确认（NULL = 未确认吸收）。BigSeller 同步库存 ≠ DIS 到仓进度，两个事实来源独立展示。

在途 = shipment 非 warehoused 的 (quantity - warehoused_quantity)，已确认到仓 = customs 或 (warehoused + bigseller_absorbed_at IS NULL) 的 warehoused_quantity。
