# Current Task Packet

## Task ID

`P3-S5B1` — Migration 00026 + types/schema + migration tests

## 状态

**待开始**（2026-07-02，P3-S5B0 已完成并收口返修通过）

## 依赖

- P3-S5B0 DONE（旧版 00023 入仓入口已封存）

## 范围

### 1. Migration 00026

新建 `supabase/migrations/00026_partial_warehouse_shipment.sql`：

- 新增 `shipment.bigseller_absorbed_at TIMESTAMPTZ NULL` 列（Admin 手动确认 BigSeller 已吸收，NULL = 未确认）
- 新增 `partial_warehouse_shipment` RPC（SECURITY INVOKER，Admin-only）
  - 参数：`p_shipment_id UUID, p_items JSONB`（`[{variant_id, quantity}]`）
  - 校验：shipment 存在、非 warehoused、有 warehouse_id、status=customs
  - `FOR UPDATE` 锁定 shipment + shipment_item
  - 逐行校验 `quantity <= remaining`（quantity - warehoused_quantity）
  - `UPDATE shipment_item.warehoused_quantity += quantity`
  - 全部入仓时 `UPDATE shipment.status = 'warehoused'`
  - `INSERT tracking_event`（status='warehoused' 或 'partial_warehoused'）
  - **不写入 inventory.quantity**（inventory 唯一事实来源是 BigSeller）
  - 返回 JSONB：`{success, all_warehoused, items_updated}`
- REVOKE EXECUTE FROM PUBLIC, anon + GRANT EXECUTE TO authenticated

### 2. database.ts 类型同步

- `src/types/database.ts`：`Shipment` 表新增 `bigseller_absorbed_at: string | null`
- `Database.Functions` 新增 `partial_warehouse_shipment` 返回类型

### 3. Feature 类型与 Schema

- `src/features/shipments/types.ts`：
  - `PartialWarehouseItem`：`{ variantId: string; quantity: number }`
  - `PartialWarehouseShipmentData`：`{ shipmentId: string; items: PartialWarehouseItem[]; description?: string }`
  - `PartialWarehouseResult`：`{ success: boolean; allWarehoused: boolean; itemsUpdated: number }`
- `src/features/shipments/schema.ts`：
  - `partialWarehouseItemSchema`：Zod 校验 `variantId` UUID + `quantity` positive int
  - `partialWarehouseShipmentSchema`：Zod 校验数组非空 + 每项 quantity > 0

### 4. Migration 静态契约测试

`src/features/shipments/p3-s5b-migration.test.ts`：

| 分组 | 内容 |
|---|---|
| RPC 存在性 | `partial_warehouse_shipment` 函数定义 |
| 权限模型 | SECURITY INVOKER、不含 SECURITY DEFINER |
| REVOKE/GRANT | REVOKE FROM PUBLIC, anon + GRANT TO authenticated |
| Admin-only | `v_role != 'admin'` 校验 + 中文错误消息 |
| 业务规则 | FOR UPDATE × 2（shipment/shipment_item）、非 warehoused、warehouse_id NOT NULL、customs only、remaining > 0 |
| 不写 inventory | 不含 `INSERT INTO public.inventory`、不含 `ON CONFLICT`、不含 `EXCLUDED.quantity` |
| 原子写入 | `warehoused_quantity += quantity`、全部入仓 `status = 'warehoused'`、tracking_event 插入 |
| bigseller_absorbed_at | ALTER TABLE shipment ADD COLUMN bigseller_absorbed_at |
| 返回类型 | RETURNS JSONB、success/all_warehoused/items_updated 字段 |
| 中文错误 | RAISE EXCEPTION 含中文消息 |

### 5. 不实现

- **不实现** `partialWarehouseShipment` / `batchWarehouseShipments` / `confirmBigsellerAbsorption` Server Actions
- **不实现** Repository 方法（P3-S5B2）
- **不实现** 详情页双模式按钮 / PartialWarehouseDialog / BigsellerAbsorptionButton（P3-S5B3）
- **不实现** 批量 UI / 海外库存列（P3-S5B4）
- **不实现** 应用行为测试（P3-S5B5）
- **不修改** Migration 00023

## 质量门

- `npm run test -- src/features/shipments/` — 全部通过
- `npm run test` — 全部通过（concurrency 与 best live 预存 env 依赖除外）
- `npm run lint` — 0 new errors
- `npm run build` — PASS
- `git diff --check` — PASS

## 下一步

P3-S5B2 — Repository 方法 + Server Actions（依赖 P3-S5B1）

## 当前业务口径

P3-S5B0 已封存旧版 00023 入仓入口。P3-S5B1 创建 Migration 00026（RPC + `bigseller_absorbed_at` 列），这是 P3-S5B2~B5 的数据层基础。inventory.quantity 的唯一事实来源是 BigSeller 同步链路，DIS 入仓是运营跟踪工具，不写入 inventory。
