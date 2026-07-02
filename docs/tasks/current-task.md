# Current Task Packet

## Task ID

`P3-S5B2` — Repository 方法 + Server Actions

## 状态

**待开始**（2026-07-02，P3-S5B0、P3-S5B1 已完成。P3-S5B2 尚未实现）

## 依赖

- P3-S5B0 DONE（旧版 00023 入仓入口已封存）
- P3-S5B1 DONE（Migration 00026 + types/schema + 93 项静态测试。Migration 00026 未执行）

## 范围（待实现）

### 1. Repository 方法

在 `src/features/shipments/repository.ts` 新增：

- `partialWarehouse(shipmentId, items, userId)` — 调用 `partial_warehouse_shipment` RPC
- `listEligibleForBatchWarehousing(filters, userId)` — 查询可批量入仓的 shipments（customs + 有仓库）
- `getConfirmedWarehousedQuantity(variantId, warehouseId)` — 某 variant 在某仓库的已确认入仓总量
- `getConfirmedWarehousedByWarehouse(warehouseId)` — 某仓库的已确认入仓聚合
- `confirmBigsellerAbsorption(shipmentId, userId)` — 设置 `bigseller_absorbed_at = now()`

### 2. Server Actions

在 `src/features/shipments/actions.ts` 新增：

- `partialWarehouseShipment(data: PartialWarehouseShipmentData)` — Admin-only + Zod + RPC
- `batchWarehouseShipments(data: BatchWarehouseData)` — Admin-only + Zod + 逐条 RPC
- `confirmBigsellerAbsorption(shipmentId: string)` — Admin-only + Zod + Repository

### 3. 不实现

- 不实现 UI / Dialog / 按钮（P3-S5B3）
- 不实现批量 UI / 海外库存列（P3-S5B4）
- 不实现应用行为测试（P3-S5B5）
- 不修改 Migration 00023

## 待执行

- Migration 00026 需在 P3-S5B2 实现前由用户在 Supabase SQL Editor 手动执行
- 执行后验证：`bigseller_absorbed_at` 列存在 + `partial_warehouse_shipment` RPC 存在 + admin-only + REVOKE/GRANT 正确

## 下一步

P3-S5B3 — 详情页双模式按钮 + PartialWarehouseDialog + BigsellerAbsorptionButton（依赖 P3-S5B2）

## 当前业务口径

inventory.quantity 唯一事实来源是 BigSeller。DIS 确认到仓仅更新 shipment_item.warehoused_quantity + shipment.status + tracking_event。`bigseller_absorbed_at` 由 Admin 手动确认（NULL = 未确认吸收）。
