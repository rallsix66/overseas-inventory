# Current Task Packet

## Task ID

`P3-S5A` — 手动确认入仓事务与库存联动

## 状态

**DONE**（2026-06-30）

## 背景

P3-S4A 已完成状态流转规则收口（Migration 00022 已执行并验证），warehoused 状态禁止手动推进。P3-S5A 新增专用的入仓 RPC（Migration 00023），在同一数据库事务内完成：shipment.status→warehoused + shipment_item.warehoused_quantity→quantity + inventory.quantity 增加 + tracking_event 插入。

仅 Admin 可执行；仅 customs 状态允许入仓；禁止重复入仓；必须有 warehouse_id。

## 依赖

- P3-S4A DONE（`change_shipment_status_transactional` RPC + Migration 00022 已执行）
- P3-S2E DONE（Admin-only 权限覆盖）

## 范围

1. **Migration 00023** — 新增 `warehouse_shipment_transactional` RPC：SECURITY INVOKER + Admin-only + FOR UPDATE 行锁 + 逐 item 超量保护 + UPSERT inventory + 同事务 atomic

2. **Schema / Types** — 新增 `warehouseShipmentSchema`（shipmentId uuid + description optional max 500）+ `WarehouseShipmentData` 类型

3. **Repository** — `warehouseShipment()` 调用 RPC，DB/RLS 错误传递为 ShipmentError

4. **Server Action** — `warehouseShipment()` Admin-only + Zod 校验 + revalidatePath 列表与详情 + 中文错误

5. **UI** — `WarehouseShipmentButton` 组件：Dialog 二次确认 + 不可撤销警告 + 备注输入。详情页 customs 状态显示按钮，非 customs 显示原因，Operator 不显示

6. **测试** — 90 项新测试：8 Zod + 28 Migration 源码检查 + 7 详情页源码 + 13 按钮组件源码 + 7 仓库行为 + 13 actions + 14 仓库/actions 源码检查

## 禁止

- 不接 Best/external 表
- 不自动入仓
- 不允许 Operator 写
- 不在页面或客户端组件直接访问 Supabase
- 不修改 00022 或更早 Migration
- 不做库存历史、批量入仓、部分入仓、回滚撤销入仓

## 停止条件（全部满足）

1. Migration 00023：`warehouse_shipment_transactional` RPC 新增 ✓
2. `warehouseShipmentSchema` Zod schema ✓
3. Repository `warehouseShipment()` 调用 RPC ✓
4. Actions `warehouseShipment()` Admin-only + 中文错误 ✓
5. `WarehouseShipmentButton` 组件二次确认 + 不可撤销警告 ✓
6. 详情页 customs 显示按钮 / 非 customs 显示原因 / Operator 隐藏 ✓
7. `npm run test` 1778/1778（51 文件），`npm run lint` 0 errors / 25 warnings，`npm run build` 通过，`git diff --check` 通过 ✓

## 下一步

- Migration 00023 待用户在 Supabase SQL Editor 手动执行
- P3-S5B 或 P3-S6 就绪
